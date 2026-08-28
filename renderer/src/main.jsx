import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../styles.css';

// Sigma Clarity — light-first. Sem tema salvo = light (não dark).
try {
  const saved = localStorage.getItem('sigma-theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  } else if (saved === 'auto') {
    const prefersDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }
} catch { try { document.documentElement.setAttribute('data-theme','light'); } catch{} }

const BUILD_STAMP = '2026-07-10-ui-fix-v9-sigma-app';

// Descarta erro antigo em localStorage (ex.: stack de index-7F4QwPd2 / ui-mrfg9u99)
try {
  const prev = localStorage.getItem('sigma_last_react_error') || '';
  if (/7F4QwPd2|ui-mrfg9u99|CaedZwU-|Dj5wJ2qb|currentTime|rad4ZrnG|BC5opcok/i.test(prev)) {
    localStorage.removeItem('sigma_last_react_error');
    localStorage.removeItem('sigma_last_react_error_at');
    console.info('[SIGMA] lixo de erro antigo removido do localStorage');
  }
} catch { /* ignore */ }

// Rede de segurança global: se QUALQUER código (velho em cache, lib, etc.)
// estourar currentTime em null, engole no capture phase ANTES do React.
if (typeof window !== 'undefined' && !window.__sigmaMediaGuard) {
  window.__sigmaMediaGuard = true;
  window.addEventListener(
    'error',
    (event) => {
      const msg = String(event?.message || event?.error?.message || '');
      const src = String(event?.filename || '');
      if (
        /currentTime|HTMLMediaElement|play\(\) request was interrupted|NotSupportedError|AbortError/i.test(msg)
        || /7F4QwPd2|ui-mrfg9u99|CaedZwU-|Dj5wJ2qb/i.test(src)
      ) {
        console.warn('[SIGMA] media/stale guard (capture):', msg || src);
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        return false;
      }
      return undefined;
    },
    true,
  );
  window.addEventListener(
    'unhandledrejection',
    (event) => {
      const msg = String(event?.reason?.message || event?.reason || '');
      if (/currentTime|HTMLMediaElement|play\(\) request was interrupted|NotSupportedError|AbortError/i.test(msg)) {
        console.warn('[SIGMA] media guard rejection:', msg);
        event.preventDefault?.();
      }
    },
    true,
  );
}

/** Sessão TEMP / bundle morto — precisa recarregar do dist */
function isStaleUiSession(text = '') {
  const hay = `${text}\n${typeof location !== 'undefined' ? location.href : ''}`;
  return /rad4ZrnG|BC5opcok|7F4QwPd2|ui-mrfg9u99|CaedZwU-|Dj5wJ2qb|monStats|sigma-ui-\d+|1783703330457/i.test(hay);
}

function forceFreshUi(reason) {
  console.warn('[SIGMA] forçando UI nova:', reason);
  try {
    localStorage.removeItem('sigma_last_react_error');
  } catch { /* ignore */ }
  if (window.electronAPI?.reloadUI) {
    return window.electronAPI.reloadUI().catch((e) => {
      console.error(e);
      try { window.electronAPI.winClose?.(); } catch { /* ignore */ }
    });
  }
  try { window.electronAPI?.winClose?.(); } catch { /* ignore */ }
  return Promise.resolve();
}

// Se a página ainda está em TEMP antigo, recarrega imediatamente (não espera crash)
if (typeof location !== 'undefined' && isStaleUiSession(location.href)) {
  forceFreshUi('href TEMP antigo');
}

/** Erros de mídia/player — logar, não matar a UI */
function isBenignMediaError(text = '') {
  return /currentTime|duration|play\(\)|pause\(\)|NotSupportedError|AbortError|The play\(\) request was interrupted|media was removed|Failed to load because no supported source|audio\/|HTMLMediaElement/i.test(
    String(text || ''),
  );
}

/** Decodifica erros minificados do React (ex.: #301) */
function decodeReactError(message) {
  const raw = String(message || '');
  const match = raw.match(/Minified React error #(\d+)/i) || raw.match(/invariant=(\d+)/i);
  const code = match ? match[1] : null;
  const map = {
    '31': 'Objeto inválido como filho do React (tentou renderizar um object no JSX).',
    '130': 'Elemento React inválido (tipo de componente undefined/null).',
    '152': 'Hooks chamados fora de um componente React.',
    '300': 'Renderizou undefined/null de forma inválida em lista.',
    '301': 'Too many re-renders — loop infinito de setState no render.',
    '310': 'Renderizou um objeto puro no JSX.',
    '418': 'Hydration mismatch (HTML do servidor ≠ cliente).',
    '423': 'Hydration mismatch (texto diferente).',
    '425': 'Hydration mismatch (atributos diferentes).',
  };
  if (code && map[code]) {
    return {
      code,
      human: map[code],
      full: `React #${code}: ${map[code]}\n\nOriginal: ${raw}`,
    };
  }
  if (/too many re-renders/i.test(raw)) {
    return { code: '301', human: map['301'], full: raw };
  }
  if (/objects are not valid as a react child/i.test(raw)) {
    return { code: '31', human: map['31'], full: raw };
  }
  if (/monStats is not defined/i.test(raw)) {
    return {
      code: 'monStats',
      human: 'Bug antigo do monitor (já corrigido). A janela está com JS velho — feche o app e rode npm start.',
      full: raw,
    };
  }
  if (isBenignMediaError(raw)) {
    return {
      code: 'media',
      human: 'Erro de áudio/mídia (não deve derrubar o app). Se a tela travou, recarregue a UI.',
      full: raw,
    };
  }
  return { code: null, human: null, full: raw || 'Erro desconhecido' };
}

function extractStack(error, extra = {}) {
  const parts = [];
  if (error && typeof error === 'object') {
    if (error.stack) parts.push(String(error.stack));
    if (error.cause?.stack) parts.push(`cause: ${String(error.cause.stack)}`);
    try {
      const keys = Object.getOwnPropertyNames(error);
      if (keys.length) {
        parts.push(`props: ${JSON.stringify(error, keys)}`);
      }
    } catch { /* ignore */ }
  }
  if (extra.filename) {
    parts.push(`at ${extra.filename}:${extra.lineno || 0}:${extra.colno || 0}`);
  }
  if (extra.eventMessage) {
    parts.push(`event.message: ${extra.eventMessage}`);
  }
  if (extra.raw) {
    parts.push(`raw: ${extra.raw}`);
  }
  // Stack sintético se o runtime não deu stack (comum em alguns erros DOM/Electron)
  if (!parts.length) {
    try {
      throw new Error('synthetic-stack');
    } catch (e) {
      if (e?.stack) parts.push(`synthetic:\n${String(e.stack)}`);
    }
  }
  return parts.join('\n') || '(stack vazio — erro de runtime no DOM / mídia)';
}

function formatErrorReport(error, errorInfo, extra = {}) {
  const msg =
    (error && typeof error === 'object' && error.message)
      ? String(error.message)
      : (extra.eventMessage || String(error || 'Erro desconhecido'));
  const decoded = decodeReactError(msg);
  const stack = extractStack(error, extra);
  const comp = errorInfo?.componentStack ? String(errorInfo.componentStack) : '';
  const file = extra.filename || extra.source || '';
  const line = extra.lineno || extra.line || '';
  const col = extra.colno || extra.col || '';
  return [
    '=== SIGMA REACT ERROR ===',
    `Build: ${BUILD_STAMP}`,
    `Hora: ${new Date().toISOString()}`,
    `URL: ${typeof location !== 'undefined' ? location.href : ''}`,
    `UserAgent: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
    file ? `Arquivo: ${file}${line ? `:${line}` : ''}${col ? `:${col}` : ''}` : 'Arquivo: (não informado pelo runtime)',
    decoded.code ? `Código: ${decoded.code}` : null,
    decoded.human ? `Significado: ${decoded.human}` : null,
    '',
    '--- Mensagem ---',
    decoded.full || msg || '(sem mensagem)',
    '',
    '--- Stack ---',
    stack,
    '',
    '--- Component stack ---',
    comp || '(sem component stack — erro fora do React, ex. window.onerror / mídia)',
    '',
    '--- Extra ---',
    extra.eventMessage ? `event.message: ${extra.eventMessage}` : null,
    error != null ? `typeof error: ${typeof error}` : 'error: null/undefined',
    error && typeof error === 'object' ? `error.name: ${error.name || '(sem name)'}` : null,
  ].filter((line) => line != null).join('\n');
}

function persistError(report) {
  try {
    localStorage.setItem('sigma_last_react_error', report);
    localStorage.setItem('sigma_last_react_error_at', String(Date.now()));
  } catch { /* ignore */ }
  try {
    document.title = 'ERRO React — Sigma';
  } catch { /* ignore */ }
  console.error(report);
}

window.addEventListener('error', (event) => {
  const eventMessage = String(event.message || event.error || 'Erro desconhecido');
  const err = event.error instanceof Error
    ? event.error
    : new Error(eventMessage);
  if (!err.stack && event.filename) {
    err.stack = `${err.message}\n    at ${event.filename}:${event.lineno || 0}:${event.colno || 0}`;
  }
  const report = formatErrorReport(err, null, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    eventMessage,
    raw: String(event.error ?? ''),
  });
  // Erros de áudio/DOM: loga e engole — NÃO derruba a sessão
  if (isBenignMediaError(report) || isBenignMediaError(eventMessage)) {
    console.warn('[SIGMA] media error engolido:', eventMessage);
    persistError(report);
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    return;
  }
  persistError(report);
  if (isStaleUiSession(report) || /monStats/i.test(report)) {
    forceFreshUi('window.error monStats/stale');
  }
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const eventMessage = reason instanceof Error
    ? reason.message
    : String(reason ?? 'unhandledrejection');
  const err = reason instanceof Error ? reason : new Error(eventMessage);
  const report = formatErrorReport(err, null, { eventMessage, raw: String(reason ?? '') });
  if (isBenignMediaError(report) || isBenignMediaError(eventMessage)) {
    console.warn('[SIGMA] media rejection engolida:', eventMessage);
    persistError(report);
    event.preventDefault?.();
    return;
  }
  persistError(report);
});

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, report: '', recovering: false };
    this.textareaRef = React.createRef();
    this._recoverStarted = false;
  }

  static getDerivedStateFromError(error) {
    const report = formatErrorReport(error, null);
    // currentTime / mídia: NÃO entra em tela de erro
    if (isBenignMediaError(report) || isBenignMediaError(error?.message)) {
      console.warn('[SIGMA] getDerivedStateFromError media soft-fail');
      return { hasError: false, report: '', recovering: false, mediaSoft: true };
    }
    return { hasError: true, report, mediaSoft: false };
  }

  componentDidCatch(error, errorInfo) {
    const report = formatErrorReport(error, errorInfo);
    if (isBenignMediaError(report) || isBenignMediaError(error?.message)) {
      console.warn('[SIGMA] ErrorBoundary engoliu erro de mídia — UI segue');
      persistError(report);
      this.setState({ hasError: false, report: '', recovering: false, mediaSoft: true });
      return;
    }
    persistError(report);
    this.setState({ report });
    this.maybeAutoRecover(report);
  }

  componentDidMount() {
    if (this.state.hasError) this.maybeAutoRecover(this.state.report);
  }

  componentDidUpdate(_, prev) {
    if (this.state.hasError && !prev.hasError && this.textareaRef.current) {
      try {
        this.textareaRef.current.focus();
        this.textareaRef.current.select();
      } catch { /* ignore */ }
    }
    if (this.state.hasError) this.maybeAutoRecover(this.state.report);
  }

  maybeAutoRecover(report) {
    if (this._recoverStarted) return;
    const stale = isStaleUiSession(report) || /monStats is not defined/i.test(report || '');
    const media = isBenignMediaError(report);
    if (!stale && !media) return;
    this._recoverStarted = true;
    this.setState({ recovering: true });
    if (media && !stale) {
      setTimeout(() => {
        this._recoverStarted = false;
        this.setState({ hasError: false, report: '', recovering: false });
      }, 80);
      return;
    }
    // auto: recarrega UI do dist (não fica preso no TEMP)
    setTimeout(() => forceFreshUi('error-boundary auto'), 300);
  }

  render() {
    if (this.state.hasError) {
      const report = this.state.report || 'Erro sem detalhes';
      const decoded = decodeReactError(report);
      const stale = isStaleUiSession(report) || /monStats/i.test(report);
      return (
        <div style={{
          padding: 20,
          color: '#e0e0e0',
          background: '#0a0a0a',
          height: '100vh',
          boxSizing: 'border-box',
          overflow: 'auto',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <h1 style={{ color: '#e17055', margin: '0 0 8px', fontSize: 22 }}>
            {stale ? 'Janela antiga detectada' : 'Algo deu errado no React'}
          </h1>

          {stale ? (
            <div style={{
              background: 'rgba(253,203,110,0.12)',
              border: '1px solid #fdcb6e',
              borderRadius: 10,
              padding: 14,
              marginBottom: 14,
              color: '#fdcb6e',
              lineHeight: 1.5,
              fontWeight: 600,
            }}>
              Este erro é de uma sessão TEMP velha (<code>rad4ZrnG</code> / <code>monStats</code>).
              <br />
              {this.state.recovering
                ? 'Recarregando UI nova automaticamente…'
                : 'Clique em “Recarregar UI nova” ou feche o app e rode npm start.'}
            </div>
          ) : (
            <p style={{ color: '#fdcb6e', marginTop: 0 }}>
              {decoded.human || 'Veja a mensagem abaixo.'}
            </p>
          )}

          <p style={{ color: '#888', fontSize: 12 }}>
            Build: <code>{BUILD_STAMP}</code>
          </p>

          <textarea
            ref={this.textareaRef}
            readOnly
            value={report}
            style={{
              width: '100%',
              height: '40vh',
              boxSizing: 'border-box',
              background: '#111',
              color: '#ffb4a2',
              border: '1px solid #e17055',
              borderRadius: 10,
              padding: 12,
              fontFamily: 'ui-monospace, Consolas, monospace',
              fontSize: 12,
              lineHeight: 1.45,
              resize: 'vertical',
            }}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              onClick={() => forceFreshUi('botao recarregar')}
              style={{
                padding: '12px 18px',
                borderRadius: 8,
                border: 'none',
                background: '#6c5ce7',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              Recarregar UI nova (obrigatório)
            </button>
            <button
              type="button"
              onClick={() => window.electronAPI?.winClose?.()}
              style={{
                padding: '12px 18px',
                borderRadius: 8,
                border: '1px solid #553',
                background: '#1a1010',
                color: '#e17055',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Fechar app
            </button>
            <button
              type="button"
              onClick={() => {
                try { navigator.clipboard?.writeText(report); } catch { /* ignore */ }
              }}
              style={{
                padding: '12px 18px',
                borderRadius: 8,
                border: '1px solid #333',
                background: '#111',
                color: '#ccc',
                cursor: 'pointer',
              }}
            >
              Copiar erro
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

console.info(`[SIGMA] UI build ${BUILD_STAMP}`);
console.info('[SIGMA] location', typeof location !== 'undefined' ? location.href : '');

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
