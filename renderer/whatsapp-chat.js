var chats = [];
var archivedChats = [];
var showArchived = false;
var activeChat = null;
var chatMessages = {};
var chatFilter = "";
var isRecording = false;
var mediaRecorder = null;
var audioChunks = [];
var hasConnected = false;
var syncDone = false;
var syncStats = null;
var syncStartedAt = 0;
var editingFunnel = false;
var _refreshTimer = null;
var sidebarCollapsed = false;
var profilePicCache = {};
var profilePicLoading = {};
var showingProfile = false;
var mediaCache = {};
var replyingToMsg = null;
var chatListenersBound = false;
var waSettings = loadWaSettings();
var stickerLibrary = [];
var settingsSyncPromise = null;
var activeStickerTray = null;

function normalizeWaSettings(raw) {
  var input = raw && typeof raw === "object" ? raw : {};
  var notif =
    input.notifications && typeof input.notifications === "object"
      ? input.notifications
      : { desktop: input.notifications !== false };
  return {
    notifications: {
      desktop: notif.desktop !== false,
      sound: notif.sound !== false,
      showPreview: notif.showPreview !== false,
      notifyGroups: notif.notifyGroups !== false,
      quietHours: notif.quietHours || null,
    },
    sound: input.sound !== false,
    mutedChats: input.mutedChats || {},
    media: Object.assign(
      {
        autoDownloadImages: true,
        autoDownloadAudio: true,
        autoDownloadVideos: false,
        autoDownloadDocuments: false,
        autoDownloadStickers: true,
        maxAutoDownloadBytes: 5242880,
        cacheLimitBytes: 1073741824,
      },
      input.media || {},
    ),
    previews: Object.assign(
      { links: true, pdf: true, videoPreloadBytes: 5242880 },
      input.previews || {},
    ),
    groups: Object.assign(
      {
        allowFunnels: false,
        confirmFunnels: true,
        allowCampaigns: false,
        downloadPictures: true,
      },
      input.groups || {},
    ),
  };
}

function loadWaSettings() {
  try {
    return normalizeWaSettings(
      JSON.parse(localStorage.getItem("sigma_wa_settings") || "{}"),
    );
  } catch (e) {
    return normalizeWaSettings({});
  }
}

function saveWaSettings() {
  localStorage.setItem("sigma_wa_settings", JSON.stringify(waSettings));
  if (window.chatAPI && window.chatAPI.updateSettings) {
    window.chatAPI.updateSettings(waSettings).catch(function () {});
  }
}

function fileUrl(path) {
  return "file:///" + String(path || "").replace(/\\/g, "/").replace(/#/g, "%23").replace(/\?/g, "%3F").replace(/ /g, "%20");
}

function extractFirstUrl(text) {
  var match = String(text || "").match(/https?:\/\/[^\s<>"')\]]+/i);
  return match ? match[0] : "";
}

function syncWaSettings() {
  if (settingsSyncPromise) return settingsSyncPromise;
  settingsSyncPromise = window.chatAPI
    .getSettings()
    .then(function (r) {
      if (r && r.settings) {
        waSettings = normalizeWaSettings(Object.assign({}, waSettings, r.settings));
        saveWaSettings();
      }
    })
    .catch(function () {})
    .finally(function () {
      settingsSyncPromise = null;
    });
  return settingsSyncPromise;
}

function getChatDisplayName(jid) {
  var chat =
    chats.find(function (c) {
      return c.jid === jid;
    }) ||
    archivedChats.find(function (c) {
      return c.jid === jid;
    });
  return (chat && chat.name) || formatPhoneDisplay(jid);
}

function playNotificationSound() {
  try {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    var ctx = new AudioCtx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch (e) {}
}

function notifyIncomingMessage(data) {
  if (!data || !data.message || data.message.key?.fromMe) return;
  if (waSettings.mutedChats && waSettings.mutedChats[data.jid]) return;
  if (waSettings.sound) playNotificationSound();
  if (!waSettings.notifications || waSettings.notifications.desktop === false || typeof Notification === "undefined") return;
  var name = getChatDisplayName(data.jid);
  var body = data.message.message
    ? formatMessagePreview(data.message.message)
    : "Nova mensagem";
  if (Notification.permission === "granted") {
    new Notification(name, { body });
  }
}

function toggleMutedChat(jid) {
  if (!jid) return false;
  waSettings.mutedChats = waSettings.mutedChats || {};
  if (waSettings.mutedChats[jid]) delete waSettings.mutedChats[jid];
  else waSettings.mutedChats[jid] = true;
  saveWaSettings();
  return !!waSettings.mutedChats[jid];
}

function formatMessagePreview(message) {
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage) return "Foto";
  if (message.videoMessage) return "Video";
  if (message.audioMessage) return "Audio";
  if (message.documentMessage) return message.documentMessage.fileName || "Documento";
  if (message.stickerMessage) return "Figurinha";
  return "Nova mensagem";
}

function formatPhoneDisplay(jid) {
  if (!jid) return "";
  if (jid.endsWith("@g.us")) return "Grupo";
  var digits = jid.replace(/@.*$/, "").replace(/\D/g, "");
  if (!digits) return jid;
  // JIDs with more than 15 digits are not real phone numbers (e.g. business IDs, server IDs)
  if (digits.length > 14 || digits.indexOf("120363") === 0) return "";
  return "+" + digits;
}

function getChatPhone(c) {
  if (!c) return "";
  return c.phone || (c.phoneJid ? formatPhoneDisplay(c.phoneJid) : "") || formatPhoneDisplay(c.jid);
}

function getChatName(c) {
  if (!c) return "";
  var isGrp = c.isGroup || (c.jid || "").endsWith("@g.us");
  var phone = getChatPhone(c);
  var name = c.name || "";
  if (isGrp) return name && !/^\+?\d[\d\s\-()]*$/.test(name) ? name : "Grupo";
  if (!name || name === (c.jid || "").split("@")[0] || /^\+?\d[\d\s\-()]*$/.test(name)) {
    return phone || name || (c.jid || "").split("@")[0];
  }
  return name;
}

function messageToFunnelText(msg) {
  var mc = msg && msg.message;
  if (!mc) return "";
  return (
    mc.conversation ||
    (mc.extendedTextMessage && mc.extendedTextMessage.text) ||
    (mc.imageMessage && mc.imageMessage.caption) ||
    (mc.videoMessage && mc.videoMessage.caption) ||
    ""
  );
}

function pickAudioMimeType() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4;codecs=mp4a.40.2")) return "audio/mp4;codecs=mp4a.40.2";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) return "audio/ogg;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  return "audio/webm";
}

var FUNNEL_TEMPLATES = [
  {
    name: "Boas-vindas",
    header: "Olá! Somos da *{empresa}*. Como podemos ajudar?",
    footer: "Responda abaixo:",
  },
  {
    name: "Agendamento",
    header: "Gostaria de agendar uma visita? Qual sua disponibilidade?",
    footer: "Escolha uma opção:",
  },
  {
    name: "Orçamento",
    header: "Sobre qual serviço gostaria de mais informações?",
  },
];

function loadFunnels() {
  try {
    var s = localStorage.getItem("sigma_funnels");
    if (s) FUNNEL_TEMPLATES = JSON.parse(s);
  } catch (e) {}
}
function saveFunnels() {
  localStorage.setItem("sigma_funnels", JSON.stringify(FUNNEL_TEMPLATES));
}
loadFunnels();

// ─── RENDER ────────────────────────────────
var _chatListInitialized = false;

async function renderChatList() {
  var panel = document.getElementById("waChatsPanel");
  if (!panel) return;
  await syncWaSettings();
  if (_chatListInitialized) {
    await refreshChats();
    return;
  }
  _chatListInitialized = true;
  panel.innerHTML =
    '<div id="chatSidebar"' +
    (sidebarCollapsed ? ' class="collapsed"' : "") +
    '><button class="chat-sidebar-toggle" id="sidebarToggle">' +
    (sidebarCollapsed ? "▶" : "◀") +
    '</button><div id="chatConnectionSwitcher"></div><div id="chatSidebarInner" style="flex:1;overflow-y:auto;"></div></div>' +
    '<div id="chatMain"><div id="chatMainInner"></div></div>' +
    '<div id="chatProfileSidebar" style="width:340px; border-left:1px solid #2a3942; background:#111b21; display:none; flex-direction:column; flex-shrink:0;"></div>';
  showWhatsAppLoading("Carregando WhatsApp", "Buscando conexao ativa e conversas recentes...");
  document
    .getElementById("sidebarToggle")
    .addEventListener("click", function () {
      sidebarCollapsed = !sidebarCollapsed;
      var sb = document.getElementById("chatSidebar");
      if (sb) sb.classList.toggle("collapsed", sidebarCollapsed);
      this.textContent = sidebarCollapsed ? "▶" : "◀";
    });

  // Check if already connected
  try {
    var st = await window.whatsappAPI.getStatus();
    if (st.connected) {
      hasConnected = true;
    }
  } catch (e) {}

  bindChatEventsOnce();
  renderChatConnectionSwitcher();

  await refreshChats();
}

async function renderChatConnectionSwitcher() {
  var box = document.getElementById("chatConnectionSwitcher");
  if (!box || !window.whatsappAPI.listConnections) return;
  var res = await window.whatsappAPI.listConnections();
  var connections = res.connections || [];
  if (connections.length <= 1) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML =
    '<select id="chatConnectionSelect" class="chat-connection-select">' +
    connections
      .map(function (c) {
        return (
          '<option value="' +
          escHtml(c.id) +
          '" ' +
          (c.active ? "selected" : "") +
          ">" +
          escHtml(c.phoneNumber || c.id.replace(/^wa_/, "WhatsApp ")) +
          "</option>"
        );
      })
      .join("") +
    "</select>";
  box.querySelector("select").addEventListener("change", async function () {
    var res = await window.whatsappAPI.switchConnection(this.value);
    if (res.success) {
      activeChat = null;
      chats = [];
      archivedChats = [];
      chatMessages = {};
      profilePicCache = {};
      syncStats = null;
      syncDone = false;
      await refreshChats();
      showEmptyChat();
      toast("WhatsApp ativo alterado", "s");
    }
  });
}

function bindChatEventsOnce() {
  if (chatListenersBound) return;
  chatListenersBound = true;
  window.chatAPI.onSync(function (data) {
    hasConnected = true;
    if (data.type === "sync-start") {
      syncDone = false;
      syncStartedAt = Date.now();
      syncStats = data.stats || syncStats || {};
    }
    if (data.type === "sync-progress") {
      var pct = Number(data.stats && data.stats.progress);
      syncDone = pct >= 100 || pct === 1;
      if (!syncStartedAt) syncStartedAt = Date.now();
      syncStats = data.stats || syncStats;
    }
    if (data.type === "sync-done") {
      syncDone = true;
      syncStats = Object.assign({}, syncStats || {}, data.stats || {}, {
        progress: 100,
      });
      syncStartedAt = 0;
    }
    rerenderChatSidebar();
    setTimeout(refreshChats, 1000);
  });
  window.chatAPI.onMessage(function (data) {
    if (editingFunnel) return;
    if (!data || !data.jid) return;
    notifyIncomingMessage(data);
    if (!chatMessages[data.jid]) chatMessages[data.jid] = [];
    if (
      !chatMessages[data.jid].find(function (m) {
        return (
          m.key &&
          m.key.id === (data.message && data.message.key && data.message.key.id)
        );
      })
    ) {
      chatMessages[data.jid].push(data.message);
    }
    // Only update messages area — do NOT re-render full shell (preserves input bar)
    if (activeChat === data.jid && !editingFunnel) {
      var c = document.getElementById("chatMessagesContainer");
      if (c) {
        c.className = "chat-messages";
        renderMessageBubbles(c, chatMessages[data.jid]);
        setTimeout(function () {
          c.scrollTop = c.scrollHeight;
        }, 50);
      }
    }
  });
  window.chatAPI.onChatUpdate(function () {
    if (!editingFunnel) {
      // Only refresh if chats panel is actually visible to avoid unnecessary IPC
      var chatsPanel = document.getElementById("waChatsPanel");
      if (!chatsPanel || chatsPanel.style.display === "none") return;
      if (_refreshTimer) clearTimeout(_refreshTimer);
      _refreshTimer = setTimeout(refreshChats, 3000);
    }
  });
}

async function refreshChats() {
  if (editingFunnel) return;
  var r = await window.chatAPI.getChats();
  chats = r.chats || [];
  try {
    var ar = await window.chatAPI.getArchivedChats();
    archivedChats = ar.chats || [];
  } catch (e) {
    archivedChats = [];
  }
  if (chats.length === 0 && hasConnected) {
    setTimeout(async function () {
      if (editingFunnel) return;
      var r2 = await window.chatAPI.getChats();
      if ((r2.chats || []).length > chats.length) {
        chats = r2.chats;
        rerenderChatSidebar();
      }
    }, 5000);
  }
  rerenderChatSidebar();
  // Restore active chat view if chat was open before tab switch
  if (activeChat && document.getElementById("chatMessagesContainer") && !document.getElementById("chatHeaderClick")) {
    selectChat(activeChat, true);
  }
}

var chatFilterTab = "contacts"; // 'contacts','unread','groups','all'

function getSyncPercent() {
  var raw = syncStats && Number(syncStats.progress);
  if (!isFinite(raw) || raw <= 0) return null;
  if (raw <= 1) raw = raw * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function shouldShowSyncProgress() {
  if (!hasConnected || syncDone) return false;
  var percent = getSyncPercent();
  if (percent >= 100) return false;
  if (!chats.length && !archivedChats.length) return true;
  if (!syncStats) return false;
  if (!syncStartedAt) return false;
  return Date.now() - syncStartedAt < 15000;
}

function buildSyncProgressHtml(compact) {
  var percent = getSyncPercent();
  var remaining = percent === null ? null : 100 - percent;
  var chatsCount = syncStats && syncStats.chats ? syncStats.chats : chats.length;
  var messagesCount = syncStats && syncStats.messages ? syncStats.messages : 0;
  var contactsCount = syncStats && syncStats.contacts ? syncStats.contacts : 0;
  var groupsCount = syncStats && syncStats.groups ? syncStats.groups : 0;
  var barWidth = percent === null ? 32 : percent;
  var percentText =
    percent === null
      ? "Calculando"
      : percent + "% concluido · falta " + remaining + "%";
  return (
    '<div class="sync-progress-card' +
    (compact ? " compact" : "") +
    '">' +
    '<div class="sync-progress-head"><span class="sp mini"></span><div><strong>Sincronizando conversas</strong><small>' +
    percentText +
    "</small></div></div>" +
    '<div class="sync-progress-track"><div class="sync-progress-fill" style="width:' +
    barWidth +
    '%;"></div></div>' +
    '<div class="sync-progress-stats"><span><b>' +
    chatsCount +
    '</b> conversas</span><span><b>' +
    messagesCount +
    '</b> mensagens</span><span><b>' +
    contactsCount +
    '</b> contatos</span><span><b>' +
    groupsCount +
    "</b> grupos</span></div>" +
    "</div>"
  );
}

function isGroupChat(c) {
  return !!(c && (c.isGroup || (c.jid || "").endsWith("@g.us")));
}

function isContactChat(c) {
  return !!(c && !isGroupChat(c));
}

function getUnreadCount(c) {
  return Math.max(0, Number((c && c.unread) || 0));
}

function getUnreadTotal(list) {
  return (list || []).reduce(function (sum, c) {
    return sum + getUnreadCount(c);
  }, 0);
}

function getChatSidebarStats() {
  return {
    contacts: chats.filter(isContactChat).length,
    unreadChats: chats.filter(function (c) {
      return getUnreadCount(c) > 0;
    }).length,
    unreadMessages: getUnreadTotal(chats),
    groups: chats.filter(isGroupChat).length,
    all: chats.length,
  };
}

function buildFilterTabHtml(tab, label, count) {
  var badge =
    count > 0 ? '<span class="chat-filter-count">' + (count > 99 ? "99+" : count) + "</span>" : "";
  return (
    '<button class="chat-filter-tab' +
    (chatFilterTab === tab ? " active" : "") +
    '" data-ftab="' +
    tab +
    '"><span>' +
    label +
    "</span>" +
    badge +
    "</button>"
  );
}

function rerenderChatSidebar() {
  var inner = document.getElementById("chatSidebarInner");
  if (!inner) return;
  var oldSearch = document.getElementById("chatSearch");
  var keepSearchFocus = oldSearch && document.activeElement === oldSearch;
  var keepSelectionStart = keepSearchFocus ? oldSearch.selectionStart : null;
  var keepSelectionEnd = keepSearchFocus ? oldSearch.selectionEnd : null;
  var stats = getChatSidebarStats();
  var filtered = chats;
  // Apply tab filter
  if (chatFilterTab === "contacts")
    filtered = filtered.filter(function (c) {
      return isContactChat(c);
    });
  else if (chatFilterTab === "unread")
    filtered = filtered.filter(function (c) {
      return getUnreadCount(c) > 0;
    });
  else if (chatFilterTab === "groups")
    filtered = filtered.filter(function (c) {
      return isGroupChat(c);
    });
  // Apply text search
  if (chatFilter)
    filtered = filtered.filter(function (c) {
      return (
        ((c.name || "") + " " + (c.phone || "") + " " + (c.jid || ""))
          .toLowerCase()
          .indexOf(chatFilter) !== -1
      );
    });
  var pinned = filtered.filter(function (c) {
    return c.pinned;
  });
  var regular = filtered.filter(function (c) {
    return !c.pinned;
  });

  var h = "";
  // Search bar
  h +=
    '<div style="padding:8px 12px;border-bottom:1px solid #2a3942;display:flex;gap:8px;align-items:center;"><input id="chatSearch" placeholder="Pesquisar ou começar uma nova conversa" style="flex:1;min-width:0;background:#202c33;border:none;color:#e9edef;padding:7px 12px;border-radius:8px;font-size:13px;outline:none;" value="' +
    escHtml(chatFilter) +
    '"><button id="btnNewChat" title="Nova conversa" style="width:34px;height:34px;border:none;border-radius:8px;background:#202c33;color:#e9edef;cursor:pointer;">＋</button></div>';
  // Filter tabs
  h += '<div class="chat-filter-tabs">';
  h += buildFilterTabHtml("contacts", "Conversas", stats.contacts);
  h += buildFilterTabHtml("unread", "Não lidas", stats.unreadMessages);
  h += buildFilterTabHtml("groups", "Grupos", stats.groups);
  h += buildFilterTabHtml("all", "Tudo", stats.all);
  h += "</div>";
  if (shouldShowSyncProgress() && chats.length > 0) {
    h += buildSyncProgressHtml(true);
  }

  if (chats.length === 0) {
    if (!shouldShowSyncProgress() && hasConnected) {
      h +=
        '<div style="padding:40px;text-align:center;color:#8696a0;font-size:13px;">Nenhuma conversa encontrada</div>';
    } else if (!shouldShowSyncProgress()) {
      h +=
        '<div style="padding:40px;text-align:center;color:#8696a0;font-size:13px;">Conecte-se na aba Conexão</div>';
    }
  } else {
    // Archived row (WhatsApp Web style — at top)
    if (archivedChats.length > 0 && chatFilterTab === "all") {
      h +=
        '<div class="archived-row" id="archivedToggle"><span>📦</span><span>Arquivadas</span><span class="archived-count">' +
        archivedChats.length +
        "</span></div>";
    }
    h += '<div id="chatList">';
    if (pinned.length > 0) {
      for (var p = 0; p < pinned.length; p++)
        h += buildChatItemHtml(pinned[p], true);
    }
    for (var i = 0; i < regular.length; i++)
      h += buildChatItemHtml(regular[i], false);
    h += "</div>";
    // Archived expanded list
    if (showArchived && archivedChats.length > 0) {
      h += '<div id="archivedList" style="border-top:1px solid #2a3942;">';
      for (var a = 0; a < archivedChats.length; a++)
        h += buildChatItemHtml(archivedChats[a], false);
      h += "</div>";
    }
  }
  h +=
    '<div class="chat-sidebar-footer" style="font-size:9px;color:#8696a0;text-align:center;padding:6px;">' +
    filtered.length +
    " exibida" +
    (filtered.length !== 1 ? "s" : "") +
    (stats.unreadMessages ? " · " + stats.unreadMessages + " não lida" + (stats.unreadMessages !== 1 ? "s" : "") : "") +
    "</div>";
  inner.innerHTML = h;

  // Tab filter events
  inner.querySelectorAll(".chat-filter-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      chatFilterTab = this.dataset.ftab;
      rerenderChatSidebar();
    });
  });
  // Archived toggle
  var at = document.getElementById("archivedToggle");
  if (at)
    at.addEventListener("click", function () {
      showArchived = !showArchived;
      rerenderChatSidebar();
    });
  // Search
  var s = document.getElementById("chatSearch");
  if (s) {
    s.addEventListener("input", function () {
      chatFilter = this.value.toLowerCase();
      rerenderChatSidebar();
    });
    s.value = chatFilter;
    if (keepSearchFocus) {
      s.focus();
      var pos = keepSelectionStart == null ? s.value.length : keepSelectionStart;
      s.setSelectionRange(pos, keepSelectionEnd == null ? pos : keepSelectionEnd);
    }
  }
  var nc = document.getElementById("btnNewChat");
  if (nc) {
    nc.addEventListener("click", function () {
      startNewConversation();
    });
  }
  // Chat click
  var l = inner.querySelector("#chatList");
  if (l)
    l.querySelectorAll(".chat-item").forEach(function (el) {
      el.addEventListener("click", function () {
        selectChat(this.dataset.jid, false);
      });
      el.addEventListener("contextmenu", function (e) {
        showChatContextMenu(e, this.dataset.jid);
      });
    });
  var al2 = document.getElementById("archivedList");
  if (al2)
    al2.querySelectorAll(".chat-item").forEach(function (el) {
      el.addEventListener("click", function () {
        selectChat(this.dataset.jid, false);
      });
      el.addEventListener("contextmenu", function (e) {
        showChatContextMenu(e, this.dataset.jid);
      });
    });
  if (!activeChat) {
    if (chats.length === 0 && shouldShowSyncProgress()) {
      var statsText = syncStats
        ? (getSyncPercent() || "0") +
          "% · " +
          (syncStats.chats || 0) +
          " conversas · " +
          (syncStats.messages || 0) +
          " mensagens"
        : "Carregando conversas recentes...";
      showWhatsAppLoading("Carregando WhatsApp", statsText);
    } else {
      showEmptyChat();
    }
  }
  loadVisibleProfilePics(
    showArchived && archivedChats.length > 0
      ? filtered.concat(archivedChats)
      : filtered,
  );
}

function buildChatItemHtml(c, isPinned) {
  var unreadCount = getUnreadCount(c);
  var hasUnread = unreadCount > 0;
  var badge = hasUnread
    ? '<span class="chat-badge">' +
      (unreadCount > 99 ? "99+" : unreadCount) +
      "</span>"
    : "";
  var pinHtml = isPinned ? '<span class="pin-icon">📌</span>' : "";
  var isGrp = isGroupChat(c);
  var phoneFormatted = getChatPhone(c);
  var displayName = getChatName(c);
  var initial = (
    isGrp
      ? "👥"
      : displayName || phoneFormatted || "?"
  )
    .charAt(0)
    .toUpperCase();
  if (c.profilePic && !profilePicCache[c.jid]) profilePicCache[c.jid] = c.profilePic;
  var cachedPic = profilePicCache[c.jid];
  var avatarClass = "chat-avatar" + (isGrp ? " group-avatar" : "");
  var avatarInner = cachedPic
    ? '<img src="' + escHtml(cachedPic) + '">'
    : isGrp
      ? "👥"
      : initial;
  var timeClass = "chat-time" + (hasUnread ? " has-unread" : "");
  // Message preview with type icon
  var preview = c.lastMessage || "";
  if (!preview && isGrp) preview = "Toque para abrir";

  // Show phone number below name for individual contacts (WhatsApp Web style)
  var chatName = escHtml(displayName || phoneFormatted);
  var phoneSub = "";
  if (
    !isGrp &&
    phoneFormatted &&
    displayName !== phoneFormatted
  ) {
    phoneSub =
      '<div style="color:#8696a0;font-size:11px;margin-top:0px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
      phoneFormatted +
      "</div>";
  }
  return (
    '<div class="chat-item' +
    (activeChat === c.jid ? " active" : "") +
    (isPinned ? " pinned" : "") +
    '" data-jid="' +
    escHtml(c.jid) +
    '">' +
    '<div class="' +
    avatarClass +
    '">' +
    avatarInner +
    "</div>" +
    '<div style="flex:1;min-width:0;" class="chat-item-meta">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;">' +
    '<span class="chat-name">' +
    chatName +
    "</span>" +
    '<span class="' +
    timeClass +
    '">' +
    (c.timestamp ? formatTime(c.timestamp) : "") +
    "</span>" +
    "</div>" +
    phoneSub +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1px;">' +
    '<span class="chat-preview">' +
    escHtml(preview) +
    "</span>" +
    '<div style="display:flex;align-items:center;gap:4px;">' +
    pinHtml +
    badge +
    "</div>" +
    "</div>" +
    "</div></div>"
  );
}

function showChatContextMenu(e, jid) {
  e.preventDefault();
  e.stopPropagation();
  if (activeMsgContextMenu) activeMsgContextMenu.remove();
  var chat =
    chats.find(function (c) {
      return c.jid === jid;
    }) ||
    archivedChats.find(function (c) {
      return c.jid === jid;
    });
  var isArchived = !!(chat && chat.archived);
  var isPinned = !!(chat && chat.pinned);
  var isMuted = !!(waSettings.mutedChats && waSettings.mutedChats[jid]);
  var menu = document.createElement("div");
  menu.className = "chat-context-menu";
  menu.style.cssText = "position:fixed;z-index:1000;";
  menu.innerHTML =
    '<div class="context-menu-item" data-act="archive">📥 <span>' +
    (isArchived ? "Desarquivar conversa" : "Arquivar conversa") +
    "</span></div>" +
    '<div class="context-menu-item" data-act="pin">📌 <span>' +
    (isPinned ? "Desafixar conversa" : "Fixar conversa") +
    "</span></div>" +
    '<div class="context-menu-item" data-act="unread">💬 <span>Marcar como não lida</span></div>' +
    '<div class="context-menu-item" data-act="mute">🔕 <span>' +
    (isMuted ? "Ativar notificações" : "Silenciar notificações") +
    "</span></div>" +
    '<div class="context-menu-sep"></div>' +
    '<div class="context-menu-item" data-act="block">🚫 <span>Bloquear</span></div>' +
    '<div class="context-menu-item" data-act="clear">🧹 <span>Limpar conversa</span></div>' +
    '<div class="context-menu-item" data-act="delete">🗑️ <span>Apagar conversa</span></div>';
  document.body.appendChild(menu);
  var left = e.clientX,
    top = e.clientY;
  var rect = menu.getBoundingClientRect();
  if (left + rect.width > window.innerWidth)
    left = window.innerWidth - rect.width - 8;
  if (top + rect.height > window.innerHeight)
    top = window.innerHeight - rect.height - 8;
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.querySelectorAll(".context-menu-item").forEach(function (item) {
    item.addEventListener("click", function () {
      var act = this.dataset.act;
      menu.remove();
      activeMsgContextMenu = null;
      performChatAction(jid, act);
    });
  });
  activeMsgContextMenu = menu;
  setTimeout(function () {
    document.addEventListener("click", function closeMenu(ev) {
      if (menu && !menu.contains(ev.target)) {
        menu.remove();
        activeMsgContextMenu = null;
        document.removeEventListener("click", closeMenu);
      }
    });
  }, 10);
}

async function performChatAction(jid, act) {
  if (act === "mute") {
    var muted = toggleMutedChat(jid);
    try {
      if (muted) await window.chatAPI.chatAction(jid, act);
    } catch (e) {}
    toast(muted ? "Conversa silenciada" : "Conversa com som ativo", "s");
    renderWaSettings();
    return;
  }
  if (
    act === "clear" &&
    !confirm("Limpar as mensagens desta conversa localmente?")
  )
    return;
  if (act === "delete" && !confirm("Apagar esta conversa localmente?")) return;
  try {
    var r = await window.chatAPI.chatAction(jid, act);
    if (!r || !r.success) toast((r && r.error) || "Ação não concluída", "e");
    else {
      toast("Ação aplicada", "s");
      if ((act === "delete" || act === "clear") && activeChat === jid) {
        activeChat = null;
        showEmptyChat();
      }
      await refreshChats();
      renderWaSettings();
    }
  } catch (e) {
    toast(e.message || "Erro", "e");
  }
}

function loadVisibleProfilePics(chatList) {
  chatList.forEach(function (c) {
    if (isGroupChat(c) && waSettings.groups && waSettings.groups.downloadPictures === false) return;
    if (profilePicCache[c.jid] || profilePicLoading[c.jid]) return;
    profilePicLoading[c.jid] = true;
    window.chatAPI
      .getProfilePic(c.jid)
      .then(function (r) {
        if (r && r.url) {
          profilePicCache[c.jid] = r.url;
          c.profilePic = r.url;
          // Update avatar in sidebar without full re-render
          var item = Array.prototype.find.call(
            document.querySelectorAll(".chat-item"),
            function (el) {
              return el.dataset.jid === c.jid;
            },
          );
          var el = item && item.querySelector(".chat-avatar");
          if (el) {
            el.innerHTML = "";
            var img = document.createElement("img");
            img.src = r.url;
            el.appendChild(img);
          }
        } else {
          delete profilePicCache[c.jid];
        }
      })
      .finally(function () {
        delete profilePicLoading[c.jid];
      });
  });
}

function showEmptyChat() {
  var m = document.getElementById("chatMainInner");
  if (m) {
    m.innerHTML =
      '<div class="chat-empty"><div style="font-size:48px;opacity:0.3;margin-bottom:16px;">💬</div><div style="color:#8696a0;font-size:14px;">WhatsApp</div><div style="color:#8696a0;font-size:12px;margin-top:8px;">Selecione uma conversa para começar</div>' +
      "</div>";
  }
}

function showWhatsAppLoading(title, subtitle) {
  var m = document.getElementById("chatMainInner");
  if (!m) return;
  m.innerHTML =
    '<div class="chat-empty"><div class="sp" style="width:30px;height:30px;margin-bottom:16px;"></div><div style="color:#e9edef;font-size:14px;">' +
    escHtml(title || "Carregando WhatsApp") +
    '</div><div style="color:#8696a0;font-size:12px;margin-top:8px;">' +
    escHtml(subtitle || "Preparando suas conversas...") +
    "</div></div>";
}

function renderWaSettings() {
  var panel = document.getElementById("waSettingsPanel");
  if (!panel) return;
  var activeName = activeChat ? getChatDisplayName(activeChat) : "";
  var activeMuted = !!(
    activeChat &&
    waSettings.mutedChats &&
    waSettings.mutedChats[activeChat]
  );
  var mutedList = Object.keys(waSettings.mutedChats || {});
  panel.innerHTML =
    '<div class="wa-settings-grid">' +
    '<div class="wa-card wa-settings-card"><h4>⚙️ Notificações</h4>' +
    '<label class="wa-toggle-row"><span><b>Notificações na área de trabalho</b><small>Mostra alerta quando chegar mensagem nova.</small></span><input type="checkbox" id="waNotifToggle" ' +
    (waSettings.notifications && waSettings.notifications.desktop !== false ? "checked" : "") +
    "></label>" +
    '<label class="wa-toggle-row"><span><b>Som de nova mensagem</b><small>Reproduz um toque curto ao receber mensagem.</small></span><input type="checkbox" id="waSoundToggle" ' +
    (waSettings.sound ? "checked" : "") +
    "></label>" +
    '<button class="btn btn2" id="waAskNotifPermission">🔔 Permitir notificações do sistema</button>' +
    "</div>" +
    '<div class="wa-card wa-settings-card"><h4>💬 Conversa atual</h4>' +
    (activeChat
      ? '<div class="wa-current-chat"><div><span>Selecionada</span><strong>' +
        escHtml(activeName) +
        "</strong><small>" +
        escHtml(activeChat) +
        "</small></div></div>" +
        '<div class="wa-settings-actions"><button class="btn btn2" id="waMuteActive">' +
        (activeMuted ? "🔔 Ativar notificações" : "🔕 Silenciar conversa") +
        '</button><button class="btn btn2" id="waArchiveActive">📥 Arquivar conversa</button></div>'
      : '<p class="wa-settings-empty">Selecione uma conversa na aba Chats para configurar silenciar ou arquivar.</p>') +
    "</div>" +
    '<div class="wa-card wa-settings-card"><h4>🔕 Conversas silenciadas</h4>' +
    (mutedList.length
      ? mutedList
          .map(function (jid) {
            return (
              '<div class="wa-muted-row"><span>' +
              escHtml(getChatDisplayName(jid)) +
              '</span><button class="btn btn2 wa-unmute-btn" data-jid="' +
              escHtml(jid) +
              '">Ativar</button></div>'
            );
          })
          .join("")
      : '<p class="wa-settings-empty">Nenhuma conversa silenciada.</p>') +
    "</div>" +
    '<div class="wa-card wa-settings-card"><h4>📦 Mídia</h4>' +
    '<label class="wa-toggle-row"><span><b>Baixar imagens automaticamente</b><small>Imagem recebida entra no cache local.</small></span><input type="checkbox" id="waMediaImages" ' +
    (waSettings.media && waSettings.media.autoDownloadImages ? "checked" : "") +
    '></label><label class="wa-toggle-row"><span><b>Baixar vídeos automaticamente</b><small>Vídeo recebido fica pronto sem novo download.</small></span><input type="checkbox" id="waMediaVideos" ' +
    (waSettings.media && waSettings.media.autoDownloadVideos ? "checked" : "") +
    '></label><label class="wa-toggle-row"><span><b>Baixar documentos automaticamente</b><small>PDF e docs entram no cache local.</small></span><input type="checkbox" id="waMediaDocs" ' +
    (waSettings.media && waSettings.media.autoDownloadDocuments ? "checked" : "") +
    '></label><label class="wa-toggle-row"><span><b>Salvar figurinhas automaticamente</b><small>Figurinhas recebidas vão para biblioteca.</small></span><input type="checkbox" id="waMediaStickers" ' +
    (waSettings.media && waSettings.media.autoDownloadStickers ? "checked" : "") +
    '></label></div>' +
    '<div class="wa-card wa-settings-card"><h4>👁 Previews</h4>' +
    '<label class="wa-toggle-row"><span><b>Prévia de links</b><small>Card com título, imagem e domínio.</small></span><input type="checkbox" id="waPreviewLinks" ' +
    (waSettings.previews && waSettings.previews.links ? "checked" : "") +
    '></label><label class="wa-toggle-row"><span><b>Prévia de PDF</b><small>Abre documento em visualização interna.</small></span><input type="checkbox" id="waPreviewPdf" ' +
    (waSettings.previews && waSettings.previews.pdf ? "checked" : "") +
    '></label></div>' +
    '<div class="wa-card wa-settings-card"><h4>👥 Grupos</h4>' +
    '<label class="wa-toggle-row"><span><b>Baixar foto de grupo</b><small>Atualiza avatar de grupos automaticamente.</small></span><input type="checkbox" id="waGroupPics" ' +
    (waSettings.groups && waSettings.groups.downloadPictures ? "checked" : "") +
    '></label><label class="wa-toggle-row"><span><b>Permitir funis em grupos</b><small>Libera automação em grupo com confirmação.</small></span><input type="checkbox" id="waGroupFunnels" ' +
    (waSettings.groups && waSettings.groups.allowFunnels ? "checked" : "") +
    '></label><label class="wa-toggle-row"><span><b>Confirmar automação em grupo</b><small>Pede confirmação antes de enviar.</small></span><input type="checkbox" id="waGroupFunnelsConfirm" ' +
    (waSettings.groups && waSettings.groups.confirmFunnels ? "checked" : "") +
    '></label></div>' +
    '<div class="wa-card wa-settings-card"><h4>🌟 Figurinhas salvas</h4><div id="waStickerLibrary" class="wa-sticker-library"><p class="wa-settings-empty">Carregando figurinhas...</p></div></div>' +
    "</div></div>";

  var notifToggle = document.getElementById("waNotifToggle");
  if (notifToggle) {
    notifToggle.addEventListener("change", function () {
      waSettings.notifications.desktop = this.checked;
      saveWaSettings();
    });
  }
  var soundToggle = document.getElementById("waSoundToggle");
  if (soundToggle) {
    soundToggle.addEventListener("change", function () {
      waSettings.sound = this.checked;
      saveWaSettings();
    });
  }
  var permissionBtn = document.getElementById("waAskNotifPermission");
  if (permissionBtn) {
    permissionBtn.addEventListener("click", function () {
      if (typeof Notification === "undefined") {
        toast("Notificações não suportadas neste ambiente", "e");
        return;
      }
      Notification.requestPermission().then(function (permission) {
        toast(
          permission === "granted"
            ? "Notificações permitidas"
            : "Notificações não permitidas",
          permission === "granted" ? "s" : "e",
        );
      });
    });
  }
  var mediaImages = document.getElementById("waMediaImages");
  if (mediaImages) {
    mediaImages.addEventListener("change", function () {
      waSettings.media.autoDownloadImages = this.checked;
      saveWaSettings();
    });
  }
  var mediaVideos = document.getElementById("waMediaVideos");
  if (mediaVideos) {
    mediaVideos.addEventListener("change", function () {
      waSettings.media.autoDownloadVideos = this.checked;
      saveWaSettings();
    });
  }
  var mediaDocs = document.getElementById("waMediaDocs");
  if (mediaDocs) {
    mediaDocs.addEventListener("change", function () {
      waSettings.media.autoDownloadDocuments = this.checked;
      saveWaSettings();
    });
  }
  var mediaStickers = document.getElementById("waMediaStickers");
  if (mediaStickers) {
    mediaStickers.addEventListener("change", function () {
      waSettings.media.autoDownloadStickers = this.checked;
      saveWaSettings();
    });
  }
  var previewLinks = document.getElementById("waPreviewLinks");
  if (previewLinks) {
    previewLinks.addEventListener("change", function () {
      waSettings.previews.links = this.checked;
      saveWaSettings();
    });
  }
  var previewPdf = document.getElementById("waPreviewPdf");
  if (previewPdf) {
    previewPdf.addEventListener("change", function () {
      waSettings.previews.pdf = this.checked;
      saveWaSettings();
    });
  }
  var groupPics = document.getElementById("waGroupPics");
  if (groupPics) {
    groupPics.addEventListener("change", function () {
      waSettings.groups.downloadPictures = this.checked;
      saveWaSettings();
      rerenderChatSidebar();
    });
  }
  var groupFunnels = document.getElementById("waGroupFunnels");
  if (groupFunnels) {
    groupFunnels.addEventListener("change", function () {
      waSettings.groups.allowFunnels = this.checked;
      saveWaSettings();
    });
  }
  var groupFunnelsConfirm = document.getElementById("waGroupFunnelsConfirm");
  if (groupFunnelsConfirm) {
    groupFunnelsConfirm.addEventListener("change", function () {
      waSettings.groups.confirmFunnels = this.checked;
      saveWaSettings();
    });
  }
  if (window.chatAPI.listStickers) {
    window.chatAPI.listStickers().then(function (r) {
      stickerLibrary = (r && r.stickers) || [];
      var lib = document.getElementById("waStickerLibrary");
      if (!lib) return;
      lib.innerHTML = stickerLibrary.length
        ? stickerLibrary
            .map(function (s) {
              return (
                '<div class="wa-sticker-row"><img src="' +
                escHtml(fileUrl(s.filePath)) +
                '"><div class="wa-sticker-meta"><strong>' +
                escHtml(s.name || s.id) +
                '</strong><small>' +
                escHtml(s.filePath || "") +
                "</small></div><button class=\"btn btn2 wa-send-sticker\" data-id=\"" +
                escHtml(s.id) +
                '">Enviar</button></div>'
              );
            })
            .join("")
        : '<p class="wa-settings-empty">Nenhuma figurinha salva.</p>';
      lib.querySelectorAll(".wa-send-sticker").forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (!activeChat) return;
          window.chatAPI.sendSavedSticker(activeChat, this.dataset.id).then(function () {
            if (activeChat) selectChat(activeChat, true);
          });
        });
      });
    });
  }
  var muteActive = document.getElementById("waMuteActive");
  if (muteActive) {
    muteActive.addEventListener("click", function () {
      var muted = toggleMutedChat(activeChat);
      toast(muted ? "Conversa silenciada" : "Conversa com som ativo", "s");
      renderWaSettings();
    });
  }
  var archiveActive = document.getElementById("waArchiveActive");
  if (archiveActive) {
    archiveActive.addEventListener("click", function () {
      performChatAction(activeChat, "archive");
    });
  }
  panel.querySelectorAll(".wa-unmute-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      toggleMutedChat(this.dataset.jid);
      renderWaSettings();
    });
  });
}

async function selectChat(jid, silent) {
  if (editingFunnel) return;
  activeChat = jid;
  showingProfile = false;
  renderWaSettings();
  // Close profile panel when switching chats
  var profilePanel = document.getElementById("chatProfileSidebar");
  if (profilePanel) profilePanel.style.display = "none";
  rerenderChatSidebar();
  // Progressive: show header + loading immediately
  renderChatMainShell(jid);
  // Load messages async
  if (!silent) window.chatAPI.markRead(jid);
  var loaded = await window.chatAPI.loadMessages(jid, 50);
  chatMessages[jid] = loaded.messages || [];
  // Only update messages area (not full re-render)
  var c = document.getElementById("chatMessagesContainer");
  if (c && activeChat === jid) {
    c.className = "chat-messages";
    renderMessageBubbles(c, chatMessages[jid]);
    setTimeout(function () {
      c.scrollTop = c.scrollHeight;
    }, 50);
  }
}

async function startNewConversation() {
  var raw = prompt("Digite número ou JID da conversa:");
  if (!raw) return;
  var name = prompt("Nome opcional para salvar localmente:", "");
  try {
    var res = await window.chatAPI.startChat(raw.trim(), name || "");
    if (!res || !res.success) {
      toast((res && res.error) || "Número inválido", "e");
      return;
    }
    activeChat = res.jid;
    await selectChat(res.jid, true);
    rerenderChatSidebar();
  } catch (e) {
    toast(e.message || "Erro ao abrir conversa", "e");
  }
}

function renderLinkPreviewSnippet(text, jid, mid) {
  var url = extractFirstUrl(text);
  if (!url || !waSettings.previews || waSettings.previews.links === false) return "";
  var key = "link:" + jid + ":" + mid;
  var cached = mediaCache[key];
  if (!cached) {
    mediaCache[key] = { state: "loading", url: url };
    window.chatAPI.getLinkPreview(url).then(function (r) {
      mediaCache[key] = r && r.success ? r : { success: false, url: url, error: (r && r.error) || "preview" };
      refreshLinkPreviewCard(key);
    });
  }
  cached = mediaCache[key];
  if (!cached || cached.state === "loading") {
    return '<div class="link-preview" data-link-key="' + escHtml(key) + '"><span>Carregando prévia...</span></div>';
  }
  if (cached.success === false) return "";
  return (
    '<div class="link-preview" data-link-key="' +
    escHtml(key) +
    '"><div class="lp-domain">' +
    escHtml(cached.siteName || cached.host || "") +
    '</div><div class="lp-title">' +
    escHtml(cached.title || cached.url) +
    '</div><div class="lp-desc">' +
    escHtml(cached.description || "") +
    "</div></div>"
  );
}

function refreshLinkPreviewCard(key) {
  var el = document.querySelector('[data-link-key="' + key.replace(/"/g, '\\"') + '"]');
  if (!el) return;
  var cached = mediaCache[key];
  if (!cached || cached.state === "loading") {
    el.innerHTML = "<span>Carregando prévia...</span>";
    return;
  }
  if (cached.success === false) {
    el.remove();
    return;
  }
  el.innerHTML =
    '<div class="lp-domain">' +
    escHtml(cached.siteName || cached.host || "") +
    '</div><div class="lp-title">' +
    escHtml(cached.title || cached.url) +
    '</div><div class="lp-desc">' +
    escHtml(cached.description || "") +
    "</div>";
}

function loadDocumentPreview(docEl) {
  if (!docEl || docEl.dataset.previewing) return;
  docEl.dataset.previewing = "1";
  var status = docEl.querySelector(".doc-inline-status");
  if (status) status.textContent = "Carregando preview...";
  var cacheKey = docEl.dataset.jid + ":" + docEl.dataset.mid;
  function setPreview(src) {
    var old = docEl.querySelector(".doc-inline-preview");
    if (old) old.remove();
    var frame = document.createElement("iframe");
    frame.className = "doc-inline-preview";
    frame.src = src;
    docEl.appendChild(frame);
    if (status) status.textContent = "Clique para abrir em tela cheia";
  }
  if (mediaCache[cacheKey]) {
    setPreview(mediaCache[cacheKey]);
    return;
  }
  window.chatAPI.downloadMedia(docEl.dataset.jid, docEl.dataset.mid).then(function (r) {
    if (r && r.success) {
      var src = r.filePath ? fileUrl(r.filePath) : "data:" + r.mimetype + ";base64," + r.data;
      mediaCache[cacheKey] = src;
      setPreview(src);
    } else if (status) {
      status.textContent = "Preview indisponível";
    }
  });
}

function openDocumentModal(jid, mid, fileName, mime) {
  var modal = document.createElement("div");
  modal.className = "fullscreen-image-modal document-modal";
  modal.innerHTML =
    '<button class="fs-close">✕</button><div class="media-modal-loading">Carregando documento...</div><div class="doc-modal-shell"><iframe style="display:none;"></iframe><div class="doc-modal-actions"><span class="doc-meta">' +
    escHtml(fileName || "Documento") +
    " · " +
    escHtml(mime || "") +
    '</span></div></div>';
  document.body.appendChild(modal);
  modal.querySelector(".fs-close").addEventListener("click", function () {
    modal.remove();
  });
  modal.addEventListener("click", function (e) {
    if (e.target === modal) modal.remove();
  });
  var cacheKey = jid + ":" + mid;
  function setDoc(src) {
    var frame = modal.querySelector("iframe");
    var loading = modal.querySelector(".media-modal-loading");
    if (loading) loading.remove();
    frame.style.display = "block";
    frame.src = src;
  }
  if (mediaCache[cacheKey]) {
    setDoc(mediaCache[cacheKey]);
    return;
  }
  window.chatAPI.downloadMedia(jid, mid).then(function (r) {
    if (r && r.success) {
      var src = r.filePath ? fileUrl(r.filePath) : "data:" + r.mimetype + ";base64," + r.data;
      mediaCache[cacheKey] = src;
      setDoc(src);
    } else {
      var loading = modal.querySelector(".media-modal-loading");
      if (loading) loading.textContent = "Não foi possível carregar o documento";
    }
  });
}

function renderChatMainShell(jid) {
  var m = document.getElementById("chatMainInner");
  if (!m) return;
  var chat =
    chats.find(function (c) {
      return c.jid === jid;
    }) ||
    archivedChats.find(function (c) {
      return c.jid === jid;
    });
  var isGroup = jid.endsWith("@g.us");
  var phoneFormatted = chat ? getChatPhone(chat) : formatPhoneDisplay(jid);
  var name = chat ? getChatName(chat) : phoneFormatted || jid.split("@")[0];
  var phone = isGroup ? "Grupo" : phoneFormatted;
  if (chat && chat.profilePic && !profilePicCache[jid]) profilePicCache[jid] = chat.profilePic;
  var cachedPic = profilePicCache[jid];
  var avatarHtml = cachedPic
    ? '<img src="' + cachedPic + '">'
    : isGroup
      ? "👥"
      : (name || "?").charAt(0).toUpperCase();
  var fb = FUNNEL_TEMPLATES.map(function (f, i) {
    return (
      '<button class="funnel-shortcut" data-idx="' +
      i +
      '">⚡ ' +
      escHtml(f.name) +
      "</button>"
    );
  }).join("");

  m.innerHTML =
    '<div class="chat-header" id="chatHeaderClick">' +
    '<div class="chat-header-avatar">' +
    avatarHtml +
    "</div>" +
    '<div class="chat-header-info"><div class="chat-header-name">' +
    escHtml(name) +
    '</div><div class="chat-header-phone">' +
    phone +
    "</div></div></div>" +
    '<div class="chat-messages-loading" id="chatMessagesContainer"><div class="sp"></div><span>Carregando mensagens...</span></div>' +
    '<div id="replyPreviewContainer" style="display:none;background:#202c33;padding:10px 16px;border-left:4px solid #00a884;position:relative;flex-shrink:0;"><div style="color:#00a884;font-size:13px;font-weight:600;margin-bottom:4px;" id="replyPreviewName">Nome</div><div style="color:#8696a0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" id="replyPreviewText">Texto</div><button id="btnCloseReply" style="position:absolute;right:16px;top:16px;background:none;border:none;color:#8696a0;cursor:pointer;font-size:16px;">✕</button></div>' +
    (fb
      ? '<div id="funnelShortcuts" style="display:flex;gap:4px;padding:4px 12px;overflow-x:auto;border-top:1px solid var(--border);background:var(--surface);flex-shrink:0;">' +
        fb +
        '<button class="funnel-shortcut" id="btnManageFunnels" style="background:var(--surface2);">⚙️</button></div>'
      : "") +
    '<div class="chat-input-bar" id="chatInputBar"><button class="btn-attach" id="btnAttach">📎</button><button class="btn-attach" id="btnEmoji">☺</button><button class="btn-attach" id="btnSticker">▣</button><textarea id="chatInput" rows="1" placeholder="' +
    t("wa_type_msg") +
    '"></textarea><button class="btn-record idle" id="btnRecord">🎤</button><button class="btn-send" id="btnSend">▶</button></div>';

  // Bind header click for profile
  document
    .getElementById("chatHeaderClick")
    .addEventListener("click", function () {
      showProfilePanel(jid);
    });
  // Bind input
  var inp = document.getElementById("chatInput");
  var btnCloseReply = document.getElementById("btnCloseReply");
  if (btnCloseReply)
    btnCloseReply.addEventListener("click", function () {
      replyingToMsg = null;
      document.getElementById("replyPreviewContainer").style.display = "none";
    });

  document.getElementById("btnSend").addEventListener("click", function () {
    sendTextMessage(jid, inp);
  });
  inp.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage(jid, inp);
    }
  });
  document.getElementById("btnAttach").addEventListener("click", function () {
    attachFile(jid);
  });
  document.getElementById("btnEmoji").addEventListener("click", function () {
    openEmojiPicker(inp);
  });
  document.getElementById("btnSticker").addEventListener("click", function () {
    showStickerTray(jid, this);
  });
  var rb = document.getElementById("btnRecord");
  rb.addEventListener("mousedown", function () {
    startRecording(rb);
  });
  rb.addEventListener("mouseup", function () {
    stopRecording(jid, rb);
  });
  rb.addEventListener("mouseleave", function () {
    if (isRecording) stopRecording(jid, rb);
  });
  var fs = document.getElementById("funnelShortcuts");
  if (fs) {
    fs.querySelectorAll(".funnel-shortcut[data-idx]").forEach(function (b) {
      b.addEventListener("click", function () {
        fireFunnel(jid, parseInt(this.dataset.idx));
      });
    });
    document
      .getElementById("btnManageFunnels")
      .addEventListener("click", function () {
        showFunnelManager(jid);
      });
  }
  // Load profile pic for header
  if (!cachedPic && profilePicCache[jid] === undefined) {
    window.chatAPI.getProfilePic(jid).then(function (r) {
      if (r && r.url) {
        profilePicCache[jid] = r.url;
        var av = document.querySelector(".chat-header-avatar");
        if (av) av.innerHTML = '<img src="' + r.url + '">';
      }
    });
  }
}

function renderChatMain(jid) {
  renderChatMainShell(jid);
  var msgs = chatMessages[jid] || [];
  var c = document.getElementById("chatMessagesContainer");
  if (c) {
    c.className = "chat-messages";
    renderMessageBubbles(c, msgs);
    setTimeout(function () {
      c.scrollTop = c.scrollHeight;
    }, 50);
  }
}

function showProfilePanel(jid) {
  var panel = document.getElementById("chatProfileSidebar");
  if (!panel) return;
  if (
    showingProfile &&
    panel.dataset.jid === jid &&
    panel.style.display !== "none"
  ) {
    panel.style.display = "none";
    showingProfile = false;
    return;
  }
  showingProfile = true;
  panel.dataset.jid = jid;
  panel.style.display = "flex";

  var chat =
    chats.find(function (c) {
      return c.jid === jid;
    }) ||
    archivedChats.find(function (c) {
      return c.jid === jid;
    });
  var isGroup = chat && chat.isGroup;
  var phoneFormatted = (chat && chat.phone) || formatPhoneDisplay(jid);
  var name = chat ? chat.name : phoneFormatted;
  // If name is just the raw JID digits, use the formatted phone instead
  if (
    !isGroup &&
    name &&
    (name === jid.split("@")[0] ||
      /^\+?\d+$/.test(name.replace(/[\s\-()]/g, "")))
  ) {
    name = phoneFormatted;
  }
  var memberCount =
    chat && chat.participants ? chat.participants.length : "Vários";
  var phone = isGroup ? "Grupo · " + memberCount + " membros" : phoneFormatted;
  var cachedPic = profilePicCache[jid];
  var picHtml = cachedPic
    ? '<img src="' +
      cachedPic +
      '" style="width:200px;height:200px;border-radius:50%;object-fit:cover;margin:28px auto 20px;box-shadow:0 2px 4px rgba(0,0,0,0.2);">'
    : '<div style="width:200px;height:200px;border-radius:50%;background:' +
      (isGroup ? "#2a3942" : "#00a884") +
      ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:72px;margin:28px auto 20px;box-shadow:0 2px 4px rgba(0,0,0,0.2);">' +
      (isGroup ? "👥" : (name || "?").charAt(0).toUpperCase()) +
      "</div>";

  var actionBtns = isGroup
    ? '<div style="display:flex;gap:12px;width:100%;padding:0 24px 20px;"><button style="flex:1;background:transparent;border:1px solid #2a3942;border-radius:12px;padding:12px;color:#00a884;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;font-size:13px;transition:0.2s;"><span style="font-size:20px;">👤+</span>Adicionar</button><button style="flex:1;background:transparent;border:1px solid #2a3942;border-radius:12px;padding:12px;color:#00a884;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;font-size:13px;transition:0.2s;"><span style="font-size:20px;">🔍</span>Pesquisar</button></div>'
    : '<div style="display:flex;gap:12px;width:100%;padding:0 24px 20px;"><button style="flex:1;background:transparent;border:1px solid #2a3942;border-radius:12px;padding:12px;color:#00a884;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;font-size:13px;transition:0.2s;"><span style="font-size:20px;">📞</span>Ligar</button><button style="flex:1;background:transparent;border:1px solid #2a3942;border-radius:12px;padding:12px;color:#00a884;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;font-size:13px;transition:0.2s;"><span style="font-size:20px;">🔍</span>Pesquisar</button></div>';

  var infoSection = isGroup
    ? '<div style="padding:20px 24px;border-bottom:1px solid #202c33;"><div style="color:#00a884;font-size:14px;cursor:pointer;">Adicionar descrição ao grupo</div><div style="color:#8696a0;font-size:13px;margin-top:16px;">Grupo criado em ' +
      new Date().toLocaleDateString("pt-BR") +
      "</div></div>"
    : '<div id="contactInfoSection" style="padding:20px 24px;border-bottom:1px solid #202c33;"><div style="color:#e9edef;font-size:15px;margin-bottom:4px;">Disponível</div><div style="color:#8696a0;font-size:13px;">' +
      new Date().toLocaleDateString("pt-BR") +
      "</div></div>";

  panel.innerHTML =
    '<div style="background:#202c33;padding:16px 24px;display:flex;align-items:center;gap:24px;border-bottom:1px solid #2a3942;height:60px;box-sizing:border-box;"><button id="btnCloseProfile" style="background:transparent;border:none;color:#8696a0;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">✕</button><h2 style="margin:0;font-size:16px;font-weight:400;color:#e9edef;">Dados do ' +
    (isGroup ? "grupo" : "contato") +
    "</h2></div>" +
    '<div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;background:#111b21;">' +
    '<div style="background:#111b21;display:flex;flex-direction:column;align-items:center;border-bottom:10px solid #0b141a;">' +
    '<div class="profile-pic-large" style="width:100%;text-align:center;">' +
    picHtml +
    "</div>" +
    '<h2 id="profileContactName" style="margin:0 0 6px 0;font-size:24px;font-weight:400;color:#e9edef;text-align:center;padding:0 24px;">' +
    escHtml(name) +
    "</h2>" +
    '<div id="profileContactPhone" style="color:#8696a0;font-size:14px;margin-bottom:4px;">' +
    phone +
    "</div>" +
    '<div id="profileContactJid" style="color:#8696a0;font-size:12px;margin-bottom:24px;user-select:all;cursor:pointer;" title="Clique para copiar">' +
    (isGroup ? jid : phoneFormatted) +
    "</div>" +
    actionBtns +
    "</div>" +
    '<div style="background:#111b21;border-bottom:10px solid #0b141a;">' +
    infoSection +
    "</div>" +
    '<div id="profileBusinessSection" style="display:none;background:#111b21;border-bottom:10px solid #0b141a;"></div>' +
    (isGroup
      ? '<div id="groupParticipants" style="background:#111b21;border-bottom:10px solid #0b141a;"><div style="padding:16px 24px;color:#e9edef;font-size:15px;border-bottom:1px solid #202c33;">' +
        memberCount +
        ' membros</div><div id="groupParticipantsList" style="padding:0 8px;"></div></div>'
      : "") +
    '<div style="background:#111b21;padding:20px 24px;border-bottom:10px solid #0b141a;cursor:pointer;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><div style="color:#8696a0;font-size:13px;">Mídia, links e docs</div><div style="color:#8696a0;font-size:13px;">></div></div><div style="display:flex;gap:8px;overflow-x:hidden;"><div style="width:72px;height:72px;background:#202c33;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#8696a0;font-size:24px;">📷</div><div style="width:72px;height:72px;background:#202c33;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#8696a0;font-size:24px;">📷</div><div style="width:72px;height:72px;background:#202c33;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#8696a0;font-size:24px;">📷</div></div></div>' +
    '<div style="background:#111b21;border-bottom:10px solid #0b141a;"><div style="padding:16px 24px;display:flex;align-items:center;gap:16px;cursor:pointer;"><span style="font-size:20px;color:#8696a0;width:24px;text-align:center;">⭐</span><span style="color:#e9edef;font-size:15px;">Mensagens favoritas</span></div><div style="padding:16px 24px;display:flex;align-items:center;gap:16px;cursor:pointer;"><span style="font-size:20px;color:#8696a0;width:24px;text-align:center;">🔔</span><span style="color:#e9edef;font-size:15px;flex:1;">Silenciar notificações</span><div style="width:34px;height:14px;background:#2a3942;border-radius:7px;position:relative;"><div style="width:20px;height:20px;background:#8696a0;border-radius:50%;position:absolute;top:-3px;left:0;"></div></div></div><div style="padding:16px 24px;display:flex;align-items:center;gap:16px;cursor:pointer;"><span style="font-size:20px;color:#8696a0;width:24px;text-align:center;">🔒</span><div style="flex:1;"><div style="color:#e9edef;font-size:15px;margin-bottom:4px;">Criptografia</div><div style="color:#8696a0;font-size:13px;line-height:1.4;">As mensagens são protegidas com criptografia de ponta a ponta.</div></div></div></div>' +
    "</div>";

  document
    .getElementById("btnCloseProfile")
    .addEventListener("click", function () {
      panel.style.display = "none";
      showingProfile = false;
    });

  // Copy phone/JID on click
  var jidEl = document.getElementById("profileContactJid");
  if (jidEl) {
    jidEl.addEventListener("click", function () {
      var copyText = isGroup ? jid : phoneFormatted;
      try {
        navigator.clipboard.writeText(copyText);
        toast("Número copiado!", "s");
      } catch (e) {}
    });
  }

  // Fetch full contact info (name, phone, business profile)
  if (!isGroup && window.chatAPI.getContactInfo) {
    window.chatAPI.getContactInfo(jid).then(function (info) {
      if (!info) return;
      // Update name if we got a better one
      if (info.name) {
        var nameEl = document.getElementById("profileContactName");
        if (nameEl) nameEl.textContent = info.name;
      }
      // Update phone display
      if (info.phone) {
        var phoneEl = document.getElementById("profileContactPhone");
        if (phoneEl) phoneEl.textContent = info.phone;
      }
      // Update info section with contact details
      var infoEl = document.getElementById("contactInfoSection");
      if (infoEl) {
        var infoHtml = "";
        if (info.name)
          infoHtml +=
            '<div style="display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid #202c33;"><span style="font-size:20px;color:#8696a0;width:24px;text-align:center;">👤</span><div style="flex:1;"><div style="color:#8696a0;font-size:13px;">Nome</div><div style="color:#e9edef;font-size:15px;">' +
            escHtml(info.name) +
            "</div></div></div>";
        infoHtml +=
          '<div style="display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid #202c33;"><span style="font-size:20px;color:#8696a0;width:24px;text-align:center;">📱</span><div style="flex:1;"><div style="color:#8696a0;font-size:13px;">Telefone</div><div style="color:#e9edef;font-size:15px;">' +
          escHtml(info.phone || phoneFormatted) +
          "</div></div></div>";
        if (info.verifiedName)
          infoHtml +=
            '<div style="display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid #202c33;"><span style="font-size:20px;color:#8696a0;width:24px;text-align:center;">✅</span><div style="flex:1;"><div style="color:#8696a0;font-size:13px;">Nome verificado</div><div style="color:#e9edef;font-size:15px;">' +
            escHtml(info.verifiedName) +
            "</div></div></div>";
        infoEl.innerHTML = infoHtml;
      }
      // Business profile section
      if (info.business) {
        var bEl = document.getElementById("profileBusinessSection");
        if (bEl) {
          var bHtml =
            '<div style="padding:16px 24px;color:#e9edef;font-size:15px;border-bottom:1px solid #202c33;display:flex;align-items:center;gap:8px;"><span style="font-size:18px;">🏢</span> Perfil comercial</div>';
          if (info.business.description)
            bHtml +=
              '<div style="padding:12px 24px;border-bottom:1px solid #202c33;"><div style="color:#8696a0;font-size:13px;margin-bottom:4px;">Descrição</div><div style="color:#e9edef;font-size:14px;line-height:1.4;">' +
              escHtml(info.business.description) +
              "</div></div>";
          if (info.business.email)
            bHtml +=
              '<div style="padding:12px 24px;border-bottom:1px solid #202c33;display:flex;align-items:center;gap:16px;"><span style="font-size:18px;color:#8696a0;">✉️</span><div><div style="color:#8696a0;font-size:13px;">Email</div><div style="color:#00a884;font-size:14px;">' +
              escHtml(info.business.email) +
              "</div></div></div>";
          if (info.business.website && info.business.website.length)
            bHtml +=
              '<div style="padding:12px 24px;border-bottom:1px solid #202c33;display:flex;align-items:center;gap:16px;"><span style="font-size:18px;color:#8696a0;">🌐</span><div><div style="color:#8696a0;font-size:13px;">Website</div><div style="color:#00a884;font-size:14px;">' +
              escHtml(info.business.website.join(", ")) +
              "</div></div></div>";
          if (info.business.address)
            bHtml +=
              '<div style="padding:12px 24px;border-bottom:1px solid #202c33;display:flex;align-items:center;gap:16px;"><span style="font-size:18px;color:#8696a0;">📍</span><div><div style="color:#8696a0;font-size:13px;">Endereço</div><div style="color:#e9edef;font-size:14px;">' +
              escHtml(info.business.address) +
              "</div></div></div>";
          if (info.business.category)
            bHtml +=
              '<div style="padding:12px 24px;border-bottom:1px solid #202c33;display:flex;align-items:center;gap:16px;"><span style="font-size:18px;color:#8696a0;">🏷️</span><div><div style="color:#8696a0;font-size:13px;">Categoria</div><div style="color:#e9edef;font-size:14px;">' +
              escHtml(info.business.category) +
              "</div></div></div>";
          bEl.innerHTML = bHtml;
          bEl.style.display = "";
        }
      }
    });
  }

  if (isGroup && window.chatAPI.getGroupMetadata) {
    window.chatAPI.getGroupMetadata(jid).then(function (meta) {
      if (meta && meta.participants) {
        var plist = document.getElementById("groupParticipantsList");
        if (plist) {
          plist.innerHTML = meta.participants
            .map(function (p) {
              var pname = p.name || formatPhoneDisplay(p.id);
              var isAdmin = p.admin
                ? '<span style="font-size:10px;color:#00a884;border:1px solid #00a884;border-radius:4px;padding:2px 4px;margin-left:8px;">Admin</span>'
                : "";
              return (
                '<div style="display:flex;align-items:center;padding:12px 16px;cursor:pointer;transition:background 0.2s;" onmouseover="this.style.background=\'#202c33\'" onmouseout="this.style.background=\'transparent\'">' +
                '<div style="width:40px;height:40px;border-radius:50%;background:#2a3942;color:#8696a0;display:flex;align-items:center;justify-content:center;margin-right:12px;overflow:hidden;">👤</div>' +
                '<div style="flex:1;"><div style="color:#e9edef;font-size:15px;display:flex;align-items:center;">' +
                escHtml(pname) +
                isAdmin +
                "</div>" +
                (p.name && p.name !== formatPhoneDisplay(p.id)
                  ? '<div style="color:#8696a0;font-size:13px;">' +
                    formatPhoneDisplay(p.id) +
                    "</div>"
                  : "") +
                "</div>" +
                "</div>"
              );
            })
            .join("");
        }
      }
    });
  }

  if (!cachedPic) {
    window.chatAPI.getProfilePic(jid).then(function (r) {
      if (r && r.url) {
        profilePicCache[jid] = r.url;
        var pic = panel.querySelector(".profile-pic-large");
        if (pic)
          pic.innerHTML =
            '<img src="' +
            r.url +
            '" style="width:200px;height:200px;border-radius:50%;object-fit:cover;margin:24px auto;">';
      }
    });
  }
}

function formatMessageText(text, msg) {
  var t = escHtml(text);
  var urlRegex = /(https?:\/\/[^\s]+)/g;
  t = t.replace(
    urlRegex,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#53bdeb;text-decoration:underline;">$1</a>',
  );
  var mentions =
    (msg.message &&
      msg.message.extendedTextMessage &&
      msg.message.extendedTextMessage.contextInfo &&
      msg.message.extendedTextMessage.contextInfo.mentionedJid) ||
    [];
  if (mentions.length > 0) {
    mentions.forEach(function (jid) {
      var phone = jid.split("@")[0];
      var rx = new RegExp("@" + phone, "g");
      var displayPhone = formatPhoneDisplay(jid);
      t = t.replace(
        rx,
        '<span style="color:#53bdeb;">@' + displayPhone + "</span>",
      );
    });
  }
  return t;
}

function renderMessageBubbles(c, msgs) {
  c.innerHTML = "";
  var isGroup = activeChat && activeChat.endsWith("@g.us");
  for (var i = 0; i < msgs.length; i++) {
    var msg = msgs[i];
    if (!msg.message) continue;
    var fromMe = msg.key && msg.key.fromMe;
    var time = msg.messageTimestamp ? formatTime(msg.messageTimestamp) : "";
    var d = document.createElement("div");
    d.className = "msg " + (fromMe ? "sent" : "received");
    // Group sender name for received messages
    var senderHtml = "";
    if (isGroup && !fromMe && msg.key && msg.key.participant) {
      var senderJid = msg.key.participant;
      var senderName = msg.pushName || formatPhoneDisplay(senderJid);
      senderHtml =
        '<div class="msg-sender" style="font-size:11px;font-weight:600;color:#00a884;margin-bottom:2px;">' +
        escHtml(senderName) +
        "</div>";
    }
    var mc = msg.message;

    // Quoted message handling
    var contextInfo =
      (mc.extendedTextMessage && mc.extendedTextMessage.contextInfo) ||
      (mc.imageMessage && mc.imageMessage.contextInfo) ||
      (mc.videoMessage && mc.videoMessage.contextInfo);
    var quotedHtml = "";
    if (contextInfo && contextInfo.quotedMessage) {
      var qm = contextInfo.quotedMessage;
      var qtext =
        qm.conversation ||
        (qm.extendedTextMessage && qm.extendedTextMessage.text) ||
        (qm.imageMessage && "📷 Foto") ||
        (qm.videoMessage && "🎬 Vídeo") ||
        (qm.documentMessage && "📄 Documento") ||
        (qm.stickerMessage && "🌟 Figurinha") ||
        "Mensagem";
      var qname = contextInfo.participant
        ? formatPhoneDisplay(contextInfo.participant)
        : "";
      quotedHtml =
        '<div style="background:rgba(0,0,0,0.15);border-left:4px solid ' +
        (fromMe ? "#005c4b" : "#53bdeb") +
        ';padding:6px 8px;margin-bottom:6px;border-radius:4px;cursor:pointer;">' +
        '<div style="color:' +
        (fromMe ? "#00a884" : "#53bdeb") +
        ';font-size:12px;font-weight:600;margin-bottom:2px;">' +
        escHtml(qname) +
        "</div>" +
        '<div style="color:rgba(255,255,255,0.8);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
        escHtml(qtext) +
        "</div></div>";
    }

    var replyBtn =
      '<button class="msg-reply-btn" style="position:absolute;right:0;top:0;background:linear-gradient(90deg, transparent, ' +
      (fromMe ? "#005c4b" : "#202c33") +
      ' 40%);border:none;border-radius:0 8px 0 8px;width:40px;height:28px;color:#8696a0;cursor:pointer;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;z-index:2;opacity:0;transition:opacity 0.2s;font-size:18px;line-height:1;">⏷</button>';

    if (mc.audioMessage) {
      d.innerHTML =
        replyBtn +
        senderHtml +
        quotedHtml +
        '<div class="msg-audio-player"><button class="audio-play-btn" data-jid="' +
        (activeChat || "") +
        '" data-mid="' +
        (msg.key ? msg.key.id : "") +
        '">▶</button><div class="audio-wave"><div class="audio-wave-fill"></div></div><span class="audio-dur">' +
        formatAudioDur(mc.audioMessage.seconds) +
        '</span><audio preload="none"></audio></div><div class="msg-time">' +
        time +
        "</div>";
      c.appendChild(d);
      bindAudioPlayer(d, activeChat, msg.key ? msg.key.id : "");
    } else if (mc.imageMessage) {
      var thumb = mc.imageMessage.jpegThumbnail;
      var thumbSrc = thumb
        ? "data:image/jpeg;base64," +
          (typeof thumb === "string" ? thumb : arrayToBase64(thumb))
        : "";
      var caption = mc.imageMessage.caption || "";
      d.innerHTML =
        replyBtn +
        senderHtml +
        quotedHtml +
        '<div class="msg-image-wrap" data-jid="' +
        (activeChat || "") +
        '" data-mid="' +
        (msg.key ? msg.key.id : "") +
        '">' +
        (thumbSrc
          ? '<img src="' + thumbSrc + '">'
          : '<div class="img-loading">📷</div>') +
        (caption
          ? '<div class="img-caption">' + escHtml(caption) + "</div>"
          : "") +
        '</div><div class="msg-time">' +
        time +
        "</div>";
      c.appendChild(d);
      d.querySelector(".msg-image-wrap").addEventListener("click", function () {
        openFullImage(
          this.dataset.jid,
          this.dataset.mid,
          this.querySelector("img"),
        );
      });
    } else if (mc.videoMessage) {
      var vThumb = mc.videoMessage.jpegThumbnail;
      var vSrc = vThumb
        ? "data:image/jpeg;base64," +
          (typeof vThumb === "string" ? vThumb : arrayToBase64(vThumb))
        : "";
      var vCaption = mc.videoMessage.caption || "";
      d.innerHTML =
        replyBtn +
        senderHtml +
        quotedHtml +
        '<div class="msg-video-wrap" data-jid="' +
        (activeChat || "") +
        '" data-mid="' +
        (msg.key ? msg.key.id : "") +
        '">' +
        (vSrc
          ? '<img src="' + vSrc + '">'
          : '<div class="media-skeleton">🎬</div>') +
        '<div class="video-play-overlay">▶</div>' +
        '<div class="video-duration">' +
        formatAudioDur(mc.videoMessage.seconds) +
        "</div>" +
        (vCaption
          ? '<div class="img-caption">' + escHtml(vCaption) + "</div>"
          : "") +
        '</div><div class="msg-time">' +
        time +
        "</div>";
      c.appendChild(d);
      d.querySelector(".msg-video-wrap").addEventListener("click", function () {
        openVideoModal(
          this.dataset.jid,
          this.dataset.mid,
          this.querySelector("img"),
        );
      });
    } else if (mc.stickerMessage) {
      var sThumb =
        mc.stickerMessage.jpegThumbnail || mc.stickerMessage.pngThumbnail;
      var sSrc = sThumb
        ? "data:image/webp;base64," +
          (typeof sThumb === "string" ? sThumb : arrayToBase64(sThumb))
        : "";
      d.innerHTML =
        replyBtn +
        senderHtml +
        quotedHtml +
        '<div class="msg-sticker-wrap" data-jid="' +
        (activeChat || "") +
        '" data-mid="' +
        (msg.key ? msg.key.id : "") +
        '">' +
        (sSrc
          ? '<img src="' +
            sSrc +
            '" style="max-width:180px;max-height:180px;border-radius:8px;background:transparent;">'
          : '<div style="font-size:48px;">🌟</div>') +
        '</div><div class="msg-time">' +
        time +
        "</div>";
      d.style.background = "transparent";
      d.style.boxShadow = "none";
      c.appendChild(d);
      // Try loading full sticker
      if (true) {
        (function (el, j, m) {
          var cacheKey = j + ":" + m;
          if (mediaCache[cacheKey]) {
            var cachedImg = el.querySelector("img") || el.querySelector("div");
            if (cachedImg) {
              var readyImg = document.createElement("img");
              readyImg.src = mediaCache[cacheKey];
              readyImg.className = "sticker-img";
              readyImg.style.cssText = "max-width:220px;max-height:220px;border-radius:8px;";
              cachedImg.replaceWith(readyImg);
            }
            return;
          }
          window.chatAPI.downloadMedia(j, m).then(function (r) {
            if (r.success) {
              var img = el.querySelector("img") || el.querySelector("div");
              if (img) {
                var newImg = document.createElement("img");
                newImg.src = r.filePath ? fileUrl(r.filePath) : "data:" + r.mimetype + ";base64," + r.data;
                mediaCache[cacheKey] = newImg.src;
                newImg.className = "sticker-img";
                newImg.style.cssText =
                  "max-width:220px;max-height:220px;border-radius:8px;";
                img.replaceWith(newImg);
              }
              if (
                waSettings.media &&
                waSettings.media.autoDownloadStickers &&
                msg.key &&
                !msg.key.fromMe &&
                window.chatAPI.saveSticker
              ) {
                window.chatAPI.saveSticker(j, m, getChatDisplayName(j)).catch(function () {});
              }
            }
          });
        })(d, activeChat, msg.key ? msg.key.id : "");
      }
    } else if (mc.documentMessage) {
      var fileName = mc.documentMessage.fileName || "Documento";
      var mime = mc.documentMessage.mimetype || "";
      var pages = mc.documentMessage.pageCount
        ? mc.documentMessage.pageCount + " pág."
        : "";
      d.innerHTML =
        replyBtn +
        senderHtml +
        quotedHtml +
        '<div class="msg-doc-wrap" data-jid="' +
        (activeChat || "") +
        '" data-mid="' +
        (msg.key ? msg.key.id : "") +
        '" data-name="' +
        escHtml(fileName) +
        '" data-mime="' +
        escHtml(mime) +
        '">' +
        '<div class="doc-icon">' +
        (mime.indexOf("pdf") !== -1 ? "PDF" : "DOC") +
        "</div>" +
        '<div class="doc-meta"><div class="doc-name">' +
        escHtml(fileName) +
        '</div><div class="doc-sub">' +
        escHtml([pages, mime].filter(Boolean).join(" · ")) +
        '</div><div class="doc-inline-status">Clique para abrir</div></div>' +
        '</div><div class="msg-time">' +
        time +
        "</div>";
      c.appendChild(d);
      var docWrap = d.querySelector(".msg-doc-wrap");
      docWrap.addEventListener("click", function () {
        openDocumentModal(this.dataset.jid, this.dataset.mid, this.dataset.name, this.dataset.mime);
      });
      if (mime.indexOf("pdf") !== -1 && waSettings.previews && waSettings.previews.pdf) {
        loadDocumentPreview(docWrap);
      }
    } else {
      var text =
        mc.conversation ||
        (mc.extendedTextMessage && mc.extendedTextMessage.text) ||
        (mc.videoMessage && "🎬 Vídeo") ||
        (mc.documentMessage &&
          "📄 " + (mc.documentMessage.fileName || "Documento")) ||
        (mc.contactMessage && "👤 Contato") ||
        (mc.buttonsResponseMessage && "📋 Resposta");
      if (!text) continue;
      d.innerHTML =
        replyBtn +
        senderHtml +
        quotedHtml +
        formatMessageText(text, msg) +
        renderLinkPreviewSnippet(text, activeChat, msg.key ? msg.key.id : "") +
        '<div class="msg-time">' +
        time +
        "</div>";
      c.appendChild(d);
    }

    // Bind context menu
    var rbtn = d.querySelector(".msg-reply-btn");
    if (rbtn) {
      d.addEventListener("mouseenter", function () {
        this.querySelector(".msg-reply-btn").style.opacity = "1";
      });
      d.addEventListener("mouseleave", function () {
        this.querySelector(".msg-reply-btn").style.opacity = "0";
      });
      (function (m, rb, mEl) {
        rb.addEventListener("click", function (e) {
          showMessageContextMenu(e, m, mEl);
        });
      })(msg, rbtn, d);
    }
  }
}

var activeMsgContextMenu = null;
function showMessageContextMenu(e, msg, mEl) {
  e.stopPropagation();
  if (activeMsgContextMenu) activeMsgContextMenu.remove();

  var menu = document.createElement("div");
  menu.className = "msg-context-menu";
  menu.style.cssText = "position:fixed;z-index:1000;";

  var rect = e.target.getBoundingClientRect();
  menu.style.top = rect.bottom + 4 + "px";
  var left = rect.left - 130;
  if (left < 0) left = rect.left;
  menu.style.left = left + "px";

  var replyBtn = document.createElement("div");
  replyBtn.innerHTML = "↩️ <span>Responder</span>";
  replyBtn.className = "context-menu-item";
  replyBtn.style.cssText = "";
  replyBtn.onmouseover = function () {
    this.style.background = "#182229";
  };
  replyBtn.onmouseout = function () {
    this.style.background = "transparent";
  };
  replyBtn.onclick = function () {
    menu.remove();
    activeMsgContextMenu = null;
    replyingToMsg = msg;
    var t =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      (msg.message?.imageMessage && "📷 Foto") ||
      (msg.message?.videoMessage && "🎬 Vídeo") ||
      (msg.message?.documentMessage && "📄 Documento") ||
      (msg.message?.stickerMessage && "🌟 Figurinha") ||
      "Mensagem";
    var n =
      msg.pushName ||
      formatPhoneDisplay(msg.key?.participant || msg.key?.remoteJid || "");
    var prev = document.getElementById("replyPreviewContainer");
    if (prev) {
      prev.style.display = "block";
      document.getElementById("replyPreviewName").textContent = n;
      document.getElementById("replyPreviewText").textContent = t;
      document.getElementById("chatInput").focus();
    }
  };

  var deleteBtn = document.createElement("div");
  deleteBtn.innerHTML = "🗑️ <span>Apagar</span>";
  deleteBtn.className = "context-menu-item";
  deleteBtn.style.cssText = "";
  deleteBtn.onmouseover = function () {
    this.style.background = "#182229";
  };
  deleteBtn.onmouseout = function () {
    this.style.background = "transparent";
  };
  deleteBtn.onclick = async function () {
    menu.remove();
    activeMsgContextMenu = null;
    if (confirm("Apagar esta mensagem?")) {
      var r = await window.chatAPI.deleteMessage(activeChat, msg.key);
      if (r && r.success) {
        mEl.remove();
      } else {
        toast("Erro ao apagar: " + (r?.error || ""), "e");
      }
    }
  };

  var reactBtn = document.createElement("div");
  reactBtn.innerHTML = "☺ <span>Reagir</span>";
  reactBtn.className = "context-menu-item";
  reactBtn.onclick = async function () {
    var emoji = prompt("Emoji da reação:", "👍");
    menu.remove();
    activeMsgContextMenu = null;
    if (emoji === null) return;
    var r = await window.chatAPI.reactMessage(activeChat, msg.key, emoji);
    toast(r && r.success ? "Reação enviada" : (r && r.error) || "Erro ao reagir", r && r.success ? "s" : "e");
  };

  var forwardBtn = document.createElement("div");
  forwardBtn.innerHTML = "➤ <span>Encaminhar</span>";
  forwardBtn.className = "context-menu-item";
  forwardBtn.onclick = async function () {
    var target = prompt("Telefone ou JID de destino:");
    menu.remove();
    activeMsgContextMenu = null;
    if (!target) return;
    var clean = target.indexOf("@") >= 0 ? target.trim() : target.replace(/\D/g, "");
    var r = await window.chatAPI.forwardMessage(activeChat, msg.key && msg.key.id, clean);
    toast(r && r.success ? "Mensagem encaminhada" : (r && r.error) || "Erro ao encaminhar", r && r.success ? "s" : "e");
  };

  var stickerBtn = null;
  if (msg.message && msg.message.stickerMessage) {
    stickerBtn = document.createElement("div");
    stickerBtn.innerHTML = "🌟 <span>Salvar figurinha</span>";
    stickerBtn.className = "context-menu-item";
    stickerBtn.onclick = function () {
      menu.remove();
      activeMsgContextMenu = null;
      if (!activeChat) return;
      window.chatAPI.saveSticker(activeChat, msg.key && msg.key.id, getChatDisplayName(activeChat)).then(function (r) {
        if (r && r.success) {
          toast("Figurinha salva", "s");
          renderWaSettings();
        } else {
          toast((r && r.error) || "Erro ao salvar figurinha", "e");
        }
      });
    };
  }

  var funnelBtn = document.createElement("div");
  funnelBtn.innerHTML = "⚡ <span>Salvar no funil</span>";
  funnelBtn.className = "context-menu-item";
  funnelBtn.onclick = function () {
    menu.remove();
    activeMsgContextMenu = null;
    saveMessageAsFunnel(msg);
  };

  menu.appendChild(replyBtn);
  menu.appendChild(reactBtn);
  menu.appendChild(forwardBtn);
  if (stickerBtn) menu.appendChild(stickerBtn);
  menu.appendChild(funnelBtn);
  menu.appendChild(deleteBtn);
  document.body.appendChild(menu);
  activeMsgContextMenu = menu;

  setTimeout(function () {
    document.addEventListener("click", function closeMenu(ev) {
      if (menu && !menu.contains(ev.target)) {
        menu.remove();
        activeMsgContextMenu = null;
        document.removeEventListener("click", closeMenu);
      }
    });
  }, 10);
}

function formatAudioDur(sec) {
  if (!sec) return "0:00";
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function arrayToBase64(arr) {
  if (typeof arr === "string") return arr;
  if (arr && arr.type === "Buffer" && arr.data) arr = arr.data;
  if (!arr || !arr.length) return "";
  var bin = "";
  for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function bindAudioPlayer(el, jid, mid) {
  var btn = el.querySelector(".audio-play-btn");
  var audio = el.querySelector("audio");
  var wave = el.querySelector(".audio-wave-fill");
  var loaded = false;
  btn.addEventListener("click", async function () {
    if (!loaded) {
      btn.textContent = "⏳";
      try {
        var cacheKey = jid + ":" + mid;
        var dataUrl = mediaCache[cacheKey];
        if (!dataUrl) {
          var r = await window.chatAPI.downloadMedia(jid, mid);
          if (r.success) {
            dataUrl = r.filePath ? fileUrl(r.filePath) : "data:" + r.mimetype + ";base64," + r.data;
            mediaCache[cacheKey] = dataUrl;
          } else {
            btn.textContent = "▶";
            toast("Erro ao carregar áudio", "e");
            return;
          }
        }
        audio.src = dataUrl;
        loaded = true;
      } catch (e) {
        btn.textContent = "▶";
        return;
      }
    }
    if (audio.paused) {
      audio.play();
      btn.textContent = "⏸";
    } else {
      audio.pause();
      btn.textContent = "▶";
    }
  });
  audio.addEventListener("timeupdate", function () {
    if (audio.duration)
      wave.style.width = (audio.currentTime / audio.duration) * 100 + "%";
  });
  audio.addEventListener("ended", function () {
    btn.textContent = "▶";
    wave.style.width = "0%";
  });
}

function openFullImage(jid, mid, thumbImg) {
  var modal = document.createElement("div");
  modal.className = "fullscreen-image-modal";
  var imgSrc = thumbImg ? thumbImg.src : "";
  modal.innerHTML =
    '<button class="fs-close">✕</button><div class="media-modal-loading">Carregando mídia...</div><img style="' +
    (imgSrc ? "" : "display:none;") +
    '" src="' +
    imgSrc +
    '">';
  document.body.appendChild(modal);
  modal.querySelector(".fs-close").addEventListener("click", function () {
    modal.remove();
  });
  modal.addEventListener("click", function (e) {
    if (e.target === modal) modal.remove();
  });
  // Load full res
  var cacheKey = jid + ":" + mid;
  if (mediaCache[cacheKey]) {
    modal.querySelector("img").src = mediaCache[cacheKey];
  } else {
    window.chatAPI.downloadMedia(jid, mid).then(function (r) {
      if (r.success) {
        var url = r.filePath ? fileUrl(r.filePath) : "data:" + r.mimetype + ";base64," + r.data;
        mediaCache[cacheKey] = url;
        var img = modal.querySelector("img");
        var loading = modal.querySelector(".media-modal-loading");
        img.src = url;
        img.style.display = "block";
        if (loading) loading.remove();
      }
    });
  }
}

function openVideoModal(jid, mid, thumbImg) {
  var modal = document.createElement("div");
  modal.className = "fullscreen-image-modal video-modal";
  var thumb = thumbImg ? thumbImg.src : "";
  modal.innerHTML =
    '<button class="fs-close">✕</button><div class="media-modal-loading">Carregando vídeo...</div>' +
    (thumb ? '<img class="video-thumb-bg" src="' + thumb + '">' : "") +
    '<video controls autoplay style="display:none;"></video>';
  document.body.appendChild(modal);
  modal.querySelector(".fs-close").addEventListener("click", function () {
    modal.remove();
  });
  modal.addEventListener("click", function (e) {
    if (e.target === modal) modal.remove();
  });
  var cacheKey = jid + ":" + mid;
  function setVideo(url) {
    var video = modal.querySelector("video");
    var loading = modal.querySelector(".media-modal-loading");
    var bg = modal.querySelector(".video-thumb-bg");
    if (loading) loading.remove();
    if (bg) bg.remove();
    video.src = url;
    video.style.display = "block";
    video.play().catch(function () {});
  }
  if (mediaCache[cacheKey]) {
    setVideo(mediaCache[cacheKey]);
  } else {
    window.chatAPI.downloadMedia(jid, mid).then(function (r) {
      if (r.success) {
        var url = r.filePath ? fileUrl(r.filePath) : "data:" + r.mimetype + ";base64," + r.data;
        mediaCache[cacheKey] = url;
        setVideo(url);
      } else {
        var loading = modal.querySelector(".media-modal-loading");
        if (loading) loading.textContent = "Não foi possível carregar o vídeo";
      }
    });
  }
}

async function fireFunnel(jid, idx) {
  var t = FUNNEL_TEMPLATES[idx];
  if (!t) return;
  var chat = chats.find(function (c) {
    return c.jid === jid;
  });
  var company = chat ? chat.name : "nossa empresa";
  var header = (t.header || "").replace(/\{empresa\}/g, company);
  if (t.audio || t.audioPath) {
    await window.chatAPI.chatAction(jid, "recording");
    await waitMs((Number(t.audioDelaySec) || 0) * 1000);
    var audioRes = t.audioPath
      ? await window.chatAPI.sendMedia(jid, t.audioPath, "")
      : await window.chatAPI.sendAudio(jid, t.audio, t.audioMime || "audio/webm");
    if (!audioRes || !audioRes.success) {
      await window.chatAPI.chatAction(jid, "paused");
      toast((audioRes && audioRes.error) || "Erro ao enviar áudio do funil", "e");
      return;
    }
  }
  if (header || t.footer) {
    await window.chatAPI.chatAction(jid, "typing");
    await waitMs((Number(t.textDelaySec) || 0) * 1000);
    var text = [header, (t.footer || "").replace(/\{empresa\}/g, company)]
      .filter(Boolean)
      .join("\n");
    var textRes = await window.chatAPI.sendMessage(jid, { text: text });
    if (!textRes || !textRes.success) {
      await window.chatAPI.chatAction(jid, "paused");
      toast((textRes && textRes.error) || "Erro ao enviar mensagem do funil", "e");
      return;
    }
  }
  await window.chatAPI.chatAction(jid, "paused");
  await selectChat(jid, true);
  scrollToBottom();
  toast("Funil enviado!", "s");
}

function waitMs(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, Math.max(0, ms || 0));
  });
}

// ─── FUNNEL MANAGER ────────────────────────
function getFunnelHost(containerId) {
  if (containerId) return document.getElementById(containerId);
  return document.getElementById("chatMainInner");
}

function showFunnelManager(jid, containerId) {
  editingFunnel = true;
  var m = getFunnelHost(containerId);
  if (!m) return;
  var list = FUNNEL_TEMPLATES.map(function (f, i) {
    return (
      '<div class="funnel-card"><div class="funnel-card-head"><span>⚡ ' +
      escHtml(f.name) +
      '</span><div><button class="fe-btn" data-idx="' +
      i +
      '">✏️</button><button class="fd-btn" data-idx="' +
      i +
      '">✕</button></div></div><p>' +
      escHtml(f.header || "") +
      "</p><small>" +
      (f.audio || f.audioPath ? "🎵 Áudio · " : "") +
      "Digitando: " +
      (f.textDelaySec || 0) +
      "s · Gravando: " +
      (f.audioDelaySec || 0) +
      "s</small></div>"
    );
  }).join("");
  m.innerHTML =
    '<div class="funnel-manager"><div class="funnel-top"><div><h3>Funis</h3><span>Configure respostas rápidas com texto, áudio e simulação de presença.</span></div><button id="btnAddFunnel" class="btn btn1">➕ Novo funil</button></div><div class="funnel-grid">' +
    (list ||
      '<div class="wa-settings-empty">Nenhum funil criado.</div>') +
    "</div>" +
    (containerId
      ? ""
      : '<button id="btnBack" class="btn btn2 funnel-back">← Voltar ao chat</button>') +
    "</div>";
  var back = document.getElementById("btnBack");
  if (back)
    back.addEventListener("click", function () {
      editingFunnel = false;
      if (activeChat) renderChatMain(activeChat);
      else showEmptyChat();
    });
  document
    .getElementById("btnAddFunnel")
    .addEventListener("click", function () {
      showFunnelEditor(-1, jid, containerId);
    });
  m.querySelectorAll(".fe-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      showFunnelEditor(parseInt(this.dataset.idx), jid, containerId);
    });
  });
  m.querySelectorAll(".fd-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      if (confirm("Apagar?")) {
        FUNNEL_TEMPLATES.splice(parseInt(this.dataset.idx), 1);
        saveFunnels();
        showFunnelManager(jid, containerId);
      }
    });
  });
}

function showFunnelEditor(idx, jid, containerId) {
  editingFunnel = true;
  var m = getFunnelHost(containerId);
  if (!m) return;
  var f =
    idx >= 0
      ? FUNNEL_TEMPLATES[idx]
      : {
          name: "",
          header: "",
          footer: "",
        };
  var funnelAudio = f.audio || null;
  var funnelAudioPath = f.audioPath || "";
  var funnelAudioMime = f.audioMime || "audio/webm";
  var funnelAudioName = f.audioName || "";
  var funnelAudioUrl = null;

  m.innerHTML =
    '<div class="funnel-editor"><div class="funnel-top"><div><h3>' +
    (idx >= 0 ? "Editar funil" : "Novo funil") +
    '</h3><span>Defina o conteúdo e o tempo de digitação/gravação antes do envio.</span></div></div>' +
    '<div class="funnel-editor-grid"><section><label>Nome</label><input id="fn" value="' +
    escHtml(f.name) +
    '"><label>Mensagem</label><textarea id="fh" rows="5">' +
    escHtml(f.header || "") +
    '</textarea><label>Tempo digitando antes do texto (segundos)</label><input id="ftd" type="number" min="0" max="120" value="' +
    (f.textDelaySec || 0) +
    '"><label>Rodapé</label><input id="ff" value="' +
    escHtml(f.footer || "") +
    '"></section><section><label>Áudio</label><div class="funnel-audio-row"><button id="frb" class="btn-record idle">🎤</button><button id="fFile" class="btn btn2">📎 Arquivo</button><span id="fas">' +
    (funnelAudioPath ? escHtml(f.audioName || "Arquivo selecionado") : funnelAudio ? "🎵 Gravado" : "Nenhum áudio") +
    "</span>" +
    '<button id="fra" class="funnel-remove-audio" style="' +
    (funnelAudio || funnelAudioPath ? "" : "display:none;") +
    '">✕</button>' +
    '</div><label>Tempo gravando antes do áudio (segundos)</label><input id="fad" type="number" min="0" max="120" value="' +
    (f.audioDelaySec || 0) +
    '"><div id="funnelAudioPreview" class="funnel-audio-preview"></div></section></div>' +
    '<div class="funnel-editor-actions"><button id="bsf" class="btn btn1">💾 Salvar</button><button id="bcf" class="btn btn2">Cancelar</button></div></div>';

  function fileUrl(path) {
    return "file:///" + String(path || "").replace(/\\/g, "/").replace(/#/g, "%23").replace(/\?/g, "%3F");
  }
  function updateFunnelAudioPreview() {
    var preview = document.getElementById("funnelAudioPreview");
    var status = document.getElementById("fas");
    if (!preview || !status) return;
    var remove = document.getElementById("fra");
    if (funnelAudioUrl) URL.revokeObjectURL(funnelAudioUrl);
    funnelAudioUrl = null;
    var src = "";
    if (funnelAudio && funnelAudio.length) {
      var blob = new Blob([new Uint8Array(funnelAudio)], { type: funnelAudioMime || "audio/webm" });
      funnelAudioUrl = URL.createObjectURL(blob);
      src = funnelAudioUrl;
      status.textContent = "Gravado";
    } else if (funnelAudioPath) {
      src = fileUrl(funnelAudioPath);
      status.textContent = (funnelAudioName || funnelAudioPath.split(/[\\/]/).pop() || "Arquivo selecionado");
    }
    preview.innerHTML = src
      ? '<audio controls preload="metadata" src="' + escHtml(src) + '"></audio>'
      : '<span>Nenhum áudio para ouvir.</span>';
    if (remove) remove.style.display = src ? "" : "none";
  }
  updateFunnelAudioPreview();

  document.getElementById("fFile").addEventListener("click", async function () {
    var res = await window.chatAPI.openFile([
      { name: "Áudios", extensions: ["mp3", "wav", "ogg", "opus", "webm"] },
    ]);
    if (res.canceled || !res.filePath) return;
    funnelAudio = null;
    funnelAudioPath = res.filePath;
    funnelAudioMime = "";
    funnelAudioName = res.filePath.split(/[\\/]/).pop();
    document.getElementById("fas").textContent = funnelAudioName;
    updateFunnelAudioPreview();
  });

  // Audio recording
  var isFR = false,
    fMR = null,
    fAC = [];
  var rb = document.getElementById("frb");
  rb.addEventListener("mousedown", async function () {
    try {
      var st = await navigator.mediaDevices.getUserMedia({ audio: true });
      funnelAudioMime = pickAudioMimeType();
      fMR = new MediaRecorder(st, { mimeType: funnelAudioMime });
      fAC = [];
      fMR.ondataavailable = function (e) {
        fAC.push(e.data);
      };
      fMR.start();
      isFR = true;
      rb.classList.remove("idle");
      rb.classList.add("recording");
      document.getElementById("fas").textContent = "Gravando...";
    } catch (e) {}
  });
  rb.addEventListener("mouseup", function () {
    if (!isFR || !fMR) return;
    fMR.onstop = async function () {
      if (!fAC.length) return;
      var blob = new Blob(fAC, { type: funnelAudioMime || "audio/webm" });
      var buf = await blob.arrayBuffer();
      funnelAudio = Array.from(new Uint8Array(buf));
      funnelAudioPath = "";
      funnelAudioName = "";
      funnelAudioMime = blob.type || "audio/webm";
      updateFunnelAudioPreview();
    };
    fMR.stop();
    fMR.stream.getTracks().forEach(function (t) {
      t.stop();
    });
    isFR = false;
    rb.classList.remove("recording");
    rb.classList.add("idle");
  });
  var ra = document.getElementById("fra");
  if (ra)
    ra.addEventListener("click", function () {
      funnelAudio = null;
      funnelAudioPath = "";
      funnelAudioName = "";
      document.getElementById("fas").textContent = "Nenhum";
      updateFunnelAudioPreview();
    });

  document.getElementById("bcf").addEventListener("click", function () {
    showFunnelManager(jid, containerId);
  });
  document.getElementById("bsf").addEventListener("click", function () {
    var name = document.getElementById("fn").value.trim();
    if (!name) {
      toast("Nome obrigatório", "e");
      return;
    }
    var fun = {
      name: name,
      header: document.getElementById("fh").value.trim(),
      footer: document.getElementById("ff").value.trim(),
      textDelaySec: Number(document.getElementById("ftd").value) || 0,
      audioDelaySec: Number(document.getElementById("fad").value) || 0,
    };
    if (funnelAudio) {
      fun.audio = funnelAudio;
      fun.audioMime = funnelAudioMime || "audio/webm";
    }
    if (funnelAudioPath) {
      fun.audioPath = funnelAudioPath;
      fun.audioName = funnelAudioName || funnelAudioPath.split(/[\\/]/).pop();
    }
    if (idx >= 0) FUNNEL_TEMPLATES[idx] = fun;
    else FUNNEL_TEMPLATES.push(fun);
    saveFunnels();
    toast("Salvo!", "s");
    showFunnelManager(jid, containerId);
  });
}

function addFunnelBtnRow(container, text, id) {
  var d = document.createElement("div");
  d.style.cssText = "display:flex;gap:4px;margin-bottom:4px;";
  d.innerHTML =
    '<input value="' +
    escHtml(text) +
    '" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:4px;font-size:11px;outline:none;"><input value="' +
    escHtml(id) +
    '" style="width:100px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px;border-radius:4px;font-size:11px;outline:none;"><button style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:14px;">✕</button>';
  container.appendChild(d);
  d.querySelector("button").addEventListener("click", function () {
    d.remove();
  });
}

function saveMessageAsFunnel(msg) {
  var text = messageToFunnelText(msg);
  if (!text) {
    toast("Só mensagens com texto podem virar funil rápido por enquanto", "e");
    return;
  }
  var suggested = text.replace(/\s+/g, " ").trim().slice(0, 28) || "Mensagem salva";
  var name = prompt("Nome do funil:", suggested);
  if (!name) return;
  FUNNEL_TEMPLATES.push({
    name: name.trim(),
    header: text.trim(),
    footer: "",
    textDelaySec: 0,
    audioDelaySec: 0,
  });
  saveFunnels();
  toast("Mensagem salva no funil", "s");
  if (activeChat) renderChatMain(activeChat);
}

// ─── MESSAGING ─────────────────────────────
async function sendTextMessage(jid, input) {
  var text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";

  var content = { text: text };
  if (replyingToMsg) {
    content.quoted = replyingToMsg;
    replyingToMsg = null;
    var c = document.getElementById("replyPreviewContainer");
    if (c) c.style.display = "none";
  }

  var res = await window.chatAPI.sendMessage(jid, content);
  if (res.success) {
    await selectChat(jid, true);
    scrollToBottom();
  } else {
    toast(res.error || "Erro", "e");
  }
}

async function attachFile(jid) {
  var res = await window.chatAPI.openFile([
    {
      name: "Files",
      extensions: [
        "jpg",
        "jpeg",
        "png",
        "gif",
        "webp",
        "pdf",
        "doc",
        "docx",
        "mp4",
      ],
    },
  ]);
  if (res.canceled || !res.filePath) return;
  var caption = prompt("Legenda:");
  var r = await window.chatAPI.sendMedia(jid, res.filePath, caption || "");
  if (r.success) {
    await selectChat(jid, true);
    scrollToBottom();
  } else toast(r.error || "Erro", "e");
}

async function attachSticker(jid) {
  var res = await window.chatAPI.openFile([
    { name: "Figurinhas WebP", extensions: ["webp"] },
  ]);
  if (res.canceled || !res.filePath) return;
  var r = await window.chatAPI.sendSticker(jid, res.filePath);
  if (r.success) {
    await selectChat(jid, true);
    scrollToBottom();
  } else toast(r.error || "Erro ao enviar figurinha", "e");
}

async function showStickerTray(jid, anchor) {
  if (activeStickerTray) {
    activeStickerTray.remove();
    activeStickerTray = null;
  }
  var tray = document.createElement("div");
  tray.className = "sticker-tray";
  tray.innerHTML =
    '<div class="sticker-tray-head"><strong>Figurinhas</strong><button class="sticker-file-btn">Arquivo</button></div><div class="sticker-tray-grid"><span class="wa-settings-empty">Carregando...</span></div>';
  document.body.appendChild(tray);
  activeStickerTray = tray;
  var rect = anchor ? anchor.getBoundingClientRect() : { left: 12, top: window.innerHeight - 80 };
  tray.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 320)) + "px";
  tray.style.top = Math.max(70, rect.top - 300) + "px";
  tray.querySelector(".sticker-file-btn").addEventListener("click", function () {
    tray.remove();
    activeStickerTray = null;
    attachSticker(jid);
  });
  try {
    var r = await window.chatAPI.listStickers();
    stickerLibrary = (r && r.stickers) || [];
  } catch (e) {
    stickerLibrary = [];
  }
  var grid = tray.querySelector(".sticker-tray-grid");
  if (!stickerLibrary.length) {
    grid.innerHTML =
      '<div class="sticker-empty"><span>Nenhuma figurinha salva.</span><button class="sticker-file-btn-inline">Escolher WebP</button></div>';
    grid.querySelector(".sticker-file-btn-inline").addEventListener("click", function () {
      tray.remove();
      activeStickerTray = null;
      attachSticker(jid);
    });
  } else {
    grid.innerHTML = stickerLibrary
      .map(function (s) {
        return (
          '<button class="sticker-pick" title="' +
          escHtml(s.name || s.id) +
          '" data-id="' +
          escHtml(s.id) +
          '"><img src="' +
          escHtml(fileUrl(s.filePath)) +
          '"></button>'
        );
      })
      .join("");
    grid.querySelectorAll(".sticker-pick").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = this.dataset.id;
        tray.remove();
        activeStickerTray = null;
        window.chatAPI.sendSavedSticker(jid, id).then(function (res) {
          if (res && res.success) selectChat(jid, true);
          else toast((res && res.error) || "Erro ao enviar figurinha", "e");
        });
      });
    });
  }
  setTimeout(function () {
    document.addEventListener("click", function closeTray(ev) {
      if (tray && !tray.contains(ev.target) && ev.target !== anchor) {
        tray.remove();
        activeStickerTray = null;
        document.removeEventListener("click", closeTray);
      }
    });
  }, 20);
}

function openEmojiPicker(input) {
  var old = document.getElementById("emojiPicker");
  if (old) {
    old.remove();
    return;
  }
  var emojis = ["😀", "😂", "😍", "👍", "🔥", "🙏", "👏", "✅", "🎯", "🚀", "❤️", "😮"];
  var picker = document.createElement("div");
  picker.id = "emojiPicker";
  picker.className = "emoji-picker";
  picker.innerHTML = emojis
    .map(function (e) {
      return '<button type="button">' + e + "</button>";
    })
    .join("");
  document.body.appendChild(picker);
  var bar = document.getElementById("chatInputBar");
  var rect = bar.getBoundingClientRect();
  picker.style.left = rect.left + 46 + "px";
  picker.style.bottom = window.innerHeight - rect.top + 6 + "px";
  picker.querySelectorAll("button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var start = input.selectionStart || input.value.length;
      var end = input.selectionEnd || start;
      input.value = input.value.slice(0, start) + btn.textContent + input.value.slice(end);
      input.focus();
      var pos = start + btn.textContent.length;
      input.setSelectionRange(pos, pos);
      picker.remove();
    });
  });
  setTimeout(function () {
    document.addEventListener("click", function closeEmoji(e) {
      if (!picker.contains(e.target) && e.target.id !== "btnEmoji") {
        picker.remove();
        document.removeEventListener("click", closeEmoji);
      }
    });
  }, 10);
}

async function startRecording(btn) {
  try {
    var st = await navigator.mediaDevices.getUserMedia({ audio: true });
    var mime = pickAudioMimeType();
    mediaRecorder = new MediaRecorder(st, { mimeType: mime });
    mediaRecorder.audioMime = mime;
    audioChunks = [];
    mediaRecorder.ondataavailable = function (e) {
      audioChunks.push(e.data);
    };
    mediaRecorder.start();
    isRecording = true;
    btn.classList.remove("idle");
    btn.classList.add("recording");
  } catch (e) {
    toast("Sem microfone", "e");
  }
}

async function stopRecording(jid, btn) {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.onstop = async function () {
    if (!audioChunks.length) return;
    var mime = mediaRecorder.audioMime || "audio/webm";
    var blob = new Blob(audioChunks, { type: mime });
    var buf = await blob.arrayBuffer();
    var r = await window.chatAPI.sendAudio(
      jid,
      Array.from(new Uint8Array(buf)),
      mime,
    );
    if (r.success) {
      await selectChat(jid, true);
      scrollToBottom();
    } else toast(r.error || "Erro", "e");
  };
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(function (t) {
    t.stop();
  });
  isRecording = false;
  btn.classList.remove("recording");
  btn.classList.add("idle");
}

function scrollToBottom() {
  var c = document.getElementById("chatMessagesContainer");
  if (c) c.scrollTop = 999999;
}

function formatTime(ts) {
  if (!ts || ts === 0 || isNaN(ts)) return "";
  var d = new Date(
    (typeof ts === "object" && ts.low !== undefined ? ts.low : ts) * 1000,
  );
  if (isNaN(d.getTime())) return "";
  var now = new Date(),
    h = d.getHours().toString().padStart(2, "0"),
    m = d.getMinutes().toString().padStart(2, "0");
  return d.toDateString() === now.toDateString()
    ? h + ":" + m
    : d.getDate().toString().padStart(2, "0") +
        "/" +
        (d.getMonth() + 1).toString().padStart(2, "0");
}
function escHtml(s) {
  var d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}
