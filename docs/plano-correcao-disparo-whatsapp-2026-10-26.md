# Plano de correção — disparo de WhatsApp "não funciona"

Data: 2026-10-26
Escopo: pipeline de campanhas (`campaigns/*` → `whatsapp/baileys-provider.js`) e os caminhos de UI/IPC que o alimentam.
Objetivo: transformar o disparo em algo que **ou envia, ou diz exatamente por que não enviou e por quanto tempo** — sem exigir reinício do app.

> Este documento é uma ordem de execução. As fases estão em ordem de risco; a Fase 1 sozinha já elimina o pior sintoma (campanha em `running` que nunca mais envia nada). Não pule para a UI antes de fechar a Fase 1.

---

## 1. Veredito

**Sim, o disparo está quebrado em cenários reais, e por motivos do nosso código — não por má configuração do usuário.**

Dez defeitos foram confirmados por leitura de código; cinco deles (C1, C3, C4, C5 e C8) também foram reproduzidos em execução nesta auditoria. Dois produzem exatamente o relato mais comum: *"cliquei em disparar, a campanha ficou em andamento e não saiu nada (e depois nunca mais saiu)"*.

| # | Prioridade | Defeito | Sintoma relatado pelo usuário |
|---|---|---|---|
| C1 | **P0** | Consulta `onWhatsApp` sem timeout congela o scheduler inteiro de forma permanente | "Começou a disparar, parou no meio e não volta nem reiniciando a campanha" |
| C2 | **P0** | Cota padrão de 10 msgs/dia por número + pausa que nunca retoma sozinha | "Disparou 10 e parou; no dia seguinte continua parada" |
| C3 | **P0** | Janela de disparo padrão 07:00–18:00 bloqueia silenciosamente o início noturno | "Iniciei à noite e não saiu nenhuma mensagem" |
| C4 | **P1** | Números com DDD 55 são **descartados** pelo normalizador | "Minha lista tem 200 leads e a campanha nasce com 150" / "não aceita nenhum destinatário" |
| C5 | **P1** | Campanha pode ser disparada por um número que **não é o dela** | "Recebi/disparei pelo número errado" ou "não saiu pelo número que escolhi" |
| C6 | **P1** | Validação `onWhatsApp` a cada destinatário (1 IQ por lead) | "Muitos leads falharam dizendo que o número não tem WhatsApp" |
| C7 | **P1** | Falha transitória queima as 2 tentativas e vira definitiva; não há botão de reenvio na UI | "10 falharam e não tem como reenviar" |
| C8 | **P2** | `{{variáveis}}` não resolvidas vão literais na mensagem | "Chegou 'Olá {{nome}}' para o cliente" |
| C9 | **P2** | Fechar/reiniciar o app deixa a campanha em estado que exige confirmação manual pouco óbvia | "Reabri o app e a campanha não continuou" |
| C10 | **P2** | Provider Meta não suporta mídia, mas campanha com mídia pode ser iniciada | "Todas as mensagens com imagem falharam" |

## 2. Caminho crítico hoje

```text
WhatsAppPanel (wizard) -> campaignAPI.start() -> IPC "campaign-start"
  -> CampaignManager.start()            (resolve provider, status=running)
  -> CampaignScheduler.start()          (_scheduleNextTick a cada 1s)
     -> tick(): janela de horário -> cota -> _pickNextSend()
        -> provider.sendMessage()       (resolveSendJid -> socket.sendMessage)
```

Arquivos que importam nesta correção:

- `campaigns/campaign-scheduler.js` — loop, cota, janela, retry, escolha de número.
- `campaigns/campaign-manager.js` — ciclo de vida, retomada, tracking.
- `whatsapp/baileys-provider.js` — resolução de JID e envio real.
- `whatsapp/phone-normalizer.js` — aceitação de telefone.
- `main.js` — defaults de configuração, sanitização IPC, pausa ao fechar.
- `renderer/src/components/WhatsAppPanel.jsx` — status exibido, botões, qual número é escolhido.

## 3. Causas confirmadas

### C1 — P0: consulta sem timeout congela o scheduler para sempre

Cadeia exata:

1. `whatsapp/baileys-provider.js:138` — `makeWASocket({ ... defaultQueryTimeoutMs: undefined ... })`. Em Baileys, `promiseTimeout(undefined, fn)` devolve `new Promise(fn)` **sem timeout** (`node_modules/@whiskeysockets/baileys/lib/Utils/generics.js:112`). Ou seja: toda query IQ fica pendurada indefinidamente se o servidor não responder.
2. `whatsapp/baileys-provider.js:1049-1053` — `resolveSendJid()` chama `sock.onWhatsApp(d)` para cada destinatário novo. `onWhatsApp` é uma query (`Socket/socket.js:219`).
3. `campaigns/campaign-scheduler.js:326-328` — o `await provider.sendMessage(...)` não tem timeout próprio.
4. `campaigns/campaign-scheduler.js:45-51` — o próximo tick só é agendado **depois** que `tick()` resolve. Um `await` pendurado mata o loop.
5. `campaigns/campaign-scheduler.js:30-33` — `start()` retorna cedo quando `this.running === true`. Com o timer morto e `running` ainda `true`, **nenhum** `start()`, `resume()` ou nova campanha rearma o scheduler. Só reiniciar o app.

Prova (sonda executada com o Node embutido do Electron): uma campanha c1 com um envio que nunca retorna impediu a campanha c2 de enviar qualquer coisa por 15s, com `scheduler.running === true` e `start()` sem efeito.

```text
[SCHEDULER] Enviando campanha=c1 conn=a lead=c1-1 dest=5511900000001
5s  -> running: true | enviados c2: 0 | c1 pendente: pending | c2 pendente: pending
15s -> running: true | enviados c2: 0 | c2 status campanha: running
=> scheduler travado em um envio pendente? true
```

Impacto: é a explicação mais provável para "parou e não volta". Também explica congelamento silencioso quando o celular cai de rede sem o socket perceber (status continua `connected`).

Correção:
- `makeWASocket`: definir `defaultQueryTimeoutMs: 60000` (padrão do Baileys). Isso sozinho remove a pendência infinita da query.
- `BaileysProvider.sendMessage` / `sendMedia`: envolver `sock.sendMessage` em `Promise.race` com timeout (60s) e devolver `{ success:false, error:'timeout' }`.
- `CampaignScheduler`: timeouts explícitos — `SEND_TIMEOUT_MS = 120_000` para o envio e um watchdog de tick (`_tickStartedAt`; se passar de 5 min, logar, forçar `running=false` e rearmar).
- `_scheduleNextTick`: rearmar no `finally`, nunca só no caminho feliz; zerar `_tickTimer` quando ele dispara.
- `start()`: se `running === true` e `_tickTimer` estiver nulo/vencido, considerar timer morto e rearmar em vez de retornar.
- Lead que estoura timeout: `status='failed'`, `errorMessage='Tempo esgotado no envio — confirme no WhatsApp antes de reenviar'`. **Não** repetir automaticamente (evita duplicidade se a mensagem tiver saído).

Aceite: teste com provider que nunca resolve → outra campanha continua enviando; lead marcado como falha por timeout; `start()` novo volta a andar sem reiniciar o app.

### C2 — P0: 10 mensagens/dia por padrão e uma pausa que não retoma

- Default em `main.js:129-139`: `dailyLimit: 10`, `unlockedLimits: [10]`.
- `campaigns/campaign-scheduler.js:236-262`: ao bater a cota, a campanha vira `paused` com `pauseReason='daily_limit'` e **sai** de `activeCampaigns`.
- O evento gravado diz *"campanha salva e retoma depois"* (`campaign-scheduler.js:249-252`), mas nada retoma: `CampaignManager.autoResume()` (`campaign-manager.js:118`) **não é chamado em nenhum ponto de produção** (só em teste). Nem no boot, nem na virada do dia, nem quando o provider reconecta.
- A UI está correta ao dizer que exige retomada explícita (`WhatsAppPanel.jsx:6130-6180`, `5349-5362`), então a mensagem do scheduler contradiz a UI.

Impacto: para uma lista de 200 leads, o usuário vê a campanha "morrer" no 10º envio. É o segundo relato mais provável. Some-se a isso: ao retomar no mesmo dia, o tick re-pausa imediatamente (comportamento correto, mas sem informar quando libera).

Correção:
- Calcular e expor `nextEligibleAt` (próxima meia-noite local, ou próximo início de janela) em cada campanha pausada por cota; mostrar no card ("cota 10/10 · retoma 00:00").
- Implementar a retomada prometida: manter campanhas `daily_limit` em um conjunto de espera no scheduler (não removê-las de vez) e retomá-las automaticamente quando `quota.check` voltar a permitir, **ou** ligar `autoResume({confirmed:true})` no boot e no evento de provider conectado. Recomendação: automático para `daily_limit`, com setting `autoResumeDailyLimit` (padrão ligado) e registro no eventLog.
- Corrigir o texto do evento para refletir o comportamento implementado.
- Mostrar cota restante por número no card e no monitor ("7 de 10 hoje").

Aceite: campanha de 30 leads com cota 10 envia 10, fica `paused` com horário de retomada visível e volta sozinha após o reset (teste com relógio injetado).

### C3 — P0: janela 07:00–18:00 por padrão

- Default em `main.js:137-139`: `workingHoursEnabled: true`, `07:00`–`18:00`.
- `campaigns/campaign-scheduler.js:407-440`: campanha sem `schedule.workingHours` herda a janela global. Fora dela, o tick só grava `waitReason='outside_hours'` e continua `running` **sem nunca enviar**.
- Sonda confirma: `19:00` com settings vazios → `false` (bloqueado); `19:00` com `workingHoursEnabled:false` → `true`.

Impacto: quem instala e testa à noite conclui que "o disparo não funciona". A UI mostra o badge "Fora do horário", mas só depois que o usuário abre a campanha; não há previsão de horário nem confirmação no clique de iniciar.

Correção:
- No `campaign-start`, quando a campanha cair fora da janela, devolver `{ success:true, waiting:{ reason:'outside_hours', nextEligibleAt } }` e a UI exibir confirmação explícita: *"Fora da janela 07:00–18:00. Disparar mesmo assim?"* com opção "Disparar agora" (que grava `workingHours.enabled=false` para essa campanha) ou "Agendar para 07:00".
- Exibir `nextEligibleAt` no card e notificar uma vez (já existe notificação para `outside_hours`, mas ela não diz quando volta).
- No wizard, deixar a janela visível no passo de agendamento (já existe o resumo em `5349-5362`; falta destacar quando a janela está ativa e o horário atual está fora).

Aceite: iniciar às 19h mostra confirmação; "disparar agora" envia; "agendar" deixa `scheduled` com horário correto.

### C4 — P1: números com DDD 55 são descartados

`whatsapp/phone-normalizer.js:1-38` decide se o número "já tem código do país" apenas olhando `digits.startsWith('55')`. DDD 55 é uma região real (RS), então qualquer número local dessa região é lido como já internacional e reprovado pelo mínimo de dígitos.

Prova (sonda executada):

```text
"55999999999"          -> {"valid":false,"reason":"Número deve ter pelo menos 12 dígitos"}
"(55) 99999-9999"      -> {"valid":false,"reason":"Número deve ter pelo menos 12 dígitos"}
"(55) 3222-1234"       -> {"valid":false,"reason":"Número deve ter pelo menos 12 dígitos"}
"+55 55 99999-9999"    -> {"valid":true,"number":"5555999999999"}
"11999999999"          -> {"valid":true,"number":"5511999999999"}
```

Como `sanitizeCampaignRecipient` (`main.js:691+`) retorna `null` quando `normalizePhone` falha, esses leads são **silenciosamente removidos** da lista no `campaign-create` (`main.js:810-825`). Se a seleção inteira for dessa região, o create falha com "Nenhum destinatário válido (telefone ou grupo)".

O telefone vem cru do Maps (`utils/businessData.js:66-68`, ex.: `"(55) 3222-1234"`), então isso atinge leads reais.

Correção:
- Reescrever `normalizePhone` com regra explícita de comprimento: se o número (sem `+`) tem 10–11 dígitos, é local → prefixar o país; se tem 12–13 dígitos e começa com o código do país, é internacional; `+` sempre força internacional. Nunca inferir país só pelo prefixo.
- Manter a decisão de "9º dígito" em `resolveSendJid`, não no normalizador.
- Adicionar casos ao teste (`test/phone-normalizer.test.js` hoje não cobre DDD 55).

Aceite: `(55) 99999-9999` → `5555999999999`; `(55) 3222-1234` → `555532221234`; `+55 55 ...` idem; `(21) 99999-8888` continua igual; nada de regressão nos testes atuais.

### C5 — P1: disparo pelo número errado

Dois caminhos independentes:

1. `campaigns/campaign-scheduler.js:130-145` — se nenhum número da campanha estiver disponível, o passo 3 ("qualquer sessão online com cota") escolhe **qualquer** provider conectado, fora de `campaign.connectionIds`. Sonda confirma: campanha ligada a `numero-da-campanha` (offline) escolheu `numero-pessoal` (online) e o envio seguiria por ele.
2. `renderer/src/components/WhatsAppPanel.jsx:3561-3598` — `handleStartCampaign` prefere `activeConnectionId` (o número que está aberto na UI) **antes** do número da campanha. Com dois números, iniciar uma campanha criada para o número A enquanto a UI está no número B faz rebind para B.

Impacto: mensagens saindo de um número que o usuário não escolheu (risco de banir o número pessoal) ou "não saiu pelo número que eu configurei".

Correção:
- Remover o fallback para sessões fora da campanha; `_pickNextSend` deve considerar apenas `_campaignConnectionIds(campaign)`. Se todas estiverem offline, devolver `blocked: 'no_provider'` com a lista de números e status.
- Inverter a ordem no `handleStartCampaign`: `campaign.connectionId` → `activeConnectionId` só quando a campanha não tem número.
- Se o número escolhido estiver offline, bloquear com erro explícito ("Número 55… está desconectado") em vez de trocar silenciosamente. Rebind só com confirmação do usuário.
- Registrar em cada lead `sentWith` (connectionId real) e exibir no relatório.
- Cobrir com teste: `_pickNextSend` nunca retorna id fora de `connectionIds`.

Aceite: campanha de A com A offline não envia nada e explica; com A online, todo envio sai por A.

### C6 — P1: `onWhatsApp` a cada destinatário

`resolveSendJid` (`baileys-provider.js:958-1085`) faz uma query USync por lead novo (até 2 quando tenta variante com/sem 9). Consequências:

- Latência: cada lead paga um round-trip antes do envio; em campanha com intervalo curto o loop fica refém da rede.
- Falha em massa: se o USync for limitado/instável, `resolveSendJid` **lança** `Número X não tem WhatsApp` (`1063-1085`) e o lead queima tentativas mesmo tendo WhatsApp.
- É o gatilho do C1 quando a query não retorna.

Correção:
- Cachear o resultado por telefone (ex.: 24h, persistido em `userData`) e pular a validação quando o JID já é conhecido (`_knownChatJid`) ou já foi validado antes.
- Em erro/timeout da consulta, **cair para o JID calculado** (`55…@s.whatsapp.net`) e deixar o ACK do envio dizer se existe; só marcar falha definitiva quando o envio em si falhar.
- Limitar a taxa de consultas (ex.: no máximo 1 USync a cada 2s, em lote) ou remover a validação do caminho de campanha (usar `sock.sendMessage` e tratar o erro).

Aceite: campanha de 50 leads não faz 50 USyncs; um `onWhatsApp` que estoura timeout não impede o envio.

### C7 — P1: retry sem backoff, terminal em 3 falhas, sem reenvio na UI

- `campaign-scheduler.js:20` — `_maxRetries = 2`; `355-366` — o retry acontece no próximo tick (5s depois), sem backoff e sem distinguir erro transitório de definitivo.
- `campaign-store.js` guarda `errorMessage`, mas não há botão de reenvio: `campaign-retry-failed` existe em `main.js:3820` e `preload.js:77`, porém **nenhum componente chama** `retryFailed`.
- Leads `failed` são terminais; a UI só os lista.

Correção:
- Backoff exponencial com jitter (30s, 2min, 10min) para erros transitórios (timeout, conexão, rate limit); falha definitiva (número inválido, arquivo de mídia ausente) sem retry.
- Botão "Reenviar falhas (N)" no card e no monitor, chamando `campaignAPI.retryFailed(campaignId, connectionId)` e mostrando o retorno.
- Exibir `errorMessage` + `retryCount` por lead no monitor.

### C8 — P2: variáveis não resolvidas vão literais

`campaigns/template-engine.js:26-34,74-83` mantém o `{{match}}` quando o campo do lead está vazio. Sonda: `interpolate('Oi {{nome}}', {name:''})` → `"Oi {{nome}}"`. O scheduler valida apenas "mensagem não vazia" (`campaign-scheduler.js:316-318`), então a mensagem sai com placeholder.

Correção: escolher uma política (recomendado: remover o placeholder e normalizar espaços; se sobrar vazio, cair para o texto padrão da campanha) e bloquear o início quando o template tiver variável que nenhum lead possui (`extractVariables` já existe). Avisar no preview do wizard.

### C9 — P2: continuidade após fechar/reiniciar

- `main.js:452-462` — `pauseActiveCampaignsFromTray()` marca campanhas ativas como `paused` + `tray_safe_pause` ao encerrar, e elas **não** voltam sozinhas (`interruptForRestart` só trata `running`, `scheduled` e `paused+daily_limit`).
- Campanha `running` no boot vira `interrupted` (`campaign-manager.js:142-215`) e exige confirmação. O card mostra o status cru "interrupted" (o mapa de rótulos em `WhatsAppPanel.jsx:5049-5060` não tem essa chave) e o botão existe, mas não há um aviso na primeira abertura.

Correção: rótulo claro ("Interrompida — retomar?"), aviso no boot com a lista (reaproveitando o modal de horário perdido), e um botão explícito para retomar as pausadas por encerramento.

### C10 — P2: mídia em provider Meta

`whatsapp/meta-provider.js:74-76` devolve erro para qualquer mídia, mas `CampaignManager.start` não impede iniciar campanha com mídia em `provider==='meta'`. Resultado: 100% de falhas. Correção: validar no start e bloquear com mensagem clara.

## 4. O que ainda não é possível afirmar

- Não há telemetria de campanha: `utils/app-metrics.js` registra eventos de app, não resultado de envio. **Não é possível medir a proporção de usuários afetados por C1 vs C2/C3 hoje** — só a Fase 0 resolve isso.
- Não há acesso às máquinas dos usuários nem a logs de produção. Os `app-*.log` do repositório são de uma sessão de dev (25/09) e não contêm tentativa de disparo.
- Portanto: as causas acima são **reproduzidas em código**, mas a ordem de frequência em campo precisa do diagnóstico da Fase 0.

## 5. Plano de execução

### Fase 0 — Instrumentar antes de mexer (0,5 dia)

1. Log estruturado por envio em `campaign-scheduler.js`: `campaignId`, `leadId`, `connectionId`, `providerStatus`, `result`, `durationMs`, `error`.
2. Persistir os últimos 200 envios por campanha (`campaign.eventLog` já existe; usar `type:'send-attempt'`).
3. Contadores em `utils/app-metrics.js`: `campaign_start`, `campaign_send_ok`, `campaign_send_fail:{reason}`, `campaign_wait:{reason}`, `campaign_timeout`.
4. Painel "Diagnóstico de disparo" em Configurações: status de cada sessão, cota usada/limite, janela ativa, próximos horários elegíveis, últimas 20 tentativas com erro.

Aceite: com o log de um usuário é possível dizer em 1 minuto se o problema é cota, janela, número offline, timeout ou número inválido.

### Fase 1 — Scheduler à prova de travamento (P0, ~1 dia)

Arquivos: `campaigns/campaign-scheduler.js`, `whatsapp/baileys-provider.js`.

1. `defaultQueryTimeoutMs: 60000` no `makeWASocket`.
2. Timeout em `sendMessage`/`sendMedia` do provider e no `await` do scheduler.
3. `_scheduleNextTick` com rearme em `finally` + watchdog de tick (5 min).
4. `start()` recupera timer morto.
5. Timeout vira `failed` com mensagem de verificação (sem retry automático).
6. Testes: `test/campaign-scheduler-hang.test.js`.

Aceite: nenhuma campanha fica `running` sem timer ativo; teste de hang passa.

### Fase 2 — Destino e número corretos (P1, ~1 dia)

Arquivos: `campaigns/campaign-scheduler.js`, `campaigns/campaign-manager.js`, `renderer/src/components/WhatsAppPanel.jsx`, `whatsapp/phone-normalizer.js`.

1. Remover fallback para sessões fora da campanha (C5).
2. Inverter preferência de número no start e exigir confirmação para rebind.
3. Reescrever `normalizePhone` (C4) + testes de DDD 55.
4. `sentWith` por lead e exibição no relatório.

Aceite: testes de C4 e C5 verdes; nenhum envio fora de `connectionIds`.

### Fase 3 — Previsibilidade de cota e janela (P0/P1, ~1,5 dia)

Arquivos: `campaigns/campaign-scheduler.js`, `campaigns/campaign-manager.js`, `main.js`, `WhatsAppPanel.jsx`.

1. `nextEligibleAt` para `daily_limit` e `outside_hours`.
2. Retomada automática de `daily_limit` (setting `autoResumeDailyLimit`, padrão ligado) ou, no mínimo, boot + virada do dia.
3. Confirmação explícita ao iniciar fora da janela, com "disparar agora"/"agendar 07:00".
4. Rótulos de status e texto do evento corrigidos (C9 incluso).
5. Cota restante no card.

Aceite: cenários de 19h e de cota estourada acontecem sem reinício e sem mensagem enganosa.

### Fase 4 — Provider e confiabilidade de envio (P1, ~2 dias)

Arquivos: `whatsapp/baileys-provider.js`, `campaigns/campaign-scheduler.js`, `whatsapp/meta-provider.js`.

1. Cache de `onWhatsApp` + fallback para JID calculado em erro/timeout (C6).
2. Lote/limite de taxa de consultas.
3. Backoff e classificação de erro transitório vs definitivo (C7).
4. Bloqueio de campanha com mídia em Meta (C10).
5. Política de variável não resolvida (C8) — no template-engine, com teste.

Aceite: `onWhatsApp` indisponível não impede envio; retry respeita backoff.

### Fase 5 — UI de falha e reenvio (P1, ~1 dia)

Arquivos: `WhatsAppPanel.jsx`, `preload.js` (já expõe o necessário).

1. Botão "Reenviar falhas (N)".
2. Colunas erro/tentativas/número no monitor.
3. Notificação única e acionável para cada motivo de espera.

### Fase 6 — Fechamento (0,5 dia)

1. `npm test` completo (comando do projeto: `node --test`).
2. Checklist manual com **dois números**: A online e B offline; campanha em A deve enviar por A. Repetir após 19h e após estourar cota.
3. Build empacotado (`npm run build:renderer`) e smoke do painel de diagnóstico.

## 6. Testes a adicionar

| Arquivo | Cobre |
|---|---|
| `test/campaign-scheduler-hang.test.js` | envio pendurado não congela outras campanhas; timeout vira falha clara; `start()` recupera timer morto |
| `test/campaign-scheduler-routing.test.js` | `_pickNextSend` nunca sai de `connectionIds`; bloqueio quando todas offline; cota por número |
| `test/campaign-scheduler-window.test.js` | 07–18, 24h, janela que cruza meia-noite, `nextEligibleAt` |
| `test/phone-normalizer.test.js` (ampliar) | DDD 55 móvel/fixo, `+55`, número já com país, curto demais |
| `test/daily-quota-resume.test.js` | reset por dia e retomada automática com relógio injetado |
| `test/template-engine.test.js` (novo) | variável vazia não gera `{{x}}` literal |

Execução: `node --test` (neste ambiente não há `node` no PATH; usar `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe --test` ou o Node instalado do dev).

## 7. Definition of Done

1. Nenhum caminho deixa campanha `running` sem timer ativo (teste de hang).
2. Nenhum envio sai por número fora de `campaign.connectionIds`.
3. Telefone com DDD 55 é aceito e enviado.
4. Iniciar fora da janela ou com cota esgotada tem previsão explícita de retomada, sem reiniciar o app.
5. Falha tem motivo legível e botão de reenvio.
6. `npm test` verde e checklist manual de dois números executado.

## 8. Riscos e não-objetivos

- **Não** aumentar o limite diário padrão: 10/dia é proteção anti-ban. O problema é a comunicação e a retomada, não o teto.
- **Não** remover a confirmação de retomada após reinício (proteção contra disparo acidental ao abrir o app).
- **Não** mexer no tracking (delivered/read/reply) nesta rodada além do necessário para exibir erro.
- Risco da Fase 1: timeout marca lead como `failed` mesmo se a mensagem saiu (rede lenta). Mitigação: mensagem orienta conferir no WhatsApp e o reenvio é manual.
- Risco da Fase 2: remover o fallback pode deixar campanhas antigas sem número válido. Mitigação: bloquear com instrução de reconectar, não trocar de número.

## 9. Ordem de commits

1. `fix(whatsapp): aplicar timeout em queries e envios do Baileys`
2. `fix(campaigns): watchdog e rearme do scheduler após envio pendurado`
3. `fix(campaigns): restringir disparo aos números da campanha`
4. `fix(whatsapp): aceitar telefones com DDD 55 no normalizador`
5. `feat(campaigns): previsão de retomada para cota e janela`
6. `fix(campaigns): backoff e reenvio de falhas`
7. `feat(ui): diagnóstico de disparo e botão de reenviar falhas`
