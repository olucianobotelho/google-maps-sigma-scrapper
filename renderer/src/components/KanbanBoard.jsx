import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Ban,
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock,
  DollarSign,
  Filter,
  Flame,
  Globe,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { normalizeLeadCollection, readLocalArray } from '../leadData';
import { DEFAULT_SCORE_THRESHOLDS, normalizeThresholds, scoreBand } from '../leadMatch.mjs';

const MAX_COLUMNS = 12;
const MAX_RULES = 50;
const MAX_CONDITIONS = 6;

const FIELD_OPTIONS = [
  { value: 'score', label: 'Score', short: 'score' },
  { value: 'priority', label: 'Prioridade', short: 'prioridade' },
  { value: 'hasPhone', label: 'Tem telefone', short: 'telefone' },
  { value: 'hasWebsite', label: 'Tem site', short: 'site' },
  { value: 'hasEmail', label: 'Tem e-mail', short: 'e-mail' },
  { value: 'category', label: 'Categoria', short: 'categoria' },
  { value: 'city', label: 'Cidade', short: 'cidade' },
  { value: 'source', label: 'Origem', short: 'origem' },
  { value: 'campaignStatus', label: 'Status de campanha', short: 'status da campanha' },
  { value: 'prospectingStatus', label: 'Status comercial', short: 'status comercial' },
];

const OPERATOR_OPTIONS = [
  { value: 'gte', label: 'é maior ou igual a' },
  { value: 'lte', label: 'é menor ou igual a' },
  { value: 'equals', label: 'é igual a' },
  { value: 'contains', label: 'contém' },
  { value: 'in', label: 'está em uma lista' },
  { value: 'isTrue', label: 'é verdadeiro' },
  { value: 'isFalse', label: 'é falso' },
];

const TRIGGER_OPTIONS = [
  { value: 'sync', label: 'Ao reaplicar regras (manual)' },
  { value: 'lead.imported', label: 'Ao importar lead da base' },
  { value: 'scoring.completed', label: 'Ao concluir o scoring' },
  { value: 'campaign.sent', label: 'Ao enviar campanha' },
  { value: 'campaign.replied', label: 'Ao receber resposta' },
  { value: 'deal.won', label: 'Ao marcar como ganho' },
  { value: 'deal.lost', label: 'Ao marcar como perdido' },
  { value: 'any', label: 'Em qualquer evento' },
];

/**
 * O caminho principal de configuração: uma frase por evento. É o modelo mental
 * "se aconteceu X, vai para a coluna Y" — sem condições para montar.
 */
const SIMPLE_RULES = [
  {
    trigger: 'campaign.sent',
    when: 'Se o lead recebeu a mensagem',
    hint: 'Disparo de campanha move o card.',
    icon: ArrowRight,
  },
  {
    trigger: 'campaign.replied',
    when: 'Se o lead respondeu',
    hint: 'Resposta puxa o lead na hora.',
    icon: Zap,
  },
  {
    trigger: 'deal.won',
    when: 'Se você marcou como ganho',
    hint: 'Também define a etapa “Vendeu”.',
    icon: Trophy,
  },
  {
    trigger: 'deal.lost',
    when: 'Se você marcou como perdido',
    hint: 'Também define a etapa “Recusou”.',
    icon: Ban,
  },
];

const LEVELS = [
  { min: 0, title: 'Manual', hint: 'O quadro ainda depende de você.' },
  { min: 20, title: 'Organizado', hint: 'O funil começa a andar sozinho.' },
  { min: 45, title: 'Afiado', hint: 'Regras cobrindo o fluxo principal.' },
  { min: 75, title: 'Escala', hint: 'Automação multi-evento rodando.' },
  { min: 110, title: 'Máquina', hint: 'Pipeline inteiro no automático.' },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cardName(card) {
  return card?.entity?.profile?.name || 'Lead sem nome';
}

function cardSources(card) {
  const refs = card?.entity?.sourceRefs || {};
  return [
    refs.mapsIds?.length ? 'Maps' : null,
    refs.scoringIds?.length ? 'Scoring' : null,
    refs.campaignRefs?.length ? 'Campanha' : null,
  ].filter(Boolean);
}

function hasNoValueOperator(operator) {
  return operator === 'isTrue' || operator === 'isFalse';
}

function fieldOption(value) {
  return FIELD_OPTIONS.find((option) => option.value === value) || FIELD_OPTIONS[0];
}

function conditionText(condition) {
  const field = fieldOption(condition?.field);
  const value = String(condition?.value ?? '');
  if (condition?.operator === 'isTrue') return `tem ${field.short}`;
  if (condition?.operator === 'isFalse') return `sem ${field.short}`;
  if (condition?.operator === 'gte') return `${field.short} ≥ ${value || '0'}`;
  if (condition?.operator === 'lte') return `${field.short} ≤ ${value || '0'}`;
  if (condition?.operator === 'equals') return `${field.short} = ${value || '—'}`;
  if (condition?.operator === 'contains') return `${field.short} contém “${value || '—'}”`;
  return `${field.short} em “${value || '—'}”`;
}

function triggerLabel(value) {
  return TRIGGER_OPTIONS.find((option) => option.value === value)?.label || 'Ao sincronizar';
}

function relativeTime(timestamp) {
  const diff = Date.now() - Number(timestamp || 0);
  if (!Number.isFinite(diff) || diff < 0) return 'agora';
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function eventText(event, columns) {
  const columnName = columns.find((column) => column.id === event?.columnId)?.name;
  if (event?.type === 'leads_synced') return `${event.count || 0} lead(s) sincronizados de ${event.source || 'fonte'}${event.removed ? ` · ${event.removed} removido(s)` : ''}`;
  if (event?.type === 'rules_applied') return `${event.moved || 0} card(s) movidos pelas regras`;
  if (event?.type === 'card_moved') return `Card movido ${event.manual ? 'manualmente' : 'pela automação'}${columnName ? ` para ${columnName}` : ''}`;
  if (event?.type === 'board_configured') return `Kanban configurado: ${event.columns || 0} etapas, ${event.rules || 0} regras`;
  if (event?.type === 'automation_resumed') return 'Automação retomada para um lead';
  if (event?.type === 'deal_recorded') return event.outcome === 'won' ? `Venda registrada · ${formatCurrency(event.value)}` : event.outcome === 'lost' ? 'Negócio marcado como recusado' : 'Negócio reaberto';
  if (event?.type === 'board_reset') return 'Base e cards do Kanban limpos';
  return event?.type || 'Atividade';
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(value) {
  const date = new Date(Number(value) || value || NaN);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : 'Ainda não registrado';
}

function toDateTimeLocal(value) {
  const date = new Date(Number(value) || value || NaN);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function parseCurrency(value) {
  const raw = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100) / 100) : 0;
}

function phoneDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function ManualLeadModal({ columns, chats, onClose, onSave, busy }) {
  const [source, setSource] = useState('manual');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [chatJid, setChatJid] = useState('');
  const [columnId, setColumnId] = useState(columns[0]?.id || '');
  const [dealValue, setDealValue] = useState('');
  const [error, setError] = useState('');
  const selectedChat = chats.find((chat) => chat.jid === chatJid) || null;
  const selectedColumn = columns.find((column) => column.id === columnId) || columns[0] || null;

  const submit = (event) => {
    event.preventDefault();
    if (source === 'whatsapp' && !selectedChat) {
      setError('Escolha uma conversa do WhatsApp para continuar.');
      return;
    }
    const selectedPhone = source === 'whatsapp'
      ? selectedChat?.phone || selectedChat?.jid?.replace(/@.*$/, '') || ''
      : phone;
    const selectedName = source === 'whatsapp' ? selectedChat?.name || '' : name;
    const normalizedPhone = phoneDigits(selectedPhone);
    if (normalizedPhone.length < 8) {
      setError('Digite um telefone válido com pelo menos 8 números.');
      return;
    }
    setError('');
    onSave({
      name: selectedName.trim() || normalizedPhone,
      phone: normalizedPhone,
      columnId: selectedColumn?.id || columns[0]?.id,
      dealOutcome: selectedColumn?.dealOutcome || null,
      dealValue: parseCurrency(dealValue),
    });
  };

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal-content kanban-manual-lead-modal" role="dialog" aria-modal="true" aria-labelledby="kanban-manual-lead-title" onSubmit={submit}>
        <header className="kanban-modal-head">
          <div><span className="eyebrow">Novo card</span><h2 id="kanban-manual-lead-title">Adicionar lead manualmente</h2><p>Cadastre um contato mesmo que ele ainda não esteja na base.</p></div>
          <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="kanban-settings-body kanban-manual-lead-body">
          <div className="kanban-manual-source" role="group" aria-label="Origem do telefone">
            <button type="button" className={source === 'manual' ? 'active' : ''} onClick={() => setSource('manual')}><Phone size={14} /> Digitar telefone</button>
            <button type="button" className={source === 'whatsapp' ? 'active' : ''} onClick={() => setSource('whatsapp')}><MessageCircle size={14} /> Escolher conversa</button>
          </div>
           {source === 'whatsapp' ? (
             <label className="field"><span>Conversa do WhatsApp</span><select value={chatJid} onChange={(event) => setChatJid(event.target.value)} required={chats.length > 0}>
               <option value="">Selecione uma conversa</option>
               {chats.map((chat) => <option key={chat.jid} value={chat.jid}>{chat.name || chat.phone || chat.jid} {chat.phone ? `· ${chat.phone}` : ''}</option>)}
             </select></label>
           ) : (
             <div className="kanban-manual-lead-grid">
               <label className="field"><span>Nome do lead</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Clínica Central" /></label>
               <label className="field"><span>Telefone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Ex.: (21) 99999-0000" inputMode="tel" /></label>
             </div>
           )}
           <div className="kanban-manual-lead-grid">
             <label className="field"><span>Etapa inicial</span><select value={columnId} onChange={(event) => setColumnId(event.target.value)}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
             {source === 'manual' && selectedColumn?.dealOutcome ? <label className="field"><span>Valor do negócio (opcional)</span><input value={dealValue} onChange={(event) => setDealValue(event.target.value)} placeholder="$$$" inputMode="decimal" /></label> : <div />}
           </div>
           {source === 'whatsapp' && !chats.length ? <p className="kanban-manual-empty">Nenhuma conversa disponível. Volte para “Digitar telefone” para continuar.</p> : null}
           {error ? <p className="kanban-deal-error" role="alert">{error}</p> : null}
         </div>
         <footer className="kanban-modal-foot"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={busy || (source === 'whatsapp' && !selectedChat)}>{busy ? 'Adicionando…' : 'Adicionar ao Kanban'}</button></footer>
       </form>
     </div>
  );
}

function pickColumn(columns, names) {
  const folded = names.map((name) => name.toLocaleLowerCase('pt-BR'));
  return columns.find((column) => folded.includes(String(column.name || '').toLocaleLowerCase('pt-BR')))
    || columns.find((column) => folded.some((name) => String(column.name || '').toLocaleLowerCase('pt-BR').includes(name)))
    || columns.filter((column) => !column.terminal)[1]
    || columns[0];
}

function recipeRules(columns, thresholds) {
  const targets = {
    qualified: pickColumn(columns, ['qualificad', 'proposta', 'em contato']),
    proposal: pickColumn(columns, ['proposta', 'qualificad', 'enviados']),
    sent: pickColumn(columns, ['enviad']),
    contacted: pickColumn(columns, ['contato', 'respondeu']),
    lost: pickColumn(columns, ['perdid', 'final']),
    fresh: columns[0],
  };
  return [
    {
      id: 'hot-lead',
      icon: Flame,
      label: 'Lead quente',
      hint: `Score ≥ ${thresholds.highFrom} entra qualificado`,
      trigger: 'scoring.completed',
      when: [{ field: 'score', operator: 'gte', value: String(thresholds.highFrom) }],
      columnId: targets.qualified?.id,
    },
    {
      id: 'no-website',
      icon: Globe,
      label: 'Sem site',
      hint: 'Empresa sem site vira proposta',
      trigger: 'scoring.completed',
      when: [{ field: 'hasWebsite', operator: 'isFalse', value: '' }],
      columnId: targets.proposal?.id,
    },
    {
      id: 'imported-phone',
      icon: Phone,
      label: 'Importado com telefone',
      hint: 'Lead novo com telefone entra no funil',
      trigger: 'lead.imported',
      when: [{ field: 'hasPhone', operator: 'isTrue', value: '' }],
      columnId: targets.fresh?.id,
    },
    {
      id: 'campaign-sent',
      icon: ArrowRight,
      label: 'Campanha enviada',
      hint: 'Sai de Novos quando a mensagem é enviada',
      trigger: 'campaign.sent',
      when: [],
      columnId: targets.sent?.id,
    },
    {
      id: 'campaign-replied',
      icon: Zap,
      label: 'Respondeu',
      hint: 'Resposta puxa o lead para contato',
      trigger: 'campaign.replied',
      when: [],
      columnId: targets.contacted?.id,
    },
    {
      id: 'cold-lead',
      icon: Ban,
      label: 'Score baixo',
      hint: `Score < ${thresholds.ignoreBelow} vai para Perdidos`,
      trigger: 'scoring.completed',
      when: [{ field: 'score', operator: 'lte', value: String(Math.max(0, thresholds.ignoreBelow - 1)) }],
      columnId: targets.lost?.id,
    },
  ];
}

function newRule(columns, thresholds) {
  return {
    id: `rule-${Date.now()}`,
    enabled: true,
    priority: 10,
    trigger: 'scoring.completed',
    match: 'all',
    when: [{ field: 'score', operator: 'gte', value: String(thresholds?.highFrom ?? DEFAULT_SCORE_THRESHOLDS.highFrom) }],
    action: { type: 'move', columnId: columns[0]?.id || 'new' },
    problem: null,
  };
}

function newColumn(index) {
  const palette = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6'];
  return {
    id: `stage-${Date.now()}-${index + 1}`,
    name: 'Nova etapa',
    color: palette[index % palette.length],
    terminal: false,
    wipLimit: null,
  };
}

function RuleEditor({ rule, columns, disabled, onChange, onRemove }) {
  const updateRule = (patch) => onChange({ ...rule, ...patch, problem: null });
  const updateCondition = (index, patch) => updateRule({
    when: rule.when.map((condition, itemIndex) => itemIndex === index ? { ...condition, ...patch } : condition),
  });
  const addCondition = () => {
    if (rule.when.length >= MAX_CONDITIONS) return;
    updateRule({ when: [...rule.when, { field: 'score', operator: 'gte', value: '75' }] });
  };
  return (
    <section className="kanban-rule-editor">
      <div className="kanban-rule-head">
        <label className="kanban-switch">
          <input type="checkbox" checked={rule.enabled !== false} onChange={(event) => updateRule({ enabled: event.target.checked })} />
          <span>{rule.enabled === false ? 'Regra pausada' : 'Regra ativa'}</span>
        </label>
        <button type="button" className="icon-btn" aria-label="Remover regra" title="Remover regra" onClick={onRemove}><Trash2 size={15} /></button>
      </div>
      <div className="kanban-rule-grid">
        <label>
          Quando
          <select value={rule.trigger} onChange={(event) => updateRule({ trigger: event.target.value })}>
            {TRIGGER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Combinar
          <select value={rule.match || 'all'} onChange={(event) => updateRule({ match: event.target.value })}>
            <option value="all">todas as condições</option>
            <option value="any">qualquer condição</option>
          </select>
        </label>
        <label>
          Prioridade
          <input type="number" min="0" max="999" value={rule.priority ?? 10} onChange={(event) => updateRule({ priority: Number(event.target.value) || 0 })} />
        </label>
        <label>
          Mover para
          <select value={rule.action?.columnId || ''} onChange={(event) => updateRule({ action: { type: 'move', columnId: event.target.value } })}>
            <option value="">Escolha a etapa…</option>
            {columns.map((column) => <option key={column.id} value={column.id}>{column.name || 'Etapa'}</option>)}
          </select>
        </label>
      </div>
      <div className="kanban-rule-conditions">
        {rule.when.map((condition, index) => (
          <div className="kanban-condition" key={`${rule.id}-${index}`}>
            <select value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value })} aria-label="Campo da condição">
              {FIELD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={condition.operator} onChange={(event) => updateCondition(index, { operator: event.target.value })} aria-label="Operador da condição">
              {OPERATOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {hasNoValueOperator(condition.operator) ? <span className="kanban-condition-static">sem valor</span> : (
              <input value={condition.value ?? ''} onChange={(event) => updateCondition(index, { value: event.target.value })} placeholder="Valor" aria-label="Valor da condição" />
            )}
            <button type="button" className="icon-btn" disabled={rule.when.length <= 1} aria-label="Remover condição" onClick={() => updateRule({ when: rule.when.filter((_, itemIndex) => itemIndex !== index) })}><X size={14} /></button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-compact"
          disabled={disabled || rule.when.length >= MAX_CONDITIONS}
          onClick={addCondition}
        >
          <Plus size={14} /> {rule.when.length >= MAX_CONDITIONS ? `Máximo de ${MAX_CONDITIONS} condições` : 'Condição'}
        </button>
      </div>
    </section>
  );
}

function KanbanSettingsModal({ board, thresholds, onClose, onSave, saving }) {
  const [draft, setDraft] = useState(() => clone(board));
  const [formError, setFormError] = useState('');
  const [tab, setTab] = useState('rules');
  const [expandedRule, setExpandedRule] = useState('');
  const [confirmForce, setConfirmForce] = useState(false);

  const updateColumn = (index, patch) => {
    setDraft((current) => ({
      ...current,
      columns: current.columns.map((column, itemIndex) => itemIndex === index ? { ...column, ...patch } : column),
    }));
  };
  const moveColumn = (index, direction) => {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.columns.length) return current;
      const columns = [...current.columns];
      [columns[index], columns[target]] = [columns[target], columns[index]];
      return { ...current, columns };
    });
  };
  const removeColumn = (index) => {
    if (draft.columns.length <= 1) return;
    const target = draft.columns[index];
    const affected = draft.rules.filter((rule) => rule.action?.columnId === target.id);
    setFormError(affected.length
      ? `“${target.name}” foi removida. ${affected.length} regra(s) ficarão pausadas até você escolher a nova etapa.`
      : '');
    setDraft((current) => ({
      ...current,
      columns: current.columns.filter((_, itemIndex) => itemIndex !== index),
      rules: current.rules.map((rule) => rule.action?.columnId === target.id
        ? { ...rule, enabled: false, action: { type: 'move', columnId: '' }, problem: 'missing_column' }
        : rule),
    }));
  };
  const updateRule = (index, rule) => setDraft((current) => ({
    ...current,
    rules: current.rules.map((item, itemIndex) => itemIndex === index ? rule : item),
  }));
  const addRule = () => {
    if (draft.rules.length >= MAX_RULES) {
      setFormError(`Limite de ${MAX_RULES} regras atingido.`);
      return;
    }
    const rule = newRule(draft.columns, thresholds);
    setFormError('');
    setDraft((current) => ({ ...current, rules: [...current.rules, rule] }));
    setExpandedRule(rule.id);
  };
  const applyRecipe = (recipe) => {
    if (draft.rules.length >= MAX_RULES) {
      setFormError(`Limite de ${MAX_RULES} regras atingido.`);
      return;
    }
    if (!recipe.columnId) {
      setFormError('Crie uma etapa antes de usar este atalho.');
      return;
    }
    const rule = {
      ...newRule(draft.columns, thresholds),
      id: `${recipe.id}-${Date.now()}`,
      trigger: recipe.trigger,
      when: recipe.when.map((condition) => ({ ...condition })),
      action: { type: 'move', columnId: recipe.columnId },
    };
    setFormError('');
    setDraft((current) => ({ ...current, rules: [...current.rules, rule] }));
    setExpandedRule(rule.id);
  };
  const setSimpleRule = (definition, columnId) => {
    setDraft((current) => {
      const index = current.rules.findIndex((rule) => rule.trigger === definition.trigger && (rule.when || []).length === 0);
      if (!columnId) {
        return index < 0 ? current : { ...current, rules: current.rules.filter((_, itemIndex) => itemIndex !== index) };
      }
      if (index >= 0) {
        return {
          ...current,
          rules: current.rules.map((rule, itemIndex) => itemIndex === index
            ? { ...rule, enabled: true, action: { type: 'move', columnId }, problem: null }
            : rule),
        };
      }
      if (current.rules.length >= MAX_RULES) {
        setFormError(`Limite de ${MAX_RULES} regras atingido.`);
        return current;
      }
      const rule = {
        ...newRule(current.columns, thresholds),
        id: `simple-${definition.trigger.replace(/\W+/g, '-')}-${Date.now()}`,
        trigger: definition.trigger,
        priority: SIMPLE_RULES.findIndex((item) => item.trigger === definition.trigger) + 1,
        when: [],
        action: { type: 'move', columnId },
      };
      setFormError('');
      return { ...current, rules: [...current.rules, rule] };
    });
  };
  const save = async () => {
    if (draft.columns.some((column) => !String(column.name || '').trim())) {
      setFormError('Dê um nome para cada etapa antes de salvar.');
      return;
    }
    if (draft.rules.some((rule) => rule.enabled !== false && !rule.action?.columnId)) {
      setFormError('Toda regra ativa precisa de uma etapa de destino.');
      return;
    }
    setFormError('');
    await onSave(draft);
  };

  const activeRules = draft.rules.filter((rule) => rule.enabled !== false && rule.action?.columnId);
  const triggers = new Set(activeRules.map((rule) => rule.trigger));
  const xp = activeRules.length * 12
    + triggers.size * 10
    + draft.columns.filter((column) => column.terminal).length * 8
    + draft.columns.filter((column) => column.wipLimit).length * 5;
  const levelIndex = LEVELS.reduce((acc, level, index) => (xp >= level.min ? index : acc), 0);
  const level = LEVELS[levelIndex];
  const nextLevel = LEVELS[levelIndex + 1] || null;
  const levelProgress = nextLevel
    ? Math.max(4, Math.min(100, Math.round(((xp - level.min) / (nextLevel.min - level.min)) * 100)))
    : 100;
  const badges = [
    { id: 'first', label: 'Primeira regra', hint: 'Ative 1 automação', icon: Zap, done: activeRules.length >= 1 },
    { id: 'score', label: 'Score no fluxo', hint: 'Use a condição score', icon: Target, done: activeRules.some((rule) => rule.when.some((condition) => condition.field === 'score')) },
    { id: 'multi', label: 'Multi-fonte', hint: 'Importação + campanha', icon: RefreshCw, done: triggers.has('lead.imported') && (triggers.has('campaign.sent') || triggers.has('campaign.replied')) },
    { id: 'terminal', label: 'Etapa final', hint: 'Marque uma etapa como Final', icon: Trophy, done: draft.columns.some((column) => column.terminal) },
    { id: 'wip', label: 'Foco no WIP', hint: 'Defina um limite de cards', icon: BriefcaseBusiness, done: draft.columns.some((column) => column.wipLimit) },
    { id: 'five', label: 'Piloto automático', hint: '5 automações ativas', icon: Sparkles, done: activeRules.length >= 5 },
  ];
  const brokenRules = draft.rules.filter((rule) => rule.problem === 'missing_column').length;

  return (
    <div className="overlay on kanban-modal-overlay" role="presentation" onClick={onClose}>
      <section className="kanban-settings-modal" role="dialog" aria-modal="true" aria-labelledby="kanban-settings-title" onClick={(event) => event.stopPropagation()}>
        <header className="kanban-modal-head">
          <div>
            <span className="eyebrow">Fluxo comercial</span>
            <h2 id="kanban-settings-title">Configurar Kanban</h2>
            <p>Etapas e automações em linguagem simples. Movimentos manuais nunca são sobrescritos sem você mandar.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Fechar configuração" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="kanban-tabs" role="tablist" aria-label="Seções da configuração">
          <button type="button" role="tab" aria-selected={tab === 'rules'} className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>
            <Zap size={14} /> Automações <b>{activeRules.length}</b>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'flow'} className={tab === 'flow' ? 'on' : ''} onClick={() => setTab('flow')}>
            <BriefcaseBusiness size={14} /> Etapas <b>{draft.columns.length}</b>
          </button>
        </div>

        <div className="kanban-settings-body">
          {formError ? <div className="kanban-feedback error" role="alert"><CircleAlert size={15} /> {formError}</div> : null}
          {brokenRules > 0 ? (
            <div className="kanban-feedback error" role="status">
              <CircleAlert size={15} /> {brokenRules} regra(s) pausadas: a etapa de destino foi removida. Escolha uma nova etapa.
            </div>
          ) : null}

          {tab === 'rules' ? (
            <>
              <section className="kanban-simple-builder" aria-labelledby="kanban-simple-title">
                <div className="kanban-section-title">
                  <div>
                    <h3 id="kanban-simple-title">Automação rápida</h3>
                    <p>Escolha somente para onde o lead vai. “Não mover” desliga essa ação.</p>
                  </div>
                  <span className="kanban-easy-tag">modo fácil</span>
                </div>
                <div className="kanban-simple-list">
                  {SIMPLE_RULES.map((definition) => {
                    const Icon = definition.icon;
                    const rule = draft.rules.find((item) => item.trigger === definition.trigger && (item.when || []).length === 0);
                    return (
                      <label className="kanban-simple-row" key={definition.trigger}>
                        <span className="kanban-simple-icon"><Icon size={16} /></span>
                        <span className="kanban-simple-copy"><b>{definition.when}</b><small>{definition.hint}</small></span>
                        <ArrowRight size={14} aria-hidden="true" />
                        <select
                          value={rule?.enabled !== false ? rule?.action?.columnId || '' : ''}
                          onChange={(event) => setSimpleRule(definition, event.target.value)}
                          aria-label={`${definition.when}: mover para`}
                        >
                          <option value="">Não mover</option>
                          {draft.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </section>

              <section className="kanban-level-card">
                <div className="kanban-level-head">
                  <div>
                    <span className="eyebrow">Nível de automação</span>
                    <h3>{level.title}</h3>
                    <p>{level.hint}</p>
                  </div>
                  <div className="kanban-level-xp"><Trophy size={16} /><b>{xp}</b><small>XP</small></div>
                </div>
                <div className="kanban-level-track" role="img" aria-label={`Progresso para o próximo nível: ${nextLevel ? `${levelProgress}%` : 'nível máximo'}`}>
                  <div className="kanban-level-fill" style={{ width: `${levelProgress}%` }} />
                </div>
                <div className="kanban-level-foot">
                  <span>{activeRules.length} regra(s) ativa(s)</span>
                  <span>{triggers.size} evento(s) coberto(s)</span>
                  <span>{nextLevel ? `${Math.max(0, nextLevel.min - xp)} XP para ${nextLevel.title}` : 'Nível máximo alcançado'}</span>
                </div>
                <div className="kanban-badges">
                  {badges.map((badge) => {
                    const Icon = badge.done ? badge.icon : Lock;
                    return (
                      <span key={badge.id} className={`kanban-badge ${badge.done ? 'done' : ''}`} title={badge.hint}>
                        <Icon size={13} /> {badge.label}
                      </span>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="kanban-section-title">
                  <div>
                    <h3>Atalhos com 1 clique</h3>
                    <p>Receitas prontas: clique para criar a automação e ajuste se quiser.</p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-compact" disabled={draft.rules.length >= MAX_RULES} onClick={addRule}><Plus size={14} /> Regra do zero</button>
                </div>
                <div className="kanban-recipes">
                  {recipeRules(draft.columns, thresholds).map((recipe) => {
                    const Icon = recipe.icon;
                    const already = draft.rules.some((rule) => rule.trigger === recipe.trigger
                      && rule.action?.columnId === recipe.columnId
                      && JSON.stringify(rule.when) === JSON.stringify(recipe.when));
                    return (
                      <button
                        key={recipe.id}
                        type="button"
                        className={`kanban-recipe ${already ? 'done' : ''}`}
                        onClick={() => applyRecipe(recipe)}
                        disabled={saving || already || draft.rules.length >= MAX_RULES}
                      >
                        <span className="kanban-recipe-icon"><Icon size={15} /></span>
                        <span className="kanban-recipe-text">
                          <b>{recipe.label}</b>
                          <small>{already ? 'já aplicada' : recipe.hint}</small>
                        </span>
                        {already ? <CheckCircle2 size={15} /> : <Plus size={15} />}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="kanban-section-title">
                  <div>
                    <h3>Suas automações</h3>
                    <p>Cada card mostra a leitura da regra. Use Editar para mudar condições e prioridade.</p>
                  </div>
                  <span className="kanban-limit-hint">{draft.rules.length}/{MAX_RULES}</span>
                </div>
                {draft.rules.length === 0 ? (
                  <div className="kanban-empty-rules">Nenhuma automação ainda. Leads novos entram em “{draft.columns[0]?.name || 'Novos'}” e ficam esperando você.</div>
                ) : (
                  <div className="kanban-rules-list">
                    {draft.rules.map((rule, index) => {
                      const target = draft.columns.find((column) => column.id === rule.action?.columnId);
                      const expanded = expandedRule === rule.id;
                      const broken = rule.problem === 'missing_column';
                      return (
                        <article key={rule.id} className={`kanban-rule-card ${rule.enabled === false ? 'off' : ''} ${broken ? 'broken' : ''}`}>
                          <div className="kanban-rule-summary">
                            <label className="kanban-switch" title={rule.enabled === false ? 'Ativar regra' : 'Pausar regra'}>
                              <input type="checkbox" checked={rule.enabled !== false} onChange={(event) => updateRule(index, { ...rule, enabled: event.target.checked, problem: event.target.checked ? null : rule.problem })} />
                              <span className="sr-only">Regra ativa</span>
                            </label>
                            <span className={`kanban-rule-dot ${broken ? 'broken' : ''}`} style={{ '--kanban-stage': target?.color || '#e5e5e5' }} />
                            <p>
                              <b>{triggerLabel(rule.trigger)}</b>
                              {rule.when.length ? <> · {(rule.when || []).map(conditionText).join(rule.match === 'any' ? ' ou ' : ' e ')}</> : ' · sempre'}
                              <ArrowRight size={13} /> <b>{target?.name || 'escolha a etapa'}</b>
                            </p>
                            <span className="kanban-rule-priority" title="Prioridade: menor número roda antes">P{rule.priority}</span>
                            <button type="button" className="icon-btn" aria-label={expanded ? 'Fechar edição' : 'Editar regra'} title="Editar" onClick={() => setExpandedRule(expanded ? '' : rule.id)}>
                              {expanded ? <ChevronUp size={15} /> : <Pencil size={15} />}
                            </button>
                            <button type="button" className="icon-btn" aria-label="Remover regra" title="Remover" onClick={() => setDraft((current) => ({ ...current, rules: current.rules.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={15} /></button>
                          </div>
                          {broken ? <p className="kanban-rule-warning">A etapa desta regra foi removida. Escolha o novo destino para reativar.</p> : null}
                          {expanded ? (
                            <RuleEditor
                              rule={rule}
                              columns={draft.columns}
                              disabled={rule.enabled === false}
                              onChange={(next) => updateRule(index, next)}
                              onRemove={() => setDraft((current) => ({ ...current, rules: current.rules.filter((_, itemIndex) => itemIndex !== index) }))}
                            />
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          ) : (
            <section>
              <div className="kanban-section-title">
                <div>
                  <h3>Etapas do funil</h3>
                  <p>Ordem, cor, limite de cards (WIP) e o que é ponto final do processo.</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  disabled={draft.columns.length >= MAX_COLUMNS}
                  onClick={() => setDraft((current) => ({ ...current, columns: [...current.columns, newColumn(current.columns.length)] }))}
                >
                  <Plus size={14} /> {draft.columns.length >= MAX_COLUMNS ? `Máximo de ${MAX_COLUMNS} etapas` : 'Etapa'}
                </button>
              </div>
              <div className="kanban-stage-settings">
                {draft.columns.map((column, index) => (
                  <div className="kanban-stage-row" key={column.id}>
                    <span className="kanban-stage-order">
                      <button type="button" className="icon-btn" aria-label={`Subir ${column.name || 'etapa'}`} disabled={index === 0} onClick={() => moveColumn(index, -1)}><ChevronUp size={14} /></button>
                      <button type="button" className="icon-btn" aria-label={`Descer ${column.name || 'etapa'}`} disabled={index === draft.columns.length - 1} onClick={() => moveColumn(index, 1)}><ChevronDown size={14} /></button>
                    </span>
                    <input type="color" value={column.color || '#10a37f'} onChange={(event) => updateColumn(index, { color: event.target.value })} aria-label={`Cor da etapa ${column.name || index + 1}`} />
                    <input value={column.name || ''} onChange={(event) => updateColumn(index, { name: event.target.value })} maxLength="60" aria-label={`Nome da etapa ${index + 1}`} />
                    <label className="kanban-checkbox" title="Etapa final: a automação não tira cards daqui"><input type="checkbox" checked={Boolean(column.terminal)} onChange={(event) => updateColumn(index, { terminal: event.target.checked })} /> Final</label>
                    <label className="kanban-wip">WIP <input type="number" min="1" max="999" value={column.wipLimit || ''} placeholder="—" onChange={(event) => updateColumn(index, { wipLimit: event.target.value ? Number(event.target.value) : null })} /></label>
                    <button type="button" className="icon-btn" disabled={draft.columns.length <= 1} aria-label={`Remover ${column.name || 'etapa'}`} onClick={() => removeColumn(index)}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="kanban-modal-foot">
          {confirmForce ? (
            <span className="kanban-confirm">
              <CircleAlert size={14} /> Mover também os cards manuais?
              <button type="button" className="btn btn-ghost btn-compact" onClick={() => setConfirmForce(false)}>Cancelar</button>
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => onSave(draft, { force: true })}>Mover tudo</button>
            </span>
          ) : <span />}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={saving}
            title="Salva e reaplica as regras em todos os cards"
            onClick={() => setConfirmForce(true)}
          >
            <RotateCcw size={14} /> Salvar e reaplicar
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar Kanban'}</button>
        </footer>
      </section>
    </div>
  );
}

function CardDetailsModal({ card, board, onClose, onMove, onRecordDeal, onResumeAutomation, onNavigate, busy, thresholds, initialOutcome }) {
  const profile = card.entity.profile || {};
  const band = scoreBand(profile.score, thresholds);
  const [dealDraft, setDealDraft] = useState({ outcome: card.dealStatus || 'open', value: card.dealValue ? String(card.dealValue) : '', note: card.dealNote || '', reminderAt: toDateTimeLocal(card.reminderAt), reminderNote: card.reminderNote || '' });
  const [dealError, setDealError] = useState('');
  useEffect(() => {
    setDealDraft({
      outcome: initialOutcome || card.dealStatus || 'open',
      value: card.dealValue ? Number(card.dealValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
      note: card.dealNote || '',
      reminderAt: toDateTimeLocal(card.reminderAt),
      reminderNote: card.reminderNote || '',
    });
    setDealError('');
  }, [card.entityKey, card.dealStatus, card.dealValue, card.dealNote, card.reminderAt, card.reminderNote, initialOutcome]);
  const saveDeal = async () => {
    const value = parseCurrency(dealDraft.value);
    if (dealDraft.outcome === 'won' && value <= 0) {
      setDealError('Informe o valor recebido para registrar a venda.');
      return;
    }
    setDealError('');
    await onRecordDeal(card, { ...dealDraft, value });
  };
  return (
    <div className="overlay on kanban-modal-overlay" role="presentation" onClick={onClose}>
      <section className="kanban-card-modal" role="dialog" aria-modal="true" aria-labelledby="kanban-card-title" onClick={(event) => event.stopPropagation()}>
        <header className="kanban-modal-head">
          <div>
            <span className="eyebrow">Lead no Kanban</span>
            <h2 id="kanban-card-title">{cardName(card)}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Fechar detalhes do lead" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="kanban-card-details">
          <div className="kanban-detail-grid">
            <span><Phone size={14} /> <span data-sensitive-phone="true">{profile.phone || 'Sem telefone'}</span></span>
            <span><Mail size={14} /> {profile.email || 'Sem e-mail'}</span>
            <span><MapPin size={14} /> {[profile.city, profile.state].filter(Boolean).join(' · ') || 'Localização não informada'}</span>
            <span><BriefcaseBusiness size={14} /> {profile.category || 'Sem categoria'}</span>
          </div>
          <div className="kanban-card-score">
            <span>Score</span>
            <strong>{Number(profile.score || 0)}</strong>
            <small>{band.label}{profile.priority ? ` · ${profile.priority}` : ''}</small>
          </div>
          <section className="kanban-timeline" aria-label="Linha do tempo do contato">
            <div className={card.messageSentAt ? 'done' : ''}><Send size={14} /><span><small>Mensagem recebida</small><b>{formatDateTime(card.messageSentAt)}</b></span></div>
            <div className={card.repliedAt ? 'done' : ''}><MessageCircle size={14} /><span><small>Resposta recebida</small><b>{formatDateTime(card.repliedAt)}</b></span></div>
          </section>
          <label className="field">
            <span>Mover para</span>
            <select value={card.columnId} disabled={busy} onChange={(event) => onMove(card, event.target.value)}>
              {board.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
            </select>
          </label>
          <section className="kanban-deal-box" aria-labelledby="kanban-deal-title">
            <div className="kanban-deal-head">
              <span className="kanban-simple-icon"><DollarSign size={16} /></span>
              <div><b id="kanban-deal-title">Resultado comercial</b><small>O valor vendido entra na Visão Geral.</small></div>
            </div>
            <div className="kanban-deal-grid">
              <label className="field">
                <span>Status</span>
                <select value={dealDraft.outcome} disabled={busy} onChange={(event) => setDealDraft((current) => ({ ...current, outcome: event.target.value }))}>
                  <option value="open">Em negociação</option>
                  <option value="won">Vendeu</option>
                  <option value="lost">Recusou</option>
                </select>
              </label>
              <label className="field">
                <span>Valor do negócio (R$)</span>
                <input inputMode="decimal" value={dealDraft.value} disabled={busy || dealDraft.outcome === 'lost'} placeholder="0,00" onChange={(event) => setDealDraft((current) => ({ ...current, value: event.target.value }))} />
              </label>
            </div>
            <label className="field">
              <span>Observação (opcional)</span>
              <input maxLength="200" value={dealDraft.note} disabled={busy} placeholder="Ex.: site institucional + manutenção" onChange={(event) => setDealDraft((current) => ({ ...current, note: event.target.value }))} />
            </label>
            {dealError ? <p className="kanban-deal-error" role="alert">{dealError}</p> : null}
          </section>
          <section className="kanban-reminder-box" aria-labelledby="kanban-reminder-title">
            <div className="kanban-deal-head">
              <span className="kanban-simple-icon"><Bell size={16} /></span>
              <div><b id="kanban-reminder-title">Lembrete</b><small>Aparece com um sino na Visão Geral.</small></div>
            </div>
            <div className="kanban-reminder-grid">
              <label className="field">
                <span>Data e hora</span>
                <input type="datetime-local" value={dealDraft.reminderAt} disabled={busy} onChange={(event) => setDealDraft((current) => ({ ...current, reminderAt: event.target.value }))} />
              </label>
              <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => setDealDraft((current) => ({ ...current, reminderAt: toDateTimeLocal(Date.now() + 7 * 86400000) }))}>+ 7 dias</button>
              {dealDraft.reminderAt ? <button type="button" className="btn btn-ghost btn-compact" disabled={busy} onClick={() => setDealDraft((current) => ({ ...current, reminderAt: '', reminderNote: '' }))}>Limpar</button> : null}
            </div>
            <label className="field">
              <span>Assunto (opcional)</span>
              <input maxLength="200" value={dealDraft.reminderNote} disabled={busy || !dealDraft.reminderAt} placeholder="Ex.: retornar sobre a proposta" onChange={(event) => setDealDraft((current) => ({ ...current, reminderNote: event.target.value }))} />
            </label>
          </section>
          <div className="kanban-source-line"><span>Fontes</span>{cardSources(card).map((source) => <b key={source}>{source}</b>)}</div>
          {card.manualOverride ? (
            <div className="kanban-override-note">
              <CircleAlert size={15} /> Movimento manual: automações estão pausadas para este lead.
              <button type="button" className="btn btn-ghost btn-compact" disabled={busy} onClick={() => onResumeAutomation(card.entityKey)}>Retomar automação</button>
            </div>
          ) : null}
        </div>
        <footer className="kanban-modal-foot">
          <button type="button" className="btn btn-secondary" onClick={() => onNavigate?.('base')}><ArrowRight size={14} /> Ver na base</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={saveDeal}>{busy ? 'Salvando…' : 'Salvar alterações'}</button>
        </footer>
      </section>
    </div>
  );
}

export default function KanbanBoard({ onNavigate, addLog }) {
  const [board, setBoard] = useState(null);
  const [thresholds, setThresholds] = useState(() => normalizeThresholds(DEFAULT_SCORE_THRESHOLDS));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [pendingOutcome, setPendingOutcome] = useState('');
  const [draggingKey, setDraggingKey] = useState(null);
  const [showActivity, setShowActivity] = useState(false);
  const [forcePrompt, setForcePrompt] = useState(null);
  const [manualLeadOpen, setManualLeadOpen] = useState(false);
  const [manualLeadChats, setManualLeadChats] = useState([]);

  const applyBoard = useCallback((result) => {
    if (!result?.success || !result.board) {
      throw new Error(result?.error || 'Não foi possível carregar o Kanban.');
    }
    setBoard(result.board);
    if (result.thresholds) setThresholds(normalizeThresholds(result.thresholds));
    return result.board;
  }, []);

  const loadBoard = useCallback(async ({ quiet = false } = {}) => {
    if (!window.kanbanAPI) {
      setError('Esta versão do aplicativo não possui o Kanban geral. Atualize o aplicativo.');
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      // Envia sempre, inclusive vazio: é assim que o quadro esquece os leads
      // que saíram da base.
      const mapsLeads = normalizeLeadCollection(readLocalArray('sigma_leads'));
      applyBoard(await window.kanbanAPI.syncMapsLeads(mapsLeads));
      applyBoard(await window.kanbanAPI.getBoard());
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Não foi possível sincronizar o Kanban.');
    } finally {
      setLoading(false);
    }
  }, [applyBoard]);

  useEffect(() => {
    loadBoard();
    const refresh = () => loadBoard({ quiet: true });
    window.addEventListener('sigma:leads-updated', refresh);
    return () => window.removeEventListener('sigma:leads-updated', refresh);
  }, [loadBoard]);

  const columns = board?.board?.columns || [];
  const stats = board?.stats || {};

  const cards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return (board?.cards || []).filter((card) => {
      const profile = card.entity?.profile || {};
      if (filter === 'high-score' && Number(profile.score || 0) < thresholds.highFrom) return false;
      if (filter === 'phone' && !profile.phone) return false;
      if (filter === 'manual' && !card.manualOverride) return false;
      if (!needle) return true;
      return `${profile.name || ''} ${profile.category || ''} ${profile.city || ''} ${profile.phone || ''}`.toLocaleLowerCase('pt-BR').includes(needle);
    });
  }, [board, filter, query, thresholds.highFrom]);

  const moveCard = async (card, toColumnId) => {
    if (!window.kanbanAPI || card.columnId === toColumnId) return;
    const target = board?.board?.columns?.find((column) => column.id === toColumnId);
    if (target?.dealOutcome && card.dealStatus !== target.dealOutcome) {
      setSelectedCard(card);
      setPendingOutcome(target.dealOutcome);
      setNotice(target.dealOutcome === 'won'
        ? 'Informe o valor para concluir a venda e mover o card.'
        : 'Confirme o negócio recusado para mover o card.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = applyBoard(await window.kanbanAPI.moveCard({
        entityKey: card.entityKey,
        toColumnId,
        expectedRevision: card.revision,
        manual: true,
      }));
      const stage = next.board.columns.find((column) => column.id === toColumnId);
      setNotice(`${cardName(card)} movido para ${stage?.name || 'a etapa selecionada'}. Automações pausadas para este lead.`);
      addLog?.(`[KANBAN] ${cardName(card)} movido para ${stage?.name || toColumnId}.`);
      setSelectedCard((current) => current?.entityKey === card.entityKey ? next.cards.find((item) => item.entityKey === card.entityKey) || null : current);
    } catch (moveError) {
      setError(moveError.message || 'Não foi possível mover o card.');
    } finally {
      setBusy(false);
      setDraggingKey(null);
    }
  };

  const recordDeal = async (card, deal) => {
    setBusy(true);
    setError('');
    try {
      const next = applyBoard(await window.kanbanAPI.recordDeal({
        entityKey: card.entityKey,
        outcome: deal.outcome,
        value: deal.value,
        note: deal.note,
        reminderAt: deal.reminderAt,
        reminderNote: deal.reminderNote,
      }));
      const updated = next.cards.find((item) => item.entityKey === card.entityKey) || null;
      setSelectedCard(updated);
      setPendingOutcome('');
      setNotice(deal.outcome === 'won'
        ? `Venda registrada: ${formatCurrency(deal.value)}.`
        : deal.outcome === 'lost' ? 'Negócio marcado como recusado.' : 'Negócio reaberto.');
      window.dispatchEvent(new CustomEvent('sigma:deal-updated', { detail: { stats: next.stats } }));
    } catch (dealSaveError) {
      setError(dealSaveError.message || 'Não foi possível salvar o negócio.');
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async (draft, options = {}) => {
    setBusy(true);
    setError('');
    try {
      applyBoard(await window.kanbanAPI.saveConfig(draft, board.revision));
      setSettingsOpen(false);
      const paused = draft.rules.filter((rule) => !rule.action?.columnId).length;
      setNotice(paused
        ? `Kanban salvo. ${paused} regra(s) ficaram pausadas até escolher a nova etapa.`
        : 'Kanban salvo.');
      if (options.force) await applyRules({ force: true });
    } catch (saveError) {
      setError(saveError.message || 'Não foi possível salvar a configuração.');
    } finally {
      setBusy(false);
    }
  };

  const applyRules = async ({ force = false } = {}) => {
    if (!window.kanbanAPI) return;
    setBusy(true);
    setError('');
    setForcePrompt(null);
    try {
      const result = await window.kanbanAPI.applyRules(force);
      if (!result?.success || !result.board) throw new Error(result?.error || 'Não foi possível reaplicar as regras.');
      setBoard(result.board);
      if (result.moved) {
        setNotice(`${result.moved} card(s) atualizado(s) pelas regras.`);
      } else if (result.blockedByWip) {
        setNotice(`${result.blockedByWip} card(s) não couberam: a etapa de destino atingiu o limite de cards.`);
      } else {
        setNotice('Nenhum card precisou ser movido pelas regras.');
      }
      if (result.preservedManual) setForcePrompt({ manual: result.preservedManual, terminal: result.preservedTerminal || 0 });
      addLog?.(`[KANBAN] Regras reaplicadas: ${result.moved} movimento(s).`);
    } catch (applyError) {
      setError(applyError.message || 'Não foi possível reaplicar as regras.');
    } finally {
      setBusy(false);
    }
  };

  const resumeAutomation = async (entityKey) => {
    setBusy(true);
    try {
      const next = applyBoard(await window.kanbanAPI.resumeAutomation(entityKey));
      const card = next.cards.find((item) => item.entityKey === entityKey) || null;
      setSelectedCard(card);
      const stage = next.board.columns.find((column) => column.id === card?.columnId);
      setNotice(card?.manualOverride === false
        ? `Automações reativadas${stage ? ` — lead agora em ${stage.name}` : ''}.`
        : 'Automações reativadas para este lead.');
    } catch (resumeError) {
      setError(resumeError.message || 'Não foi possível reativar as automações.');
    } finally {
      setBusy(false);
    }
  };

  const openManualLead = async () => {
    setManualLeadOpen(true);
    setManualLeadChats([]);
    try {
      const result = await window.chatAPI?.getChats?.();
      const chats = Array.isArray(result?.chats) ? result.chats : Array.isArray(result) ? result : [];
      setManualLeadChats(chats.filter((chat) => !chat?.isGroup && (chat?.phone || chat?.jid)));
    } catch (chatError) {
      // O telefone digitado continua disponível mesmo sem uma sessão WhatsApp ativa.
      setManualLeadChats([]);
    }
  };

  const addManualLead = async ({ name, phone, columnId, dealOutcome, dealValue }) => {
    const normalizedPhone = phoneDigits(phone);
    setBusy(true);
    setError('');
    try {
      const currentLeads = normalizeLeadCollection(readLocalArray('sigma_leads'));
      const existingIndex = currentLeads.findIndex((lead) => phoneDigits(lead?.phone || lead?.tel || lead?.whatsapp) === normalizedPhone);
      const manualLead = {
        ...(existingIndex >= 0 ? currentLeads[existingIndex] : {}),
        id: existingIndex >= 0 ? currentLeads[existingIndex].id : `manual-${Date.now()}`,
        name: name || normalizedPhone,
        phone: normalizedPhone,
        category: existingIndex >= 0 ? currentLeads[existingIndex].category : 'Contato manual',
        source: 'manual',
        sourceType: 'manual',
        updatedAt: Date.now(),
      };
      const nextLeads = existingIndex >= 0
        ? currentLeads.map((lead, index) => index === existingIndex ? manualLead : lead)
        : [...currentLeads, manualLead];
      localStorage.setItem('sigma_leads', JSON.stringify(nextLeads));

      const synced = await window.kanbanAPI.syncMapsLeads(nextLeads);
      if (!synced?.success || !synced.board) throw new Error(synced?.error || 'Não foi possível adicionar o lead.');
      let nextBoard = synced.board;
      const card = nextBoard.cards.find((item) => phoneDigits(item.entity?.profile?.phone) === normalizedPhone);
      const target = nextBoard.board.columns.find((column) => column.id === columnId) || nextBoard.board.columns[0];
      if (card && target && card.columnId !== target.id) {
        const moved = dealOutcome
          ? await window.kanbanAPI.recordDeal({ entityKey: card.entityKey, outcome: dealOutcome, value: dealValue || 0 })
          : await window.kanbanAPI.moveCard({ entityKey: card.entityKey, toColumnId: target.id, expectedRevision: card.revision, manual: true });
        if (!moved?.success || !moved.board) throw new Error(moved?.error || 'Lead salvo, mas não foi possível escolher a etapa.');
        nextBoard = moved.board;
      }
      setBoard(nextBoard);
      setManualLeadOpen(false);
      setNotice(`${name || normalizedPhone} foi adicionado ao Kanban.`);
      window.dispatchEvent(new Event('sigma:leads-updated'));
    } catch (saveError) {
      setError(saveError.message || 'Não foi possível adicionar o lead.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !board) {
    return <section className="kanban-loading"><RefreshCw size={18} className="spin" /> Carregando Kanban…</section>;
  }

  return (
    <section className="kanban-view" data-od-id="global-kanban">
      <header className="kanban-topbar">
        <div>
          <span className="eyebrow">Pipeline comercial</span>
          <h1>Kanban</h1>
          <p>Todos os leads conectados às suas fontes, em um único funil.</p>
        </div>
        <div className="kanban-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => loadBoard()}><RefreshCw size={14} /> Atualizar</button>
          <button type="button" className="btn btn-secondary" disabled={busy} title="Movimentos, sincronizações, vendas e alterações do quadro" onClick={() => setShowActivity((value) => !value)}>
            <Activity size={14} /> Histórico{board?.events?.length ? ` (${board.events.length})` : ''}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => applyRules({})}><RotateCcw size={14} /> Reaplicar regras</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={openManualLead}><Plus size={15} /> Adicionar lead manualmente</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setSettingsOpen(true)}><Settings2 size={15} /> Configurar Kanban</button>
        </div>
      </header>

      <div className="kanban-toolbar">
        <label className="kanban-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa, cidade ou telefone…" aria-label="Buscar no Kanban" /></label>
        <label className="kanban-filter">
          <Filter size={14} />
          <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtrar cards">
            <option value="all">Todos os leads</option>
            <option value="high-score">Prioridade alta (score ≥ {thresholds.highFrom})</option>
            <option value="phone">Com telefone</option>
            <option value="manual">Movidos manualmente</option>
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        <span className="kanban-total">
          {cards.length} lead{cards.length === 1 ? '' : 's'} visível{cards.length === 1 ? '' : 'eis'}
          {stats.enabledRules ? ` · ${stats.enabledRules} regra(s) ativa(s)` : ' · sem automação'}
          {stats.wonValue > 0 ? ` · ${formatCurrency(stats.wonValue)} vendidos` : ''}
        </span>
      </div>

      {showActivity ? (
        <div className="kanban-activity">
          <div className="kanban-activity-head"><Activity size={14} /> <b>Histórico do Kanban</b><span>movimentos, sincronizações, vendas e configurações</span></div>
          {(board?.events || []).length === 0 ? (
            <p className="kanban-activity-empty">Nada registrado ainda. Movimentos, sincronizações e ajustes de regra aparecem aqui.</p>
          ) : (
            <ul>
              {(board?.events || []).slice(0, 12).map((event) => (
                <li key={event.id}>
                  <Clock size={12} />
                  <span>{eventText(event, columns)}</span>
                  <time>{relativeTime(event.at)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {error ? <div className="kanban-feedback error" role="alert"><CircleAlert size={16} /> {error}</div> : null}
      {notice ? (
        <div className="kanban-feedback success" role="status">
          <CheckCircle2 size={16} /> {notice}
          {forcePrompt ? (
            <button type="button" className="btn btn-ghost btn-compact" disabled={busy} onClick={() => applyRules({ force: true })}>
              Mover {forcePrompt.manual} card(s) manual(is) também
            </button>
          ) : null}
          <button type="button" aria-label="Fechar mensagem" onClick={() => { setNotice(''); setForcePrompt(null); }}><X size={14} /></button>
        </div>
      ) : null}

      <div className="kanban-columns" aria-label="Quadro Kanban">
        {columns.map((column) => {
          const stageCards = cards.filter((card) => card.columnId === column.id);
          const total = stats.byColumn?.[column.id] ?? stageCards.length;
          const overLimit = column.wipLimit ? total > column.wipLimit : false;
          return (
            <section
              key={column.id}
              className={`kanban-column ${overLimit ? 'over-wip' : ''}`}
              style={{ '--kanban-stage': column.color }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const card = cards.find((item) => item.entityKey === draggingKey);
                if (card) moveCard(card, column.id);
              }}
            >
              <header className="kanban-column-head">
                <div>
                  <span className="kanban-stage-dot" />
                  <h2>{column.name}</h2>
                  {column.terminal ? <small className="kanban-terminal-tag">final</small> : null}
                  {column.wipLimit ? <small className={overLimit ? 'kanban-wip-over' : ''}>WIP {total}/{column.wipLimit}</small> : null}
                </div>
                <b>{total}</b>
              </header>
              {column.wipLimit ? (
                <div className="kanban-wip-track" aria-hidden="true">
                  <div className="kanban-wip-fill" style={{ width: `${Math.min(100, Math.round((total / column.wipLimit) * 100))}%` }} />
                </div>
              ) : null}
              <div className="kanban-column-cards">
                {stageCards.length === 0 ? <div className="kanban-column-empty">Arraste um lead para esta etapa</div> : stageCards.map((card) => {
                  const profile = card.entity.profile || {};
                  const band = scoreBand(profile.score, thresholds);
                  return (
                    <article key={card.entityKey} className="kanban-card" draggable onDragStart={() => setDraggingKey(card.entityKey)} onDragEnd={() => setDraggingKey(null)} onClick={() => { setPendingOutcome(''); setSelectedCard(card); }}>
                      <div className="kanban-card-title">
                        <strong>{cardName(card)}</strong>
                        {card.manualOverride ? <span title="Movido manualmente">Manual</span> : null}
                      </div>
                      <div className="kanban-card-meta"><span>{profile.category || 'Sem categoria'}</span>{profile.city ? <span>{profile.city}</span> : null}</div>
                      <div className="kanban-card-bottom">
                        <span className={`kanban-score-band ${band.key}`} title={`Score ${Number(profile.score || 0)}`}>
                          <b>{Number(profile.score || 0)}</b> {band.label}
                        </span>
                        <span className="kanban-source-chips">{cardSources(card).map((source) => <i key={source}>{source}</i>)}</span>
                      </div>
                      <div className="kanban-card-signals">
                        {card.dealValue > 0 ? <div className="kanban-card-value"><DollarSign size={12} /> {card.dealStatus === 'open' ? 'Pendente · ' : ''}{formatCurrency(card.dealValue)}</div> : null}
                        {card.reminderAt ? <span className={`kanban-card-reminder ${Number(card.reminderAt) <= Date.now() ? 'due' : ''}`} title={`Lembrete: ${formatDateTime(card.reminderAt)}`}><Bell size={12} /></span> : null}
                      </div>
                      <label className="kanban-card-move" onClick={(event) => event.stopPropagation()}>
                        <span className="sr-only">Mover {cardName(card)} para</span>
                        <select value={card.columnId} disabled={busy} onChange={(event) => moveCard(card, event.target.value)}>{columns.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
                      </label>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {settingsOpen ? (
        <KanbanSettingsModal
          board={board.board}
          thresholds={thresholds}
          onClose={() => setSettingsOpen(false)}
          onSave={saveConfig}
          saving={busy}
        />
      ) : null}
      {manualLeadOpen ? <ManualLeadModal columns={columns} chats={manualLeadChats} onClose={() => setManualLeadOpen(false)} onSave={addManualLead} busy={busy} /> : null}
      {selectedCard ? (
        <CardDetailsModal
          card={selectedCard}
          board={board.board}
          thresholds={thresholds}
          onClose={() => setSelectedCard(null)}
          onMove={moveCard}
          onRecordDeal={recordDeal}
          onResumeAutomation={resumeAutomation}
          onNavigate={onNavigate}
          busy={busy}
          initialOutcome={pendingOutcome}
        />
      ) : null}
    </section>
  );
}
