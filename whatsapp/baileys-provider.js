const { WhatsAppProvider } = require("./provider");
const { AuthStore } = require("./auth-store");
const fs = require("fs");
const path = require("path");

class BaileysProvider extends WhatsAppProvider {
  constructor(config, onStatus, onChatEvent, userDataPath) {
    super(config, onStatus);
    this.authStore = new AuthStore(userDataPath);
    this.onChatEvent = onChatEvent || (() => {});
    this.sock = null;
    this._status = "disconnected";
    this._phoneNumber = null;
    this._reconnectAttempts = 0;
    this._maxReconnects = 5;
    this._shouldStop = false;
    this._chats = {};
    this._messages = {};
    this._contacts = {};
    this._jidAliases = {}; // Maps LID <-> PN when Baileys provides both
    this._msgIndex = {}; // Set() index per JID for O(1) dedup
    this._MAX_MSGS_PER_CHAT = 300; // Keep enough recent history for reopened chats
    this._saveTimer = null;
    this._chatUpdateTimer = null;
    this._profilePicCache = {}; // Cache de fotos de perfil (jid -> url|null)
    this._dataPath = path.join(userDataPath, "sigma-chats.json");
    this._syncStats = null;
    this._syncActive = false; // Flag to enable adaptive throttling during sync
  }

  async connect() {
    const {
      makeWASocket,
      DisconnectReason,
      fetchLatestBaileysVersion,
      Browsers,
      makeCacheableSignalKeyStore,
    } = require("@whiskeysockets/baileys");
    const pino = require("pino");
    const logger = pino({ level: "silent" });

    this._shouldStop = false;
    this._reconnectAttempts = 0;

    // Load persisted chats
    try {
      if (fs.existsSync(this._dataPath)) {
        const d = JSON.parse(fs.readFileSync(this._dataPath, "utf-8"));
        this._chats = d.chats || {};
        this._messages = d.messages || {};
        this._contacts = d.contacts || {};
        this._jidAliases = d.jidAliases || {};
        this._profilePicCache = d.profilePicCache || {};
        this._normalizeStoredContacts();
        this._rebuildAliasesFromContacts();

        // Recover pushNames from stored messages to populate contacts
        for (const jid of Object.keys(this._messages)) {
          for (const msg of this._messages[jid]) {
            if (msg.pushName) {
              const senderJid =
                msg.key?.participant || (!msg.key?.fromMe ? jid : null);
              if (senderJid) {
                this._upsertContact(
                  { id: senderJid, name: msg.pushName, notify: msg.pushName },
                  false,
                );
              }
            }
          }
        }

        // Sync names in chats
        for (const jid of Object.keys(this._chats)) {
          const c = this._chats[jid];
          if (
            !c.name ||
            c.name === jid.split("@")[0] ||
            /^\+?\d[\d\s\-()]+$/.test(c.name)
          ) {
            const contactName = this._getContactName(jid);
            if (contactName) c.name = contactName;
          }
        }

        // Rebuild Set() index from loaded messages
        this._rebuildMsgIndex();
        // Trim loaded messages to respect the limit
        this._trimAllMessages();
        console.log(
          "[BAILEYS] Loaded",
          Object.keys(this._chats).length,
          "chats from disk",
        );
      }
    } catch (e) {
      console.log("[BAILEYS] Load error:", e.message);
      this._chats = {};
      this._messages = {};
      this._contacts = {};
      this._jidAliases = {};
      this._msgIndex = {};
    }

    const { state, saveCreds } = await this.authStore.loadBaileysState();

    return new Promise((resolve, reject) => {
      const startSocket = async () => {
        if (this._shouldStop) return;
        this._status = "connecting";

        let version;
        try {
          const v = await fetchLatestBaileysVersion();
          version = v.version;
        } catch (e) {}

        this.sock = makeWASocket({
          version,
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
          },
          logger,
          browser: Browsers.windows("Desktop"),
          syncFullHistory: false, // Only sync recent history to avoid UI freeze
          shouldSyncHistoryMessage: () => true,
          fireInitQueries: true,
          emitOwnEvents: true,
          markOnlineOnConnect: false,
          connectTimeoutMs: 60000,
          defaultQueryTimeoutMs: undefined,
          qrTimeout: 60000,
          getMessage: async (key) => {
            // Return stored message for protocol to resolve references
            if (this._messages[key.remoteJid]) {
              return this._messages[key.remoteJid].find(
                (m) => m.key?.id === key.id,
              );
            }
            return undefined;
          },
        });

        this.onStatus("connecting", { msg: "Waiting for QR scan..." });

        // ─── MESSAGES ──────────────────────────
        this.sock.ev.on("messages.upsert", ({ messages, type }) => {
          for (const msg of messages) {
            if (!msg.message || !msg.key) continue;
            const hasContent =
              msg.message.conversation ||
              msg.message.extendedTextMessage ||
              msg.message.imageMessage ||
              msg.message.videoMessage ||
              msg.message.audioMessage ||
              msg.message.documentMessage ||
              msg.message.stickerMessage ||
              msg.message.contactMessage;
            if (!hasContent) continue;

            const jid = msg.key.remoteJid;
            if (
              !jid ||
              jid.includes("@broadcast") ||
              jid === "status@broadcast"
            )
              continue;
            this._learnMessageAliases(msg);

            // O(1) dedup with Set index
            this._addMessage(jid, msg);
            this._upsertChatFromMessage(jid, msg);

            const isGroup = jid.endsWith("@g.us");
            const c = this._chats[jid];
            if (msg.pushName && !isGroup) c.name = msg.pushName;
            if (msg.messageTimestamp > c.timestamp)
              c.timestamp = msg.messageTimestamp;

            const txt =
              msg.message.conversation ||
              msg.message.extendedTextMessage?.text ||
              "";
            if (txt) c.lastMessage = (msg.key.fromMe ? "Você: " : "") + txt;

            if (type === "notify" && !msg.key.fromMe) {
              c.unread = (c.unread || 0) + 1;
              this.onChatEvent({
                type: "message-received",
                jid,
                phoneJid: this._getPhoneJid(jid),
                message: msg,
              });
            }
          }
          // Persist with debounce (not every single event)
          this._saveData();
          this._emitChatUpdate();
        });

        const logTracking = (msg) => {
          try {
            const logPath = path.join(userDataPath, "whatsapp-tracking.log");
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
          } catch (e) {}
        };

        this.sock.ev.on("messages.update", (updates) => {
          for (const update of updates || []) {
            const id = update.key?.id;
            if (!id) continue;
            const rawStatus = update.update?.status;
            let status = null;
            if (rawStatus === 3 || rawStatus === "DELIVERY_ACK") status = "delivered";
            if (rawStatus === 4 || rawStatus === "READ") status = "read";
            
            if (rawStatus) {
              logTracking(`messages.update id=${id} rawStatus=${rawStatus} parsed=${status}`);
            }
            
            if (!status) continue;
            this.onChatEvent({
              type: "message-status",
              jid: update.key.remoteJid,
              messageId: id,
              status,
            });
          }
        });

        this.sock.ev.on("message-receipt.update", (receipts) => {
          for (const receipt of receipts || []) {
            const id = receipt.key?.id;
            if (!id) continue;
            
            let status = null;
            const type = receipt.type;
            const rData = receipt.receipt || {};
            
            if (rData.readTimestamp || type === 'read' || type === 'read-self') status = "read";
            else if (rData.receiptTimestamp || type === 'delivered' || type === 'inactive') status = "delivered";
            
            logTracking(`message-receipt.update id=${id} type=${type} parsed=${status} receiptData=${JSON.stringify(rData)}`);
            
            if (!status) continue;
            this.onChatEvent({
              type: "message-status",
              jid: receipt.key.remoteJid,
              messageId: id,
              status,
            });
          }
        });

        // ─── HISTORY SYNC ──────────────────────
        this.sock.ev.on(
          "messaging-history.set",
          ({
            chats,
            messages,
            contacts,
            lidPnMappings,
            isLatest,
            progress,
          }) => {
            console.log(
              "[BAILEYS] messaging-history.set chats:",
              chats?.length,
              "msgs:",
              messages?.length,
              "contacts:",
              contacts?.length,
              "isLatest:",
              isLatest,
              "progress:",
              progress,
            );
            this._syncStats = this._syncStats || {
              chats: Object.keys(this._chats).length,
              newChats: 0,
              messages: 0,
              contacts: 0,
              groups: 0,
              progress: 0,
              isLatest: false,
            };
            this._syncStats.chats = Object.keys(this._chats).length;
            this._syncStats.newChats += chats?.length || 0;
            this._syncStats.messages += messages?.length || 0;
            this._syncStats.contacts += contacts?.length || 0;
            this._syncStats.progress = Math.max(
              this._syncStats.progress || 0,
              Number(progress) || 0,
            );
            this._syncStats.isLatest = !!isLatest;
            this.onChatEvent({
              type: "sync-progress",
              stats: { ...this._syncStats },
            });
            if (chats)
              for (const c of chats) {
                if (!c.id || c.id.includes("@broadcast")) continue;
                this._upsertContact(c, false);
                const existing = this._chats[c.id];
                if (!this._shouldKeepChatRecord(c, existing)) continue;
                const isGroup = c.id.endsWith("@g.us");
                this._chats[c.id] = {
                  jid: c.id,
                  name:
                    c.name ||
                    c.subject ||
                    this._resolveName(c.id) ||
                    c.id.split("@")[0],
                  lastMessage: this._chats[c.id]?.lastMessage || "",
                  unread: c.unreadCount || 0,
                  timestamp: c.conversationTimestamp || c.t || 0,
                  pinned: c.pinned || c.pin || 0,
                  archived: !!c.archive,
                  isGroup,
                };
              }
            if (messages)
              for (const m of messages) {
                const jid = m.key?.remoteJid;
                if (!jid || jid.includes("@broadcast")) continue;
                this._learnMessageAliases(m);
                // O(1) dedup with Set index
                this._addMessage(jid, m);
                this._upsertChatFromMessage(jid, m);
              }
            if (contacts)
              for (const ct of contacts) {
                this._upsertContact(ct, false);
              }
            this._handleLidMappings(lidPnMappings);
            this._saveData();
            this._emitChatUpdate();
          },
        );

        // ─── CHATS ─────────────────────────────
        const onChats = (chats) => {
          for (const c of Array.isArray(chats)
            ? chats
            : [chats].filter(Boolean)) {
            if (!c.id || c.id.includes("@broadcast")) continue;
            const isGroup = c.id.endsWith("@g.us");
            this._upsertContact(c, false);
            const existing = this._chats[c.id];
            if (!this._shouldKeepChatRecord(c, existing)) continue;
            this._chats[c.id] = {
              jid: c.id,
              name:
                c.name ||
                c.subject ||
                existing?.name ||
                this._resolveName(c.id) ||
                c.id.split("@")[0],
              lastMessage: existing?.lastMessage || "",
              unread: c.unreadCount || existing?.unread || 0,
              timestamp:
                c.conversationTimestamp ||
                c.t ||
                existing?.timestamp ||
                0,
              pinned: c.pinned || c.pin || existing?.pinned || 0,
              archived:
                c.archive !== undefined
                  ? !!c.archive
                  : existing?.archived || false,
              isGroup,
            };
          }
          this._saveData();
          this._emitChatUpdate();
        };
        this.sock.ev.on("chats.set", onChats);
        this.sock.ev.on("chats.update", onChats);
        this.sock.ev.on("chats.upsert", onChats);
        this.sock.ev.on("groups.upsert", onChats);
        this.sock.ev.on("groups.update", onChats);

        // ─── CONTACTS ──────────────────────────
        const onContacts = (data) => {
          const list = Array.isArray(data)
            ? data
            : (data?.contacts || [data]).filter(Boolean);
          for (const c of list) {
            this._upsertContact(c, false);
          }
          this._saveData();
          this._emitChatUpdate();
        };
        this.sock.ev.on("contacts.set", (data) =>
          onContacts(data?.contacts || data),
        );
        this.sock.ev.on("contacts.update", onContacts);
        this.sock.ev.on("contacts.upsert", onContacts);
        this.sock.ev.on("lid-mapping.update", (mapping) => {
          this._handleLidMappings(mapping);
          this._saveData();
          this._emitChatUpdate();
        });

        this.sock.ev.on("creds.update", saveCreds);

        // ─── CONNECTION ───────────────────────
        this.sock.ev.on("connection.update", async (update) => {
          const { connection, lastDisconnect, qr } = update;
          if (qr && !this._opened) {
            this._status = "qr_ready";
            this.onStatus("qr_ready", { qrData: qr });
          }
          if (connection === "open") {
            this._opened = true;
            this._status = "connected";
            this._reconnectAttempts = 0;
            this._phoneNumber = this.sock.user?.id?.split(":")[0] || null;
            this.onStatus("connected", { phoneNumber: this._phoneNumber });
            this._syncActive = true;
            this._syncStats = {
              chats: Object.keys(this._chats).length,
              newChats: 0,
              messages: 0,
              contacts: 0,
              groups: 0,
              progress: 0,
              isLatest: false,
            };
            this.onChatEvent({ type: "sync-start", stats: this._syncStats });
            this._emitChatUpdate();

            // Post-connect presence (reduced: 1 group fetch instead of 3)
            setTimeout(async () => {
              try {
                await this.sock.waitForSocketOpen();
                await this.sock.sendPresenceUpdate("available");
                await this._fetchGroupsNow();
                console.log("[BAILEYS] Sync attempt done. Waiting for data...");
              } catch (e) {
                console.log("[BAILEYS] Post-connect:", e.message);
              }
            }, 3000);
            setTimeout(() => {
              this._syncActive = false;
              if (this._syncStats) this._syncStats.progress = 100;
              this.onChatEvent({
                type: "sync-done",
                stats: this._syncStats || {
                  chats: Object.keys(this._chats).length,
                  progress: 100,
                },
              });
            }, 15000);
            resolve();
          }
          if (connection === "close") {
            if (this._opened) {
              this._status = "disconnected";
              this._phoneNumber = null;
              this.onStatus("disconnected", { msg: "Connection lost" });
              return;
            }
            const err = lastDisconnect?.error;
            if (err?.output?.statusCode === DisconnectReason.loggedOut) {
              await this.authStore.clearBaileysAuth();
              reject(new Error("Logged out"));
              return;
            }
            this._reconnectAttempts++;
            if (this._reconnectAttempts > this._maxReconnects) {
              reject(new Error("Max retries"));
              return;
            }
            try {
              this.sock?.end?.();
            } catch (e) {}
            this.sock = null;
            await new Promise((r) =>
              setTimeout(r, 2000 * Math.pow(2, this._reconnectAttempts - 1)),
            ).then(startSocket);
          }
        });
      };
      startSocket();
    });
  }

  async _fetchGroupsNow() {
    if (!this.sock || this._status !== "connected") return;
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      for (const meta of Object.values(groups || {})) {
        if (!meta?.id) continue;
        const existing = this._chats[meta.id] || {};
        this._chats[meta.id] = {
          jid: meta.id,
          name: meta.subject || existing.name || "Grupo",
          lastMessage: existing.lastMessage || "",
          unread: existing.unread || 0,
          timestamp: existing.timestamp || meta.creation || 0,
          pinned: existing.pinned || 0,
          archived: existing.archived || false,
          isGroup: true,
        };
      }
      this._saveData();
      this._emitChatUpdate();
      const groupCount = Object.keys(groups || {}).length;
      this._syncStats = this._syncStats || {};
      this._syncStats.chats = Object.keys(this._chats).length;
      this._syncStats.groups = groupCount;
      this._syncStats.stage = "groups";
      this.onChatEvent({
        type: "sync-progress",
        stats: { ...this._syncStats },
      });
      console.log("[BAILEYS] Groups fetched:", groupCount);
    } catch (e) {
      console.log("[BAILEYS] groupFetchAllParticipating:", e.message);
    }
  }

  // ─── OTIMIZAÇÃO: Message management with O(1) dedup and RAM limit ───
  _addMessage(jid, msg) {
    if (!msg.key?.id) return;
    if (!this._msgIndex[jid]) this._msgIndex[jid] = new Set();
    if (this._msgIndex[jid].has(msg.key.id)) return; // Already exists, skip

    this._msgIndex[jid].add(msg.key.id);
    if (!this._messages[jid]) this._messages[jid] = [];
    this._messages[jid].push(msg);

    // Capture pushName for unknown contacts
    if (msg.pushName) {
      const senderJid = msg.key.participant || (!msg.key.fromMe ? jid : null);
      if (senderJid) {
        this._upsertContact(
          { id: senderJid, name: msg.pushName, notify: msg.pushName },
          false,
        );
      }
    }

    // Trim oldest messages if over limit
    while (this._messages[jid].length > this._MAX_MSGS_PER_CHAT) {
      const removed = this._messages[jid].shift();
      if (removed?.key?.id) this._msgIndex[jid].delete(removed.key.id);
    }
  }

  _getMessageText(msg) {
    const mc = msg?.message || {};
    return (
      mc.conversation ||
      mc.extendedTextMessage?.text ||
      mc.imageMessage?.caption ||
      mc.videoMessage?.caption ||
      (mc.imageMessage ? "📷 Foto" : "") ||
      (mc.videoMessage ? "🎬 Vídeo" : "") ||
      (mc.audioMessage ? "🎵 Áudio" : "") ||
      (mc.documentMessage
        ? "📄 " + (mc.documentMessage.fileName || "Documento")
        : "") ||
      (mc.stickerMessage ? "🌟 Figurinha" : "") ||
      (mc.contactMessage ? "👤 Contato" : "") ||
      ""
    );
  }

  _timestampToNumber(ts) {
    if (!ts) return 0;
    if (typeof ts === "number") return ts;
    if (typeof ts === "object" && ts.low !== undefined) return ts.low;
    return Number(ts) || 0;
  }

  _upsertChatFromMessage(jid, msg) {
    if (!jid || jid.includes("@broadcast") || jid === "status@broadcast")
      return;
    const isGroup = jid.endsWith("@g.us");
    if (!this._chats[jid]) {
      this._chats[jid] = {
        jid,
        name: isGroup
          ? this._resolveName(jid) || "Grupo"
          : msg.pushName || this._resolveName(jid) || jid.split("@")[0],
        lastMessage: "",
        unread: 0,
        timestamp: 0,
        pinned: 0,
        archived: false,
        isGroup,
      };
    }

    const c = this._chats[jid];
    c.isGroup = isGroup;
    const ts = this._timestampToNumber(msg.messageTimestamp);
    if (ts > (c.timestamp || 0)) c.timestamp = ts;

    const text = this._getMessageText(msg);
    if (text) c.lastMessage = (msg.key?.fromMe ? "Você: " : "") + text;

    if (!isGroup && msg.pushName && this._isRawNumericName(c.name))
      c.name = msg.pushName;
  }

  _hasConversationData(chat) {
    if (!chat) return false;
    if ((this._messages[chat.jid] || []).length > 0) return true;
    if (chat.lastMessage) return true;
    if ((chat.unread || 0) > 0) return true;
    return (chat.timestamp || 0) > 0;
  }

  _shouldKeepChatRecord(raw, existing) {
    if (!raw?.id || raw.id.includes("@broadcast") || raw.id === "status@broadcast")
      return false;
    if (raw.id.endsWith("@g.us")) return true;
    if (existing && this._hasConversationData(existing)) return true;
    return !!(
      raw.conversationTimestamp ||
      raw.t ||
      raw.unreadCount ||
      raw.lastMessage ||
      raw.messages?.length
    );
  }

  _rebuildMsgIndex() {
    this._msgIndex = {};
    for (const jid of Object.keys(this._messages)) {
      this._msgIndex[jid] = new Set();
      for (const m of this._messages[jid]) {
        if (m.key?.id) this._msgIndex[jid].add(m.key.id);
      }
    }
  }

  _trimAllMessages() {
    for (const jid of Object.keys(this._messages)) {
      if (this._messages[jid].length > this._MAX_MSGS_PER_CHAT) {
        const trimmed = this._messages[jid].slice(-this._MAX_MSGS_PER_CHAT);
        this._messages[jid] = trimmed;
        // Rebuild index for this jid
        this._msgIndex[jid] = new Set();
        for (const m of trimmed) {
          if (m.key?.id) this._msgIndex[jid].add(m.key.id);
        }
      }
    }
  }

  // ─── OTIMIZAÇÃO: Debounced save (async, adaptive delay) ────────────
  _saveData() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    const delay = this._syncActive ? 30000 : 10000;
    this._saveTimer = setTimeout(() => this._doSave(), delay);
  }

  _doSave() {
    try {
      const data = JSON.stringify({
        chats: this._chats,
        messages: this._messages,
        contacts: this._contacts,
        jidAliases: this._jidAliases,
        profilePicCache: this._profilePicCache,
      });
      fs.writeFile(this._dataPath, data, (err) => {
        if (err) console.log("[BAILEYS] Save error:", err.message);
      });
    } catch (e) {
      console.log("[BAILEYS] Serialize error:", e.message);
    }
  }

  // Force immediate save (for disconnect/shutdown)
  _saveDataNow() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    try {
      fs.writeFileSync(
        this._dataPath,
        JSON.stringify({
          chats: this._chats,
          messages: this._messages,
          contacts: this._contacts,
          jidAliases: this._jidAliases,
          profilePicCache: this._profilePicCache,
        }),
      );
    } catch (e) {}
  }

  // ─── OTIMIZAÇÃO: Debounced chat-update events (adaptive throttle) ──
  _emitChatUpdate() {
    if (this._chatUpdateTimer) return; // Already scheduled, skip
    const delay = this._syncActive ? 3000 : 500;
    this._chatUpdateTimer = setTimeout(() => {
      this._chatUpdateTimer = null;
      this.onChatEvent({ type: "chat-update" });
    }, delay);
  }

  async disconnect() {
    this._shouldStop = true;
    this._saveDataNow(); // Force immediate save on disconnect
    if (this.sock) {
      try {
        this.sock.end();
      } catch (e) {}
      this.sock = null;
    }
    this._status = "disconnected";
    this._phoneNumber = null;
    this.onStatus("disconnected");
  }

  // ─── CONTACT/JID HELPERS ───────────────────
  _bareJid(jid) {
    if (!jid || typeof jid !== "string") return jid;
    return jid.split(":")[0];
  }

  _isPhoneJid(jid) {
    return /@(s\.whatsapp\.net|c\.us)$/.test(jid || "");
  }

  _isLidJid(jid) {
    return /@lid$/.test(jid || "");
  }

  _isRawNumericName(value) {
    return !value || /^\+?\d[\d\s\-()]*$/.test(String(value));
  }

  _normalizeContactRecord(value, id) {
    if (!value) return { id };
    if (typeof value === "string") return { id, name: value };
    return { id, ...value };
  }

  _normalizeStoredContacts() {
    for (const id of Object.keys(this._contacts || {})) {
      this._contacts[id] = this._normalizeContactRecord(this._contacts[id], id);
    }
  }

  _registerAlias(a, b) {
    if (!a || !b || a === b) return;
    this._jidAliases[a] = b;
    this._jidAliases[b] = a;
  }

  _rebuildAliasesFromContacts() {
    this._jidAliases = this._jidAliases || {};
    for (const [id, raw] of Object.entries(this._contacts || {})) {
      const c = this._normalizeContactRecord(raw, id);
      if (c.phoneNumber) this._registerAlias(id, c.phoneNumber);
      if (c.lid) this._registerAlias(id, c.lid);
      if (c.pn) this._registerAlias(id, c.pn);
    }
  }

  _getContact(jid) {
    const direct = this._contacts[jid];
    if (direct) return this._normalizeContactRecord(direct, jid);
    const alias = this._jidAliases[jid];
    if (alias && this._contacts[alias])
      return this._normalizeContactRecord(this._contacts[alias], alias);
    return null;
  }

  _getContactName(jid) {
    const c = this._getContact(jid);
    const name = c?.name || c?.notify || c?.verifiedName;
    return name && !this._isRawNumericName(name) ? name : null;
  }

  _getPhoneJid(jid) {
    if (!jid) return null;
    if (this._isPhoneJid(jid)) return jid;
    const c = this._getContact(jid);
    if (c?.phoneNumber) return c.phoneNumber;
    if (c?.pn) return c.pn;
    const alias = this._jidAliases[jid];
    if (this._isPhoneJid(alias)) return alias;
    return null;
  }

  _getDisplayJid(jid) {
    return this._getPhoneJid(jid) || jid;
  }

  _toMessageJid(to) {
    if (!to) return "";
    if (String(to).includes("@")) return String(to);
    const digits = String(to).replace(/\D/g, "");
    return digits ? `${digits}@s.whatsapp.net` : String(to);
  }

  _getCachedProfilePicture(jid) {
    if (this._profilePicCache[jid]) return this._profilePicCache[jid];
    const aliases = [jid, this._getPhoneJid(jid), this._jidAliases[jid]].filter(Boolean);
    const hit = Object.entries(this._profilePicCache || {}).find(([key]) =>
      aliases.some((alias) => key.split("|").includes(alias)),
    );
    return hit ? hit[1] : null;
  }

  _upsertContact(contact, emit = true) {
    if (!contact || !contact.id) return;
    const id = this._bareJid(contact.id);
    const existing = this._normalizeContactRecord(this._contacts[id], id);
    const next = {
      ...existing,
      id,
      lid: contact.lid || existing.lid,
      phoneNumber: contact.phoneNumber || contact.pn || existing.phoneNumber,
      pn: contact.pn || contact.phoneNumber || existing.pn,
      name: contact.name || existing.name,
      notify: contact.notify || existing.notify,
      verifiedName: contact.verifiedName || existing.verifiedName,
      imgUrl: contact.imgUrl || existing.imgUrl,
      status: contact.status || existing.status,
    };
    this._contacts[id] = next;

    if (next.phoneNumber) {
      this._contacts[next.phoneNumber] = {
        ...next,
        id: next.phoneNumber,
        lid: next.lid || id,
      };
      this._registerAlias(id, next.phoneNumber);
    }
    if (next.lid) {
      this._contacts[next.lid] = {
        ...next,
        id: next.lid,
        phoneNumber: next.phoneNumber || id,
      };
      this._registerAlias(id, next.lid);
    }

    const aliases = [
      id,
      next.phoneNumber,
      next.lid,
      this._jidAliases[id],
    ].filter(Boolean);
    const name = this._getContactName(id);
    for (const alias of aliases) {
      if (name && this._chats[alias]) {
        const old = this._chats[alias].name;
        if (this._isRawNumericName(old) || old === alias.split("@")[0])
          this._chats[alias].name = name;
      }
    }
    if (emit) {
      this._saveData();
      this._emitChatUpdate();
    }
  }

  _handleLidMappings(mappings) {
    if (!mappings) return;
    const list = Array.isArray(mappings) ? mappings : [mappings];
    for (const m of list) {
      const lid = m?.lid || m?.lidJid;
      const pn = m?.pn || m?.pnJid || m?.phoneNumber;
      if (!lid || !pn) continue;
      this._registerAlias(lid, pn);
      const lidContact = this._getContact(lid) || { id: lid };
      const pnContact = this._getContact(pn) || { id: pn };
      const merged = {
        id: lid,
        lid,
        phoneNumber: pn,
        pn,
        name: lidContact.name || pnContact.name,
        notify: lidContact.notify || pnContact.notify,
        verifiedName: lidContact.verifiedName || pnContact.verifiedName,
        imgUrl: lidContact.imgUrl || pnContact.imgUrl,
        status: lidContact.status || pnContact.status,
      };
      this._upsertContact(merged, false);
    }
  }

  _learnMessageAliases(msg) {
    const key = msg?.key || {};
    if (key.remoteJid && key.remoteJidAlt)
      this._registerAlias(key.remoteJid, key.remoteJidAlt);
    if (key.participant && key.participantAlt)
      this._registerAlias(key.participant, key.participantAlt);
    if (msg?.pushName) {
      const senderJid = key.participant || (!key.fromMe ? key.remoteJid : null);
      if (senderJid)
        this._upsertContact(
          { id: senderJid, name: msg.pushName, notify: msg.pushName },
          false,
        );
      const altJid =
        key.participantAlt || (!key.fromMe ? key.remoteJidAlt : null);
      if (altJid)
        this._upsertContact(
          { id: altJid, name: msg.pushName, notify: msg.pushName },
          false,
        );
    }
  }

  // ─── PHONE FORMATTING ──────────────────────
  _formatPhone(jid) {
    if (!jid) return "";
    if (jid.endsWith("@g.us")) return "Grupo";
    const displayJid = this._getDisplayJid(jid);
    let digits = displayJid.replace(/@.*$/, "").replace(/\D/g, "");
    if (!digits) return displayJid;
    // LID or server IDs are not real phone numbers unless Baileys provided a PN alias.
    if (this._isLidJid(displayJid) || digits.length > 14 || digits.startsWith("120363"))
      return "";
    return "+" + digits;
  }

  _resolveName(jid, chat) {
    const contactName = this._getContactName(jid);
    if (contactName) return contactName;
    if (
      chat &&
      chat.name &&
      chat.name !== jid.split("@")[0] &&
      !this._isRawNumericName(chat.name)
    )
      return chat.name;
    return this._formatPhone(jid);
  }

  // ─── API ──────────────────────────────────
  getChats() {
    return Object.values(this._chats)
      .filter((c) => !c.archived)
      .filter((c) => this._hasConversationData(c))
      .map((c) => ({
        jid: c.jid,
        name: this._resolveName(c.jid, c),
        phone: c.isGroup ? null : this._formatPhone(c.jid),
        phoneJid: c.isGroup ? null : this._getPhoneJid(c.jid),
        profilePic: this._getCachedProfilePicture(c.jid),
        lastMessage: c.lastMessage || "",
        unread: c.unread || 0,
        timestamp: c.timestamp || 0,
        pinned: c.pinned || 0,
        isGroup: !!c.isGroup,
      }))
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        if (a.pinned && b.pinned) return b.pinned - a.pinned;
        if (a.isGroup && !b.isGroup) return 1;
        if (!a.isGroup && b.isGroup) return -1;
        return (b.timestamp || 0) - (a.timestamp || 0);
      });
  }

  getArchivedChats() {
    return Object.values(this._chats)
      .filter((c) => c.archived)
      .filter((c) => this._hasConversationData(c))
      .map((c) => ({
        jid: c.jid,
        name: this._resolveName(c.jid, c),
        phone: c.isGroup ? null : this._formatPhone(c.jid),
        phoneJid: c.isGroup ? null : this._getPhoneJid(c.jid),
        profilePic: this._getCachedProfilePicture(c.jid),
        lastMessage: c.lastMessage || "",
        unread: c.unread || 0,
        timestamp: c.timestamp || 0,
        pinned: 0,
        archived: true,
        isGroup: !!c.isGroup,
      }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  getMessages(jid) {
    return (this._messages[jid] || []).sort(
      (a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0),
    );
  }
  async loadMessages(jid, limit) {
    return this.getMessages(jid);
  }

  async markRead(jid) {
    if (!this.sock) return;
    try {
      const keys = (this._messages[jid] || [])
        .filter((m) => !m.key.fromMe)
        .map((m) => m.key);
      if (keys.length) {
        await this.sock.readMessages(keys);
        if (this._chats[jid]) {
          this._chats[jid].unread = 0;
          this._saveData();
          this._emitChatUpdate();
        }
      }
    } catch (e) {}
  }

  async sendMessage(to, content) {
    if (!this.sock || this._status !== "connected")
      return { success: false, error: "Not connected" };
    try {
      const jid = this._toMessageJid(to);
      let result;
      const options = content?.quoted ? { quoted: content.quoted } : {};
      if (content?.buttons?.length) {
        result = await this.sock.sendMessage(
          jid,
          {
            text: content.header || content.text || "",
            footer: content.footer || "",
            buttons: content.buttons.map((b) => ({
              buttonId: b.id || b.buttonId,
              buttonText: { displayText: b.text || b.buttonText },
              type: 1,
            })),
            headerType: 1,
            viewOnce: false,
          },
          options,
        );
      } else if (
        content?.image ||
        content?.video ||
        content?.audio ||
        content?.document
      ) {
        return this.sendMedia(to, content);
      } else {
        const text =
          typeof content === "string" ? content : content?.text || "";
        result = await this.sock.sendMessage(jid, { text }, options);
      }
      // Add sent message to cache immediately so it shows in UI
      if (result?.key) {
        const msg = {
          key: result.key,
          message: content?.buttons?.length
            ? { conversation: content.header || content.text || "" }
            : content?.image
              ? { imageMessage: {} }
              : content?.document
                ? { documentMessage: { fileName: content.fileName || "" } }
                : {
                    conversation:
                      typeof content === "string"
                        ? content
                        : content?.text || "",
                  },
          messageTimestamp: Math.floor(Date.now() / 1000),
        };
        this._addMessage(jid, msg);
        if (!this._chats[jid])
          this._chats[jid] = {
            jid,
            name: jid.split("@")[0],
            lastMessage: "",
            unread: 0,
            timestamp: 0,
            pinned: 0,
            archived: false,
          };
        const c = this._chats[jid];
        c.lastMessage =
          "Você: " +
          (typeof content === "string"
            ? content
            : content?.text || content?.header || "");
        c.timestamp = Math.floor(Date.now() / 1000);
        this._saveData();
        this._emitChatUpdate();
      }
      return { success: true, messageId: result?.key?.id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async sendMedia(to, content) {
    if (!this.sock) return { success: false, error: "Not connected" };
    try {
      const p = {};
      const jid = this._toMessageJid(to);
      if (content.text || content.caption)
        p.caption = content.text || content.caption;
      if (content.image) p.image = content.image;
      if (content.video) p.video = content.video;
      if (content.audio) {
        p.audio = content.audio;
        p.mimetype = content.mimetype || "audio/ogg";
        p.ptt = content.ptt !== false;
      }
      if (content.document) {
        p.document = content.document;
        p.fileName = content.fileName || "file";
        p.mimetype = content.mimetype || "application/octet-stream";
      }
      const r = await this.sock.sendMessage(jid, p);
      return { success: true, messageId: r?.key?.id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async sendAudio(to, buffer, mimetype) {
    const type = mimetype || "audio/ogg";
    return this.sendMedia(to, {
      audio: buffer,
      mimetype: type,
      ptt: /audio\/(ogg|opus)/i.test(type),
    });
  }

  async sendSticker(to, buffer) {
    if (!this.sock || this._status !== "connected")
      return { success: false, error: "Not connected" };
    try {
      const jid = this._toMessageJid(to);
      const r = await this.sock.sendMessage(jid, { sticker: buffer });
      return { success: true, messageId: r?.key?.id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async reactMessage(jid, key, emoji) {
    if (!this.sock || this._status !== "connected")
      return { success: false, error: "Not connected" };
    try {
      await this.sock.sendMessage(jid, {
        react: {
          text: emoji || "",
          key,
        },
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async forwardMessage(fromJid, messageId, toJid) {
    if (!this.sock || this._status !== "connected")
      return { success: false, error: "Not connected" };
    try {
      const msg = (this._messages[fromJid] || []).find(
        (m) => m.key?.id === messageId,
      );
      if (!msg) return { success: false, error: "Mensagem não encontrada" };
      const jid = this._toMessageJid(toJid);
      const r = await this.sock.sendMessage(jid, { forward: msg, force: true });
      return { success: true, messageId: r?.key?.id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async chatAction(jid, action) {
    try {
      if (!this._chats[jid])
        return { success: false, error: "Conversa não encontrada" };
      const chat = this._chats[jid];
      if (action === "archive") {
        const next = !chat.archived;
        if (this.sock?.chatModify)
          await this.sock.chatModify({ archive: next }, jid).catch(() => {});
        chat.archived = next;
      } else if (action === "pin") {
        const next = chat.pinned ? 0 : Math.floor(Date.now() / 1000);
        if (this.sock?.chatModify)
          await this.sock.chatModify({ pin: !!next }, jid).catch(() => {});
        chat.pinned = next;
      } else if (action === "unread") {
        chat.unread = Math.max(chat.unread || 0, 1);
      } else if (action === "mute") {
        if (this.sock?.chatModify)
          await this.sock
            .chatModify({ mute: 8 * 60 * 60 * 1000 }, jid)
            .catch(() => {});
      } else if (action === "typing") {
        if (this.sock?.sendPresenceUpdate)
          await this.sock.sendPresenceUpdate("composing", jid).catch(() => {});
      } else if (action === "recording") {
        if (this.sock?.sendPresenceUpdate)
          await this.sock.sendPresenceUpdate("recording", jid).catch(() => {});
      } else if (action === "paused") {
        if (this.sock?.sendPresenceUpdate)
          await this.sock.sendPresenceUpdate("paused", jid).catch(() => {});
      } else if (action === "block") {
        if (this.sock?.updateBlockStatus && !jid.endsWith("@g.us"))
          await this.sock.updateBlockStatus(jid, "block").catch(() => {});
      } else if (action === "clear") {
        this._messages[jid] = [];
        this._msgIndex[jid] = new Set();
        chat.lastMessage = "";
        chat.unread = 0;
      } else if (action === "delete") {
        delete this._chats[jid];
        delete this._messages[jid];
        delete this._msgIndex[jid];
      } else {
        return { success: false, error: "Ação inválida" };
      }
      this._saveDataNow();
      this._emitChatUpdate();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async deleteMessage(jid, key) {
    if (!this.sock || this._status !== "connected")
      return { success: false, error: "Not connected" };
    try {
      await this.sock.sendMessage(jid, { delete: key });

      // Update cache
      if (this._messages[jid]) {
        this._messages[jid] = this._messages[jid].filter(
          (m) => m.key.id !== key.id,
        );
        this._saveData();
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  getStatus() {
    return this._status;
  }
  getPhoneNumber() {
    return this._phoneNumber;
  }

  async getContactInfo(jid) {
    const contact = this._getContact(jid);
    const phoneJid = this._getPhoneJid(jid);
    const info = {
      jid,
      phoneJid,
      phone: this._formatPhone(jid),
      name: null,
      notify: contact?.notify || null,
      verifiedName: contact?.verifiedName || null,
      business: null,
    };
    // Local contact data
    const contactName = this._getContactName(jid);
    if (contactName) info.name = contactName;
    // Chat name fallback
    const chat = this._chats[jid];
    if (
      chat &&
      chat.name &&
      chat.name !== jid.split("@")[0] &&
      !/^\+?\d[\d\s\-()]+$/.test(chat.name)
    ) {
      if (!info.name) info.name = chat.name;
    }
    // Try fetching business profile for extra data
    if (this.sock && this._status === "connected" && !jid.endsWith("@g.us")) {
      try {
        const bp = await this.sock.getBusinessProfile(jid);
        if (bp) {
          info.business = {
            description: bp.description || null,
            email: bp.email || null,
            website: bp.website || null,
            address: bp.address || null,
            businessHours: bp.businessHours || null,
            category: bp.category || null,
          };
          if (bp.verifiedName) info.verifiedName = bp.verifiedName;
          // Business name is often the best name
          if (
            bp.verifiedName &&
            (!info.name || info.name === jid.split("@")[0])
          ) {
            info.name = bp.verifiedName;
          }
        }
      } catch (e) {
        /* not a business account or unavailable */
      }
    }
    return info;
  }

  async _downloadImageAsDataUrl(url) {
    try {
      if (!url || url.startsWith("data:")) return url || null;
      const res = await fetch(url);
      if (!res.ok) return url;
      const contentType = res.headers.get("content-type") || "image/jpeg";
      const buffer = Buffer.from(await res.arrayBuffer());
      return `data:${contentType};base64,${buffer.toString("base64")}`;
    } catch (e) {
      return url;
    }
  }

  async getProfilePicture(jid) {
    const lookupJids = [
      ...new Set(
        [jid, this._getPhoneJid(jid), this._jidAliases[jid]].filter(Boolean),
      ),
    ];
    const cacheKey = lookupJids.join("|");
    if (this._profilePicCache[cacheKey]) return this._profilePicCache[cacheKey];

    const contact = this._getContact(jid);
    if (contact?.imgUrl && contact.imgUrl !== "changed") {
      const dataUrl = await this._downloadImageAsDataUrl(contact.imgUrl);
      this._profilePicCache[cacheKey] = dataUrl;
      this._saveData();
      return dataUrl;
    }

    if (!this.sock || this._status !== "connected") return null;
    for (const candidate of lookupJids) {
      for (const type of ["image", "preview"]) {
        try {
          const url = await this.sock.profilePictureUrl(candidate, type);
          if (url) {
            const dataUrl = await this._downloadImageAsDataUrl(url);
            this._profilePicCache[cacheKey] = dataUrl;
            this._saveData();
            return dataUrl;
          }
        } catch (e) {
          // Try the next size/alias (LID/PN) before giving up.
        }
      }
    }
    return null;
  }

  async getGroupMetadata(jid) {
    if (!this.sock || this._status !== "connected") return null;
    try {
      const meta = await this.sock.groupMetadata(jid);
      // Map participants names
      if (meta && meta.participants) {
        meta.participants = meta.participants.map((p) => ({
          id: p.id,
          phone: this._formatPhone(p.id),
          phoneJid: this._getPhoneJid(p.id),
          admin: p.admin,
          name: this._getContactName(p.id),
        }));
      }
      return meta;
    } catch (e) {
      return null;
    }
  }

  async downloadMedia(jid, messageId) {
    try {
      const { downloadMediaMessage } = require("@whiskeysockets/baileys");
      const msgs = this._messages[jid] || [];
      const msg = msgs.find((m) => m.key?.id === messageId);
      if (!msg) return { success: false, error: "Message not found" };
      const buffer = await downloadMediaMessage(
        msg,
        "buffer",
        {},
        {
          logger: require("pino")({ level: "silent" }),
          reuploadRequest: this.sock?.updateMediaMessage,
        },
      );
      const base64 = buffer.toString("base64");
      const mc = msg.message;
      let mimetype = "application/octet-stream";
      if (mc?.imageMessage) mimetype = mc.imageMessage.mimetype || "image/jpeg";
      else if (mc?.audioMessage)
        mimetype = mc.audioMessage.mimetype || "audio/ogg";
      else if (mc?.videoMessage)
        mimetype = mc.videoMessage.mimetype || "video/mp4";
      else if (mc?.documentMessage)
        mimetype = mc.documentMessage.mimetype || "application/octet-stream";
      return { success: true, data: base64, mimetype };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = { BaileysProvider };
