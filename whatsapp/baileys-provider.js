const { WhatsAppProvider } = require("./provider");
const { AuthStore } = require("./auth-store");
const { normalizePhone } = require("./phone-normalizer");
const fs = require("fs");
const path = require("path");
const { resolveContactIdentity } = require('./contact-identity-resolver');

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
    this._mediaCacheRoot = path.join(userDataPath, "whatsapp-media-cache");
    this._stickerCacheRoot = path.join(userDataPath, "whatsapp-stickers");
    this._syncStats = null;
    this._syncActive = false; // Flag to enable adaptive throttling during sync
    // messageId -> { filePath, mimetype, kind, jids[] } — mídia enviada por nós (play local)
    this._outgoingMediaById = new Map();
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

        // Presence → conversation open proxy (available / composing)
        this.sock.ev.on("presence.update", (data) => {
          try {
            const jid = data?.id;
            if (!jid || jid.includes("@g.us") || jid.includes("@broadcast")) return;
            const presences = data?.presences || {};
            for (const [participant, info] of Object.entries(presences)) {
              const last = info?.lastKnownPresence || info?.presence || "";
              if (
                last === "available" ||
                last === "composing" ||
                last === "recording" ||
                last === "online"
              ) {
                logTracking(`presence.update jid=${jid} participant=${participant} presence=${last}`);
                this.onChatEvent({
                  type: "conversation-open",
                  jid: participant?.includes("@") ? participant : jid,
                  phoneJid: this._getPhoneJid
                    ? this._getPhoneJid(participant?.includes("@") ? participant : jid)
                    : jid,
                  presence: last,
                });
              }
            }
            // Some Baileys versions send lastKnownPresence at root for 1:1
            if (!Object.keys(presences).length && data?.lastKnownPresence) {
              const last = data.lastKnownPresence;
              if (last === "available" || last === "composing" || last === "recording") {
                this.onChatEvent({
                  type: "conversation-open",
                  jid,
                  phoneJid: this._getPhoneJid ? this._getPhoneJid(jid) : jid,
                  presence: last,
                });
              }
            }
          } catch (e) {
            /* ignore presence parse errors */
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
                  archived: this._getRawArchiveState(c, this._chats[c.id]),
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
              archived: this._getRawArchiveState(c, existing),
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
  _messageHasDownloadableMedia(msg) {
    const mc = this._unwrapMessageContent(msg?.message || {});
    const media =
      mc.imageMessage ||
      mc.videoMessage ||
      mc.audioMessage ||
      mc.documentMessage ||
      mc.stickerMessage;
    // Baileys precisa de mediaKey/url/directPath para baixar
    return !!(media && (media.mediaKey || media.url || media.directPath));
  }

  _addMessage(jid, msg) {
    if (!msg.key?.id) return;
    if (!this._msgIndex[jid]) this._msgIndex[jid] = new Set();
    if (!this._messages[jid]) this._messages[jid] = [];

    // Já existe: atualiza se a nova versão tiver mídia baixável (eco do servidor)
    if (this._msgIndex[jid].has(msg.key.id)) {
      const idx = this._messages[jid].findIndex((m) => m.key?.id === msg.key.id);
      if (idx >= 0) {
        const old = this._messages[jid][idx];
        if (this._messageHasDownloadableMedia(msg) && !this._messageHasDownloadableMedia(old)) {
          this._messages[jid][idx] = msg;
        } else if (msg.messageTimestamp && (!old.messageTimestamp || msg.messageTimestamp >= old.messageTimestamp)) {
          // merge leve de status
          this._messages[jid][idx] = {
            ...old,
            ...msg,
            message: msg.message || old.message,
            status: msg.status != null ? msg.status : old.status,
          };
        }
      }
      return;
    }

    this._msgIndex[jid].add(msg.key.id);
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
    const mc = this._unwrapMessageContent
      ? this._unwrapMessageContent(msg?.message || {})
      : msg?.message || {};
    return (
      mc.conversation ||
      mc.extendedTextMessage?.text ||
      mc.imageMessage?.caption ||
      mc.videoMessage?.caption ||
      mc.documentMessage?.caption ||
      (mc.imageMessage ? "📷 Foto" : "") ||
      (mc.videoMessage ? "🎬 Vídeo" : "") ||
      (mc.audioMessage
        ? mc.audioMessage.ptt
          ? "🎤 Mensagem de voz"
          : "🎵 Áudio"
        : "") ||
      (mc.documentMessage
        ? "📄 " + (mc.documentMessage.fileName || "Documento")
        : "") ||
      (mc.stickerMessage ? "🌟 Figurinha" : "") ||
      (mc.contactMessage ? "👤 Contato" : "") ||
      (mc.locationMessage ? "📍 Localização" : "") ||
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

  _getChatMessageCount(jid) {
    return (this._messages[jid] || []).filter((msg) => this._getMessageText(msg))
      .length;
  }

  _safeCacheSegment(value) {
    return String(value || "unknown").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 96);
  }

  _ensureDir(dirPath) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch (e) {}
  }

  _guessMediaExtension(mimetype, fallback = ".bin") {
    const type = String(mimetype || "").toLowerCase();
    if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
    if (type.includes("png")) return ".png";
    if (type.includes("gif")) return ".gif";
    if (type.includes("webp")) return ".webp";
    if (type.includes("mp4")) return ".mp4";
    if (type.includes("quicktime")) return ".mov";
    if (type.includes("ogg") || type.includes("opus")) return ".ogg";
    if (type.includes("mpeg")) return ".mp3";
    if (type.includes("wav")) return ".wav";
    if (type.includes("pdf")) return ".pdf";
    if (type.includes("msword")) return ".doc";
    if (type.includes("officedocument.wordprocessingml.document")) return ".docx";
    return fallback;
  }

  _getMediaCachePath(jid, messageId, mimetype) {
    const ext = this._guessMediaExtension(mimetype);
    const safeJid = this._safeCacheSegment(jid);
    const safeMsg = this._safeCacheSegment(messageId);
    const dir = path.join(this._mediaCacheRoot, safeJid);
    this._ensureDir(dir);
    return path.join(dir, `${safeMsg}${ext}`);
  }

  _hasConversationData(chat) {
    if (!chat) return false;
    if (this._getChatMessageCount(chat.jid) > 0) return true;
    if (chat.lastMessage) return true;
    if ((chat.unread || 0) > 0) return true;
    return false;
  }

  _shouldKeepChatRecord(raw, existing) {
    if (!raw?.id || raw.id.includes("@broadcast") || raw.id === "status@broadcast")
      return false;
    if (existing && this._hasConversationData(existing)) return true;
    return !!(
      raw.unreadCount ||
      raw.lastMessage ||
      (Array.isArray(raw.messages) &&
        raw.messages.some((msg) => this._getMessageText(msg)))
    );
  }

  _getRawArchiveState(raw, existing) {
    if (raw?.archive !== undefined) return !!raw.archive;
    if (raw?.archived !== undefined) return !!raw.archived;
    return existing?.archived || false;
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
    const s = String(to).trim();
    // Já é JID completo (PN, LID, grupo…)
    if (s.includes("@")) return s;
    const normalized = normalizePhone(s);
    const digits = normalized.valid
      ? normalized.number
      : s.replace(/\D/g, "");
    return digits ? `${digits}@s.whatsapp.net` : s;
  }

  /** JID de conversa já conhecida (chat/mensagens) — prioriza envio direto. */
  _knownChatJid(jid) {
    if (!jid) return null;
    if (this._chats?.[jid] || this._messages?.[jid]) return jid;
    const alias = this._jidAliases?.[jid];
    if (alias && (this._chats?.[alias] || this._messages?.[alias])) return alias;
    return null;
  }

  /**
   * Resolve o JID real no WhatsApp.
   * - Grupos / broadcast: como estão
   * - @lid: NÃO tratar dígitos do LID como telefone (bug que gerava "10700… sem WhatsApp")
   * - Preferir alias PN (telefone) quando existir
   * - Conversas já abertas: reutiliza o JID da conversa
   * - Números novos: valida com onWhatsApp (+ variantes BR 9º dígito)
   */
  async resolveSendJid(to) {
    if (!to) throw new Error("Destinatário vazio");
    const raw = String(to).trim();
    if (!this.sock) throw new Error("WhatsApp não conectado");

    // Grupo / status / broadcast
    if (raw.endsWith("@g.us") || raw.endsWith("@broadcast") || raw === "status@broadcast") {
      return raw;
    }

    // ─── LID (Linked ID do WhatsApp multi-device) ─────────────────────────
    // Ex.: 107005234663576@lid — NÃO é telefone. Enviar como PN se soubermos,
    // senão enviar direto no @lid da conversa aberta.
    if (this._isLidJid(raw)) {
      const phoneJid = this._getPhoneJid(raw);
      if (phoneJid && this._isPhoneJid(phoneJid)) {
        console.log("[BAILEYS] LID→PN:", raw, "→", phoneJid);
        // Tenta validar o PN, mas se falhar ainda usa o LID da conversa
        try {
          const digits = phoneJid.replace(/@.*$/, "").replace(/\D/g, "");
          if (digits && typeof this.sock.onWhatsApp === "function") {
            const results = await this.sock.onWhatsApp(digits);
            const hit = Array.isArray(results)
              ? results.find((r) => r && r.exists !== false && r.jid)
              : null;
            if (hit?.jid) {
              this._registerAlias(raw, hit.jid);
              return hit.jid;
            }
          }
        } catch (e) {
          console.warn("[BAILEYS] onWhatsApp no PN do LID falhou:", e.message);
        }
        return phoneJid;
      }
      // Conversa já existe com esse LID → enviar direto (presença "gravando" já funciona assim)
      if (this._knownChatJid(raw) || this._chats?.[raw]) {
        console.log("[BAILEYS] enviando direto no LID da conversa:", raw);
        return raw;
      }
      const alias = this._jidAliases[raw];
      if (alias) return alias;
      console.log("[BAILEYS] LID sem alias PN, usando LID:", raw);
      return raw;
    }

    // Outros JIDs não-telefone (ex. newsletter) — passa direto
    if (
      raw.includes("@") &&
      !raw.endsWith("@s.whatsapp.net") &&
      !raw.endsWith("@c.us")
    ) {
      return raw;
    }

    // ─── Já é @s.whatsapp.net / @c.us ────────────────────────────────────
    if (this._isPhoneJid(raw) || raw.endsWith("@c.us")) {
      // Se a conversa já está aberta, não precisa revalidar (evita falso negativo)
      if (this._knownChatJid(raw) || this._chats?.[raw] || this._messages?.[raw]) {
        return raw.endsWith("@c.us")
          ? raw.replace("@c.us", "@s.whatsapp.net")
          : raw;
      }
    }

    const fallbackJid = this._toMessageJid(raw);
    // Se após toMessageJid ainda for LID (edge), não extrair dígitos como telefone
    if (this._isLidJid(fallbackJid)) {
      return this.resolveSendJid(fallbackJid);
    }

    const digits = fallbackJid.replace(/@.*$/, "").replace(/\D/g, "");
    // LID numérico sem @ (raro) — se parece ID longo e temos chat @lid, use o chat
    if (digits.length >= 14 && !raw.includes("@")) {
      const asLid = `${digits}@lid`;
      if (this._chats?.[asLid] || this._messages?.[asLid]) return asLid;
    }

    const candidates = [];
    if (digits && digits.length >= 10 && digits.length <= 15) candidates.push(digits);
    // BR: 55 + DDD(2) + 8 dígitos (antigo) → tenta inserir o 9
    if (digits.startsWith("55") && digits.length === 12) {
      candidates.push(digits.slice(0, 4) + "9" + digits.slice(4));
    }
    // BR: 55 + DDD + 9 + 8 dígitos → tenta sem o 9
    if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
      candidates.push(digits.slice(0, 4) + digits.slice(5));
    }

    let lastError = "";
    let usedOnWhatsApp = false;
    for (const d of [...new Set(candidates)]) {
      try {
        if (typeof this.sock.onWhatsApp !== "function") break;
        usedOnWhatsApp = true;
        const results = await this.sock.onWhatsApp(d);
        const hit = Array.isArray(results)
          ? results.find((r) => r && r.exists !== false && r.jid)
          : null;
        if (hit?.jid) {
          this._registerAlias(hit.jid, `${d}@s.whatsapp.net`);
          return hit.jid;
        }
        lastError = `Número ${d} não tem WhatsApp (ou não foi encontrado)`;
      } catch (e) {
        lastError = e.message || String(e);
        usedOnWhatsApp = false; // API quebrou → permite fallback
      }
    }

    // Conversa aberta com o JID original (PN) mesmo se onWhatsApp falhar
    const known = this._knownChatJid(raw) || this._knownChatJid(fallbackJid);
    if (known) {
      console.warn("[BAILEYS] onWhatsApp sem hit; usando JID da conversa aberta:", known);
      return known;
    }

    if (usedOnWhatsApp) {
      throw new Error(lastError || `Número sem WhatsApp: ${to}`);
    }

    if (fallbackJid && fallbackJid.includes("@") && !this._isLidJid(fallbackJid)) {
      console.warn("[BAILEYS] onWhatsApp indisponível, usando JID calculado:", fallbackJid);
      return fallbackJid;
    }
    throw new Error(lastError || `Não foi possível resolver o número: ${to}`);
  }

  _extractOutgoingText(content) {
    if (typeof content === "string") return content;
    if (!content || typeof content !== "object") return "";
    return (
      content.text ||
      content.caption ||
      content.header ||
      content.fileName ||
      ""
    );
  }

  _buildOutgoingMessagePayload(content) {
    if (typeof content === "string") {
      return { conversation: content };
    }
    if (content?.buttons?.length) {
      return { conversation: content.header || content.text || "" };
    }
    if (content?.image) {
      return {
        imageMessage: {
          caption: content.caption || content.text || "",
          mimetype: content.mimetype || "image/jpeg",
        },
      };
    }
    if (content?.video) {
      return {
        videoMessage: {
          caption: content.caption || content.text || "",
          mimetype: content.mimetype || "video/mp4",
        },
      };
    }
    if (content?.audio) {
      return {
        audioMessage: {
          mimetype: content.mimetype || "audio/ogg",
          ptt: content.ptt !== false,
          seconds: Number.isFinite(content.seconds) ? content.seconds : undefined,
        },
      };
    }
    if (content?.document) {
      return {
        documentMessage: {
          fileName: content.fileName || "arquivo",
          mimetype: content.mimetype || "application/octet-stream",
          caption: content.caption || content.text || "",
        },
      };
    }
    if (content?.sticker) {
      return { stickerMessage: { mimetype: "image/webp" } };
    }
    return { conversation: this._extractOutgoingText(content) };
  }

  /** Persiste mídia enviada por nós para playback local (evita "Message not found"). */
  _cacheOutgoingMedia(messageId, jid, content) {
    if (!messageId || !content) return;
    try {
      let buffer = null;
      let mimetype = "application/octet-stream";
      let kind = null;
      if (content.audio) {
        buffer = Buffer.isBuffer(content.audio) ? content.audio : Buffer.from(content.audio);
        mimetype = content.mimetype || "audio/ogg";
        kind = "audio";
      } else if (content.image) {
        buffer = Buffer.isBuffer(content.image) ? content.image : Buffer.from(content.image);
        mimetype = content.mimetype || "image/jpeg";
        kind = "image";
      } else if (content.video) {
        buffer = Buffer.isBuffer(content.video) ? content.video : Buffer.from(content.video);
        mimetype = content.mimetype || "video/mp4";
        kind = "video";
      } else if (content.document) {
        buffer = Buffer.isBuffer(content.document) ? content.document : Buffer.from(content.document);
        mimetype = content.mimetype || "application/octet-stream";
        kind = "document";
      } else if (content.sticker) {
        buffer = Buffer.isBuffer(content.sticker) ? content.sticker : Buffer.from(content.sticker);
        mimetype = "image/webp";
        kind = "sticker";
      }
      if (!buffer || !buffer.length) return;
      const filePath = this._getMediaCachePath(jid, messageId, mimetype);
      this._ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, buffer);
      const prev = this._outgoingMediaById.get(messageId) || { jids: [] };
      const jids = new Set([...(prev.jids || []), jid].filter(Boolean));
      this._outgoingMediaById.set(messageId, {
        filePath,
        mimetype,
        kind,
        jids: [...jids],
        fileName: content.fileName || null,
      });
    } catch (e) {
      console.warn("[BAILEYS] cache outgoing media:", e.message);
    }
  }

  /** Grava mensagem enviada no cache local (aparece no chat do app). */
  _recordOutgoing(jid, result, content) {
    if (!result?.key?.id || !jid) return;
    const messageId = result.key.id;
    const key = {
      ...result.key,
      remoteJid: result.key.remoteJid || jid,
      fromMe: true,
      id: messageId,
    };
    const msg = {
      key,
      message: this._buildOutgoingMessagePayload(content),
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 1, // PENDING/SERVER_ACK
    };
    // Salva buffer em disco para poder ouvir/ver no app
    this._cacheOutgoingMedia(messageId, jid, content);

    const targets = new Set([jid, key.remoteJid, this._getPhoneJid(jid), this._jidAliases[jid]].filter(Boolean));
    for (const t of targets) {
      this._addMessage(t, msg);
      if (t !== jid) this._registerAlias(jid, t);
    }

    const chatJid = this._chats[jid] ? jid : (this._chats[key.remoteJid] ? key.remoteJid : jid);
    if (!this._chats[chatJid]) {
      this._chats[chatJid] = {
        jid: chatJid,
        name: this._resolveName(chatJid) || chatJid.split("@")[0],
        lastMessage: "",
        unread: 0,
        timestamp: 0,
        pinned: 0,
        archived: false,
        isGroup: chatJid.endsWith("@g.us"),
      };
    }
    const preview = this._extractOutgoingText(content);
    const c = this._chats[chatJid];
    const isAudio = !!(content && content.audio);
    c.lastMessage = "Você: " + (isAudio ? "🎤 Áudio" : (preview || "📎 Mídia"));
    c.timestamp = Math.floor(Date.now() / 1000);
    c.archived = false;
    this._saveData();
    this._emitChatUpdate();
  }

  /**
   * Envia presença de digitando/gravando de forma que o contato realmente veja.
   * - resolve LID→PN
   * - presenceSubscribe antes
   * - envia em todos os aliases conhecidos do chat
   */
  async _sendChatPresence(kind, jid) {
    if (!this.sock || !jid) return { success: false, error: "Sem socket" };
    const targets = new Set();
    targets.add(jid);
    try {
      const resolved = await this.resolveSendJid(jid);
      if (resolved) targets.add(resolved);
    } catch { /* ignore */ }
    const phone = this._getPhoneJid(jid);
    if (phone) targets.add(phone);
    const alias = this._jidAliases[jid];
    if (alias) targets.add(alias);
    // Se a conversa aberta é LID e estamos com PN (ou vice-versa), inclui a chave do chat
    for (const chatKey of Object.keys(this._chats || {})) {
      if (chatKey === jid || this._jidAliases[chatKey] === jid || this._jidAliases[jid] === chatKey) {
        targets.add(chatKey);
      }
    }

    let any = false;
    for (const t of targets) {
      if (!t || t.endsWith("@g.us") || t.includes("@broadcast")) continue;
      try {
        if (typeof this.sock.presenceSubscribe === "function") {
          await this.sock.presenceSubscribe(t).catch(() => {});
        }
        await this.sock.sendPresenceUpdate(kind, t);
        any = true;
      } catch (e) {
        console.warn("[BAILEYS] presence", kind, t, e.message);
      }
    }
    return { success: any };
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
    const identity = resolveContactIdentity({
      jid: id,
      phoneJid: contact.phoneNumber || contact.pn || existing.phoneNumber || id,
      manualName: contact.manualName || existing.manualName,
      savedName: contact.savedName || existing.savedName,
      verifiedName: contact.verifiedName || existing.verifiedName,
      pushName: contact.pushName || contact.name || contact.notify || existing.name || existing.notify,
      chatName: contact.chatName,
      companyName: contact.companyName,
    });
    const next = {
      ...existing,
      id,
      lid: contact.lid || existing.lid,
      phoneNumber: contact.phoneNumber || contact.pn || existing.phoneNumber,
      pn: contact.pn || contact.phoneNumber || existing.pn,
      name: identity.displayName,
      nameSource: identity.source,
      nameConfidence: identity.confidence,
      notify: contact.notify || existing.notify || identity.displayName,
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
  /**
   * Lista contatos conhecidos (agenda/sincronizados) + chats individuais.
   * Usado na montagem de campanhas manuais.
   */
  getContacts() {
    const out = new Map();

    const push = (entry) => {
      if (!entry?.jid && !entry?.phone) return;
      const isGroup = !!(entry.isGroup || String(entry.jid || "").endsWith("@g.us"));
      const jid = entry.jid || (entry.phone ? `${String(entry.phone).replace(/\D/g, "")}@s.whatsapp.net` : "");
      if (!jid || jid.includes("@broadcast") || jid === "status@broadcast") return;
      const key = isGroup ? `g:${jid}` : `p:${String(entry.phone || jid.replace(/@.*$/, "")).replace(/\D/g, "")}`;
      if (!key || key === "p:" || key === "g:") return;
      if (out.has(key)) {
        const prev = out.get(key);
        if (!prev.name && entry.name) prev.name = entry.name;
        return;
      }
      out.set(key, {
        jid,
        phone: isGroup ? jid : (entry.phone || jid.replace(/@.*$/, "").replace(/\D/g, "")),
        name: entry.name || "",
        isGroup,
        source: entry.source || "contact",
      });
    };

    // Contatos do Baileys
    for (const [id, raw] of Object.entries(this._contacts || {})) {
      const c = this._normalizeContactRecord(raw, id);
      const phoneJid = this._getPhoneJid(id) || (this._isPhoneJid(id) ? id : null);
      if (this._isLidJid(id) && !phoneJid) continue;
      const jid = phoneJid || id;
      if (jid.endsWith("@g.us")) {
        push({
          jid,
          name: this._getContactName(jid) || c.name || c.notify || "",
          isGroup: true,
          source: "contact",
        });
        continue;
      }
      if (!this._isPhoneJid(jid) && !c.phoneNumber) continue;
      const phone = (c.phoneNumber || jid).replace(/@.*$/, "").replace(/\D/g, "");
      if (!phone || phone.length < 10) continue;
      push({
        jid: this._isPhoneJid(jid) ? jid : `${phone}@s.whatsapp.net`,
        phone,
        name: this._getContactName(jid) || c.name || c.notify || c.verifiedName || "",
        isGroup: false,
        source: "contact",
      });
    }

    // Chats (pessoas e grupos com conversa)
    for (const c of Object.values(this._chats || {})) {
      if (!c?.jid || c.jid.includes("@broadcast")) continue;
      if (c.isGroup || c.jid.endsWith("@g.us")) {
        push({
          jid: c.jid,
          name: this._resolveName(c.jid, c) || c.name || "Grupo",
          isGroup: true,
          source: "chat",
        });
      } else {
        const phone = this._formatPhone(c.jid).replace(/\D/g, "") || c.jid.replace(/@.*$/, "").replace(/\D/g, "");
        if (!phone || phone.length < 10) continue;
        push({
          jid: c.jid,
          phone,
          name: this._resolveName(c.jid, c) || c.name || "",
          isGroup: false,
          source: "chat",
        });
      }
    }

    return [...out.values()].sort((a, b) => {
      if (a.isGroup !== b.isGroup) return a.isGroup ? 1 : -1;
      return String(a.name || a.phone).localeCompare(String(b.name || b.phone), "pt-BR");
    });
  }

  getGroups() {
    return this.getContacts().filter((c) => c.isGroup);
  }

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
        unread: Number(c.unread || 0),
        timestamp: c.timestamp || 0,
        pinned: c.pinned || 0,
        isGroup: !!c.isGroup,
        messageCount: this._getChatMessageCount(c.jid),
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
        unread: Number(c.unread || 0),
        timestamp: c.timestamp || 0,
        pinned: 0,
        archived: true,
        isGroup: !!c.isGroup,
        messageCount: this._getChatMessageCount(c.jid),
      }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  getMessages(jid) {
    if (!jid) return [];
    const aliases = new Set(
      [jid, this._jidAliases[jid], this._getPhoneJid(jid), this._getDisplayJid(jid)].filter(Boolean),
    );
    // Inclui qualquer chave de _messages que aponte para o mesmo contato
    for (const [a, b] of Object.entries(this._jidAliases || {})) {
      if (aliases.has(a) || aliases.has(b)) {
        aliases.add(a);
        aliases.add(b);
      }
    }
    const seen = new Set();
    const msgs = [];
    for (const id of aliases) {
      for (const m of this._messages[id] || []) {
        const mid = m?.key?.id;
        if (mid && seen.has(mid)) continue;
        if (mid) seen.add(mid);
        msgs.push(m);
      }
    }
    return msgs.sort(
      (a, b) =>
        this._timestampToNumber(a.messageTimestamp) -
        this._timestampToNumber(b.messageTimestamp),
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
      return { success: false, error: "WhatsApp não conectado" };
    try {
      // Mídia via sendMedia (também grava no chat)
      if (
        content &&
        typeof content === "object" &&
        (content.image || content.video || content.audio || content.document || content.sticker)
      ) {
        return this.sendMedia(to, content);
      }

      const text =
        typeof content === "string" ? content : this._extractOutgoingText(content);
      if (!String(text || "").trim() && !content?.buttons?.length) {
        return { success: false, error: "Mensagem vazia — nada para enviar" };
      }

      const jid = await this.resolveSendJid(to);
      if (!jid) return { success: false, error: "Destinatário inválido" };

      let result;
      const options = content?.quoted ? { quoted: content.quoted } : {};
      if (content?.buttons?.length) {
        // Botões legados costumam falhar no WhatsApp atual — fallback para texto
        try {
          result = await this.sock.sendMessage(
            jid,
            {
              text: content.header || content.text || text,
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
        } catch (btnErr) {
          console.warn("[BAILEYS] botões falharam, enviando texto:", btnErr.message);
          const plain = [content.header, content.text, content.footer]
            .filter(Boolean)
            .join("\n");
          result = await this.sock.sendMessage(jid, { text: plain || text }, options);
        }
      } else {
        result = await this.sock.sendMessage(jid, { text: String(text) }, options);
      }

      const messageId = result?.key?.id;
      if (!messageId) {
        return {
          success: false,
          error: "WhatsApp não confirmou o envio (sem messageId). Tente de novo.",
        };
      }

      this._recordOutgoing(jid, result, typeof content === "string" ? { text } : content || { text });
      return { success: true, messageId, jid };
    } catch (e) {
      console.error("[BAILEYS] sendMessage error:", e.message);
      return { success: false, error: e.message || "Falha ao enviar" };
    }
  }

  async sendMedia(to, content) {
    if (!this.sock || this._status !== "connected")
      return { success: false, error: "WhatsApp não conectado" };
    try {
      const p = {};
      const jid = await this.resolveSendJid(to);
      if (!jid) return { success: false, error: "Destinatário inválido" };
      if (content.text || content.caption)
        p.caption = content.text || content.caption;
      if (content.image) { p.image = content.image; if (content.mimetype) p.mimetype = content.mimetype; }
      if (content.video) { p.video = content.video; if (content.mimetype) p.mimetype = content.mimetype; }
      if (content.audio) {
        const audioBuf = Buffer.isBuffer(content.audio)
          ? content.audio
          : Buffer.from(content.audio);
        if (!audioBuf.length) {
          return { success: false, error: "Áudio vazio (0 bytes) — grave de novo" };
        }
        p.audio = audioBuf;
        // PTT exige ogg/opus; se vier webm, o convert no main deve ter rodado
        let mime = content.mimetype || "audio/ogg; codecs=opus";
        if (/webm/i.test(mime) && content.ptt !== false) {
          // WhatsApp PTT com webm costuma sair "zerado" — avisa
          console.warn("[BAILEYS] enviando áudio webm como PTT — preferível ogg/opus");
        }
        if (/ogg|opus/i.test(mime) && !/webm/i.test(mime)) {
          mime = "audio/ogg; codecs=opus";
        }
        p.mimetype = mime;
        p.ptt = content.ptt !== false;
        if (Number.isFinite(content.seconds) && content.seconds > 0) {
          p.seconds = Math.round(content.seconds);
        }
      }
      if (content.document) {
        p.document = content.document;
        p.fileName = content.fileName || "file";
        p.mimetype = content.mimetype || "application/octet-stream";
      }
      if (content.sticker) {
        p.sticker = content.sticker;
      }
      if (!p.image && !p.video && !p.audio && !p.document && !p.sticker) {
        return { success: false, error: "Mídia inválida ou vazia" };
      }
      const r = await this.sock.sendMessage(jid, p);
      const messageId = r?.key?.id;
      if (!messageId) {
        return {
          success: false,
          error: "WhatsApp não confirmou o envio da mídia (sem messageId).",
        };
      }
      this._recordOutgoing(jid, r, content);
      return { success: true, messageId, jid };
    } catch (e) {
      console.error("[BAILEYS] sendMedia error:", e.message);
      return { success: false, error: e.message || "Falha ao enviar mídia" };
    }
  }

  async sendAudio(to, buffer, mimetype, seconds) {
    // Mensagem de voz (PTT): Baileys prefere ogg/opus com ptt:true
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    if (!buf.length) {
      return { success: false, error: "Áudio vazio (0 bytes)" };
    }
    const type = String(mimetype || "audio/ogg; codecs=opus");
    // Não marcar webm;codecs=opus como se fosse ogg
    const isOgg = /ogg/i.test(type) && !/webm/i.test(type);
    return this.sendMedia(to, {
      audio: buf,
      mimetype: isOgg ? "audio/ogg; codecs=opus" : type,
      ptt: true,
      seconds: Number.isFinite(seconds) ? seconds : undefined,
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
      // Resolve alias LID↔PN para achar a conversa certa
      let chatJid = jid;
      if (!this._chats[chatJid]) {
        const alt =
          this._jidAliases[jid] ||
          this._getPhoneJid(jid) ||
          this._knownChatJid(jid);
        if (alt && this._chats[alt]) chatJid = alt;
      }
      const chat = this._chats[chatJid];
      // typing/recording/paused não exigem chat local (presença no JID de envio)
      const presenceOnly =
        action === "typing" || action === "recording" || action === "paused";
      if (!chat && !presenceOnly) {
        return { success: false, error: "Conversa não encontrada" };
      }
      const presenceJid = jid || chatJid;

      if (action === "archive") {
        const next = !chat.archived;
        if (this.sock?.chatModify)
          await this.sock.chatModify({ archive: next }, chatJid).catch(() => {});
        chat.archived = next;
      } else if (action === "pin") {
        const next = chat.pinned ? 0 : Math.floor(Date.now() / 1000);
        if (this.sock?.chatModify)
          await this.sock.chatModify({ pin: !!next }, chatJid).catch(() => {});
        chat.pinned = next;
      } else if (action === "unread") {
        chat.unread = Math.max(chat.unread || 0, 1);
      } else if (action === "mute") {
        if (this.sock?.chatModify)
          await this.sock
            .chatModify({ mute: 8 * 60 * 60 * 1000 }, chatJid)
            .catch(() => {});
      } else if (action === "typing") {
        await this._sendChatPresence("composing", presenceJid);
      } else if (action === "recording") {
        await this._sendChatPresence("recording", presenceJid);
      } else if (action === "paused") {
        await this._sendChatPresence("paused", presenceJid);
      } else if (action === "block") {
        if (this.sock?.updateBlockStatus && !chatJid.endsWith("@g.us"))
          await this.sock.updateBlockStatus(chatJid, "block").catch(() => {});
      } else if (action === "clear") {
        this._messages[chatJid] = [];
        this._msgIndex[chatJid] = new Set();
        chat.lastMessage = "";
        chat.unread = 0;
      } else if (action === "delete") {
        delete this._chats[chatJid];
        delete this._messages[chatJid];
        delete this._msgIndex[chatJid];
      } else {
        return { success: false, error: "Ação inválida" };
      }
      if (chat) {
        this._saveDataNow();
        this._emitChatUpdate();
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Apaga mensagem.
   * forEveryone=true: tenta apagar para todos (só próprias, janela do WA).
   * forEveryone=false: remove só do histórico local do Sigma.
   */
  async deleteMessage(jid, key, { forEveryone = true } = {}) {
    if (!key?.id) return { success: false, error: "Mensagem inválida" };
    const removeLocal = (storeJid) => {
      if (!storeJid || !this._messages[storeJid]) return;
      const before = this._messages[storeJid].length;
      this._messages[storeJid] = this._messages[storeJid].filter(
        (m) => m.key?.id !== key.id,
      );
      if (this._msgIndex[storeJid]) this._msgIndex[storeJid].delete(key.id);
      if (this._messages[storeJid].length !== before) {
        const last = this._messages[storeJid][this._messages[storeJid].length - 1];
        if (this._chats[storeJid]) {
          this._chats[storeJid].lastMessage = last
            ? (last.key?.fromMe ? "Você: " : "") + (this._getMessageText(last) || "…")
            : "";
        }
      }
    };

    try {
      if (forEveryone) {
        if (!this.sock || this._status !== "connected") {
          return { success: false, error: "WhatsApp não conectado" };
        }
        const delKey = {
          remoteJid: key.remoteJid || jid,
          fromMe: key.fromMe !== false,
          id: key.id,
          participant: key.participant,
        };
        await this.sock.sendMessage(jid, { delete: delKey });
      }

      // Limpa em todos os aliases (LID/PN)
      const targets = new Set(
        [jid, key.remoteJid, this._getPhoneJid(jid), this._jidAliases[jid]].filter(Boolean),
      );
      for (const t of targets) removeLocal(t);
      // busca residual
      for (const t of Object.keys(this._messages || {})) {
        if ((this._messages[t] || []).some((m) => m.key?.id === key.id)) removeLocal(t);
      }
      this._outgoingMediaById?.delete(key.id);
      this._saveData();
      this._emitChatUpdate();
      return { success: true, forEveryone: !!forEveryone };
    } catch (e) {
      // Se "para todos" falhar (ex.: tempo esgotado), ainda oferece limpar local
      if (forEveryone) {
        try {
          const targets = new Set([jid, key.remoteJid].filter(Boolean));
          for (const t of targets) removeLocal(t);
          this._saveData();
          this._emitChatUpdate();
        } catch { /* ignore */ }
      }
      return { success: false, error: e.message };
    }
  }

  getStatus() {
    return this._status;
  }
  /** Pronto para enviar (campanhas / chat) */
  isReady() {
    return this._status === "connected" && !!this.sock;
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

  getMediaCacheRoot() {
    return this._mediaCacheRoot;
  }

  getStickerCacheRoot() {
    return this._stickerCacheRoot;
  }

  _unwrapMessageContent(message) {
    if (!message || typeof message !== "object") return message || {};
    const inner =
      message.ephemeralMessage?.message ||
      message.viewOnceMessage?.message ||
      message.viewOnceMessageV2?.message ||
      message.viewOnceMessageV2Extension?.message ||
      message.documentWithCaptionMessage?.message ||
      message.editedMessage?.message ||
      null;
    return inner ? this._unwrapMessageContent(inner) : message;
  }

  _getMessageMediaMeta(msg) {
    const mc = this._unwrapMessageContent(msg?.message || {});
    if (mc.imageMessage) {
      return {
        kind: "image",
        mimetype: mc.imageMessage.mimetype || "image/jpeg",
        fileName: null,
      };
    }
    if (mc.videoMessage) {
      return {
        kind: "video",
        mimetype: mc.videoMessage.mimetype || "video/mp4",
        fileName: null,
      };
    }
    if (mc.audioMessage) {
      return {
        kind: "audio",
        mimetype: mc.audioMessage.mimetype || "audio/ogg",
        fileName: null,
      };
    }
    if (mc.documentMessage) {
      return {
        kind: "document",
        mimetype: mc.documentMessage.mimetype || "application/octet-stream",
        fileName: mc.documentMessage.fileName || null,
      };
    }
    if (mc.stickerMessage) {
      return {
        kind: "sticker",
        mimetype: mc.stickerMessage.mimetype || "image/webp",
        fileName: null,
      };
    }
    return null;
  }

  _readCachedMedia(jid, messageId, mimetype) {
    try {
      const filePath = this._getMediaCachePath(jid, messageId, mimetype);
      if (!fs.existsSync(filePath)) return null;
      const buffer = fs.readFileSync(filePath);
      return {
        success: true,
        data: buffer.toString("base64"),
        mimetype,
        filePath,
        cached: true,
      };
    } catch (e) {
      return null;
    }
  }

  _findMessageAnywhere(jid, messageId) {
    const tryJids = [
      jid,
      this._getPhoneJid(jid),
      this._jidAliases[jid],
      this._getDisplayJid(jid),
    ].filter(Boolean);
    for (const j of tryJids) {
      const list = this._messages[j] || [];
      const hit = list.find((m) => m.key?.id === messageId);
      if (hit) return { msg: hit, jid: j };
    }
    // Busca global por id (enviamos em PN, UI pede no LID, etc.)
    for (const [j, list] of Object.entries(this._messages || {})) {
      const hit = (list || []).find((m) => m.key?.id === messageId);
      if (hit) return { msg: hit, jid: j };
    }
    return null;
  }

  async downloadMedia(jid, messageId) {
    try {
      // 1) Cache de mídia que NÓS enviamos (sempre disponível localmente)
      const outgoing = this._outgoingMediaById?.get(messageId);
      if (outgoing?.filePath && fs.existsSync(outgoing.filePath)) {
        const buffer = fs.readFileSync(outgoing.filePath);
        return {
          success: true,
          data: buffer.toString("base64"),
          mimetype: outgoing.mimetype || "application/octet-stream",
          filePath: outgoing.filePath,
          fileName: outgoing.fileName || null,
          kind: outgoing.kind || null,
          cached: true,
        };
      }

      // 2) Mensagem no histórico (incluindo aliases LID/PN)
      const found = this._findMessageAnywhere(jid, messageId);
      if (!found?.msg) {
        // Ainda tenta arquivo em cache por jid informado
        for (const mimeGuess of ["audio/ogg", "audio/ogg; codecs=opus", "image/jpeg", "video/mp4", "image/webp"]) {
          const guess = this._getMediaCachePath(jid, messageId, mimeGuess);
          if (fs.existsSync(guess)) {
            const buffer = fs.readFileSync(guess);
            return {
              success: true,
              data: buffer.toString("base64"),
              mimetype: mimeGuess,
              filePath: guess,
              cached: true,
            };
          }
        }
        return { success: false, error: "Message not found" };
      }
      const { msg, jid: storeJid } = found;

      const meta = this._getMessageMediaMeta(msg);
      if (!meta) {
        // Sem meta no payload sintético, mas pode ter arquivo no cache
        for (const mimeGuess of ["audio/ogg", "audio/ogg; codecs=opus", "audio/webm"]) {
          const guess = this._getMediaCachePath(storeJid, messageId, mimeGuess);
          if (fs.existsSync(guess)) {
            const buffer = fs.readFileSync(guess);
            return {
              success: true,
              data: buffer.toString("base64"),
              mimetype: mimeGuess,
              filePath: guess,
              kind: "audio",
              cached: true,
            };
          }
        }
        return { success: false, error: "Message has no media" };
      }

      const cached = this._readCachedMedia(storeJid, messageId, meta.mimetype);
      if (cached) return cached;
      // tenta no jid da UI também
      const cached2 = this._readCachedMedia(jid, messageId, meta.mimetype);
      if (cached2) return cached2;

      // Stickers often live under a different extension already cached by saveStickerMedia
      if (meta.kind === "sticker") {
        const stickerGuess = this._getMediaCachePath(storeJid, messageId, "image/webp");
        if (fs.existsSync(stickerGuess)) {
          const buffer = fs.readFileSync(stickerGuess);
          return {
            success: true,
            data: buffer.toString("base64"),
            mimetype: "image/webp",
            filePath: stickerGuess,
            cached: true,
          };
        }
      }

      // Mensagem sintética (sem mediaKey) não baixa da rede — precisa do cache local
      if (!this._messageHasDownloadableMedia(msg)) {
        return {
          success: false,
          error: "Mídia local não encontrada (reabra o app após reenviar)",
        };
      }

      const { downloadMediaMessage } = require("@whiskeysockets/baileys");
      const unwrappedContent = this._unwrapMessageContent(msg.message || {});
      const downloadMsg =
        unwrappedContent && unwrappedContent !== msg.message
          ? { ...msg, message: unwrappedContent }
          : msg;
      const buffer = await downloadMediaMessage(
        downloadMsg,
        "buffer",
        {},
        {
          logger: require("pino")({ level: "silent" }),
          reuploadRequest: this.sock?.updateMediaMessage,
        },
      );
      const base64 = buffer.toString("base64");
      const mimetype = meta.mimetype || "application/octet-stream";
      const filePath = this._getMediaCachePath(storeJid, messageId, mimetype);
      try {
        this._ensureDir(path.dirname(filePath));
        fs.writeFileSync(filePath, buffer);
      } catch (e) {}
      return {
        success: true,
        data: base64,
        mimetype,
        filePath,
        fileName: meta.fileName || null,
        kind: meta.kind,
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async saveStickerMedia(jid, messageId, label) {
    try {
      const media = await this.downloadMedia(jid, messageId);
      if (!media.success) return media;
      this._ensureDir(this._stickerCacheRoot);
      const stickerId = this._safeCacheSegment(`sticker_${jid}_${messageId}`);
      const stickerName = `${stickerId}.webp`;
      const stickerPath = path.join(this._stickerCacheRoot, stickerName);
      if (!fs.existsSync(stickerPath)) {
        const src = media.filePath || "";
        if (src && fs.existsSync(src)) {
          fs.copyFileSync(src, stickerPath);
        } else {
          fs.writeFileSync(stickerPath, Buffer.from(media.data, "base64"));
        }
      }
      return {
        success: true,
        sticker: {
          id: stickerId,
          name: label || messageId,
          filePath: stickerPath,
          mimetype: media.mimetype || "image/webp",
          createdAt: Date.now(),
        },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = { BaileysProvider };
