window.activeWaCampaignId = null;

function formatCampaignDuration(ms) {
  if (!ms) return "-";
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function campaignProgressPct(campaign) {
  return campaign.stats.total > 0
    ? Math.round(((campaign.stats.sent || 0) / campaign.stats.total) * 100)
    : 0;
}

function campaignStatusMeta(status) {
  return (
    {
      ready: ["Pronta", "Aguardando início", "idle"],
      scheduled: ["Agendada", "Vai iniciar automaticamente", "scheduled"],
      running: ["Enviando", "Disparo em andamento", "running"],
      paused: ["Pausada", "Envio interrompido", "paused"],
      completed: ["Concluída", "Todos os leads foram processados", "done"],
      cancelled: ["Cancelada", "Campanha interrompida", "cancelled"],
    }[status] || ["Desconhecida", status, "idle"]
  );
}

function renderWaMonitor(campaignId) {
  const panel = document.getElementById("waMonitorPanel");
  panel.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text2);">${t("wa_loading")}</div>`;

  window.campaignAPI.get(campaignId).then(({ campaign }) => {
    if (!campaign) {
      panel.innerHTML = `<div class="empty"><p>${t("wa_campaign_not_found")}</p></div>`;
      return;
    }
    window.activeWaCampaignId = campaign.id;
    buildMonitorUI(panel, campaign);
  });
}

function buildMonitorUI(panel, campaign) {
  const progress = campaignProgressPct(campaign);
  const [statusLabel, statusHint, statusClass] = campaignStatusMeta(campaign.status);
  const startsAt = campaign.schedule?.startAt
    ? new Date(campaign.schedule.startAt).toLocaleString()
    : null;
  const nextLead = campaign.leads.find((l) => l.status === "pending");
  const stats = campaign.stats || {};

  panel.innerHTML = `
    <div class="campaign-monitor-hero ${statusClass}">
      <div>
        <div class="campaign-status-pill">${statusLabel}</div>
        <h3>${escCampaign(campaign.name)}</h3>
        <p>${startsAt && campaign.status === "scheduled" ? `Inicia em ${escCampaign(startsAt)}` : statusHint} &bull; Conexão: <strong>${escCampaign(campaign.connectionId || "Sessão principal")}</strong></p>
      </div>
      <div class="campaign-monitor-actions">
        ${campaign.status === "ready" ? `<button class="btn btn1" id="waMonStart">Iniciar</button>` : ""}
        ${campaign.status === "scheduled" ? `<button class="btn btn1" id="waMonStartNow">Iniciar agora</button>` : ""}
        ${campaign.status === "running" || campaign.status === "scheduled" ? `<button class="btn btn2" id="waMonPause">${t("wa_pause")}</button>` : ""}
        ${campaign.status === "paused" ? `<button class="btn btn1" id="waMonResume">${t("wa_resume")}</button>` : ""}
        ${(stats.failed || 0) > 0 ? `<button class="btn btn2" id="waMonRetryFailed" title="Reenvia leads que falharam">↻ Reenviar ${stats.failed} falha(s)</button>` : ""}
        ${["running", "paused", "scheduled"].includes(campaign.status) ? `<button class="btn btn3" id="waMonCancel">${t("wa_cancel")}</button>` : ""}
        ${!["running", "paused", "scheduled"].includes(campaign.status) ? `<button class="btn btn3" id="waMonDelete">${t("wa_delete")}</button>` : ""}
      </div>
    </div>

    <div class="campaign-monitor-grid">
      <section class="campaign-monitor-panel wide">
        <div class="campaign-progress-head">
          <span>${progress}% concluído</span>
          <small>${stats.sent || 0}/${stats.total || 0} processados</small>
        </div>
        <div class="campaign-progress-large"><i style="width:${progress}%"></i></div>
        <div class="campaign-next-step">
          <strong>${nextLead ? `Próximo: ${escCampaign(nextLead.name || nextLead.phone)}` : "Fila finalizada"}</strong>
          <span>${nextLead ? escCampaign(nextLead.phone || "") : "Nenhum lead pendente"}</span>
        </div>
      </section>

      <section class="campaign-monitor-panel">
        <b>${stats.total || 0}</b><span>Total</span>
      </section>
      <section class="campaign-monitor-panel">
        <b>${stats.sent || 0}</b><span>Enviadas</span>
      </section>
      <section class="campaign-monitor-panel">
        <b>${stats.delivered || 0}</b><span>Entregues</span>
      </section>
      <section class="campaign-monitor-panel">
        <b>${stats.read || 0}</b><span>Lidas</span>
      </section>
      <section class="campaign-monitor-panel">
        <b>${stats.replied || 0}</b><span>Respondidas</span>
      </section>
      <section class="campaign-monitor-panel">
        <b>${formatCampaignDuration(stats.avgResponseTimeMs)}</b><span>Tempo médio resposta</span>
      </section>
      <section class="campaign-monitor-panel">
        <b>${stats.pending || 0}</b><span>Pendentes</span>
      </section>
      <section class="campaign-monitor-panel">
        <b>${stats.failed || 0}</b><span>Falhas</span>
      </section>
    </div>

    <div class="campaign-monitor-panel lead-table-panel">
      <div class="campaign-table-head">
        <h4>${t("wa_lead_list")}</h4>
        <div><button class="btn btn2" id="waMonExportCsv">CSV</button><button class="btn btn2" id="waMonExportJson">JSON</button></div>
      </div>
      <div style="overflow-x:auto;">
        <table class="wa-lead-table">
          <thead><tr><th>#</th><th>${t("col_name")}</th><th>${t("col_phone")}</th><th>${t("col_cat")}</th><th>Status</th><th>Resposta</th><th>${t("wa_error_col")}</th></tr></thead>
          <tbody>
            ${campaign.leads
              .map((l, i) => {
                const stCls = `st-${l.status}`;
                const stText = {
                  pending: "Pendente",
                  sent: "Enviada",
                  delivered: "Entregue",
                  read: "Lida",
                  replied: "Respondida",
                  failed: "Falhou",
                }[l.status] || l.status;
                return `<tr>
                  <td>${i + 1}</td>
                  <td>${escCampaign(l.name)}</td>
                  <td>${escCampaign(l.phone)}</td>
                  <td>${escCampaign(l.category || "-")}</td>
                  <td class="${stCls}">${stText}</td>
                  <td>${l.repliedAt ? formatCampaignDuration(l.responseTimeMs) : "-"}</td>
                  <td style="font-size:10px;color:var(--text2);max-width:220px;overflow:hidden;text-overflow:ellipsis;">${escCampaign(l.errorMessage || "")}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("waMonStart")?.addEventListener("click", async () => {
    const res = await window.campaignAPI.start(campaign.id);
    toast(res.success ? "Campanha iniciada" : res.error || "Erro ao iniciar", res.success ? "s" : "e");
    renderWaMonitor(campaign.id);
  });

  document.getElementById("waMonStartNow")?.addEventListener("click", async () => {
    await window.campaignAPI.update(campaign.id, { schedule: { ...campaign.schedule, startAt: null } });
    const res = await window.campaignAPI.start(campaign.id);
    toast(res.success ? "Campanha iniciada" : res.error || "Erro ao iniciar", res.success ? "s" : "e");
    renderWaMonitor(campaign.id);
  });

  document.getElementById("waMonPause")?.addEventListener("click", async () => {
    await window.campaignAPI.pause(campaign.id);
    toast("Campanha pausada", "s");
    renderWaMonitor(campaign.id);
  });

  document.getElementById("waMonResume")?.addEventListener("click", async () => {
    const res = await window.campaignAPI.resume(campaign.id);
    toast(res.success ? "Campanha retomada" : res.error || "Erro ao retomar", res.success ? "s" : "e");
    renderWaMonitor(campaign.id);
  });

  document.getElementById("waMonRetryFailed")?.addEventListener("click", async () => {
    if (!confirm(`Reenviar os ${stats.failed} leads que falharam?`)) return;
    const res = await window.campaignAPI.retryFailed(campaign.id);
    if (res.success) {
      toast(`${res.count} lead(s) recolocado(s) na fila`, "s");
      renderWaMonitor(campaign.id);
    } else {
      toast(res.error || "Erro ao reenviar falhas", "e");
    }
  });

  document.getElementById("waMonCancel")?.addEventListener("click", async () => {
    if (!confirm("Cancelar esta campanha?")) return;
    await window.campaignAPI.update(campaign.id, { status: "cancelled" });
    toast("Campanha cancelada", "s");
    renderWaMonitor(campaign.id);
  });

  document.getElementById("waMonDelete")?.addEventListener("click", async () => {
    if (!confirm("Apagar esta campanha permanentemente?")) return;
    await window.campaignAPI.delete(campaign.id);
    toast("Campanha apagada", "s");
    document.getElementById("waCampaignsPanel").style.display = "";
    document.getElementById("waMonitorPanel").style.display = "none";
    renderWaCampaigns();
  });

  document.getElementById("waMonExportCsv")?.addEventListener("click", async () => {
    const res = await window.campaignAPI.export(campaign.id, "csv");
    toast(res.success ? "Exportado CSV" : res.message || "Erro", res.success ? "s" : "e");
  });

  document.getElementById("waMonExportJson")?.addEventListener("click", async () => {
    const res = await window.campaignAPI.export(campaign.id, "json");
    toast(res.success ? "Exportado JSON" : res.message || "Erro", res.success ? "s" : "e");
  });
}

window.campaignAPI.onProgress(({ campaignId, event, data }) => {
  if (["completed", "lead-sent", "metric-update", "reply-received", "scheduled", "started"].includes(event)) {
    if (window.activeWaCampaignId === campaignId) renderWaMonitor(campaignId);
    if (event === "lead-sent") log(`[WhatsApp] Lead processado: ${data?.status}${data?.error ? " - " + data.error : ""}`);
    if (event === "reply-received") log("[WhatsApp] Resposta recebida em campanha");
    if (event === "completed") log("[WhatsApp] Campanha concluída!");
  }
});

window.renderWaMonitor = renderWaMonitor;
