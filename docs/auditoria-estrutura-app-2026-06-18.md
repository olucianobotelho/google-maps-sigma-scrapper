# Auditoria completa da estrutura do app - 2026-06-18

## Escopo

Avaliação feita no estado atual do working tree em `E:\CODE\gmaps\sigma-gmaps-scraper`.

Cobertura:

- Estrutura Electron, preload, IPC e renderer.
- Scraper Playwright/Google Maps.
- WhatsApp/Baileys/Meta provider.
- Campanhas, scheduler, template engine e persistência.
- Exportação CSV/JSON/relatórios.
- Build, dependências, operação, design de UI e riscos de produto.

Não coberto com teste real:

- Login WhatsApp via QR, porque exige sessão real.
- Disparo real de mensagens, para evitar efeito externo.
- Scrape real em produção, para evitar tráfego desnecessário no Google Maps.

## Verificações executadas

- `node --check` em 25 arquivos JS: passou.
- `npm audit --omit=dev`: falhou com 4 vulnerabilidades, sendo 2 críticas e 2 altas.
- `npm outdated --depth=0`: há updates para Baileys, Electron, electron-builder e Playwright.
- `npm run build -- --dir`: passou e gerou `dist\win-unpacked`.
- Tamanho do pacote unpacked Windows: cerca de 413 MB.
- RTK savings após lote: 19.0M tokens economizados, 92.3%.

## Veredito executivo

O app já tem uma base funcional rica: Electron isolado por `contextIsolation`, scraper Playwright, painel de leads, WhatsApp multi-conexão, chat, campanhas, monitor e build Windows funcionando.

Mas a estrutura atual ainda está em estágio de MVP avançado, não pronta para uso confiável em produção. Os riscos principais são:

- P0 segurança: path traversal em `connectionId`, XSS no renderer combinado com IPC privilegiado, dependências com CVEs críticas.
- P1 operação: persistência frágil em `localStorage`/JSON direto, cancelamento falso do scraping, normalização de telefone incompleta, erros silenciosos.
- P1 produto: promessa de "milhares/ilimitado" não combina com `localStorage`, seletor frágil do Maps e risco de banimento/ToS.
- P2 manutenção: muitos globals no renderer, HTML por string, estilos inline, sem testes/lint/schema.

## Arquitetura atual

### Processos

- `main.js`: lifecycle Electron, IPC, scraper, arquivos, WhatsApp, campanhas.
- `preload.js`: expõe `electronAPI`, `whatsappAPI`, `campaignAPI`, `chatAPI`.
- `renderer/*.js`: UI sem bundler, scripts globais e estado em `localStorage`.
- `scraper.js`: Playwright Chromium headless.
- `whatsapp/baileys-provider.js`: WhatsApp Web, chat cache, mídia, grupos, mensagens.
- `campaigns/*`: JSON store, manager, scheduler, template engine.

### Estado persistente

- Leads, buscas e fila: `localStorage` do renderer (`renderer/renderer.js:340-347`).
- Campanhas: `{userData}/campaigns.json` (`campaigns/campaign-store.js:6`).
- Sessões WhatsApp: `{userData}/whatsapp-sessions/{connectionId}/whatsapp-auth`.
- Cache de chats: `{sessionPath}/sigma-chats.json`.
- Resultados temporários: `{userData}/gmaps_*.json/csv/txt`.

## P0 - falhas críticas

### P0.1 - Path traversal destrutivo em `connectionId`

Evidência:

- `main.js:488-492` aceita `config.connectionId` vindo do renderer e usa direto em `path.join`.
- `main.js:556-558` remove recursivamente `path.join(userData, "whatsapp-sessions", connectionId)`.
- `preload.js:20-23` expõe `connect(provider, config)` e `removeConnection(connectionId)` ao renderer.

Impacto:

- Um renderer comprometido, ou qualquer XSS, pode chamar `window.whatsappAPI.removeConnection("..")`.
- Isso resolve para `{userData}/whatsapp-sessions/..`, ou seja, `{userData}`, e executa `fs.rmSync(..., { recursive: true, force: true })`.
- Resultado provável: perda de campanhas, sessões, cache, dados temporários e outras configurações do app.
- Com outros valores (`..\..\...`), pode tentar apagar caminhos fora de `userData`, dependendo de permissões.

Correção recomendada:

- Nunca aceitar `connectionId` arbitrário do renderer.
- Gerar IDs somente no main process.
- Validar com allowlist rígida: `^wa_[a-zA-Z0-9_-]{1,80}$`.
- Criar helper `resolveInside(base, child)` que usa `path.resolve` e falha se o caminho final não começa com o diretório base.
- Aplicar esse helper antes de `mkdirSync`, `rmSync`, `unlinkSync` e qualquer operação com session path.
- Adicionar teste automatizado garantindo que `".."`, `"../x"`, `"..\\x"`, caminho absoluto e string vazia são rejeitados.

### P0.2 - XSS no renderer vira controle privilegiado do app

Evidência:

- `renderer/index.html:1-7` não define Content Security Policy.
- `renderer/renderer.js:462-470` injeta dados de leads externos via `innerHTML`, incluindo `name`, `category`, `address`, `email`, `website`, `instagram`.
- `renderer/template-editor.js:92-110` injeta preview de template via `innerHTML` sem escapar o texto original.
- `preload.js:53-84` expõe envio de mensagem, envio de mídia, sticker, download de mídia, ação em chat e abertura de arquivo.
- `main.js:702-746` lê `filePath` recebido do renderer e envia o buffer pelo WhatsApp.
- `main.js:812-818` lê `filePath` recebido do renderer e envia sticker.

Impacto:

- Um lead vindo do Google Maps, ou um dado salvo no `localStorage`, pode carregar payload HTML/JS se conseguir entrar em campos renderizados por `innerHTML`.
- Como o preload expõe APIs de alto privilégio, XSS não precisa de `nodeIntegration`: basta chamar `window.chatAPI.sendMedia(...)`, `window.whatsappAPI.removeConnection(...)`, `window.campaignAPI.update(...)`, etc.
- Cadeia de ataque plausível: dado externo malicioso -> XSS -> ler arquivo local permitido por IPC -> enviar por WhatsApp -> apagar sessão/campanhas.

Correção recomendada:

- Trocar renderização por DOM seguro (`textContent`, `createElement`, `setAttribute` validado).
- Onde HTML for necessário, usar sanitizador confiável com allowlist.
- Validar URLs antes de criar links: permitir apenas `http:` e `https:`, negar `javascript:`, `file:`, `data:` e protocolos vazios.
- Adicionar `rel="noopener noreferrer"` em links externos.
- Definir CSP em `index.html`, por exemplo: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; object-src 'none'; base-uri 'none'`.
- Em Electron, bloquear navegação e novas janelas com `webContents.setWindowOpenHandler` e `will-navigate`.
- Reduzir bridge: expor APIs específicas por intenção, não primitives genéricas de arquivo/mensagem.

### P0.3 - Dependências com vulnerabilidades críticas

Evidência:

- `package.json:15` usa `@whiskeysockets/baileys ^7.0.0-rc10`.
- `npm audit --omit=dev` reportou:
  - `@whiskeysockets/baileys`: critical, spoofing/corrupção via protocolMessage.
  - `protobufjs <=7.6.2`: critical, arbitrary code execution e vários DoS/prototype issues.
  - `ws`: high, memory disclosure e memory exhaustion DoS.
  - Total: 4 vulnerabilidades, 2 altas e 2 críticas.

Impacto:

- Área WhatsApp processa payloads vindos de rede externa não confiável.
- CVE em Baileys/protobuf/ws é especialmente grave porque mensagens/histórico são entradas remotas.
- O app pode travar, corromper estado, processar payload malicioso ou sofrer DoS.

Correção recomendada:

- Rodar upgrade controlado para Baileys `7.0.0-rc13` ou versão corrigida disponível.
- Rodar `npm audit fix` em branch separada e testar login, sync, envio, mídia e campanhas.
- Se a cadeia transitive continuar vulnerável, usar `overrides` no `package.json` para `protobufjs`/`ws` corrigidos, validando compatibilidade.
- Considerar Meta Business API como provider de produção e Baileys apenas como modo experimental.

## P1 - alto impacto

### P1.1 - IPC sem schema/validação de payload

Evidência:

- `main.js` registra muitos handlers (`start-scrape`, `whatsapp-*`, `campaign-*`) sem validação estruturada.
- `main.js:180-183` aceita `query`, `maxResults`, `queryId` direto.
- `main.js:323-357` aceita `leads` arbitrários do renderer e escreve em disco.
- `main.js:797-805` converte `audioData` arbitrário em `Buffer` e roda ffmpeg.

Impacto:

- Renderer pode enviar payload gigante e causar alto uso de RAM/CPU/disco.
- `maxResults` pode ser abusado para scraping longo.
- `audioData` pode travar o app via buffer enorme/ffmpeg.
- Erros viram rejeições genéricas ou estados quebrados.

Correção recomendada:

- Criar camada de validação por canal IPC.
- Definir limites: tamanho máximo de lead export, maxResults, tamanho de template, tamanho de áudio, tamanho de arquivo, extensão permitida.
- Retornar erro tipado e previsível.
- Registrar auditoria local para ações destrutivas.

### P1.2 - Leitura arbitrária de arquivo por APIs de mídia

Evidência:

- `preload.js:72-77` expõe `sendMedia(to, filePath, caption)` e `sendSticker(to, filePath)`.
- `main.js:706` faz `fs.readFileSync(filePath)`.
- `main.js:817` faz `fs.readFileSync(filePath)`.
- `campaigns/campaign-scheduler.js:214-217` lê `media.filePath` salvo em campanha.

Impacto:

- Mesmo sem path traversal, qualquer XSS pode tentar ler arquivos do usuário e enviá-los para um contato WhatsApp.
- Não há limite de tamanho, diretório permitido ou verificação de que o arquivo veio do dialog.
- Arquivos enormes podem travar o app.

Correção recomendada:

- Trocar API para usar token/capability emitido pelo `dialog-open-file`.
- Main deve manter uma allowlist temporária de paths escolhidos pelo usuário.
- Validar tamanho (`stat.size`), extensão, mime real e diretório.
- Negar paths fora da allowlist.

### P1.3 - Meta provider reporta sucesso mesmo com token inválido

Evidência:

- `whatsapp/meta-provider.js:18-31` captura erro, seta `_status = "error"` e não lança.
- `main.js:506-514` sempre retorna `{ success: true }` se `provider.connect()` resolver.
- `renderer/whatsapp-panel.js:152-158` só mostra erro se `res.success` for falso.

Impacto:

- Usuário recebe estado incoerente: conexão criada como sucesso, mas provider está em erro.
- Campaign manager pode receber provider inválido.
- Diagnóstico fica confuso, especialmente em produção com Meta API.

Correção recomendada:

- `MetaProvider.connect()` deve lançar erro após `onStatus("error")`.
- `main.js` deve checar `provider.getStatus() === "connected"` antes de retornar sucesso.
- Persistir/salvar config Meta só depois de validação real.

### P1.4 - Normalização de telefone existe, mas não é usada no fluxo crítico

Evidência:

- `whatsapp/phone-normalizer.js:3-29` implementa normalização com DDI.
- `preload.js:48` expõe `phone-normalize`.
- `renderer/campaign-create.js:362-365` copia `phone: l.phone` cru para campanha.
- `campaigns/campaign-store.js:51` persiste telefone cru.
- `whatsapp/baileys-provider.js:800-805` só remove não-dígitos e anexa `@s.whatsapp.net`; não adiciona DDI.
- `campaigns/campaign-manager.js:186-193` rastreia resposta por comparação exata de dígitos.

Impacto:

- Telefone raspado como `(21) 99999-8888` vira `21999998888@s.whatsapp.net`, sem `55`.
- Envio pode falhar ou ir para destino inválido.
- Mesmo quando envia, reply tracking pode não casar se lead está local e JID recebido tem DDI.
- Métricas de resposta ficam erradas.

Correção recomendada:

- Normalizar telefone no main process no momento de criar campanha.
- Rejeitar/mostrar leads inválidos antes de iniciar.
- Persistir `phoneRaw`, `phoneE164`/`phoneDigits` e `countryCode`.
- Usar o mesmo normalizador para envio, dedupe e reply tracking.

### P1.5 - Persistência de campanhas pode perder dados silenciosamente

Evidência:

- `campaigns/campaign-store.js:11-15` se JSON está corrompido, retorna `{}` sem aviso.
- `campaigns/campaign-store.js:22` escreve direto no arquivo final, sem escrita atômica.
- `campaigns/campaign-store.js:27-35` usa save debounced de 2s.
- `campaigns/campaign-manager.js:212-215` shutdown só para scheduler, não força flush do store.

Impacto:

- Crash durante escrita pode corromper `campaigns.json`.
- Próxima abertura apaga a visão de todas as campanhas porque parse error vira objeto vazio.
- Eventos de entrega/leitura/resposta podem ser perdidos se o app fechar antes do debounce.

Correção recomendada:

- Persistência atômica: escrever `campaigns.json.tmp`, `fsync` quando viável, renomear.
- Manter backup `campaigns.json.bak`.
- Em parse error, preservar arquivo corrompido e avisar usuário.
- Implementar `store.flush()` e chamar no `before-quit`.
- Migrar para SQLite se volume e confiabilidade importam.

### P1.6 - Scraper marca falha geral como sucesso

Evidência:

- `scraper.js:118-126` captura erro geral, loga `Error: ...`, mas retorna `{ success: true }`.
- `main.js:225-230` confia no resultado e retorna sucesso ao renderer.
- `renderer/renderer.js:604-621` só adiciona leads se `result.success`.

Impacto:

- Falhas de navegação, seletor, timeout ou bloqueio podem parecer "sucesso com 0 leads".
- Usuário não sabe se a busca não teve resultado ou se o scraper quebrou.
- Dificulta suporte e retry.

Correção recomendada:

- Diferenciar `no_results`, `blocked`, `timeout`, `partial_success`, `fatal_error`.
- Em catch geral, retornar `success: false` quando nada foi concluído.
- Se houver dados parciais, retornar `success: true, partial: true, warnings: [...]`.

### P1.7 - Cancelamento da extração não cancela o trabalho real

Evidência:

- `renderer/renderer.js:656-660` só seta `cancelled = true`.
- `renderer/renderer.js:601` fica aguardando `window.electronAPI.startScrape(...)`.
- `main.js:180-183` não recebe AbortController/cancel token.
- `scraper.js` não tem checagem de cancelamento.

Impacto:

- Botão "Cancelar" só impede próximos itens da fila; a busca atual continua rodando.
- Browser, rede e scraping continuam consumindo recursos.
- Usuário acha que parou, mas app segue trabalhando.

Correção recomendada:

- Introduzir `queryId` obrigatório e handler `cancel-scrape`.
- Guardar `AbortController`/flag por query no main.
- Scraper deve checar cancelamento entre scroll, item click e scrapeEmails.
- Fechar page/context/browser no cancelamento.

### P1.8 - Modelo de leads em `localStorage` não escala nem é confiável

Evidência:

- `renderer/renderer.js:340-347` guarda `sigma_searches`, `sigma_leads`, `sigma_queue` no `localStorage`.
- README promete milhares/sem limite.
- O logo `renderer/sigma-logo.png` tem cerca de 1.5 MB e carrega no splash/titlebar.

Impacto:

- `localStorage` tem limite pequeno e varia por ambiente.
- Milhares de leads com fotos, descrição, email e URLs podem estourar quota.
- Dados podem ser apagados pelo usuário ou por reset do web storage.
- Não há backup, import, migração, compactação nem paginação real.

Correção recomendada:

- Mover leads para SQLite/arquivo JSONL no main process.
- Renderer deve consultar páginas/filtros via IPC, não carregar tudo em memória.
- Criar export/import e backup.
- Otimizar logo para múltiplos tamanhos ou usar asset menor no titlebar/splash.

### P1.9 - Arquivos temporários vazam quando usuário cancela exportação

Evidência:

- `main.js:289-300` escreve `gmaps_all_*.json` antes do save dialog e não apaga se cancelar.
- `main.js:331-340` escreve `sigma_leads_*.json` antes do save dialog e não apaga se cancelar.
- `main.js:955-963` faz padrão equivalente para campanha JSON.
- `cleanOldTempFiles` em `main.js:156-166` só limpa arquivos que começam com `gmaps_`.

Impacto:

- Export cancelado deixa dados sensíveis em `userData`.
- `sigma_leads_*` e `campaign_*` podem ficar indefinidamente.

Correção recomendada:

- Abrir save dialog antes de escrever.
- Usar `try/finally` para apagar temporário.
- Limpar também `sigma_leads_*` e `campaign_*`.
- Preferir escrever direto no `filePath` escolhido.

### P1.10 - CSV/relatório quebram com lista vazia e dados aninhados

Evidência:

- `utils/csv.js:11-12` retorna sem criar arquivo se `data.length === 0`.
- `main.js:209-211` chama `saveToCSV(data, csvPath)` mesmo quando `data` pode ser vazio.
- `main.js:269` faz `copyFileSync(entry.csvPath, filePath)` assumindo arquivo existente.
- `utils/stats.js:1` divide por `data.length`; com zero gera `NaN`.
- `utils/csv.js:17-18` serializa objetos como `[object Object]`, por exemplo `photos`.

Impacto:

- Salvar CSV de busca vazia pode falhar.
- Relatório pode mostrar `NaN%`.
- CSV perde dados aninhados importantes.

Correção recomendada:

- Sempre criar CSV com headers conhecidos, mesmo vazio.
- `percent` deve retornar `0.0` quando `data.length === 0`.
- Serializar objetos/arrays como JSON ou achatar campos (`photos.count`, `photos.main`).

## P2 - médio impacto

### P2.1 - Hardening Electron incompleto

Evidência:

- `main.js:37-41` usa `nodeIntegration: false` e `contextIsolation: true`, bom.
- Não há `sandbox: true`.
- Não há CSP.
- Não há `setWindowOpenHandler`, `will-navigate` ou `setPermissionRequestHandler`.

Impacto:

- Superfície maior para renderer comprometido.
- Links externos e permissões podem se comportar de forma imprevisível.

Correção recomendada:

- Ativar sandbox se compatível com preload.
- Bloquear navegação não esperada.
- Abrir links externos via `shell.openExternal` com URL validada.
- Controlar permissões de mic/camera/notifications por origem e contexto.

### P2.2 - Seletores do Maps são frágeis

Evidência:

- `utils/businessData.js:4`, `:8`, `:23-36`, `:43-49` dependem de classes/atributos privados do Google Maps.
- `scraper.js:70-76` captura lista de locators e clica em sequência em DOM dinâmico.
- `scraper.js:112-114` engole erro por item e só loga `skip`.

Impacto:

- Mudança de DOM do Maps quebra extração sem alerta claro.
- Pode coletar campos errados, especialmente endereço por `span[jsinstance]`.

Correção recomendada:

- Criar testes e fixtures HTML para `extractBusinessData`.
- Medir taxa de campos por busca e alertar queda brusca.
- Guardar reason de skip por item.
- Versionar seletores e fallback por idioma.

### P2.3 - Falta suíte de testes e lint

Evidência:

- `package.json:8-12` tem scripts de start/build, mas não tem `test`, `lint`, `typecheck`.
- `node --check` passou, mas só valida sintaxe.

Impacto:

- Bugs de IPC, path traversal, CSV vazio, Meta connect e phone normalization passariam despercebidos.
- Refatorar renderer/WhatsApp fica arriscado.

Correção recomendada:

- Adicionar testes unitários para `phone-normalizer`, `template-engine`, `csv`, `CampaignStore`, `CampaignScheduler`.
- Adicionar testes de segurança para safe path e URL sanitization.
- Adicionar ESLint/Prettier ou biome.
- Criar smoke test Electron com Playwright Electron se possível.

### P2.4 - Renderer usa scripts globais e acoplamento por ordem de carregamento

Evidência:

- `renderer/index.html` carrega scripts em sequência manual.
- `campaign-create.js` usa estado global como `window.waConnections`/`window.activeWaConnectionId`.
- `renderer.js`, `whatsapp-panel.js`, `campaign-create.js`, `campaign-monitor.js`, `whatsapp-chat.js` compartilham funções globais (`t`, `toast`, `log`, `selectCampaign`, etc.).

Impacto:

- Regressões por ordem de scripts.
- Difícil testar módulos isoladamente.
- Colisões de nomes e estado global.

Correção recomendada:

- Introduzir bundler leve ou módulos ES.
- Criar camada de state/store do renderer.
- Separar UI de side effects IPC.
- Remover dependências implícitas de globals.

### P2.5 - UI/design inconsistente e pouco acessível

Evidência:

- Muitos controles usam emojis/texto direto no HTML.
- Muitos estilos inline em `renderer/index.html`, `renderer/renderer.js`, `renderer/whatsapp-panel.js`, `renderer/whatsapp-chat.js`.
- Nem todos textos novos passam por i18n.
- Confirmações destrutivas usam `confirm()` nativo, sem contexto detalhado.

Impacto:

- Aparência inconsistente entre plataformas.
- Acessibilidade fraca para teclado/leitores.
- Difícil manter tema e responsividade.

Correção recomendada:

- Consolidar componentes: Button, Modal, Tabs, Toast, Table, EmptyState.
- Mover estilos inline para CSS.
- Usar ícones consistentes via biblioteca ou SVG local.
- Criar modais próprios para ações destrutivas com resumo de impacto.
- Adicionar foco visível e labels ARIA.

### P2.6 - Build e documentação estão desalinhados

Evidência:

- README cita `npm run build:portable` em `README.md:197`.
- `package.json:8-12` não define `build:portable`.
- Docs de WhatsApp em `docs/whatsapp-integration-plan.md` ainda estão como planejamento, mas muito já foi implementado.

Impacto:

- Dev novo falha seguindo README.
- Release fica confuso.

Correção recomendada:

- Corrigir README para `npm run build:win` ou adicionar script `build:portable`.
- Atualizar docs de planejamento para docs de arquitetura real.
- Adicionar matriz de comandos verificados.

### P2.7 - Pacote grande e sem política de distribuição

Evidência:

- `npm run build -- --dir` gerou `dist\win-unpacked` com cerca de 413 MB.
- `Sigma GMaps Scraper.exe` unpacked tem cerca de 211 MB.
- `renderer/sigma-logo.png` tem cerca de 1.5 MB.
- `package.json:32-46` inclui `node_modules/**/*`.

Impacto:

- Download pesado.
- Atualização difícil.
- SmartScreen mais provável sem assinatura.

Correção recomendada:

- Medir conteúdo real do asar e unpacked.
- Remover assets pesados e docs desnecessários do pacote.
- Usar imagens otimizadas.
- Avaliar updater diferencial no futuro.
- Assinar binário se distribuição pública for prioridade.

### P2.8 - Observabilidade insuficiente

Evidência:

- Muitos `catch (e) {}` vazios em `main.js`, `scraper.js`, renderer e providers.
- Logs são texto livre via `console.log` e terminal UI.
- Não há código de erro ou arquivo de diagnóstico consolidado.

Impacto:

- Suporte não sabe distinguir bloqueio do Maps, erro de rede, bug de seletor, QR expirado, número inválido, falha de provider.
- Usuário recebe "skip" ou "Erro" genérico.

Correção recomendada:

- Criar logger estruturado no main.
- Cada operação deve retornar `{ code, message, details, retryable }`.
- Exportar pacote de diagnóstico sem secrets.
- Guardar métricas de scrape: tentativas, skips por motivo, tempo por item.

## P3 - baixo impacto / limpeza

- `utils/csv.js` recebe `includeQueryColumn`, mas não usa o parâmetro.
- `index.js` tem query hard-coded `Cafe in Soppeng`; melhor virar exemplo documentado ou CLI com argumentos.
- `config.js` tem constantes WhatsApp (`WHATSAPP_MIN_INTERVAL_MS`, `WHATSAPP_MAX_MESSAGE_LENGTH`) que não são aplicadas de forma consistente.
- Há mistura de idioma PT/EN em código, logs e mensagens.
- Vários arquivos grandes de documentação Baileys ficam no repo raiz e podem confundir empacotamento/manutenção.

## Prioridade de correção sugerida

### Fase 0 - bloqueadores de segurança

1. Sanitizar `connectionId` e implementar `resolveInside`.
2. Remover leitura arbitrária de arquivo do IPC; usar capability de dialog.
3. Corrigir XSS da tabela, queue, dashboard, template preview e logs HTML.
4. Adicionar CSP e bloquear navegação/nova janela.
5. Atualizar Baileys/protobuf/ws e validar fluxo WhatsApp.

### Fase 1 - confiabilidade de dados

1. Normalizar telefone no main e persistir campos normalizados.
2. Corrigir Meta provider para falhar corretamente.
3. Tornar `CampaignStore` atômico, com backup e flush no shutdown.
4. Corrigir CSV/relatório vazio e cleanup de temporários.
5. Implementar cancelamento real do scraper.

### Fase 2 - operação e produto

1. Mover leads de `localStorage` para SQLite/JSONL.
2. Criar import/export/backup.
3. Adicionar testes unitários e smoke tests.
4. Criar códigos de erro e logs estruturados.
5. Atualizar README e docs reais de arquitetura.

### Fase 3 - design/manutenção

1. Modularizar renderer.
2. Reduzir globals e estilos inline.
3. Padronizar componentes e modais.
4. Melhorar acessibilidade e i18n.
5. Reduzir pacote e otimizar assets.

## Checklist mínimo antes de release público

- Nenhum P0 aberto.
- `npm audit --omit=dev` sem critical/high.
- Testes unitários cobrindo path safety, phone normalize, campaign scheduler, CSV, template engine.
- Build Windows limpo e smoke test de abrir app.
- Scrape com erro, sem resultado e resultado parcial testados.
- WhatsApp Baileys testado com QR, envio texto, envio mídia, reconnect e disconnect.
- Meta API testada com token válido e inválido.
- Export cancelado não deixa arquivo temporário.
- README com comandos reais.

## Observação sobre mudanças locais

Antes desta auditoria, o working tree já tinha modificações em arquivos principais como `main.js`, `preload.js`, `scraper.js`, `campaigns/*`, `renderer/*` e `whatsapp/baileys-provider.js`. A avaliação acima considera o estado atual desses arquivos e não tenta distinguir autoria das mudanças.
