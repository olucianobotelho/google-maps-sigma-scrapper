let activeCampaignList = [];
let campaignGroupState = {};
let activeManageGroupId = null;

function campaignProgress(c) {
  return c.stats.total > 0
    ? Math.round(
        (((c.stats && c.stats.sent) || 0) / c.stats.total) * 100,
      )
    : 0;
}

function renderWaCampaigns() {
  const panel = document.getElementById("waCampaignsPanel");
  panel.innerHTML = `
    <div class="campaign-shell">
      <div class="campaign-toolbar">
        <div>
          <h3>Campanhas</h3>
          <span>Disparos organizados por lista, intervalo e modelo de mensagem.</span>
        </div>
        <button class="btn btn1" id="waNewCampaignBtn">➕ ${t("wa_new_campaign")}</button>
      </div>
      <div id="waCampaignList" class="campaign-list"></div>
    </div>
  `;

  document
    .getElementById("waNewCampaignBtn")
    .addEventListener("click", showNewCampaignForm);
  refreshCampaignList();
}

function refreshCampaignList() {
  const container = document.getElementById("waCampaignList");
  if (!container) return;

  window.campaignAPI.getAll().then(({ campaigns }) => {
    activeCampaignList = campaigns || [];
    if (!activeCampaignList.length) {
      container.innerHTML = `<div class="empty campaign-empty"><div class="ic">📋</div><p>${t("wa_no_campaigns")}</p></div>`;
      return;
    }

    container.innerHTML = activeCampaignList
      .map((c) => {
        const statusIcon =
          {
            ready: "⏸",
            scheduled: "⏱",
            running: "▶",
            paused: "⏸",
            completed: "✅",
            cancelled: "⏹",
          }[c.status] || "?";
        const progress = campaignProgress(c);
        return `
          <button class="campaign-card" data-id="${c.id}">
            <div class="campaign-card-head">
              <div>
                <strong>${escCampaign(c.name)}</strong>
                <span>${c.provider === "baileys" ? "WhatsApp Web" : "Meta API"} (${c.connectionId || "Sessão principal"}) · ${new Date(c.createdAt).toLocaleDateString()}</span>
              </div>
              <em>${statusIcon} ${c.status}</em>
            </div>
            <div class="campaign-progress"><i style="width:${progress}%"></i></div>
            <div class="campaign-metrics">
              <span><b>${c.stats.total}</b>Total</span>
              <span><b>${c.stats.sent}</b>Enviadas</span>
              <span><b>${c.stats.replied || 0}</b>Respostas</span>
              <span><b>${c.stats.pending}</b>Pendentes</span>
              <span><b>${progress}%</b>Progresso</span>
            </div>
          </button>
        `;
      })
      .join("");

    container.querySelectorAll(".campaign-card").forEach((card) => {
      card.addEventListener("click", () => selectCampaign(card.dataset.id));
    });
  });
}

function normalizeManualPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
}

function saveManualLeadGroup(name, rawPhones) {
  const phones = String(rawPhones || "")
    .split(/[\n,;]+/)
    .map(normalizeManualPhone)
    .filter(Boolean);
  const uniquePhones = [...new Set(phones)];
  if (!name || !uniquePhones.length) {
    toast("Informe um nome e pelo menos um telefone", "e");
    return false;
  }
  const searches = JSON.parse(localStorage.getItem("sigma_searches") || "[]");
  const leads = JSON.parse(localStorage.getItem("sigma_leads") || "[]");
  const searchId = `manual_${Date.now()}`;
  searches.push({
    id: searchId,
    query: name,
    label: name,
    createdAt: new Date().toISOString(),
    manual: true,
  });
  uniquePhones.forEach((phone, index) => {
    leads.push({
      id: `${searchId}_${index}`,
      searchId,
      name: `Lead teste ${index + 1}`,
      category: "Manual",
      phone,
      address: "",
      website: "",
      instagram: "",
      email: "",
    });
  });
  localStorage.setItem("sigma_searches", JSON.stringify(searches));
  localStorage.setItem("sigma_leads", JSON.stringify(leads));
  toast("Grupo manual criado", "s");
  return true;
}

function leadHasValue(lead, field) {
  return String(lead[field] || "").trim().length > 0;
}

function leadMatchesFilter(lead, filter) {
  if (!filter || filter.mode === "all") return true;
  const field = filter.field;
  const value = String(lead[field] || "").toLowerCase().trim();
  const needle = String(filter.value || "").toLowerCase().trim();
  if (filter.mode === "has") return leadHasValue(lead, field);
  if (filter.mode === "missing") return !leadHasValue(lead, field);
  if (filter.mode === "contains") return value.includes(needle);
  if (filter.mode === "not_contains") return !value.includes(needle);
  if (filter.mode === "equals") return value === needle;
  return true;
}

function describeLeadFilter(filter) {
  if (!filter || filter.mode === "all") return "Todos os leads";
  const labels = {
    name: "nome",
    phone: "telefone",
    category: "categoria",
    website: "site",
    instagram: "Instagram",
    email: "email",
    address: "endereço",
    rating: "avaliação",
    totalReviews: "reviews",
  };
  const field = labels[filter.field] || filter.field;
  if (filter.mode === "has") return `Com ${field}`;
  if (filter.mode === "missing") return `Sem ${field}`;
  if (filter.mode === "contains") return `${field} contém "${filter.value || ""}"`;
  if (filter.mode === "not_contains") return `${field} não contém "${filter.value || ""}"`;
  if (filter.mode === "equals") return `${field} igual a "${filter.value || ""}"`;
  return "Filtro personalizado";
}

function syncCampaignGroupState(searches, leads) {
  searches.forEach((s) => {
    const groupLeads = leads.filter((l) => l.searchId === s.id);
    if (!campaignGroupState[s.id]) {
      campaignGroupState[s.id] = {
        selectedIds: new Set(),
        filter: { field: "website", mode: "all", value: "" },
      };
      return;
    }
    campaignGroupState[s.id].selectedIds = new Set(
      [...campaignGroupState[s.id].selectedIds].filter((id) =>
        groupLeads.some((l) => l.id === id && l.phone),
      ),
    );
  });
}

function getLeadValueLabel(lead, field) {
  const value = lead[field];
  return value ? String(value) : "-";
}

function showNewCampaignForm() {
  const panel = document.getElementById("waCampaignsPanel");
  const searches = JSON.parse(localStorage.getItem("sigma_searches") || "[]");
  const leads = JSON.parse(localStorage.getItem("sigma_leads") || "[]");
  syncCampaignGroupState(searches, leads);
  const searchRows = searches
    .map((s) => {
      const groupLeads = leads.filter((l) => l.searchId === s.id);
      const count = groupLeads.length;
      const withPhone = groupLeads.filter((l) => l.phone).length;
      const selectedCount = campaignGroupState[s.id]?.selectedIds.size || 0;
      const pct = count ? Math.round((withPhone / count) * 100) : 0;
      return `
        <div class="lead-source-card">
          <input type="checkbox" class="wa-search-cb" data-search="${escCampaign(s.id)}" data-count="${withPhone}">
          <span>
            <strong>${escCampaign(s.label || s.query)}</strong>
            <small>${selectedCount}/${withPhone} selecionados · ${withPhone}/${count} com telefone</small>
          </span>
          <em>${pct}%</em>
          <button class="lead-manage-btn" type="button" data-search="${escCampaign(s.id)}">Editar</button>
        </div>
      `;
    })
    .join("");

  panel.innerHTML = `
    <div class="campaign-builder">
      <div class="campaign-toolbar">
        <div>
          <h3>Nova campanha</h3>
          <span>Escolha os leads, escreva a mensagem e defina o ritmo do envio.</span>
        </div>
        <button class="btn btn2" id="waCampCancel">← Voltar</button>
      </div>

      <div class="campaign-builder-grid">
        <section class="campaign-panel">
          <h4>1. Identificação</h4>
          <label>${t("wa_campaign_name")}</label>
          <input type="text" id="waCampName" placeholder="Ex: Prospecção academias RJ">
          
          <label style="margin-top:12px;">Conexão WhatsApp</label>
          <select id="waCampConnection">
            ${(window.waConnections || []).length > 0 
              ? window.waConnections.map(c => `<option value="${c.id}" ${c.id === window.activeWaConnectionId ? 'selected' : ''}>${escCampaign(c.phoneNumber || c.id)}</option>`).join('')
              : '<option value="">(Nenhuma conexão disponível)</option>'}
          </select>
        </section>

        <section class="campaign-panel lead-source-panel">
          <h4>2. Grupos de leads</h4>
          <div class="manual-lead-box">
            <input type="text" id="manualLeadGroupName" placeholder="Grupo manual para teste">
            <textarea id="manualLeadPhones" rows="3" placeholder="Um telefone por linha"></textarea>
            <button class="btn btn2" id="manualLeadCreate" type="button">Criar grupo manual</button>
          </div>
          <div id="waLeadSelect" class="lead-source-grid">
            ${searchRows || '<p class="wa-settings-empty">Nenhuma pesquisa com leads disponível.</p>'}
          </div>
          <div id="leadGroupManager" class="lead-group-manager"></div>
        </section>

        <section class="campaign-panel template-panel">
          <h4>3. Mensagem</h4>
          <div id="waTemplateEditor"></div>
        </section>

        <section class="campaign-panel">
          <h4>4. Envio</h4>
          <label>${t("wa_schedule")}</label>
          <select id="waScheduleMode">
            <option value="immediate">${t("wa_immediate")}</option>
            <option value="interval" selected>${t("wa_interval")}</option>
          </select>
          <div id="waIntervalRow">
            <label>${t("wa_interval_sec")}</label>
            <input type="number" id="waIntervalSec" value="30" min="5" max="3600">
          </div>
          <label class="wa-toggle-row campaign-schedule-toggle"><span><b>Agendar início</b><small>Começa automaticamente na data e hora escolhidas.</small></span><input type="checkbox" id="waScheduleToggle"></label>
          <div id="waStartAtRow" style="display:none;">
            <label>Data e horário de início</label>
            <input type="datetime-local" id="waStartAt">
          </div>
          <div class="campaign-actions">
            <button class="btn btn2" id="waCampSave">${t("wa_save_draft")}</button>
            <button class="btn btn1" id="waCampStart">Iniciar ou agendar</button>
          </div>
        </section>
      </div>
    </div>
  `;

  document.getElementById("waScheduleMode").addEventListener("change", (e) => {
    document.getElementById("waIntervalRow").style.display =
      e.target.value === "interval" ? "" : "none";
  });
  document.getElementById("waScheduleToggle").addEventListener("change", (e) => {
    document.getElementById("waStartAtRow").style.display = e.target.checked ? "" : "none";
  });
  document.getElementById("manualLeadCreate").addEventListener("click", () => {
    const ok = saveManualLeadGroup(
      document.getElementById("manualLeadGroupName").value.trim(),
      document.getElementById("manualLeadPhones").value,
    );
    if (ok) showNewCampaignForm();
  });
  document.querySelectorAll(".lead-manage-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeManageGroupId = btn.dataset.search;
      renderLeadGroupManager(searches, leads);
    });
  });
  document.querySelectorAll(".wa-search-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked && !activeManageGroupId) {
        activeManageGroupId = cb.dataset.search;
        renderLeadGroupManager(searches, leads);
      }
    });
  });
  if (activeManageGroupId) renderLeadGroupManager(searches, leads);

  let templateData = { text: "", variables: [] };
  renderTemplateEditor("waTemplateEditor", "", (td) => {
    templateData = td;
  });

  document.getElementById("waCampCancel").addEventListener("click", renderWaCampaigns);

  async function saveCampaign(status) {
    const name = document.getElementById("waCampName").value.trim();
    if (!name) {
      toast("Nome da campanha é obrigatório", "e");
      return;
    }

    const selectedSearches = [
      ...document.querySelectorAll(".wa-search-cb:checked"),
    ].map((cb) => cb.dataset.search);
    if (!selectedSearches.length) {
      toast("Selecione pelo menos um grupo de leads", "e");
      return;
    }

    const selectedLeads = [];
    selectedSearches.forEach((sid) => {
      const selectedIds = campaignGroupState[sid]?.selectedIds || new Set();
      leads
        .filter((l) => l.searchId === sid && l.phone && selectedIds.has(l.id))
        .forEach((l) => {
          selectedLeads.push({
            leadId: l.id,
            name: l.name,
            phone: l.phone,
            company: l.name,
            category: l.category || "",
            website: l.website || "",
            instagram: l.instagram || "",
            email: l.email || "",
            address: l.address || "",
            rating: l.rating || "",
            totalReviews: l.totalReviews || "",
          });
        });
    });
    if (!selectedLeads.length) {
      toast("Nenhum lead com telefone ficou selecionado", "e");
      return;
    }

    const intervalMs =
      parseInt(document.getElementById("waIntervalSec").value || "30", 10) *
      1000;
    const startEnabled = document.getElementById("waScheduleToggle").checked;
    const startValue = document.getElementById("waStartAt").value;
    const startAt = startEnabled && startValue ? new Date(startValue).getTime() : null;
    if (startEnabled && (!startAt || startAt < Date.now() - 60000)) {
      toast("Escolha uma data futura para agendar", "e");
      return;
    }
    const selectedConnection = document.getElementById("waCampConnection").value;
    if (!selectedConnection) {
      toast("Selecione uma conexão do WhatsApp", "e");
      return;
    }

    const result = await window.campaignAPI.create({
      name,
      provider: window.waProviderType || "baileys",
      connectionId: selectedConnection,
      template: { text: templateData.text, variables: templateData.variables },
      leadIds: selectedLeads,
      schedule: {
        mode: document.getElementById("waScheduleMode").value,
        intervalMs: Math.max(5000, intervalMs),
        startAt,
      },
    });

    if (!result.success) {
      toast(result.error || "Erro ao criar campanha", "e");
      return;
    }

    if (status === "running") {
      const startRes = await window.campaignAPI.start(result.campaign.id);
      if (!startRes.success) {
        toast(startRes.error || "Erro ao iniciar campanha", "e");
        return;
      }
    }

    toast(status === "running" ? (startAt ? "Campanha agendada!" : "Campanha iniciada!") : "Rascunho salvo!", "s");
    selectCampaign(result.campaign.id);
  }

  document
    .getElementById("waCampSave")
    .addEventListener("click", () => saveCampaign("ready"));
  document
    .getElementById("waCampStart")
    .addEventListener("click", () => saveCampaign("running"));
}

function renderLeadGroupManager(searches, leads) {
  const box = document.getElementById("leadGroupManager");
  if (!box || !activeManageGroupId) return;
  const group = searches.find((s) => s.id === activeManageGroupId);
  if (!group) {
    box.innerHTML = "";
    return;
  }
  const state = campaignGroupState[group.id] || {
    selectedIds: new Set(),
    filter: { field: "website", mode: "all", value: "" },
  };
  campaignGroupState[group.id] = state;
  const groupLeads = leads.filter((l) => l.searchId === group.id);
  const filter = state.filter || { field: "website", mode: "all", value: "" };
  const visible = groupLeads.filter((lead) => leadMatchesFilter(lead, filter));
  const fields = [
    ["name", "Nome"],
    ["phone", "Telefone"],
    ["category", "Categoria"],
    ["website", "Site"],
    ["instagram", "Instagram"],
    ["email", "Email"],
    ["address", "Endereço"],
    ["rating", "Avaliação"],
    ["totalReviews", "Reviews"],
  ];
  box.innerHTML = `
    <div class="lead-manager-head">
      <div>
        <strong>${escCampaign(group.label || group.query)}</strong>
        <span>${state.selectedIds.size}/${groupLeads.filter((l) => l.phone).length} marcados para campanha</span>
      </div>
      <button class="btn btn2" id="leadMgrClose" type="button">Fechar</button>
    </div>
    <div class="lead-manager-edit">
      <input type="text" id="leadGroupNameEdit" value="${escCampaign(group.label || group.query)}">
      <textarea id="leadGroupAddPhones" rows="2" placeholder="Adicionar telefones, um por linha"></textarea>
      <button class="btn btn2" id="leadGroupAddBtn" type="button">Adicionar números</button>
      <button class="btn btn2" id="leadGroupSaveName" type="button">Salvar nome</button>
    </div>
    <div class="lead-quick-filters">
      <button class="lead-chip" data-field="phone" data-mode="has" type="button">Com telefone</button>
      <button class="lead-chip" data-field="website" data-mode="missing" type="button">Sem site</button>
      <button class="lead-chip" data-field="website" data-mode="has" type="button">Com site</button>
      <button class="lead-chip" data-field="instagram" data-mode="has" type="button">Com Instagram</button>
      <button class="lead-chip" data-field="instagram" data-mode="missing" type="button">Sem Instagram</button>
      <button class="lead-chip" data-field="email" data-mode="missing" type="button">Sem email</button>
      <button class="lead-chip" data-field="all" data-mode="all" type="button">Todos</button>
    </div>
    <div class="lead-filter-summary">
      <span>${escCampaign(describeLeadFilter(filter))}: ${visible.length} leads encontrados</span>
      <div>
        <button class="btn btn1" id="leadSelectFiltered" type="button">Usar estes leads</button>
        <button class="btn btn2" id="leadUnselectFiltered" type="button">Remover estes leads</button>
      </div>
    </div>
    <details class="lead-advanced-filter">
      <summary>Filtro avançado</summary>
      <div class="lead-filter-row">
      <select id="leadFilterField">
        ${fields.map(([key, label]) => `<option value="${key}" ${filter.field === key ? "selected" : ""}>${label}</option>`).join("")}
      </select>
      <select id="leadFilterMode">
        <option value="all" ${filter.mode === "all" ? "selected" : ""}>Todos</option>
        <option value="has" ${filter.mode === "has" ? "selected" : ""}>Tem valor</option>
        <option value="missing" ${filter.mode === "missing" ? "selected" : ""}>Sem valor</option>
        <option value="contains" ${filter.mode === "contains" ? "selected" : ""}>Contém</option>
        <option value="not_contains" ${filter.mode === "not_contains" ? "selected" : ""}>Não contém</option>
        <option value="equals" ${filter.mode === "equals" ? "selected" : ""}>Igual</option>
      </select>
      <input type="text" id="leadFilterValue" value="${escCampaign(filter.value || "")}" placeholder="Valor">
      <button class="btn btn2" id="leadApplyFilter" type="button">Filtrar</button>
      </div>
    </details>
    <div class="lead-manager-actions">
      <button class="btn btn2" id="leadSelectAll" type="button">Marcar todos com telefone</button>
      <button class="btn btn2" id="leadClearAll" type="button">Limpar seleção</button>
      <button class="btn btn2" id="leadRemoveUnselected" type="button">Remover não marcados do grupo</button>
    </div>
    <div class="lead-preview-list">
      ${
        visible
          .map(
            (lead) => `
        <label class="lead-preview-row ${lead.phone ? "" : "no-phone"}">
          <input type="checkbox" class="lead-row-cb" data-id="${escCampaign(lead.id)}" ${state.selectedIds.has(lead.id) ? "checked" : ""} ${lead.phone ? "" : "disabled"}>
          <span><b>${escCampaign(lead.name || "Lead")}</b><small>${escCampaign(lead.phone || "sem telefone")} · site: ${escCampaign(getLeadValueLabel(lead, "website"))} · email: ${escCampaign(getLeadValueLabel(lead, "email"))}</small></span>
        </label>
      `,
          )
          .join("") || '<p class="wa-settings-empty">Nenhum lead nesse filtro.</p>'
      }
    </div>
  `;

  const persistLeadsAndGroups = (nextSearches, nextLeads) => {
    localStorage.setItem("sigma_searches", JSON.stringify(nextSearches));
    localStorage.setItem("sigma_leads", JSON.stringify(nextLeads));
  };
  const readFilter = () => ({
    field: document.getElementById("leadFilterField").value,
    mode: document.getElementById("leadFilterMode").value,
    value: document.getElementById("leadFilterValue").value,
  });
  document.getElementById("leadMgrClose").addEventListener("click", () => {
    activeManageGroupId = null;
    box.innerHTML = "";
  });
  document.querySelectorAll(".lead-chip").forEach((btn) => {
    const active =
      btn.dataset.mode === filter.mode &&
      (btn.dataset.mode === "all" || btn.dataset.field === filter.field);
    btn.classList.toggle("active", active);
    btn.addEventListener("click", () => {
      state.filter = {
        field: btn.dataset.field === "all" ? "website" : btn.dataset.field,
        mode: btn.dataset.mode,
        value: "",
      };
      renderLeadGroupManager(searches, leads);
    });
  });
  document.getElementById("leadApplyFilter").addEventListener("click", () => {
    state.filter = readFilter();
    renderLeadGroupManager(searches, leads);
  });
  document.getElementById("leadSelectFiltered").addEventListener("click", () => {
    visible.filter((l) => l.phone).forEach((l) => state.selectedIds.add(l.id));
    renderLeadGroupManager(searches, leads);
  });
  document.getElementById("leadUnselectFiltered").addEventListener("click", () => {
    visible.forEach((l) => state.selectedIds.delete(l.id));
    renderLeadGroupManager(searches, leads);
  });
  document.getElementById("leadSelectAll").addEventListener("click", () => {
    groupLeads.filter((l) => l.phone).forEach((l) => state.selectedIds.add(l.id));
    renderLeadGroupManager(searches, leads);
  });
  document.getElementById("leadClearAll").addEventListener("click", () => {
    state.selectedIds.clear();
    renderLeadGroupManager(searches, leads);
  });
  document.querySelectorAll(".lead-row-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.selectedIds.add(cb.dataset.id);
      else state.selectedIds.delete(cb.dataset.id);
    });
  });
  document.getElementById("leadGroupSaveName").addEventListener("click", () => {
    group.label = document.getElementById("leadGroupNameEdit").value.trim() || group.label || group.query;
    group.query = group.label;
    persistLeadsAndGroups(searches, leads);
    toast("Grupo atualizado", "s");
    showNewCampaignForm();
  });
  document.getElementById("leadGroupAddBtn").addEventListener("click", () => {
    const phones = String(document.getElementById("leadGroupAddPhones").value || "")
      .split(/[\n,;]+/)
      .map(normalizeManualPhone)
      .filter(Boolean);
    const nextLeads = JSON.parse(localStorage.getItem("sigma_leads") || "[]");
    const existingPhones = new Set(nextLeads.filter((l) => l.searchId === group.id).map((l) => l.phone));
    phones.forEach((phone) => {
      if (existingPhones.has(phone)) return;
      const id = `${group.id}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      nextLeads.push({
        id,
        searchId: group.id,
        name: `Lead manual ${phone}`,
        category: "Manual",
        phone,
        address: "",
        website: "",
        instagram: "",
        email: "",
      });
      state.selectedIds.add(id);
    });
    persistLeadsAndGroups(searches, nextLeads);
    toast("Números adicionados", "s");
    showNewCampaignForm();
  });
  document.getElementById("leadRemoveUnselected").addEventListener("click", () => {
    if (!confirm("Remover do grupo todos os leads não marcados?")) return;
    const nextLeads = leads.filter((l) => l.searchId !== group.id || state.selectedIds.has(l.id));
    persistLeadsAndGroups(searches, nextLeads);
    toast("Grupo filtrado", "s");
    showNewCampaignForm();
  });
}

function selectCampaign(id) {
  const tabs = document.querySelectorAll(".wa-tab");
  tabs.forEach((t) => t.classList.remove("act"));
  const monitorTab = document.querySelector('.wa-tab[data-wa="monitor"]');
  if (monitorTab) monitorTab.classList.add("act");

  document.getElementById("waConnectPanel").style.display = "none";
  document.getElementById("waCampaignsPanel").style.display = "none";
  document.getElementById("waMonitorPanel").style.display = "";
  document.getElementById("waSettingsPanel").style.display = "none";

  window.activeWaCampaignId = id;
  renderWaMonitor(id);
}

function escCampaign(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}

window.selectCampaign = selectCampaign;
window.refreshCampaignList = refreshCampaignList;
window.renderWaCampaigns = renderWaCampaigns;
