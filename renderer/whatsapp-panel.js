var waConnected = false;
var waProviderType = null;
var waPhoneNumber = null;
var waQrInterval = null;
var waConnections = [];
var activeWaConnectionId = null;

async function refreshWaConnections() {
  if (!window.whatsappAPI.listConnections) return;
  const res = await window.whatsappAPI.listConnections();
  waConnections = res.connections || [];
  activeWaConnectionId = res.activeConnectionId || null;
  const active = waConnections.find((c) => c.active) || waConnections[0];
  waConnected = !!(active && active.connected);
  waProviderType = active ? active.provider : waProviderType;
  waPhoneNumber = active ? active.phoneNumber : null;
}

function connectionLabel(c) {
  return c.phoneNumber || c.id.replace(/^wa_/, "WhatsApp ");
}

async function renderWaConnect() {
  await refreshWaConnections();
  const panel = document.getElementById("waConnectPanel");
  const statusCls = waConnected ? "on" : "off";
  const statusTxt = waConnected ? t("wa_connected") : t("wa_disconnected");
  const dot = waConnected ? "🟢" : "🔴";

  panel.innerHTML = `
    <div class="wa-card wa-connection-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;">
        <h4 style="margin:0;">📱 Conexões WhatsApp</h4>
        <button class="btn btn1" id="waAddConnectionBtn">➕ Nova conexão</button>
      </div>
      <div id="waConnectionList" class="wa-connection-list">
        ${
          waConnections.length
            ? waConnections
                .map(
                  (c) => `
            <button class="wa-connection-pill ${c.active ? "active" : ""}" data-id="${c.id}">
              <span>${c.connected ? "🟢" : "🔴"}</span>
              <strong>${connectionLabel(c)}</strong>
              <small>${c.provider}</small>
            </button>`,
                )
                .join("")
            : '<div class="wa-settings-empty">Nenhuma conexão ativa. Crie uma nova conexão para começar.</div>'
        }
      </div>
    </div>
    <div class="wa-card">
      <h4>🔌 ${t("wa_connection")}</h4>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <span class="wa-status ${statusCls}">${dot} ${statusTxt}</span>
        ${waPhoneNumber ? `<span style="font-size:11px;color:var(--text2);">${waPhoneNumber}</span>` : ""}
      </div>

      <label>${t("wa_provider")}</label>
      <select id="waProviderSelect" style="max-width:300px;">
        <option value="baileys" ${waProviderType === "baileys" ? "selected" : ""}>Baileys (WhatsApp Web)</option>
        <option value="meta" ${waProviderType === "meta" ? "selected" : ""}>Meta Business API</option>
      </select>

      <div id="waBaileysConfig">
        <p style="font-size:11px;color:#fdcb6e;margin-bottom:10px;">⚠ ${t("wa_baileys_warn")}</p>
        <button class="btn btn1" id="waConnectBtn">🔗 Conectar novo WhatsApp</button>
        ${waConnected ? '<button class="btn btn3" id="waDisconnectBtn">🔌 Desconectar conexão ativa</button>' : ""}
        ${waConnections.length ? '<button class="btn btn3" id="waRemoveConnBtn" style="background:var(--error);border-color:var(--error);margin-top:8px;">🗑 Remover conexão atual</button>' : ""}
        <button class="btn btn2" id="waResyncBtn" style="margin-top:8px;">🔄 ${t("wa_resync")}</button>
        <div id="waQrContainer" class="wa-qr" style="display:none;"></div>
        <div id="waStatusLog" style="margin-top:12px;padding:10px;background:var(--bg);border-radius:6px;max-height:200px;overflow-y:auto;font-family:monospace;"></div>
      </div>

      <div id="waMetaConfig" style="display:none;">
        <label>Phone Number ID</label>
        <input type="text" id="waMetaPhoneId" placeholder="123456789..." style="max-width:300px;">
        <label>Access Token</label>
        <input type="password" id="waMetaToken" placeholder="EAA..." style="max-width:450px;">
        <button class="btn btn1" id="waMetaConnectBtn">🔗 Conectar novo WhatsApp</button>
      </div>
    </div>
  `;

  document.querySelectorAll(".wa-connection-pill").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await window.whatsappAPI.switchConnection(btn.dataset.id);
      if (res.success) {
        await refreshWaConnections();
        toast("Conexão ativa alterada", "s");
        renderWaConnect();
        if (typeof refreshChats === "function") refreshChats();
      } else toast(res.error || "Erro ao trocar conexão", "e");
    });
  });

  const provSelect = document.getElementById("waProviderSelect");
  function toggleProvider() {
    const v = provSelect.value;
    document.getElementById("waBaileysConfig").style.display =
      v === "baileys" ? "" : "none";
    document.getElementById("waMetaConfig").style.display =
      v === "meta" ? "" : "none";
  }
  provSelect.addEventListener("change", toggleProvider);
  toggleProvider();

  if (waConnected && waProviderType === "baileys") {
    const qrContainer = document.getElementById("waQrContainer");
    if (qrContainer) qrContainer.style.display = "none";
  }

  const connectBtn = document.getElementById("waConnectBtn");
  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      const provider = document.getElementById("waProviderSelect").value;
      connectBtn.disabled = true;
      connectBtn.textContent = "⏳ " + t("wa_connecting");
      toast(t("wa_connecting_msg"), "s");
      try {
        const res = await window.whatsappAPI.connect(provider, {});
        if (!res.success) {
          toast(res.error || "Falha ao conectar", "e");
          connectBtn.disabled = false;
          connectBtn.textContent = "🔗 " + t("wa_connect_btn");
        } else {
          activeWaConnectionId = res.connectionId;
          waConnections = res.connections || waConnections;
          connectBtn.textContent = "🔗 " + t("wa_connect_btn");
          connectBtn.disabled = false;
        }
      } catch (e) {
        toast(e.message || "Erro de conexão", "e");
        connectBtn.disabled = false;
        connectBtn.textContent = "🔗 " + t("wa_connect_btn");
      }
    });
  }

  const metaConnectBtn = document.getElementById("waMetaConnectBtn");
  if (metaConnectBtn) {
    metaConnectBtn.addEventListener("click", async () => {
      const phoneNumberId = document
        .getElementById("waMetaPhoneId")
        .value.trim();
      const accessToken = document.getElementById("waMetaToken").value.trim();
      if (!phoneNumberId || !accessToken) {
        toast("Preencha Phone Number ID e Access Token", "e");
        return;
      }
      const res = await window.whatsappAPI.connect("meta", {
        phoneNumberId,
        accessToken,
      });
      if (!res.success) {
        toast(res.error || "Falha ao conectar", "e");
      }
    });
  }

  const disconnectBtn = document.getElementById("waDisconnectBtn");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", async () => {
      await window.whatsappAPI.disconnect();
      await refreshWaConnections();
      renderWaConnect();
    });
  }

  const removeConnBtn = document.getElementById("waRemoveConnBtn");
  if (removeConnBtn) {
    removeConnBtn.addEventListener("click", async () => {
      if (!activeWaConnectionId) return;
      if (confirm("Tem certeza que deseja remover esta conexão permanentemente? Você precisará escanear o QR Code novamente para adicioná-la no futuro.")) {
        await window.whatsappAPI.removeConnection(activeWaConnectionId);
        await refreshWaConnections();
        renderWaConnect();
        toast("Conexão removida com sucesso", "s");
      }
    });
  }

  const resyncBtn = document.getElementById("waResyncBtn");
  if (resyncBtn) {
    resyncBtn.addEventListener("click", async () => {
      if (
        confirm(
          "Deseja forçar a ressincronização? Isso limpará o cache local e desconectará o WhatsApp atual.",
        )
      ) {
        resyncBtn.disabled = true;
        resyncBtn.textContent = "⏳ ...";
        try {
          const res = await window.whatsappAPI.forceResync();
          if (res.success) {
            toast("Cache limpo. Por favor, conecte novamente.", "s");
            waConnected = false;
            waPhoneNumber = null;
            renderWaConnect();
          } else {
            toast(res.error || "Erro ao ressincronizar", "e");
            resyncBtn.disabled = false;
            resyncBtn.textContent = "🔄 " + t("wa_resync");
          }
        } catch (e) {
          toast(e.message || "Erro", "e");
          resyncBtn.disabled = false;
          resyncBtn.textContent = "🔄 " + t("wa_resync");
        }
      }
    });
  }
}

// Listen for status changes from main process
window.whatsappAPI.onStatus(async ({ status, data }) => {
  const prevConnected = waConnected;
  if (data?.connectionId) activeWaConnectionId = data.connectionId;
  // Skip expensive IPC for intermediate statuses that don't change connections
  if (status !== "qr_ready" && status !== "connecting") {
    await refreshWaConnections();
  }
  const badge = document.getElementById("waStatusBadge");
  if (badge) {
    if (status === "connected") badge.textContent = "🟢";
    else if (status === "connecting" || status === "qr_ready")
      badge.textContent = "🟡";
    else badge.textContent = "🔴";
  }

  // Append log messages to the status log in the panel
  const logEl = document.getElementById("waStatusLog");
  if (logEl) {
    const time = new Date().toLocaleTimeString();
    const msg = data?.msg || data?.error || status;
    const color =
      status === "error"
        ? "var(--red)"
        : status === "connected"
          ? "var(--green)"
          : "var(--text2)";
    logEl.innerHTML += `<div style="color:${color};font-size:11px;margin:2px 0;">[${time}] ${msg}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  if (status === "qr_ready" && data?.qrDataURL) {
    waProviderType = "baileys";
    const qrContainer = document.getElementById("waQrContainer");
    if (qrContainer) {
      qrContainer.style.display = "flex";
      qrContainer.innerHTML = `<p style="font-size:12px;color:var(--text2);margin-bottom:8px;">Escaneie o QR Code com o WhatsApp do celular</p>
        <img src="${data.qrDataURL}" alt="QR Code" style="border-radius:8px;border:4px solid #fff;width:200px;height:200px;">`;
    }
  }

  if (status === "connected") {
    waPhoneNumber = data?.phoneNumber || null;
    waProviderType = waProviderType || "baileys";
    const qrContainer = document.getElementById("waQrContainer");
    if (qrContainer) qrContainer.style.display = "none";
    toast(t("wa_connected_toast"), "s");
    renderWaConnect();
  }

  if (status === "disconnected" && prevConnected) {
    waPhoneNumber = null;
    toast(t("wa_disconnected_toast"), "e");
    renderWaConnect();
  }

  if (status === "error") {
    waPhoneNumber = null;
    if (data?.error) toast(data.error, "e");
  }
});

// Init
window.addEventListener("DOMContentLoaded", async () => {
  const st = await window.whatsappAPI.getStatus();
  waConnected = st.connected;
  waProviderType = st.provider;
  waPhoneNumber = st.phoneNumber;
  waConnections = st.connections || [];
  activeWaConnectionId = st.activeConnectionId || null;
  const badge = document.getElementById("waStatusBadge");
  if (badge) badge.textContent = st.connected ? "🟢" : "🔴";
});
