# Plano de implementação — Temas e estética (Sigma Control Center)

**Data:** 2026-08-13
**Status:** Fases 0–3 concluídas
**Objetivo:** Entrega de sistema de temas completo (escuro/claro/automático) e um polimento visual
consistente em todas as telas, sem regressão no tema escuro atual.

---

## 1. Contexto

A UI é um app Electron + React (Vite) com toda a estética centralizada em `renderer/styles.css`
(~5.000 linhas) baseada em **design tokens** (`:root` → `--bg`, `--surface`, `--accent`, ...).
Já foi entregue a **Fase 0** (modo claro via `html[data-theme="light"]` + toggle na titlebar +
IPC `theme-get`/`theme-set` + persistência). Este plano cobre as fases seguintes.

## 2. Fases

### Fase 0 ✅ — Modo claro (entregue)
- Tokens do modo claro em `html[data-theme="light"]`.
- Toggle na titlebar (App.jsx) com persistência em `localStorage` (`sigma-theme`).
- IPC `theme-get` / `theme-set` (preload + main) gravando `ui-theme.json` no userData.
- `main.js` define `backgroundColor` da janela conforme o tema salvo (evita flash).
- `main.jsx` aplica o tema antes do primeiro paint.
- Cores fixas (chat, terminal, campanhas, triggers, donação) convertidas para tokens.

### Fase 1 ✅ — Tema automático (segue o sistema)
**Escopo:**
- Estado de tema passa a ter 3 valores: `dark` | `light` | `auto`.
- Menu compacto na titlebar (Escuro / Claro / Automático) no lugar do toggle simples. ✅
- `auto` resolve via `prefers-color-scheme` no renderer e `nativeTheme.shouldUseDarkColors`
  no main (para o `backgroundColor` da janela). ✅
- Listener de mudança do sistema em tempo real quando `auto` está ativo. ✅ (validado via Playwright)
- Persistência de `auto` em `localStorage` + `ui-theme.json`. ✅

**Critérios de aceite:**
- Mudar o tema do SO atualiza a UI imediatamente quando `auto` está ativo.
- Reiniciar o app mantém `auto` e a janela já abre com a cor de fundo correta.
- `dark`/`light` continuam fixos quando selecionados manualmente.

### Fase 2 ✅ — Polimento visual (CSS, sem mudar markup)
**Escopo:**
1. **Foco & acessibilidade:** `:focus-visible` com anel accent em botões/inputs/links.
2. **Sidebar:** itens com hover suave, estado ativo com indicador + gradiente sutil,
   ícones alinhados, header consistente com o tema.
3. **Cards de estatística:** elevação no hover, transição, barra superior de status já existente.
4. **Botões:** hover com lift sutil no primário, `focus-visible`, estado desabilitado legível.
5. **Inputs:** foco mais perceptível, placeholder consistente.
6. **Tabelas:** header sticky com sombra suave, hover de linha com transição, truncamento ok.
7. **Empty states:** bloco centralizado com ícone em círculo suave.
8. **Terminal de log (`#tdr`):** header com ponto de status, corpo mono com `--term-text`.
9. **Scrollbars:** mais finas, thumb com hover.
10. **Transições de tema:** `transition` de cor em superfícies principais (evitar jank global).

**Critérios de aceite:**
- Modo escuro visualmente idêntico ao atual (sem regressão).
- Modo claro legível em todas as telas (contraste ≥ 4.5:1 em texto).
- Nenhum erro de console novo; build e testes passam.

### Fase 3 ✅ — Layouts específicos por tela
- WhatsApp: sombra sutil nas bolhas, avatar com anel, composer com altura mínima, transições de thread. ✅
- Campanhas: hover com lift nos cards, título com tracking, superfícies claras (badges, chips, progresso,
  wizard, conexões, browse) convertidas para tokens no modo claro. ✅
- Lead scoring / Dashboard: hover com elevação nos cards de estatística, transições nos cards de análise,
  hover nas linhas de ranking. ✅
- Cores inline do WhatsAppPanel (bordas/fundos brancos) convertidas para tokens. ✅

## 3. Arquivos afetados

| Arquivo | Papel |
|---|---|
| `renderer/styles.css` | Tokens, bloco light, overrides, polimento (Fase 2) |
| `renderer/src/App.jsx` | Estado de tema, menu, listener de sistema |
| `renderer/src/main.jsx` | Aplicação antecipada do tema (inclui `auto`) |
| `preload.js` | Já expõe `getTheme`/`setTheme` |
| `main.js` | `theme-get` aceita `auto`; `backgroundColor` via `nativeTheme` |
| `docs/plano-temas-e-estetica-2026-08-13.md` | Este plano |

## 4. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Regressão no tema escuro | Todo polimento usa tokens; validação Playwright em dark e light |
| `auto` causar flash ao iniciar | `main.jsx` aplica tema resolvido antes do primeiro paint; `main.js` usa `nativeTheme` |
| Popover do menu preso na drag region | Elementos marcados com `-webkit-app-region: no-drag` |

## 5. Validação

- `npm run build:renderer` (build sem erros).
- `npm test` (45 testes).
- Checagem visual Playwright (Chrome headless) nos 3 modos: superfícies, texto, toggle, aba WhatsApp.
