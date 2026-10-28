import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  Clock3,
  Globe,
  DollarSign,
  Instagram,
  Mail,
  MessageCircle,
  Percent,
  Phone,
  Send,
  Trophy,
  Users,
} from 'lucide-react';
import {
  dedupeLeads,
  getExtractionSearches,
  getLeadStats,
  getSearchLeadCount,
  normalizeLeadCategory,
  normalizeLeadCollection,
  readLocalArray,
} from '../leadData';
import { isRealWebsite } from '../leadLinks.mjs';

const METRICS = [
  { id: 'leads', Icon: Users, label: 'Leads', title: 'Quantidade de leads', color: '#10a37f' },
  { id: 'sent', Icon: Send, label: 'Enviadas', title: 'Mensagens enviadas', color: '#2563eb' },
  { id: 'replies', Icon: MessageCircle, label: 'Respostas', title: 'Respostas recebidas', color: '#f59e0b' },
  { id: 'rate', Icon: Percent, label: 'Taxa de resposta', title: 'Taxa de resposta', color: '#db2777' },
];

const BarsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="15" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

const ColumnsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="6" y1="20" x2="6" y2="13" /><line x1="12" y1="20" x2="12" y2="6" /><line x1="18" y1="20" x2="18" y2="10" />
  </svg>
);

const ListIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
    <circle cx="5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="5" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const TableIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="2" /><line x1="4" y1="10" x2="20" y2="10" /><line x1="10" y1="10" x2="10" y2="20" />
  </svg>
);

function metricDefinition(id) {
  return METRICS.find((item) => item.id === id) || METRICS[0];
}

function metricValue(category, id) {
  if (id === 'rate') return category.sent ? (category.replies / category.sent) * 100 : 0;
  return Number(category[id] || 0);
}

function formatMetric(id, value) {
  return id === 'rate' ? `${Math.round(value)}%` : Number(value || 0).toLocaleString('pt-BR');
}

function aggregateCategories(rows, name = 'Outros') {
  const aggregate = rows.reduce((acc, row) => ({
    leads: acc.leads + row.leads,
    sent: acc.sent + row.sent,
    replies: acc.replies + row.replies,
  }), { leads: 0, sent: 0, replies: 0 });
  return { name, ...aggregate, isOther: true, members: rows };
}

function getCampaignsFromResponse(response) {
  if (Array.isArray(response)) return response;
  return Array.isArray(response?.campaigns) ? response.campaigns : [];
}

function getCampaignCategoryMetrics(campaigns) {
  const byCategory = new Map();
  campaigns.forEach((campaign) => {
    (Array.isArray(campaign?.leads) ? campaign.leads : []).forEach((lead) => {
      const category = normalizeLeadCategory(lead?.category || lead?.company?.category);
      const current = byCategory.get(category) || { sent: 0, replies: 0 };
      const status = String(lead?.status || '').toLowerCase();
      const sent = Boolean(lead?.sentAt || lead?.messageId || ['sent', 'delivered', 'read', 'replied'].includes(status));
      const replied = Boolean(lead?.repliedAt || lead?.replyCount > 0 || status === 'replied');
      if (sent) current.sent += 1;
      if (replied) current.replies += 1;
      byCategory.set(category, current);
    });
  });
  return byCategory;
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function shortDate(value) {
  const date = new Date(Number(value) || value || NaN);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
}

const UF_CODES = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

function compactExtractionLabel(search) {
  const raw = String(search?.label || search?.query || '').trim();
  const uf = String(search?.uf || raw.match(/(?:^|[\s,·-])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)(?:$|[\s,·-])/i)?.[1] || '').toUpperCase();
  const niche = String(search?.niche || raw.split(/[·|]/)[0] || 'Extração').trim();
  return { label: `${niche || 'Extração'}${UF_CODES.has(uf) ? ` · ${uf}` : ''}`, niche: niche || 'Extração', uf };
}

function asTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pendingArrivalTimestamp(item) {
  // reminderCreatedAt is written when a reminder is saved. The remaining
  // fields keep older boards ordered until they receive that metadata.
  return asTimestamp(item?.reminderCreatedAt)
    || asTimestamp(item?.updatedAt)
    || asTimestamp(item?.createdAt)
    || asTimestamp(item?.movedAt)
    || asTimestamp(item?.reminderAt);
}

function Overview({ onNavigate, onNewExtraction, leadsCount = 0 }) {
  const [categoryView, setCategoryView] = useState(() => localStorage.getItem('sigma_overview_category_view') || 'bars');
  const [searchView, setSearchView] = useState(() => localStorage.getItem('sigma_overview_search_view') || 'bars');
  const [recentFilter, setRecentFilter] = useState('all');
  const [selectedMetrics, setSelectedMetrics] = useState(['leads']);
  const [expandedOther, setExpandedOther] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [kanbanSnapshot, setKanbanSnapshot] = useState({ cards: [], stats: { wonValue: 0, wonCount: 0, ticketAverage: 0, openValue: 0, reminderCount: 0 } });
  const [pendingMenuOpen, setPendingMenuOpen] = useState(false);
  const [pendingPopoverPosition, setPendingPopoverPosition] = useState(null);
  const pendingTriggerRef = useRef(null);
  const pendingPopoverRef = useRef(null);
  const [standaloneReminders, setStandaloneReminders] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('sigma_whatsapp_reminders') || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const refreshStandaloneReminders = () => {
      try {
        const raw = JSON.parse(localStorage.getItem('sigma_whatsapp_reminders') || '[]');
        setStandaloneReminders(Array.isArray(raw) ? raw : []);
      } catch {
        setStandaloneReminders([]);
      }
    };
    window.addEventListener('sigma:reminders-updated', refreshStandaloneReminders);
    window.addEventListener('storage', refreshStandaloneReminders);
    return () => {
      window.removeEventListener('sigma:reminders-updated', refreshStandaloneReminders);
      window.removeEventListener('storage', refreshStandaloneReminders);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    window.campaignAPI?.getAll?.()
      .then((response) => {
        if (mounted) setCampaigns(getCampaignsFromResponse(response));
      })
      .catch(() => {
        if (mounted) setCampaigns([]);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadDealStats = async () => {
      if (!window.kanbanAPI?.getBoard) return;
      try {
        const mapsLeads = normalizeLeadCollection(readLocalArray('sigma_leads'));
        const synced = await window.kanbanAPI.syncMapsLeads?.(mapsLeads);
        const response = await window.kanbanAPI.getBoard();
        const snapshot = response?.board || synced?.board;
        if (mounted && snapshot) setKanbanSnapshot(snapshot);
      } catch {
        if (mounted) setKanbanSnapshot({ cards: [], stats: { wonValue: 0, wonCount: 0, ticketAverage: 0, openValue: 0, reminderCount: 0 } });
      }
    };
    const refresh = () => loadDealStats();
    loadDealStats();
    window.addEventListener('sigma:deal-updated', refresh);
    window.addEventListener('sigma:leads-updated', refresh);
    return () => {
      mounted = false;
      window.removeEventListener('sigma:deal-updated', refresh);
      window.removeEventListener('sigma:leads-updated', refresh);
    };
  }, [leadsCount]);

  const dealStats = kanbanSnapshot.stats || {};
  const pendingDeals = useMemo(() => {
    const kanbanPending = (kanbanSnapshot.cards || [])
      .filter((card) => card.dealStatus !== 'won' && card.dealStatus !== 'lost' && (Number(card.dealValue) > 0 || card.reminderAt));
    const standalonePending = standaloneReminders.map((item) => ({
      ...item,
      standalone: true,
      entityKey: `standalone:${item.id || item.key || item.jid || item.phone}`,
      entity: { profile: { name: item.name || item.phone || 'Contato', phone: item.phone || item.key || '' } },
      dealStatus: 'open',
      dealValue: 0,
      reminderNote: item.note || '',
    }));
    return [...kanbanPending, ...standalonePending]
    .sort((a, b) => {
      const arrivalOrder = pendingArrivalTimestamp(b) - pendingArrivalTimestamp(a);
      if (arrivalOrder) return arrivalOrder;
      const aReminder = asTimestamp(a.reminderAt) || Number.MAX_SAFE_INTEGER;
      const bReminder = asTimestamp(b.reminderAt) || Number.MAX_SAFE_INTEGER;
      return aReminder - bReminder || String(a.entityKey || '').localeCompare(String(b.entityKey || ''), 'pt-BR');
    });
  }, [kanbanSnapshot.cards, standaloneReminders]);

  const reminderTotal = Number(dealStats.reminderCount || 0) + standaloneReminders.length;

  const openPendingDeal = (card) => {
    const profile = card?.entity?.profile || {};
    const name = profile.name || card?.entity?.name || 'Lead';
    const tel = profile.phone || profile.whatsapp || profile.tel || card?.entity?.phone || '';
    if (tel) {
      try {
        localStorage.setItem('sigma_wa_pending', JSON.stringify({ name, tel, direct: true }));
      } catch { /* best effort */ }
      onNavigate?.('whatsapp');
    } else {
      onNavigate?.('kanban');
    }
    setPendingMenuOpen(false);
  };

  useLayoutEffect(() => {
    if (!pendingMenuOpen) {
      setPendingPopoverPosition(null);
      return undefined;
    }

    const updatePosition = () => {
      const trigger = pendingTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 10;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(360, Math.max(0, viewportWidth - (viewportPadding * 2)));
      const preferredLeft = rect.right - width;
      const left = Math.min(
        Math.max(viewportPadding, preferredLeft),
        Math.max(viewportPadding, viewportWidth - width - viewportPadding),
      );
      const downTop = rect.bottom + gap;
      const availableBelow = viewportHeight - downTop - viewportPadding;
      const canStayBelow = availableBelow >= 140;
      // Abre abaixo do sino sempre que houver espaço. Em uma janela muito
      // curta, desloca só o necessário para manter o painel visível.
      const top = canStayBelow
        ? downTop
        : Math.max(viewportPadding, viewportHeight - Math.min(520, Math.max(140, viewportHeight - (viewportPadding * 2))) - viewportPadding);
      const maxHeight = Math.max(140, Math.min(520, viewportHeight - top - viewportPadding));
      setPendingPopoverPosition({ top, left, width, maxHeight });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [pendingMenuOpen]);

  useEffect(() => {
    if (!pendingMenuOpen) return undefined;
    const closeOnOutside = (event) => {
      if (pendingTriggerRef.current?.contains(event.target) || pendingPopoverRef.current?.contains(event.target)) return;
      setPendingMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setPendingMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [pendingMenuOpen]);

  const pendingPopover = pendingMenuOpen && pendingPopoverPosition
    ? createPortal(
      <div
        ref={pendingPopoverRef}
        id="overview-pending-popover"
        className="overview-pending-popover"
        role="dialog"
        aria-labelledby="overview-pending-title"
        style={{
          top: `${pendingPopoverPosition.top}px`,
          left: `${pendingPopoverPosition.left}px`,
          width: `${pendingPopoverPosition.width}px`,
          maxHeight: `${pendingPopoverPosition.maxHeight}px`,
        }}
      >
        <div className="overview-pending-popover-head">
          <div className="overview-pending-popover-heading">
            <span id="overview-pending-title">Lembretes</span>
            <small>{pendingDeals.length ? `${pendingDeals.length} · mais recentes primeiro` : 'Tudo em dia'}</small>
          </div>
          <button type="button" aria-label="Fechar lembretes" onClick={() => setPendingMenuOpen(false)}>×</button>
        </div>
        <div className="overview-pending-popover-list">
          {pendingDeals.length ? pendingDeals.map((card) => {
            const profile = card.entity?.profile || {};
            const due = card.reminderAt && asTimestamp(card.reminderAt) <= Date.now();
            const reminderAt = asTimestamp(card.reminderAt);
            return (
              <button type="button" className="overview-pending-popover-item" key={card.entityKey} onClick={() => openPendingDeal(card)}>
                <span className="overview-pending-popover-icon"><Bell size={14} /></span>
                <span className="overview-pending-popover-copy">
                  <b>{profile.name || 'Lead sem nome'}</b>
                  <small>{card.reminderNote || (due ? 'Lembrete vencido' : 'Lembrete')}</small>
                  {reminderAt ? <time dateTime={new Date(reminderAt).toISOString()}>{shortDate(reminderAt)}</time> : null}
                </span>
                <span className="overview-pending-popover-value">{Number(card.dealValue) > 0 ? money(card.dealValue) : '—'}</span>
              </button>
            );
          }) : <span className="overview-pending-empty">Nenhuma pendência</span>}
        </div>
      </div>,
      document.body,
    )
    : null;

  useEffect(() => {
    try { localStorage.setItem('sigma_overview_category_view', categoryView); } catch {}
  }, [categoryView]);

  useEffect(() => {
    try { localStorage.setItem('sigma_overview_search_view', searchView); } catch {}
  }, [searchView]);

  const data = useMemo(() => {
    const leads = dedupeLeads(normalizeLeadCollection(readLocalArray('sigma_leads')));
    const searches = getExtractionSearches(readLocalArray('sigma_searches'));
    const stats = getLeadStats(leads);
    const campaignMetrics = getCampaignCategoryMetrics(campaigns);
    const categoryMap = new Map();

    leads.forEach((lead) => {
      const name = normalizeLeadCategory(lead.category);
      categoryMap.set(name, (categoryMap.get(name) || 0) + 1);
    });

    const categories = [...categoryMap.entries()]
      .map(([name, count]) => ({
        name,
        leads: count,
        sent: campaignMetrics.get(name)?.sent || 0,
        replies: campaignMetrics.get(name)?.replies || 0,
      }))
      .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name, 'pt-BR'));

    const recent = searches.slice(0, 7).map((search) => {
      const extractionLeads = leads.filter((lead) => String(lead?.searchId ?? '') === String(search.id ?? ''));
      const compact = compactExtractionLabel(search);
      const count = extractionLeads.length || getSearchLeadCount(leads, search.id) || Number(search?.leadCount || search?.count || 0);
      return {
        ...search,
        ...compact,
        count,
        withSite: extractionLeads.filter((lead) => isRealWebsite(lead?.website || lead?.site)).length,
        withPhone: extractionLeads.filter((lead) => lead?.phone || lead?.tel || lead?.whatsapp).length,
        withEmail: extractionLeads.filter((lead) => lead?.email || lead?.mail).length,
      };
    });

    return {
      total: stats.total || Number(leadsCount || 0),
      phone: stats.phoneCount,
      web: stats.webCount,
      instagram: stats.igCount,
      email: stats.emailCount,
      categories,
      recent,
    };
  }, [campaigns, leadsCount]);

  const displayedCategories = useMemo(() => {
    if (data.categories.length <= 5) return data.categories;
    const top = data.categories.slice(0, 4);
    const rest = data.categories.slice(4);
    const other = aggregateCategories(rest);
    return expandedOther
      ? [...top, other, ...rest.map((item) => ({ ...item, isOtherMember: true }))]
      : [...top, other];
  }, [data.categories, expandedOther]);

  const metricMax = useMemo(() => Object.fromEntries(selectedMetrics.map((id) => [
    id,
    Math.max(...displayedCategories.map((category) => metricValue(category, id)), 1),
  ])), [displayedCategories, selectedMetrics]);

  const filteredRecent = useMemo(() => data.recent
    .map((item) => ({
      ...item,
      visibleCount: recentFilter === 'site' ? item.withSite : recentFilter === 'phone' ? item.withPhone : recentFilter === 'email' ? item.withEmail : item.count,
    }))
    .filter((item) => item.visibleCount > 0), [data.recent, recentFilter]);
  const maxSearch = Math.max(...filteredRecent.map((item) => item.visibleCount), 1);

  const toggleMetric = (id) => {
    setSelectedMetrics((current) => {
      if (current.includes(id)) return current.length === 1 ? current : current.filter((metricId) => metricId !== id);
      return current.length >= 2 ? [current[1], id] : [...current, id];
    });
  };

  const toggleCategory = (category) => {
    if (category.isOther) {
      setExpandedOther((value) => !value);
      return;
    }
    setSelectedCategories((current) => (
      current.includes(category.name)
        ? current.filter((name) => name !== category.name)
        : [...current, category.name]
    ));
  };

  const categoryClassName = (category) => [
    category.isOtherMember ? 'is-other-member' : '',
    selectedCategories.length && !selectedCategories.includes(category.name) && !category.isOther ? 'is-dimmed' : '',
  ].filter(Boolean).join(' ');

  const renderCategoryValues = (category) => (
    <span className="overview-values">
      {selectedMetrics.map((id) => {
        const metric = metricDefinition(id);
        return (
          <span key={id} title={`${metric.label}: ${formatMetric(id, metricValue(category, id))}`}>
            <i style={{ background: metric.color }} />
            {formatMetric(id, metricValue(category, id))}
          </span>
        );
      })}
    </span>
  );

  const renderCategoryBody = () => {
    if (!displayedCategories.length) {
      return (
        <div className="overview-empty">
          <b>Nenhum lead na base</b>
          <span>Faça uma extração para ver as categorias reais aqui.</span>
        </div>
      );
    }

    if (categoryView === 'columns') {
      return (
        <div className="overview-columns">
          {displayedCategories.map((category) => (
            <button
              type="button"
              className={categoryClassName(category)}
              key={`${category.name}-${category.isOtherMember ? 'member' : 'main'}`}
              onClick={() => toggleCategory(category)}
              aria-pressed={!category.isOther && selectedCategories.includes(category.name)}
              title={category.isOther ? `${expandedOther ? 'Recolher' : 'Ver'} categorias agrupadas` : category.name}
            >
              {renderCategoryValues(category)}
              <span className="overview-column-bars">
                {selectedMetrics.map((id) => (
                  <i
                    key={id}
                    style={{
                      height: `${Math.max(6, (metricValue(category, id) / metricMax[id]) * 112)}px`,
                      background: metricDefinition(id).color,
                    }}
                  />
                ))}
              </span>
              <span title={category.name}>{category.isOther ? `Outros ${expandedOther ? '−' : '+'}` : category.name}</span>
            </button>
          ))}
        </div>
      );
    }

    return (
      <div className={`overview-bar-list ${categoryView === 'list' ? 'is-list' : ''} ${selectedMetrics.length === 2 ? 'is-comparing' : ''}`}>
        {displayedCategories.map((category, index) => (
          <button
            type="button"
            className={categoryClassName(category)}
            key={`${category.name}-${category.isOtherMember ? 'member' : 'main'}`}
            onClick={() => toggleCategory(category)}
            aria-pressed={!category.isOther && selectedCategories.includes(category.name)}
          >
            {categoryView === 'list' && <em>{category.isOtherMember ? '↳' : `#${index + 1}`}</em>}
            <span title={category.name}>{category.isOther ? `Outros ${expandedOther ? '−' : '+'}` : category.name}</span>
            {categoryView === 'bars' && (
              <span className="overview-compare-bars">
                {selectedMetrics.map((id) => (
                  <i key={id} title={`${metricDefinition(id).label}: ${formatMetric(id, metricValue(category, id))}`}>
                    <i style={{ width: `${(metricValue(category, id) / metricMax[id]) * 100}%`, background: metricDefinition(id).color }} />
                  </i>
                ))}
              </span>
            )}
            {renderCategoryValues(category)}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="overview-view">
      <section className="overview-hero hero-op" aria-label="Resumo da base" data-od-id="dashboard-total">
        <div className="overview-hero-main hero-main">
          <div className="overview-kicker lb">Total de leads na base</div>
          <div className="big">{Number(data.total || 0).toLocaleString('pt-BR')}</div>
        </div>
        <div className="hero-cta">
          <button type="button" className="btn btn-primary overview-new-button" onClick={onNewExtraction}>+ Nova Extração</button>
        </div>
        <div className="overview-hero-bottom">
          <div className="overview-coverage hero-contacts" data-od-id="coverage">
            <span className="hc" title="Com telefone" aria-label={`${data.phone} com telefone`}><Phone /><b>{data.phone}</b></span>
            <span className="hc" title="Com site" aria-label={`${data.web} com site`}><Globe /><b>{data.web}</b></span>
            <span className="hc" title="Com Instagram" aria-label={`${data.instagram} com Instagram`}><Instagram /><b>{data.instagram}</b></span>
            <span className="hc" title="Com e-mail" aria-label={`${data.email} com e-mail`}><Mail /><b>{data.email}</b></span>
          </div>
          <div className="overview-crm-tools">
            <div className="overview-crm-metrics" aria-label="Resumo comercial">
              <span className="overview-crm-metric" title="Receita ganha" aria-label={`Receita ganha: ${money(dealStats.wonValue)}`}><DollarSign size={15} /><b>{money(dealStats.wonValue)}</b></span>
              <span className="overview-crm-metric" title="Valor pendente" aria-label={`Valor pendente: ${money(dealStats.openValue)}`}><Clock3 size={15} /><b>{money(dealStats.openValue)}</b></span>
              <span className="overview-crm-metric" title="Vendas fechadas" aria-label={`Vendas fechadas: ${dealStats.wonCount || 0}`}><Trophy size={15} /><b>{Number(dealStats.wonCount || 0).toLocaleString('pt-BR')}</b></span>
              <button ref={pendingTriggerRef} type="button" className={`overview-crm-metric overview-crm-reminder ${pendingMenuOpen ? 'active' : ''}`} title="Abrir lembretes" aria-label={`Lembretes: ${reminderTotal}`} aria-expanded={pendingMenuOpen} aria-controls="overview-pending-popover" aria-haspopup="dialog" onClick={() => setPendingMenuOpen((open) => !open)}><Bell size={15} /><b>{reminderTotal.toLocaleString('pt-BR')}</b></button>
            </div>
          </div>
        </div>
      </section>

      {pendingPopover}

      <div className="overview-grid dash-grid">
        <section className="overview-panel panel" data-od-id="dashboard-categories">
          <div className="overview-panel-head panel-head">
            <h3>Leads por categoria</h3>
            <div className="overview-segment seg" aria-label="Visualização de categorias">
              <button type="button" aria-pressed={categoryView === 'bars'} onClick={() => setCategoryView('bars')} title="Barras"><BarsIcon /></button>
              <button type="button" aria-pressed={categoryView === 'columns'} onClick={() => setCategoryView('columns')} title="Colunas"><ColumnsIcon /></button>
              <button type="button" aria-pressed={categoryView === 'list'} onClick={() => setCategoryView('list')} title="Lista"><ListIcon /></button>
            </div>
          </div>
          <div className="overview-metrics mxrow" aria-label="Selecione até duas métricas para comparar">
            {METRICS.map(({ id, Icon, title }) => (
              <button
                key={id}
                type="button"
                className={`mx ${selectedMetrics.indexOf(id) === 1 ? 'is-secondary' : ''}`}
                aria-pressed={selectedMetrics.includes(id)}
                onClick={() => toggleMetric(id)}
                title={`${title} — selecione até 2`}
              >
                <Icon size={15} />
              </button>
            ))}
            <span className="overview-metric-legend">
              {selectedMetrics.map((id) => {
                const metric = metricDefinition(id);
                return <span key={id}><i style={{ background: metric.color }} />{metric.label}</span>;
              })}
            </span>
          </div>

          <div className="scrollbox">{renderCategoryBody()}</div>
        </section>

        <section className="overview-panel panel" data-od-id="dashboard-recent">
          <div className="overview-panel-head panel-head overview-recent-head">
            <div><h3>Últimas extrações</h3><span className="overview-recent-subtitle">Nicho · UF</span></div>
            <div className="overview-segment seg" aria-label="Visualização de extrações">
              <button type="button" aria-pressed={searchView === 'bars'} onClick={() => setSearchView('bars')} title="Barras"><BarsIcon /></button>
              <button type="button" aria-pressed={searchView === 'table'} onClick={() => setSearchView('table')} title="Tabela"><TableIcon /></button>
            </div>
          </div>
          <div className="overview-recent-filters" role="group" aria-label="Filtrar leads das extrações">
            {[
              ['all', 'Todos', ListIcon],
              ['site', 'Com site', Globe],
              ['phone', 'Com telefone', Phone],
              ['email', 'Com e-mail', Mail],
            ].map(([id, label, Icon]) => (
              <button key={id} type="button" className={recentFilter === id ? 'active' : ''} aria-pressed={recentFilter === id} onClick={() => setRecentFilter(id)} title={label} aria-label={label}><Icon size={15} /></button>
            ))}
          </div>
          {filteredRecent.length ? (
            <div className={`overview-search-list ${searchView === 'table' ? 'is-table' : ''}`}>
              {filteredRecent.map((item) => (
                <div key={item.id}>
                  <span title={item.label}>{item.label}</span>
                  {searchView === 'bars' && <i><i style={{ width: `${Math.max(2, (item.visibleCount / maxSearch) * 100)}%` }} /></i>}
                  <b>{item.visibleCount} <small>leads</small></b>
                </div>
              ))}
            </div>
          ) : (
            <div className="overview-empty">
              <b>Nenhuma extração ainda</b>
              <span>Importações de planilha não aparecem neste histórico.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Overview;
