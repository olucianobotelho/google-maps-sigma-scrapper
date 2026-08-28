# Plano de estabilização — Campanhas e Lead Scoring

Data: 2026-07-10  
Repositório: `E:\CODE\gmaps\sigma-gmaps-scraper`  
Objetivo: deixar criação, edição, execução e acompanhamento de campanhas confiáveis; tornar “Quem ligar primeiro” inteligente ao distinguir site próprio, rede social, agregador, construtor gratuito, domínio suspeito e site realmente analisável.

> Este documento é uma ordem de execução para um agente com pouco contexto. Não pule fases, não refatore tudo de uma vez e não considere o trabalho concluído apenas porque `npm test` passou.

## 1. Resultado esperado

Ao final:

1. Qualquer campo do wizard de campanha aceita clique, foco, seleção, digitação, apagar, colar e navegação por teclado em 100% das tentativas.
2. Criar e editar campanha preserva nome, mensagem, agenda, conexão, destinatários e metadados.
3. O nome do contato segue uma política clara de resolução e não vira número quando existe `pushName`, nome salvo, nome do chat ou nome comercial.
4. Lead Scoring classifica a URL antes de tentar crawlear ou chamar IA.
5. Instagram, Facebook, WhatsApp, Linktree e similares não são tratados como “site próprio”.
6. Domínios gratuitos, estacionados, inválidos, suspeitos ou inacessíveis recebem estados diferentes — nunca o mesmo diagnóstico genérico.
7. Score determinístico decide a base; IA explica e personaliza, mas não inventa evidência nem altera silenciosamente fatos técnicos.
8. Campanha criada pelo Lead Scoring abre no mesmo wizard normal, permitindo revisão antes de salvar.
9. Testes unitários, integração Electron, E2E de UI e validação empacotada comprovam o comportamento.

## 2. Como a aplicação funciona hoje

### 2.1 Fluxo principal

```text
Google Maps / scraping
  -> utils/businessData.js extrai lead
  -> renderer guarda sigma_leads no localStorage
  -> LeadScoring normaliza e analisa
  -> lead-scoring/ProspectingStore persiste JSON em userData
  -> usuário seleciona leads/grupos
  -> WhatsAppPanel monta destinatários
  -> preload expõe campaignAPI
  -> main.js sanitiza payload IPC
  -> CampaignManager / CampaignStore persistem campaigns.json
  -> CampaignScheduler interpola template e envia pelo provider Baileys
  -> ACK, presença e mensagens recebidas atualizam funil da campanha
```

### 2.2 Arquivos que formam o caminho crítico

- `renderer/src/components/WhatsAppPanel.jsx`: conexão, contatos, chats, wizard, edição, monitoramento e campanhas. Arquivo grande e sensível.
- `renderer/src/components/LeadScoring.jsx`: seleção da pesquisa, análise, filtros, grupos e criação direta de campanha.
- `renderer/styles.css`: modal, regiões `drag/no-drag`, `pointer-events`, inputs e layout.
- `preload.js`: contratos `campaignAPI`, `chatAPI` e `leadScoringAPI`.
- `main.js`: registro IPC, validação, normalização e coordenação entre serviços.
- `campaigns/campaign-store.js`: persistência local atômica.
- `campaigns/campaign-manager.js`: ciclo de vida, conexão e tracking.
- `campaigns/campaign-scheduler.js`: fila e envio.
- `campaigns/template-engine.js`: variáveis e spintax.
- `whatsapp/baileys-provider.js`: contatos, aliases PN/LID, `pushName`, chats e envio.
- `lead-scoring/normalizer.js`: modelo canônico do lead.
- `lead-scoring/site-crawler.js`: URL, crawl e sinais técnicos.
- `lead-scoring/scoring-engine.js`: score determinístico.
- `lead-scoring/ai-sales-analyzer.js`: provedores, prompt, parser e fallback.
- `lead-scoring/prospecting-store.js`: análises, grupos e configurações.

## 3. Diagnóstico comprovado no código atual

### P0 — Falta prova real do wizard

O modal já contém vários remendos de foco: portal para `document.body`, `no-drag`, `pointer-events: auto`, `stopPropagation`, state local no `CampaignNameInput` e foco programático. Isso confirma que o problema já ocorreu, mas não existe teste que clique e digite no Electron real. O smoke atual abre somente `renderer/dist/index.html`; como não carrega `main.js`, os IPCs não existem. Ele não serve para validar campanhas.

Risco: cada ajuste de CSS, portal, presença do WhatsApp ou re-render pode reintroduzir perda de foco sem a suíte perceber.

### P0 — Classificação de URL insuficiente

`hasOwnDomain()` é uma regex negativa curta. Problemas:

- não cria um tipo de URL explícito;
- lista de plataformas incompleta;
- substring pode gerar falso positivo/falso negativo;
- não considera domínio registrável/eTLD+1;
- não separa rede social, agregador, marketplace, construtor gratuito, subdomínio gratuito, encurtador, estacionamento e domínio suspeito;
- falha de crawl vira um objeto parecido com “site ruim”, podendo somar dor digital indevida.

### P0 — “Tem website” não significa “tem site analisável”

`LeadScoring.jsx` aceita como site qualquer texto com aparência de URL. Links sociais podem entrar no lote, sofrer crawl e depois ser pontuados como site. A decisão precisa acontecer antes do crawler.

### P1 — Nome do WhatsApp depende de informação eventualmente observada

Baileys aprende `pushName` principalmente por mensagens recebidas. Contato sem mensagem recente, alias LID ainda não mapeado ou cache antigo pode aparecer como número. Existem várias fontes de nome, mas não há um resolvedor único com prioridade, origem, confiança e atualização retroativa das campanhas.

### P1 — Campanha perde campos na edição

O modo “editar” é apresentado como edição da lista, mas também envia `name`, `template` e `leads`. O mapeamento de volta preserva poucos metadados do lead. Campos de scoring, datas de tracking e dados comerciais podem desaparecer ou voltar vazios ao salvar.

### P1 — Criação pelo Lead Scoring pula revisão

`lead-scoring-create-campaign` cria diretamente uma campanha com `{{mensagem_whatsapp_ia}}`. O usuário não revisa conexão, destinatários sem nome, mensagens vazias, agenda ou preview final no wizard normal.

### P1 — Inconsistências de domínio do score

Há valores `alta`, `boa`, `baixa`, `ignorar`, enquanto partes da UI filtram `alta`, `media`, `baixa`. Também aparecem `priority` e `classification` com significados diferentes. Isso pode esconder leads e gerar campanhas incompletas.

### P1 — Risco de regressão no manager

`CampaignManager` contém `setProvider` definido duas vezes; a segunda definição vazia substitui a primeira. O fluxo novo usa `providersMap`, mas a duplicação deve ser removida e coberta por teste para não quebrar chamadas legadas.

### P2 — Arquivo de UI grande demais

`WhatsAppPanel.jsx` reúne muitas responsabilidades e estados que atualizam com frequência. Isso aumenta re-renders e torna bugs intermitentes difíceis de isolar. A correção deve extrair módulos gradualmente, mantendo comportamento.

## 4. Arquitetura-alvo

### 4.1 Classificador determinístico de presença digital

Criar `lead-scoring/url-classifier.js`. Entrada: valor bruto encontrado no Google Maps. Saída obrigatória:

```js
{
  rawUrl,
  normalizedUrl,
  finalUrl,
  hostname,
  registrableDomain,
  kind,              // own_domain | social | link_aggregator | marketplace |
                     // free_builder | hosted_subdomain | shortener | parked |
                     // suspicious | invalid | unreachable | none
  platform,          // instagram, facebook, linktree, wix, etc.
  crawlPolicy,       // full | lightweight | skip
  confidence,        // 0..1
  reasons: [],
  riskFlags: []
}
```

Regras:

1. Normalizar espaços, esquema, `www`, Unicode/punycode e URL de redirect conhecida.
2. Usar parser de domínio público (`tldts` ou equivalente mantido), não regex caseira para eTLD+1.
3. Comparar hostname exato ou sufixo com ponto. Nunca `includes('facebook')`.
4. Manter catálogo testável por categoria:
   - social: Instagram, Facebook, TikTok, LinkedIn, X, YouTube;
   - mensageria: `wa.me`, `api.whatsapp.com`, Telegram;
   - agregadores: Linktree, Beacons, Bio.site, Campsite, Taplink;
   - marketplaces/diretórios: iFood, GetNinjas, Doctoralia, TripAdvisor e similares;
   - builders/hosted: Wixsite, WordPress.com, Blogspot, Google Sites, Canva Site, Webnode;
   - encurtadores: bit.ly, tinyurl etc.; resolver redirect com limite e proteção SSRF;
   - estacionamento: sinais HTTP/HTML e provedores conhecidos.
5. `social`, `messaging`, `link_aggregator`, `marketplace` e `none`: não fazer crawl completo.
6. `own_domain`: crawl completo.
7. `free_builder`/`hosted_subdomain`: crawl permitido, mas marcar ausência de domínio próprio.
8. `invalid`, `suspicious` e `unreachable`: nunca inferir ausência de pixel, formulário ou mobile a partir de HTML vazio.

### 4.2 Modelo canônico de lead

Adicionar ao lead:

```js
digitalPresence: {
  primaryUrl,
  type,
  platform,
  ownDomain,
  reachable,
  domainQuality,
  riskFlags,
  classifiedAt,
  classifierVersion
}
```

Manter `company.website` por compatibilidade, mas toda decisão nova usa `digitalPresence`.

### 4.3 Score por fatos, não por falha de coleta

Separar:

- oportunidade comercial;
- qualidade da presença digital;
- facilidade de contato;
- confiança dos dados;
- sinais técnicos comprovados.

Nunca pontuar “sem HTTPS/pixel/formulário/mobile” quando crawl falhou. Nesse caso, registrar `unknown`, reduzir confiança e permitir nova tentativa.

Política sugerida:

- sem presença digital: oportunidade para criação de site;
- somente social/agregador/marketplace: oportunidade para domínio/site próprio;
- subdomínio gratuito: oportunidade de profissionalização;
- domínio próprio fraco: oportunidade de correção/CRO;
- domínio suspeito/estacionado: oportunidade possível, mas requer revisão humana;
- site próprio saudável: menor dor imediata, sem punição artificial;
- inacessível: fila “revisar”, não “ligar primeiro” automaticamente.

IA recebe a classificação como fato fechado e deve citar `evidenceIds`. Ela pode explicar e gerar abordagem; não pode mudar `kind`, `reachable`, HTTPS, pixel ou formulário.

### 4.4 Resolvedor único de nomes

Criar `whatsapp/contact-identity-resolver.js` com esta prioridade:

1. nome definido manualmente no Sigma;
2. nome salvo/sincronizado do contato;
3. `verifiedName`/nome comercial;
4. `pushName` mais recente recebido;
5. nome válido do chat;
6. nome da empresa vindo do Maps/Lead Scoring;
7. telefone formatado.

Saída:

```js
{ displayName, source, confidence, updatedAt, jid, phoneJid, lidJid }
```

Requisitos:

- consolidar aliases PN/LID antes de deduplicar;
- persistir a melhor identidade por telefone/JID;
- atualizar destinatários `pending` quando um nome melhor surgir;
- não alterar nome histórico de mensagem já enviada;
- permitir edição manual no wizard;
- mostrar badge discreto “WhatsApp”, “Maps”, “manual” ou “número”.

### 4.5 Draft único de campanha

Criar `renderer/src/campaigns/`:

- `CampaignWizard.jsx`
- `CampaignBasicsStep.jsx`
- `CampaignRecipientsStep.jsx`
- `CampaignMessageStep.jsx`
- `CampaignScheduleStep.jsx`
- `CampaignReviewStep.jsx`
- `useCampaignDraft.js`
- `campaign-draft.js`
- `recipient-mapper.js`

O draft deve ter schema/versionamento e ser a única fonte de verdade. Não misturar state local que sincroniza de volta durante digitação.

```js
{
  version: 1,
  id: null,
  name: '',
  connectionIds: [],
  recipients: [],
  template: { text: '', media: null },
  schedule: { mode: 'interval', intervalMs: 30000, startAt: null },
  dirty: false,
  source: 'manual' // manual | lead_scoring | group | duplicate
}
```

Lead Scoring deve abrir esse wizard com draft preenchido. Só o botão final chama `campaignAPI.create`.

## 5. Plano de execução obrigatório

### Fase 0 — Congelar baseline e reproduzir

1. Criar branch `codex/campaigns-lead-scoring-stabilization` somente quando autorizado.
2. Salvar `git status --short` e nunca apagar mudanças existentes.
3. Documentar versões Node, Electron, Baileys e SO.
4. Criar fixtures sem dados pessoais:
   - contato com `pushName`;
   - contato PN e LID;
   - contato só com número;
   - lead Maps com nome de empresa;
   - URLs de cada categoria.
5. Reproduzir e gravar evidência dos bugs:
   - abrir/fechar wizard 20 vezes;
   - digitar nome, manual, busca e mensagem;
   - editar campanha pronta/pausada/concluída;
   - deixar eventos de presença/chats chegando enquanto digita.
6. Não corrigir antes de existir teste falhando para cada bug reproduzido.

Aceite: relatório curto com passos, resultado atual, console e teste vermelho.

### Fase 1 — Harness Electron real

1. Substituir/estender `scripts/smoke-ui.js` para iniciar o entrypoint real ou registrar mocks IPC completos.
2. Preferir Playwright Electron (`_electron.launch`) para E2E.
3. Criar API de teste ativada apenas por `SIGMA_E2E=1`, com userData temporário e provider fake.
4. Provider fake deve simular conexão, contatos, aliases, envio, ACK, resposta e falha.
5. Cada teste usa diretório temporário isolado e o remove ao final.

Testes mínimos:

- abrir campanhas;
- abrir wizard;
- focar cada input e digitar frase inteira;
- eventos externos durante digitação não mudam valor/foco;
- navegar cinco passos;
- criar, reabrir e editar;
- reiniciar app e confirmar persistência.

Aceite: zero erro de IPC, zero React error, screenshots em falha e teste repetido 10 vezes sem flake.

### Fase 2 — Corrigir foco e draft

1. Extrair wizard do `WhatsAppPanel` sem mudar layout primeiro.
2. Remover `onMouseDown/stopPropagation` redundantes após teste provar necessidade ou inutilidade.
3. Manter `-webkit-app-region: drag` apenas na titlebar; todo conteúdo/modal deve ser `no-drag` por regra simples.
4. Garantir que nenhum overlay invisível tenha `pointer-events: auto`.
5. Usar campos controlados pelo draft; não sincronizar `initialValue` em re-render comum.
6. Dar keys estáveis aos passos/recipients. Nunca usar valor editável como key.
7. Implementar foco inicial uma vez ao abrir, não em eventos de presença.
8. Avisar ao fechar draft sujo.

Aceite: 100 ciclos de foco/digitação em CI local; clique, Tab, Shift+Tab, Ctrl+A, Backspace e colar funcionam.

### Fase 3 — Contratos e persistência de campanhas

1. Definir schema compartilhado em módulo puro e versionado.
2. Validar no renderer para UX e novamente no main por segurança.
3. Separar `create`, `updateMetadata`, `replaceRecipients` e `patchRecipient`; evitar `Object.assign` genérico.
4. Migração de `campaigns.json` deve preservar backup e aceitar registros antigos.
5. Ao editar recipients, preservar todos os campos de tracking existentes pelo `leadId`/identidade canônica.
6. Proibir edição destrutiva durante `running/scheduled`, mas permitir pausar e retomar explicitamente.
7. Remover duplicação de `setProvider` e testar `providersMap`.
8. Tornar criação multi-conexão transacional: se uma campanha falhar, informar quais foram criadas e oferecer rollback seguro.

Aceite: round-trip `UI -> IPC -> store -> restart -> UI` sem perda de campo.

### Fase 4 — Identidade e nomes WhatsApp

1. Implementar resolvedor único.
2. Adaptar `_upsertContact`, `_learnMessageAliases`, `getContacts`, `getChats` e IPC para usá-lo.
3. Persistir `nameSource` e `nameConfidence` no recipient.
4. Unir PN/LID antes de montar chave de deduplicação.
5. Enriquecer recipient vindo do Maps com nome da empresa como fallback.
6. Na etapa destinatários, permitir corrigir nome antes da criação.
7. Quando chegar `pushName` melhor, atualizar lista futura e campanhas pendentes.

Matriz de testes:

| Cenário | Nome esperado |
|---|---|
| manual + pushName | manual |
| contato salvo + pushName | contato salvo |
| verifiedName + número | verifiedName |
| pushName + número | pushName |
| lead Maps + número | empresa Maps |
| apenas número | telefone formatado |
| LID + PN em eventos diferentes | uma identidade, sem duplicata |

Aceite: nenhum contato com nome disponível aparece apenas como número; nenhuma duplicata PN/LID.

### Fase 5 — Classificador de URL

1. Adicionar biblioteca de Public Suffix e travar versão.
2. Implementar `url-classifier.js` como módulo puro.
3. Criar catálogo de plataformas em arquivo separado.
4. Integrar no `normalizer` antes do crawler.
5. Implementar política SSRF: bloquear localhost, IP privado/link-local, esquemas não HTTP(S), redirects excessivos e DNS rebinding básico.
6. Resolver encurtadores com `HEAD/GET` limitado, tamanho máximo e timeout.
7. Detectar estacionamento/inacessibilidade sem transformar ausência de HTML em defeito técnico.
8. Salvar versão e razões da classificação.

Casos obrigatórios de teste:

- `instagram.com/empresa`, `facebook.com/empresa`, `wa.me/...`;
- `linktr.ee/empresa`, `beacons.ai/...`;
- `empresa.wixsite.com/site`, `empresa.wordpress.com`;
- `empresa.com.br`, subdomínio `loja.empresa.com.br`;
- domínio contendo a palavra `facebook` mas legítimo;
- URL sem esquema, maiúsculas, acento/punycode, query e fragment;
- `bit.ly` redirecionando para social e para domínio próprio;
- `localhost`, `127.0.0.1`, `169.254.169.254`, IP privado;
- domínio inexistente, timeout, TLS inválido, 403, 404 e loop de redirect.

Aceite: classificação determinística com tabela de pelo menos 60 fixtures e zero acesso a rede nos testes unitários.

### Fase 6 — Score, IA e fila “Quem ligar primeiro”

1. Migrar score para usar `digitalPresence.type` e confiança.
2. Padronizar enum: `high`, `good`, `low`, `skip`, com labels só na UI.
3. Padronizar `score.priority` e eliminar filtros `media` incompatíveis.
4. Exibir motivo principal: “só Instagram”, “subdomínio gratuito”, “site próprio com falhas”, “site inacessível”, etc.
5. IA recebe fatos e evidências; resposta usa schema validado.
6. Se IA falhar, fallback determinístico continua útil.
7. Se mensagem IA estiver vazia, bloquear campanha ou gerar template local seguro.
8. Adicionar filtro por tipo de presença digital e confiança.
9. Reanálise deve respeitar `classifierVersion`/`scoringVersion`.

Aceite: usuário entende por que um lead está acima de outro sem abrir detalhes técnicos.

### Fase 7 — Integração Lead Scoring -> campanha

1. Trocar criação direta por `openCampaignDraft(prefill)`.
2. Pré-preencher nomes resolvidos, mensagens e metadados.
3. Marcar recipients sem telefone, sem nome ou com mensagem vazia.
4. Preview deve usar um lead real selecionável, não “Maria” fixa.
5. Mostrar contagem: válidos, duplicados, inválidos e removidos.
6. Ao criar, persistir `sourceLeadId`, score/version e origem da abordagem.

Aceite: nenhuma campanha nasce sem revisão; usuário pode corrigir nome e mensagem antes de salvar.

### Fase 8 — Scheduler e confiabilidade

1. Testar duas conexões simultâneas e rebinding controlado.
2. Não trocar silenciosamente o número remetente; pedir confirmação ou usar política configurada.
3. Persistir próximo envio e recuperar após reinício sem duplicar mensagem.
4. Criar idempotency key por campanha/lead/tentativa.
5. Diferenciar erro transitório, número inválido, desconectado e bloqueio.
6. Aplicar backoff com jitter e limite de tentativas.
7. Flush do store no encerramento.
8. Logs estruturados sem mensagem/chave/token completos.

Aceite: reinício durante lote não duplica envios e falha parcial pode ser retomada.

### Fase 9 — UX, acessibilidade e observabilidade

1. Erros dentro do modal, não apenas `alert`.
2. Estados loading/empty/error por fonte de destinatários.
3. Resumo final com conexão, quantidade, intervalo, exemplos e avisos.
4. Focus trap, Escape, aria-live e labels corretos.
5. Telemetria local de eventos técnicos: `campaign_draft_opened`, `field_focus_failed`, `campaign_create_failed`, `name_fallback_used`, `url_classified`.
6. Tela/arquivo de diagnóstico exportável sem dados sensíveis.

Aceite: operador consegue explicar uma falha sem abrir DevTools.

### Fase 10 — Empacotamento e validação final

1. `npm test`.
2. lint/typecheck se adicionados.
3. E2E Electron em renderer dev e build.
4. `npm run build:renderer`.
5. `electron-builder --dir` para prova rápida.
6. Build ZIP final em diretório limpo.
7. Abrir executável empacotado com userData novo.
8. Repetir jornada completa e reinício.
9. Confirmar arquivos novos dentro de `app.asar`.

Aceite: evidência do executável real, não apenas código ou teste unitário.

## 6. Casos E2E obrigatórios

1. Criar campanha manual com nome digitado, um contato e mensagem.
2. Criar com nome vazio e confirmar nome automático.
3. Criar a partir de scraping.
4. Criar a partir de grupo de scoring.
5. Criar a partir de WhatsApp com `pushName`.
6. Criar com duas conexões e divisão previsível.
7. Editar campanha pronta sem perder metadados.
8. Pausar, editar, retomar.
9. Agendar, reiniciar app e executar uma vez.
10. Simular envio, delivered, read e reply.
11. Simular desconexão no meio do lote.
12. Analisar lead sem site.
13. Analisar lead só Instagram/Facebook.
14. Analisar Linktree e Wixsite.
15. Analisar domínio próprio saudável e quebrado.
16. Analisar domínio suspeito/inacessível.
17. IA indisponível: fallback e campanha ainda revisáveis.
18. Digitar enquanto chegam eventos de presença/chat/progresso.

## 7. Definition of Done global

O trabalho só termina quando:

- todos os P0/P1 deste documento possuem teste de regressão;
- 35 testes atuais continuam passando;
- novos testes de URL, identidade, campanha e scheduler passam;
- E2E Electron passa 10 vezes seguidas;
- nenhum campo perde foco ou conteúdo;
- edição preserva 100% dos dados não alterados;
- URL recebe tipo explícito antes do crawl/IA;
- UI explica a prioridade com evidências;
- contatos usam a melhor identidade disponível;
- executável empacotado conclui a jornada real;
- mudanças e migrações estão documentadas;
- não há segredo, telefone ou mensagem real em fixture/log/commit.

## 8. Ordem de commits recomendada

1. `test: add real Electron campaign harness`
2. `refactor: introduce campaign draft schema`
3. `fix: stabilize campaign wizard focus and editing`
4. `fix: preserve campaign recipients and tracking data`
5. `feat: add canonical WhatsApp identity resolver`
6. `feat: classify digital presence before crawling`
7. `refactor: align scoring enums and evidence`
8. `feat: review lead-scoring campaigns in wizard`
9. `fix: make scheduler restart-safe and idempotent`
10. `test: validate packaged campaign journey`

Cada commit deve deixar testes verdes. Não misturar refatoração visual, crawler, Baileys e scheduler no mesmo commit.

## 9. Instruções finais ao agente executor

1. Leia este documento e os arquivos da seção 2.2 antes de editar.
2. Confira `git status`; o repositório pode conter trabalho não commitado do usuário.
3. Faça uma fase por vez.
4. Antes de cada correção, escreva teste que falha pelo motivo certo.
5. Não use “passou unitário” como prova de UI Electron.
6. Não faça chamadas reais em massa nem use contatos do usuário em testes.
7. Não altere o score por feeling; use fixtures e razões explícitas.
8. Não deixe IA decidir fatos que o código consegue medir.
9. Não apague compatibilidade de dados antigos sem migração e backup.
10. Ao concluir cada fase, registre arquivos alterados, testes executados, resultado e risco restante.

## 10. Baseline desta auditoria

- `npm test`: 35 testes passaram em 2026-07-10.
- `npm run build:renderer`: passou; 1.520 módulos transformados.
- Smoke atual: React montou e abriu Lead Scoring, mas gerou erros de IPC porque executa o renderer isolado. Portanto, não valida aplicação completa.
- Cobertura ausente: foco/digitação, wizard completo, round-trip de campanha, identidade WhatsApp, classificação de URL e execução empacotada.

