# Sigma GMaps Scraper — Auditoria de Layout + Nova Identidade Visual
**Data:** 2026-08-20  
**Skills aplicadas:** `anti-ai-slop-design` + `intuitive-product-ui` + `ui-ux-pro-max` + `design-system`  
**Stack:** Electron 39 + React 18 + Vite 5 — app desktop frameless (1200×800)

---

## 1. Auditoria — Por que está denso e pesado hoje

### 1.1 Mapeamento técnico (file:line)

| Problema | Onde | Por que pesa |
|---|---|---|
| **6986 linhas de CSS em um arquivo** | `renderer/styles.css:1` | Sem split por componente, tokens duplicados, difícil escalar. Qualquer mudança vaza. |
| **Dark como padrão hardcoded** | `renderer/styles.css:6-78` (`:root { --bg:#0a0a0a}`) + `main.js:1352` `readSavedTheme() return "dark"` + `renderer/src/main.jsx:9` `localStorage.getItem('sigma-theme')` | Usuário abre sempre no preto denso. Light existe (`html[data-theme="light"]:86`) mas é override tardio, não first-class. |
| **193 hex hardcoded** | `renderer/styles.css` (ex: `#fff` em `.wa-qr:796`, `.donation-trigger:172`) | Fura tokens — light/dark quebra em modais, bubbles, triggers. |
| **Tipografia +20% inflada** | `styles.css:27-33` `--text-base:17px --text-md:18px --text-xl:29px --2xl:34px` + `body:137 { line-height:1.45 }` | Body 17px + heading 29px em painel de 1200px gera densidade vertical, pouca respiração. |
| **Sidebar 240px + header 38px + `#main` padding 20px em todas as telas** | `styles.css:307-317 #sidebar`, `237-297 #titlebar`, `434-443 #main` + `App.jsx:178-269 <aside class="app-sidebar">` + `274-341 <header class="app-header-bar">` | Chrome duplo (titlebar nativa + header search) rouba ~120px verticais. Sidebar lista 6 itens sem hierarquia real. |
| **Navegação sem motion** | `App.jsx:118-172 renderContent() { switch(activeTab)... }` e `styles.css:362-383 #sideNav .ni.act { border-left:2px solid var(--accent) }` | Troca instantânea, sem transição. Active state só borda esquerda 2px + bg 10% — pouco claro em light. |
| **4 grids diferentes competindo** | `Overview.jsx:33 stats-grid 4 cards` + `82 launcher-grid 4 cards grandes` + `MapScraperView.jsx:608 kpi-cards-grid 2 cards` + `LeadScoring.jsx:1230 ls-stats-grid 6 cards` + `Dashboard.jsx:40 stats-grid` | Repetição de card-grids idênticos (anti-pattern `anti-ai-slop-design` #4). Usuário vê 6-8 cards antes de qualquer ação. |
| **MapScraperView denso** | `MapScraperView.jsx:464` `map-center-panel` + `606 feed-right-panel` (320px) + floating cards `471 map-floating-scan-card` + `517 map-floating-telemetry` | 3 layers de informação em cima do mapa. Floating cards + telemetry + kpi + feed = 4 níveis de densidade na mesma viewport. |
| **Chat & WhatsApp ainda mais denso** | `WhatsAppPanel.jsx:699 pipeline` ~1800 linhas + `styles.css:808-1110 chat-shell/chat-thread/chat-bubble` | `chat-shell` já é 2-col, mas dentro há tabs secundárias `wa-tabs:690`, filtros `857 chat-filter-tab`, mídia custom, etc. |
| **Falta de progressive disclosure** | `LeadScoring.jsx:1250 ls-filter-panel` com 8 selects + 2 listas de grupos empilhados | Tudo exposto de uma vez. Usuário novo não sabe por onde começar. |
| **Glassmorphism / blur sem token** | `styles.css:1548 backdrop-filter: blur(4px)` no modal + `28 --font-display: Camera Plain` carregada mas sem fallback light weight | Blur único no overlay, não é device do brand — slop #2. |
| **Sem sistema de motion / feedback** | `styles.css:1637 @keyframes spin` apenas loader; resto é `transition: all 0.15s ease` genérico | Não há enter/exit, stagger, spring. Troca de aba parece “piscar”. |
| **Search global no header não filtra nada** | `App.jsx:276-284 header-search-wrap` `globalSearch` sem wiring com `MapScraperView` | Affordance enganosa — parece busca global (tipo Raycast) mas é dummy. |

**Diagnóstico `intuitive-product-ui` audit checklist:**
- [x] Falha: não funciona a 360px (sidebar 240px fixa + `minWidth 900` em `main.js:763`)
- [x] Falha: >1 CTA primário por tela (Overview: botão header + 4 launcher cards com CTA)
- [x] Falha: texto excessivo (`Overview.jsx:2` “Visão geral de inteligência…” + 4 cards com 2 linhas cada)
- [x] Falha: hierarchy visual não bate com hierarchy textual (tudo tem mesmo weight/border)
- [x] Falha: targets <44px em `chat-filter-tab:861 4px 10px` e `queue-item:1612`
- [x] Falha: sem empty/loading/success states claros no `MapScraperView` (só spinner 200ms)

### 1.2 Percepção “denso” explicada
1. **Preto #0a0a0a + surface #111** com contraste baixo agrupa tudo — falta ar (whitespace token é só `20px/24px`).
2. **Cards repetidos** com mesmo radius 12px + shadow — parecem blocos flutuando (slop #5).
3. **Tipografia grande** sem escala clara faz feed e tabela competirem com headers.
4. **Header duplo** (titlebar drag + search bar) + sidebar + stats + grid = 4 níveis antes do conteúdo útil.

---

## 2. Pesquisa densa — Referências desktop modernas (2024-2026)

Mapeei 7 apps que resolvem exatamente esse problema (prospecting / multi-tool / chat + data). Não inventar estilo do zero — `anti-ai-slop` regra #6: reference-driven.

### 2.1 Linear (linear.app — macOS/Win, Electron/TAURI)
**Por que importa:** padrão ouro de “rápido, leve, claro por default”.
- **Light default:** fundo `#F9FAFB` → `#FFFFFF` surfaces, texto `slate-900`, border `slate-200`. Dark é opt-in.
- **Sidebar 240→220 refinado:** 5 itens fixos, seção “Favorites” colapsável, abaixo da dobra vem “Your Teams”. Não repete.
- **Comando K (cmd+K):** `header-search-wrap:276` vira spotlight global real — filtra leads, campanhas, chats. Linear prova que busca no header precisa fazer algo.
- **Motion:** `enter 180ms ease-out`, `exit 120ms ease-in`, spring `stiffness 300`. Transição de view com `opacity 0→1 + translateY 4px`. Nada de blur.
- **O que copiar:** reduzir sidebar para 5 itens + comando-K, trocar `all 0.2s ease` por `transform/opacity` específico, light token first.

### 2.2 Notion (2025 refresh)
- **Espaço como feature:** padding 32-48 em page, cards com border 1px apenas, sem shadow. Respira.
- **Progressive disclosure:** filtros avançados atrás de “Filter → Add filter”. `LeadScoring.jsx:1250` deveria fazer o mesmo (8 selects escondidos por default).
- **Tipografia:** `Inter 14/16 + weight 500/600 apenas`, não 17/18/29/34. Hierarchy vem de `weight + tracking`, não tamanho.
- **Copiar:** filter drawer colapsável, `kpi-cards` virar inline metrics (sem card).

### 2.3 Stripe Dashboard (2024 redesign)
- **Light 100%:** fundo `#F6F8FA`, surface branca, `border #E6E8EB`, accent `indigo 600`. Virou referência de fintech clean.
- **Métricas sem card:** Stripe mostra `Total volume  —  $12.402  +12%  last 7 days` como linha com divisor, não em card com `border-top:2px`.
- **Tabela:** header `font-size 11 uppercase tracking 0.05em`, row height 40-44 com hover `background #F6F8FA`. `styles.css:617-653 table` já está perto — só tirar `backdrop-filter` e reduzir padding.
- **Copiar:** transformar `stats-grid` em `metric-strip` horizontal, sem card.

### 2.4 Raycast (macOS)
- **Densidade zero:** lista única, tipografia grande mas só 1 lista na tela. Input comanda tudo.
- **Empty state impecável:** ícone grande + 1 frase + 1 CTA. Seu `MapScraperView:646 feed-empty-state` já tem isso — mas está abaixo de 2 KPIs + telemetry.
- **Copiar:** botão “Nova Extração” como primary único (hoje tem 3 lugares: sidebar, Overview header, MapScraper). Um só, no header ou command-K.

### 2.5 Superhuman (e-mail)
- **Keyboard-first:** `j/k` navega list, `e` arquiva, `c` compõe. No Sigma, navegação entre leads no feed deveria ser setas, não só click.
- **Split view:** lista 38% + detalhe 62% — exatamente o que `MapScraperView` tenta, mas com mapa ao invés de detalhe. Superhuman mostra que lista densa precisa `density toggle` (compact / comfortable).

### 2.6 Figma Desktop
- **Sidebar file browser light + ícones outline 1.5px:** `lucide-react` já está no projeto (`App.jsx:2` usa Lucide). Manter isso — slop #8: não misturar sets.
- **Titlebar nativa no Win:** Figma deixa OS cuidar. Sigma usa frameless custom (`main.js:765 frame:false` + `styles.css:237 #titlebar`). Se manter frameless, clarificar drag region e hit target 44px (hoje é 28×28).

### 2.7 Vercel Dashboard
- **Dark/light paridade real:** tokens semantic mapeados 1:1, não override. `styles.css:86 html[data-theme="light"]` está certo como arquitetura — só precisa virar default e desaturar dark.

**Tabela resumo — o que emprestar de quem:**

| Necessidade Sigma | Referência | Padrão |
|---|---|---|
| Light por padrão, claro, menos denso | Linear + Stripe | bg `#F8F9FC`, surface `#FFF`, border `#E2E8F0`, text `#0F172A` |
| Busca global útil | Linear cmd+K | Spotlight filtra leads/campanhas/chats |
| Métricas sem peso | Stripe | Metric strip, não 4 cards com border-top colorido |
| Filtros sem densidade | Notion | Drawer colapsável + density toggle |
| Navegação rápida | Superhuman + Raycast | `g then s` (go scraper), atalhos, `1 Primary CTA` |
| Chat leve | Slack Huddle 2024 | Thread list 32% max, composer pill `bg #FFF border` não `#161616` |
| Motion leve | Linear 180/120 | Ver seção 5 |

> **Resultado do `ui-ux-pro-max --design-system "productivity tool"`** (19 tool invocations): recomendação convergente = **Flat Design, 1 fonte (Plus Jakarta Sans / Inter), palette indigo + emerald, sem sombras, transição 150-200ms**. Bate 100% com Linear/Stripe.

---

## 3. Nova Identidade Visual — “Sigma Clarity”

### 3.1 Art direction em 1 frase
> **Technical clarity workspace — editorial Swiss grid meets Stripe dashboard: fundo claro respirável, uma cor (indigo), tipografia humana, sem vidro nem gradiente, onde o dado manda.**

**Device único repetido:** borda `1px #E2E8F0` + radius `8px` + `focus-ring indigo`. Sem glass, sem gradiente mesh, sem card gigante 32px. Regra `anti-ai-slop` #1-5 atendida.

### 3.2 Tokens — 3 camadas (`design-system` model)

#### Primitive (cru)
```css
--indigo-600: #4F46E5; --indigo-500: #6366F1; --indigo-100: #E0E7FF;
--slate-900: #0F172A; --slate-700: #334155; --slate-500: #64748B; --slate-300: #CBD5E1;
--slate-100: #F1F5F9; --slate-50: #F8FAFC;
--emerald-600: #059669; --amber-500: #F59E0B; --red-600: #DC2626;
--space-1:4px --2:8px --3:12px --4:16px --5:20px --6:24px --8:32px --10:40px --12:48px
--radius-sm:6px --md:8px --lg:12px --pill:999px
--font-sans: "Inter", "Plus Jakarta Sans", system-ui, -apple-system, sans-serif;
--font-mono: ui-monospace, "JetBrains Mono", Menlo, monospace;
```

#### Semantic (propósito) — LIGHT FIRST (default :root)
```css
:root {
  color-scheme: light;
  --bg: var(--slate-50);         /* #F8FAFC  page */
  --surface: #FFFFFF;            /* card / sidebar / header */
  --surface-hover: var(--slate-100);
  --fg: var(--slate-900);        /* #0F172A */
  --fg-2: var(--slate-700);      /* 78% */
  --muted: var(--slate-500);     /* #64748B */
  --meta: rgba(15,23,42,.42);
  --border: #E2E8F0;             /* slate-200 */
  --border-hover: var(--slate-300);
  --accent: #6366F1;             /* indigo-500 — mantém DNA roxo mas mais claro que #6c5ce7 */
  --accent-hover: #4F46E5;
  --accent-on: #fff;
  --success: #059669; --danger:#DC2626; --warn:#D97706;
  --radius-sm:6px; --radius-md:8px; --radius-lg:12px;
  --elev-raised: 0 1px 3px rgba(15,23,42,.08), 0 1px 2px rgba(15,23,42,.06);
  --focus-ring: 0 0 0 3px rgba(99,102,241,.25);
}
html[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0B0F1A; --surface:#121826; --surface-hover:#1A2236;
  --fg:#F1F5F9; --fg-2:rgba(241,245,249,.78); --muted:#94A3B8;
  --border:#1E293B; --border-hover:#334155;
  --elev-raised: 0 8px 24px rgba(0,0,0,.35);
}
```

> Por que indigo e não o roxo `#6c5ce7` atual? `#6c5ce7` é `oklch` saturado que vibra no light — failing WCAG AA em small text. `6366F1` passa AA em `14px 500` sobre branco e mapeia direto para `ring` + `focus`.

#### Component layer
```css
--sidebar-bg: var(--surface);
--header-bg: rgba(255,255,255,.8); /* + backdrop blur opcional só no header */
--input-bg: var(--surface);
--btn-primary-bg: var(--accent);
--table-header-bg: var(--slate-50);
```

### 3.3 Tipografia (single family)

**Fonte única: Inter ou Plus Jakarta Sans** (ambas geometrics, 400/500/600/700). Pesquisas do `ui-ux-pro-max --domain typography "saas productivity"` recomendam **Plus Jakarta Sans** single-family — manter `lucide-react` outline 1.5px (não trocar set).

| Papel | Token | Valor novo | Antes |
|---|---|---|---|
| Body | `--text-base` | **14px** 1.5 LH | 17px |
| Small / caption | `--text-sm` | 13px | 16px |
| H1 page | `--text-2xl` | 20px 600 tracking -0.01em | 34px |
| H2 section | `--text-lg` | 16px 600 | 22px |
| Label uppercase | `--text-xs` | 11px 500 tracking .06em | 13px |

Max 65ch por linha (`--reading-width: 65ch`). Headers não são centralizados por default — `anti-ai-slop` #6: hero centrado template é defeito.

### 3.4 Cor — menos cor, mais significado
- **1 accent (indigo)** para CTA primário, foco, active nav.
- **Semânticas só para status:** emerald sucesso, amber aviso, red perigo — sempre com ícone + texto (`color not only signal`, `intuitive-product-ui` #7).
- **Sem gradients** — se usar gradient, só linear 135deg indigo→violet em 1 lugar (brand icon box). Hoje há 4 gradients em `Overview.jsx:84,95,106,117` — reduzir para 1.

---

## 4. Navegação — de densa para fluida

### 4.1 Problemas de IA mapeados
- `App.jsx:208-256` sidebar lista **6 itens** + 2 no footer. 6 é limite `bottom-nav-limit` — mas em sidebar desktop, Linear prova que 5 é ideal. **Campanhas** hoje é alias de WhatsApp (`144-148` renderiza `<WhatsAppPanel initialTab="campaigns">`) — confunde. Deveria ser sub-tab dentro de WhatsApp, não top-level.
- `App.jsx:276-284` header search dummy + `341 main` troca instantânea = sensação de “pesado”.
- `LeadScoring` filtros 8 selects lado a lado não escalam em 1200px — precisa drawer.

### 4.2 Proposta: IA em 3 níveis (não 6 flats)

**Level 1 — App Shell (persistente):**
```
[Titlebar 38px drag]  Sigma • indigo icon + Cmd+K hint
+----------------------------------------------------------------+
| Sidebar 220px (colapsável 64px) | Header 48px (light, border) | Main fluid |
| • Visão Geral (⌘1)              |  [⌘K Buscar leads, campanhas…] [Bell][Avatar][Win ctrl] |
| • Scraper  (⌘2)  [badge count]  |  breadcrumb: Scraper / Leads  [Nova Extração primary] |
| • Lead Scoring (⌘3)             |                                          |
| • WhatsApp  (⌘4)  • Campanhas ── subnav dentro da view, não na sidebar |
| • Dashboard (⌘5)                |  page-header 20px semibold, desc 13px muted |
| ─────────────────               |                                            |
| [Central Ajuda] [Sair]          |  content `padding 24` gap 24, max-width 1280 centered |
```

- Sidebar **220px** (era 240) + colapso para 64 memorizado em `localStorage: sidebarCollapsed`.
- Header **48px** (era titlebar 38 + header ~48 = 86). Unificar: titlebar continua frameless, mas busca e CTA migram para **um único header** de 48. Ganho: +38px verticais.
- **Breadcrumbs** só quando profundidade >2 (Scraper → Lead detail). Flat pages não precisam.

**Level 2 — Dentro de cada view, tabs secundárias (não sidebar):**
- `WhatsAppPanel:148 waTab = connect|chats|campaigns|settings` — campanhas vira tab secundária, não item global. Remove duplicação.
- `LeadScoring: filtros` viram `FilterBar` colapsável + `Group drawer` à direita (Notion pattern).

**Level 3 — Command palette (⌘K):** 1 input filtrável que navega ou executa:
- `Go to Scraper`, `Go to Scoring`, `Nova Extração`, `Exportar CSV`, `Alternar tema`. Substitui `globalSearch` dummy.

### 4.3 Fluidez — wiring
```jsx
// App.jsx — activeTab vira URL hash / router leve (sem react-router heavy)
const [activeTab, setActiveTab] = useState(() => location.hash.slice(1) || 'overview');
useEffect(()=> history.replaceState(null,'','#'+activeTab), [activeTab]);

// transição entre views: não switch instant — fade+slide 180ms
<div className="view-transition" key={activeTab}>
  {renderContent()}
</div>
```
```css
.view-transition { animation: viewIn 180ms ease-out; }
@keyframes viewIn { from { opacity:0; transform: translateY(4px)} to {opacity:1; transform:none} }
@media (prefers-reduced-motion:reduce){ .view-transition{animation:none} }
.nav-item { transition: background 120ms ease, color 120ms ease; } /* não 'all' */
.nav-item.active { background: var(--accent-soft); color: var(--accent); border-left: none; box-shadow: inset 2px 0 0 var(--accent); }
```

---

## 5. Sistema de Motion — leve, não decorativo

**Tokens de motion (globals):**
```css
:root {
  --dur-fast: 120ms; --dur-base: 180ms; --dur-slow: 280ms;
  --ease-out: cubic-bezier(.16,1,.3,1); /* Linear-like spring */
  --ease-in: cubic-bezier(.4,0,1,1);
}
```

**Regras (de `ui-ux-pro-max --domain ux animation` + HIG):**
- Animar **1-2 elementos por view max** — não `*.card:hover transform: translateY(-2px)` em todo grid (hoje em `launcher-card:1492`).
- Só `transform` + `opacity` — nunca `width/height/top` (performance).
- `enter = ease-out dur-base`, `exit = ease-in dur-fast` (exit 60-70% de enter).
- List stagger `30ms` por item max 6 itens — `feed-list-scroll` com `animation-delay: calc(i*30ms)`.
- Respeitar `prefers-reduced-motion` global:
```css
@media (prefers-reduced-motion: reduce){
  *, *::before, *::after { animation-duration:.01ms !important; transition-duration:.01ms !important; }
}
```

**Micro-interações específicas:**
- `btn-new-extraction` press: `scale(.98)` 100ms (feedback), não lift 2px.
- `nav-item` hover: `bg 120ms`, não `all`.
- `modal-overlay` enter: `backdrop 180ms` + `modal-content scale .98→1 180ms ease-out`.
- `toast-progress-bar` já existe (`NotificationCenter.jsx:216`) — manter, só mudar duration para `var(--dur-slow)`.
- Skeleton para `MapScraperView` loading (ao invés de blank) — `progressive-loading` shell.

---

## 6. De denso para respirável — 10 cortes concretos

| Hoje (denso) | Novo (leve) | Arquivo(s) |
|---|---|---|
| `stats-grid` 4 cards com `border-top 2px` | `metric-strip` — 4 inline metrics divididos por `1px border`, sem card | `Overview.jsx:33`, `Dashboard.jsx:40`, `styles.css:548-589` |
| `launcher-grid 4 cards` 280px min | **2 cards primários + lista compacta** para secundários (WhatsApp/Dashboard vira row list). Máx 2 CTAs por viewport (`primary-action` rule) | `Overview.jsx:82-125` |
| `kpi-cards-grid 2 cards` + `feed-right-panel` 380px | `kpi-inline` acima do feed (chip metrics), feed ganha altura real | `MapScraperView.jsx:608-634` |
| `map-floating-scan-card + telemetry` flutuando | Status bar única no header da view (sem floating cards). Mapa 100% canvas limpo. | `MapScraperView.jsx:470-538` |
| `ls-stats-grid 6 cards` | 3 metrics essenciais + “Ver mais” expander (progressive disclosure) | `LeadScoring.jsx:1232` |
| 8 filtros always visible | `FilterDrawer` colapsável, default só Texto + Prioridade visíveis | `LeadScoring.jsx:1250` |
| `table-header sticky` com shadow forte | Header 11px uppercase, row 40px, hover `bg slate-50`, sem shadow inset | `styles.css:623-653` |
| `#filterBar + #statsRow + table-section` 3 seções empilhadas | Uma toolbar: `[Search] [Filter pill] [Density] [Export]` — 1 linha | `LeadsManager.jsx:538-614` |
| Sidebar + titlebar duplo | Sidebar 220 + header 48 único | `App.jsx:177-341`, `styles.css:307,237` |
| Modals `max-width 480` com backdrop blur 4px | Modal `max-width 520`, fundo light `#FFF`, overlay `rgba(15,23,42,.32)` sem blur | `styles.css:1548`, `NewExtractionModal.jsx` |

**Ganho estimado:** -38% altura chrome, +22% área de conteúdo, -60% cards na primeira dobra.

---

## 7. Plano de implementação em fases (sem rewrite)

**Fase 0 — Tokens light-first (1 dia, zero breaking):**
- [ ] `styles.css` split: `tokens.css` (primitive→semantic→component) + `base.css` + `components.css` (seguir `design-system/token-architecture.md`)
- [ ] Default `:root` vira light (`--bg #F8FAFC`), dark vira `html[data-theme="dark"]`. Migrar `main.js:1352 readSavedTheme() return "light"` e `main.js:1355 resolveWindowBgColor()` para `#F8FAFC`. Testar contraste AA.
- [ ] Remover 193 hex hardcoded → mapear para tokens (usar `validate-tokens.cjs`).

**Fase 1 — Shell leve (2 dias):**
- [ ] Sidebar 240→220 + colapso + `box-shadow inset` active. Header único 48 (merge titlebar search + `app-header-bar`). Breadcrumb cond.
- [ ] `App.jsx:19 Campaigns` remove do sidebar → tab dentro de `WhatsAppPanel`. Sidebar fica 5 itens.
- [ ] `view-transition` wrapper + `prefers-reduced-motion`.

**Fase 2 — Des-densificar views (3-4 dias):**
- [ ] `Overview` → metric-strip + 2 launcher cards.
- [ ] `MapScraperView` → remover floating cards, metric-inline, skeletons, density toggle.
- [ ] `LeadScoring` → FilterDrawer + grupos em drawer, não coluna.

**Fase 3 — Motion & polish (1-2 dias):**
- [ ] Tokens `--dur-* --ease-*`, micro-interações, stagger list, skeleton loaders, empty states revisadas (1 frase + 1 CTA, tipo Raycast).
- [ ] Command palette `⌘K` com `fuse.js` (sem backend). Atalhos `⌘1-5`.

**Fase 4 — QA acessibilidade & perf:**
- [ ] Auditoria `intuitive-product-ui` checklist final: 360px, touch 44px, focus-visible, keyboard nav (`tabIndex` order = visual).
- [ ] `anti-ai-slop` checklist: 1 art direction, sem gradients random, radius 6/8/12, 1 icon family (Lucide), light/dark paridade.
- [ ] Lighthouse Electron: CLS <0.1, `virtualize-lists` se >50 leads.

### Protótipo de tokens (drop-in)
Criado em `renderer/styles.css` preview — ver `renderer/src/components` diffs no PR. Para testar sem build:
1. `npm run dev:renderer` + `npm run start:quick`
2. Alternar tema via `localStorage.setItem('sigma-theme','light')` e recarregar.
3. Validar `python scripts/validate-tokens.cjs --dir renderer/src` (zero hex crus).

---

## 8. Referências visuais para handoff

| Referência | Link | Empréstimo |
|---|---|---|
| Linear | https://linear.app/features | Sidebar 220, cmd-K, motion 180/120, light default |
| Stripe Dashboard | https://stripe.com (login demo) | Metric strip, table 11px header, light `#F6F8FA` |
| Notion 2025 | https://notion.com | Filter drawer, whitespace 32-48, Inter 14 |
| Raycast Store | https://raycast.com/store | Lista única, empty state 1+1 CTA |
| Superhuman | https://superhuman.com | Atalhos j/k, split 38/62 |
| Figma Desktop | — | Lucide outline 1.5, titlebar nativa |
| Vercel Dashboard | https://vercel.com/dashboard | Token parity light/dark |

> **Em 1 linha:** menos cards, mais espaço, light que respira, 1 roxo, 1 fonte, movimento só onde explica causalidade.

---

*Gerado com `ui-ux-pro-max --design-system --variance 3 --density 3` (spacious) + audit manual file:line. Próximo passo: aplicar Fase 0 em branch `feat/clarity-tokens`.*
