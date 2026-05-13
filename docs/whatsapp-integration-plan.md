# Plano de Integração — WhatsApp no Sigma GMaps Scraper

**Versão:** 1.0  
**Data:** 2025-05-10  
**Status:** Planejamento

---

## 1. Resumo Executivo

Este documento descreve o plano de arquitetura e viabilidade para adicionar disparo automatizado de mensagens WhatsApp diretamente no Sigma GMaps Scraper, permitindo que leads coletados do Google Maps recebam mensagens via campanhas programadas.

### 1.1 Escopo

| Item | Decisão |
|------|---------|
| **Provedores WhatsApp** | Híbrido: Baileys (WhatsApp Web, gratuito/testes) + Meta Business API (oficial, produção) |
| **Modo de disparo** | Campanhas programadas com templates, scheduling e intervalo configurável |
| **Onde executa** | Dentro do Electron (main process), sem servidor externo |
| **Plataformas** | Windows (existente) + Linux (novo target de build) |

### 1.2 Viabilidade Técnica

**✅ Viável.** O Electron suporta processos persistentes no main process, e as bibliotecas Baileys e a Meta Graph API são maduras e bem documentadas. O maior desafio é integrar um processo background (conexão WebSocket persistente + scheduler) em um app que hoje é puramente request-response.

---

## 2. Suporte Linux

### 2.1 Situação Atual

O projeto compila **apenas para Windows** (`electron-builder` com target `portable`). Não existe target Linux configurado.

### 2.2 Configuração Necessária

Adicionar ao `package.json` na seção `build`:

```json
{
  "build": {
    "appId": "com.sigma.scraper",
    "productName": "Sigma",
    "directories": { "output": "dist" },
    "win": {
      "target": "portable",
      "icon": "assets/icon.ico"
    },
    "linux": {
      "target": ["AppImage", "deb"],
      "icon": "assets/icon.png",
      "category": "Office"
    },
    "portable": {
      "artifactName": "Sigma-Prospeccao.exe"
    },
    "asar": true,
    "compression": "maximum"
  }
}
```

**Novo script:**

```json
"scripts": {
  "build:linux": "electron-builder --linux"
}
```

**Dependências:** Nenhuma. Electron e Playwright já são cross-platform.

**Ícone Linux:** É necessário gerar um `icon.png` (512x512) a partir do `icon.ico` existente.

**Baileys no Linux:** Totalmente compatível. A biblioteca usa WebSocket nativo do Node.js.

---

## 3. Arquitetura de Módulos

### 3.1 Estrutura de Diretórios (pós-integração)

```
sigma-gmaps-scraper/
├── main.js                              # [MODIFICADO] + WhatsApp lifecycle, + campaign IPC handlers
├── preload.js                           # [MODIFICADO] + whatsappAPI, + campaignAPI
├── config.js                            # [MODIFICADO] + WhatsApp defaults
├── scraper.js                           # [INALTERADO]
│
├── whatsapp/                            # [NOVO] Camada de provedores WhatsApp
│   ├── provider.js                      #   Contrato base + factory
│   ├── baileys-provider.js              #   Baileys WebSocket (WhatsApp Web)
│   ├── meta-provider.js                 #   Meta Graph API (WhatsApp Business)
│   ├── phone-normalizer.js              #   Normalização de telefone
│   └── auth-store.js                    #   Persistência de auth (userData)
│
├── campaigns/                           # [NOVO] Motor de campanhas
│   ├── campaign-manager.js              #   Orquestrador: create/start/pause/resume/delete
│   ├── campaign-store.js                #   Persistência JSON (campaigns.json)
│   ├── campaign-scheduler.js            #   Loop de envio com intervalo
│   └── template-engine.js               #   Interpolação {{variavel}} + sanitização
│
├── renderer/
│   ├── index.html                       # [MODIFICADO] + sidebar WhatsApp, + containers de painel
│   ├── renderer.js                      # [MODIFICADO] + tab routing WhatsApp
│   ├── sigma-logo.png                   # [INALTERADO]
│   ├── whatsapp-panel.js                # [NOVO] UI de conexão: seletor, QR code, status
│   ├── campaign-create.js               # [NOVO] Wizard de criação de campanha
│   ├── campaign-monitor.js              # [NOVO] Dashboard de campanha, status por lead
│   └── template-editor.js               # [NOVO] Editor de template com variáveis
│
├── utils/                               # [INALTERADO]
├── assets/                              # [MODIFICADO] + icon.png (Linux)
└── package.json                         # [MODIFICADO] + baileys, + @whiskeysockets/baileys, + linux build
```

### 3.2 Responsabilidades dos Módulos

| Módulo | Processo | Responsabilidade |
|--------|----------|-----------------|
| `whatsapp/provider.js` | Main | Contrato base (`connect`, `disconnect`, `sendMessage`, `getStatus`) + factory que instancia o provedor correto |
| `whatsapp/baileys-provider.js` | Main | Conexão WebSocket via Baileys, QR code, reconexão automática, envio de mensagens |
| `whatsapp/meta-provider.js` | Main | Chamadas REST à Graph API da Meta, validação de token, envio de mensagens |
| `whatsapp/auth-store.js` | Main | Persiste credenciais Baileys (multi-file) e config Meta API no `userData/whatsapp-auth/` |
| `whatsapp/phone-normalizer.js` | Main | Normaliza números para o formato exigido pelas APIs do WhatsApp |
| `campaigns/campaign-manager.js` | Main | Orquestrador central: gerencia ciclo de vida das campanhas e conecta provider ↔ scheduler |
| `campaigns/campaign-store.js` | Main | CRUD de campanhas em `campaigns.json` no `userData` |
| `campaigns/campaign-scheduler.js` | Main | Loop `setInterval` que percorre campanhas ativas e dispara mensagens respeitando intervalo |
| `campaigns/template-engine.js` | Main | Substitui `{{variavel}}` por dados do lead e sanitiza saída |
| `renderer/whatsapp-panel.js` | Renderer | Painel de conexão: escolher provedor, escanear QR (Baileys), digitar token (Meta), status |
| `renderer/campaign-create.js` | Renderer | Formulário: nome, selecionar leads, template, schedule |
| `renderer/campaign-monitor.js` | Renderer | Dashboard: progresso, stats, lista de leads com status, pausar/retomar |
| `renderer/template-editor.js` | Renderer | Editor de texto com inserção de variáveis (`{{nome}}`, `{{empresa}}`, etc.) |

---

## 4. Data Models

### 4.1 Campaign

```js
{
  id: "camp_1715359200000_a3b2c1",
  name: "Campanha Academias - Paciência",
  provider: "baileys",                    // "baileys" | "meta"
  template: {
    text: "Olá {{nome}}! Vi que a {{empresa}} atua como {{categoria}}. Tem interesse em...",
    variables: ["nome", "empresa", "categoria"]  // extraído automaticamente
  },
  leads: [
    {
      leadId: "k3jf2l9a",                // FK → sigma_leads[].id
      name: "Academia Fitness Pro",
      phone: "5521999999999",            // já normalizado
      company: "Academia Fitness Pro",   // copiado de lead.name
      category: "Gym",
      status: "sent",                    // "pending" | "sent" | "delivered" | "read" | "failed"
      errorMessage: null,
      sentAt: 1715359205000,
      deliveredAt: null,
      readAt: null,
      messageId: "wamid.abc123"
    }
  ],
  schedule: {
    mode: "interval",                    // "immediate" | "interval" | "scheduled"
    intervalMs: 30000,                   // mínimo 5000ms (5 segundos)
    startAt: null                        // timestamp para "scheduled", null = agora
  },
  status: "running",                     // "ready" | "running" | "paused" | "completed" | "cancelled"
  stats: {
    total: 45,
    pending: 10,
    sent: 30,
    delivered: 20,
    read: 8,
    failed: 5
  },
  createdAt: 1715359200000,
  updatedAt: 1715359300000
}
```

### 4.2 WhatsApp Auth State

**Baileys** — Multi-file no diretório `{userData}/whatsapp-auth/`:
```
whatsapp-auth/
├── creds.json          # Credenciais da sessão
├── pre-key-1.json      # Chaves de pré-encriptação
├── pre-key-2.json
├── ...
└── meta-config.json    # Config da Meta API (arquivo separado)
```

**Meta API** — Único arquivo `meta-config.json`:
```json
{
  "phoneNumberId": "123456789",
  "accessToken": "EAA...",
  "wabaId": "987654321"
}
```

### 4.3 Lead (existente, sem alterações)

O modelo de lead existente não muda. A campanha referencia leads por `leadId`, e os campos relevantes (`name`, `phone`, `category`) são copiados no momento da criação da campanha para evitar inconsistências se o lead for deletado depois.

---

## 5. IPC Contract

### 5.1 Novos Canais (Main Process → handlers)

| Canal | Direção | Payload (request) | Retorno (response) |
|-------|---------|-------------------|-------------------|
| `whatsapp-connect` | Renderer → Main | `{ provider: 'baileys'\|'meta', config: {...} }` | `{ success: boolean, phoneNumber?: string, error?: string }` |
| `whatsapp-disconnect` | Renderer → Main | `{}` | `{ success: boolean }` |
| `whatsapp-status` | Renderer → Main | `{}` | `{ connected: boolean, status: string, provider: string\|null, phoneNumber: string\|null }` |

| Canal | Direção | Payload (request) | Retorno (response) |
|-------|---------|-------------------|-------------------|
| `campaign-create` | Renderer → Main | `{ name, provider, template: { text }, leadIds: [...], schedule: {...} }` | `{ success, campaign }` |
| `campaign-update` | Renderer → Main | `{ id, updates: {...} }` | `{ success, campaign }` |
| `campaign-delete` | Renderer → Main | `{ id }` | `{ success }` |
| `campaign-start` | Renderer → Main | `{ id }` | `{ success, error? }` |
| `campaign-pause` | Renderer → Main | `{ id }` | `{ success }` |
| `campaign-resume` | Renderer → Main | `{ id }` | `{ success, error? }` |
| `campaign-get-all` | Renderer → Main | `{}` | `{ campaigns: [...] }` |
| `campaign-get` | Renderer → Main | `{ id }` | `{ campaign }` |
| `campaign-export` | Renderer → Main | `{ id, format: 'csv'\|'json' }` | `{ success, savedTo? }` |

| Canal | Direção | Payload (request) | Retorno (response) |
|-------|---------|-------------------|-------------------|
| `template-preview` | Renderer → Main | `{ template, leadId }` | `{ preview: string }` |
| `phone-normalize` | Renderer → Main | `{ phone, countryCode? }` | `{ valid, number, reason? }` |

### 5.2 Eventos (Main Process → Renderer)

| Canal | Direção | Payload |
|-------|---------|---------|
| `whatsapp-status-changed` | Main → Renderer | `{ status: 'qr_ready'\|'connecting'\|'connected'\|'disconnected'\|'error', data?: { qrData?, phoneNumber?, error? } }` |
| `campaign-progress` | Main → Renderer | `{ campaignId, event: 'lead-sent'\|'completed'\|'error', data?: { leadId?, status?, stats? } }` |

### 5.3 preload.js — Novas Exposições

```js
contextBridge.exposeInMainWorld('whatsappAPI', {
  connect:      (provider, config) => ipcRenderer.invoke('whatsapp-connect', { provider, config }),
  disconnect:   ()                 => ipcRenderer.invoke('whatsapp-disconnect'),
  getStatus:    ()                 => ipcRenderer.invoke('whatsapp-status'),
  onStatus:     (callback)         => ipcRenderer.on('whatsapp-status-changed', (_, data) => callback(data)),
});

contextBridge.exposeInMainWorld('campaignAPI', {
  create:     (data)             => ipcRenderer.invoke('campaign-create', data),
  update:     (id, updates)      => ipcRenderer.invoke('campaign-update', { id, updates }),
  delete:     (id)               => ipcRenderer.invoke('campaign-delete', { id }),
  start:      (id)               => ipcRenderer.invoke('campaign-start', { id }),
  pause:      (id)               => ipcRenderer.invoke('campaign-pause', { id }),
  resume:     (id)               => ipcRenderer.invoke('campaign-resume', { id }),
  getAll:     ()                 => ipcRenderer.invoke('campaign-get-all'),
  get:        (id)               => ipcRenderer.invoke('campaign-get', { id }),
  export:     (id, format)       => ipcRenderer.invoke('campaign-export', { id, format }),
  preview:    (template, leadId) => ipcRenderer.invoke('template-preview', { template, leadId }),
  normalize:  (phone, cc)        => ipcRenderer.invoke('phone-normalize', { phone, countryCode: cc }),
  onProgress: (callback)         => ipcRenderer.on('campaign-progress', (_, data) => callback(data)),
});
```

---

## 6. Normalização de Telefone

### 6.1 Algoritmo

```js
function normalizePhone(phone, countryCode = '55') {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, number: null, reason: 'Telefone vazio' };
  }

  let digits = phone.replace(/\D/g, '');
  digits = digits.replace(/^0+/, '');  // Remove zero à esquerda

  const ccLen = countryCode.length;

  if (digits.startsWith(countryCode)) {
    // Já tem código do país: manter como está
  } else if (digits.length >= 10) {
    // Número local: prefixar código do país
    digits = countryCode + digits;
  } else {
    return { valid: false, number: null, reason: 'Número muito curto' };
  }

  // Validação de tamanho mínimo (código país + 10 dígitos = mínimo 12)
  if (digits.length < ccLen + 10) {
    return { valid: false, number: null, reason: `Número deve ter pelo menos ${ccLen + 10} dígitos` };
  }

  // Validação de tamanho máximo
  if (digits.length > 15) {
    return { valid: false, number: null, reason: 'Número excede 15 dígitos' };
  }

  return { valid: true, number: digits };
}
```

### 6.2 Regras por País

| País | Código | Dígitos esperados | Exemplo |
|------|--------|-------------------|---------|
| Brasil | 55 | 12-13 (DDD + 8-9 dígitos) | `5521999998888` |
| EUA | 1 | 11 | `12125551234` |
| Argentina | 54 | 12-13 | `541112345678` |

O `countryCode` padrão é `'55'` (Brasil), configurável via UI.

---

## 7. UI — Renderer

### 7.1 Novo Item na Sidebar

A sidebar ganha um novo item fixo entre "Dashboard" e a lista de buscas:

```
[📋 All leads]
[📊 Dashboard]
[💬 WhatsApp]     ← NOVO (com ícone de status: 🟢 conectado / 🔴 desconectado)
─────────────────
[buscas salvas...]
```

### 7.2 Painel WhatsApp — 3 Sub-abas

Ao clicar em "WhatsApp", o conteúdo principal troca para um layout com 3 abas:

```
┌─────────────────────────────────────────────────────┐
│  [🔌 Conexão]  [📋 Campanhas]  [📊 Monitor]        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  (conteúdo da aba ativa)                            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 7.2.1 Aba "Conexão" (`whatsapp-panel.js`)

```
┌─ WhatsApp Connection ──────────────────────────────┐
│                                                     │
│  Provider:  [Baileys (WhatsApp Web) ▾]              │
│                                                     │
│  ┌─ Baileys ─────────────────────────────────────┐  │
│  │  Status: 🔴 Disconnected                       │  │
│  │  [Conectar]                                    │  │
│  │                                                │  │
│  │  ┌──────────────┐                              │  │
│  │  │   QR CODE     │   ← aparece ao conectar     │  │
│  │  │   (gerado)    │                              │  │
│  │  └──────────────┘                              │  │
│  │  Escaneie com o WhatsApp do celular            │  │
│  └────────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ Meta Business API ──────────────────────────┐  │
│  │  Phone Number ID: [________________]           │  │
│  │  Access Token:    [________________]           │  │
│  │  Status: 🔴 Disconnected                       │  │
│  │  [Conectar]  [Salvar credenciais]              │  │
│  └────────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 7.2.2 Aba "Campanhas" (`campaign-create.js` + `template-editor.js`)

```
┌─ Campaigns ────────────────────────────────────────┐
│                                                     │
│  [+ Nova Campanha]                                  │
│                                                     │
│  ┌─ Campanhas Salvas ────────────────────────────┐  │
│  │  📋 Academias Paciência     ⏸ Paused   35/45   │  │
│  │  📋 Restaurantes Centro     ✅ Done     28/28  │  │
│  │  📋 Lojas Barra             ▶ Running   12/50  │  │
│  └────────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Modal "Nova Campanha":**

```
┌─ Nova Campanha ─────────────────────────────────────┐
│                                                      │
│  Nome: [Academias Zona Sul_____________________]     │
│                                                      │
│  Leads:                                              │
│  ┌────────────────────────────────────────────────┐  │
│  │  ☑ Busca: Academias Paciência (45 leads)       │  │
│  │  ☐ Busca: Restaurantes Centro (28 leads)       │  │
│  │  ☐ Selecionar leads individualmente...          │  │
│  │  ───────────────────────────────────────────── │  │
│  │  45 leads selecionados                          │  │
│  │  ⚠ 3 leads sem telefone serão ignorados         │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Template:                                           │
│  ┌────────────────────────────────────────────────┐  │
│  │ Olá {{nome}}! Somos a Sigma Software e          │  │
│  │ vimos que a {{empresa}} atua como               │  │
│  │ {{categoria}}. Gostaria de conhecer             │  │
│  │ nossa solução?                                   │  │
│  │                                                  │  │
│  │ [{{nome}}] [{{empresa}}] [{{categoria}}]        │  │
│  │ [{{telefone}}] [{{endereco}}] [{{site}}]        │  │
│  └────────────────────────────────────────────────┘  │
│  📝 Preview: "Olá Academia Fitness Pro! Somos a..."  │
│                                                      │
│  Agendamento:                                        │
│  ○ Imediato    ● Intervalo    ○ Data/hora            │
│  Intervalo: [30] segundos entre mensagens            │
│                                                      │
│  Provider: [Baileys (conectado) ▾]                   │
│                                                      │
│  [Cancelar]  [Salvar como Rascunho]  [Iniciar]       │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 7.2.3 Aba "Monitor" (`campaign-monitor.js`)

Exibe detalhes da campanha selecionada:

```
┌─ Monitor: Academias Paciência ──────────────────────┐
│                                                      │
│  Status: ▶ Running                                   │
│  [⏸ Pausar]  [⏹ Cancelar]                           │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ ████████████████░░░░░░░░░░░░  67% (30/45)       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ✅ Enviadas: 30    📬 Entregues: 20                 │
│  👁 Lidas: 8        ❌ Falhas: 5                     │
│  ⏳ Pendentes: 10                                    │
│                                                      │
│  ┌─ Leads ────────────────────────────────────────┐  │
│  │  #   Nome                    Status     Hora    │  │
│  │  1   Academia Fitness Pro    ✅ Sent    10:30  │  │
│  │  2   CrossFit Zona Sul       📬 Deliv.  10:31  │  │
│  │  3   SmartFit Paciência      👁 Read    10:31  │  │
│  │  4   Studio Pilates Rio      ❌ Failed  10:32  │  │
│  │  ...                                            │  │
│  └─────────────────────────────────────────────────┘  │
│                                                      │
│  [Exportar CSV]  [Exportar JSON]                    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 7.3 Integração com o Renderer Existente

O `renderer.js` ganha:
- Uma nova função `showWhatsAppPanel()` que alterna a visibilidade dos containers
- Variável `activeWaTab` (`'connect'`, `'campaigns'`, `'monitor'`)
- **Nenhuma alteração nos fluxos existentes** (scrape, filtros, export). A área de WhatsApp é isolada.

---

## 8. Dependências

### 8.1 Novos Pacotes npm

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "qrcode": "^1.5.0"
  },
  "devDependencies": {
    "electron-builder": "^26.0.12"
  }
}
```

| Pacote | Justificativa |
|--------|--------------|
| `@whiskeysockets/baileys` | Cliente WhatsApp Web WebSocket (mantido pela comunidade) |
| `pino` + `pino-pretty` | Logger exigido pelo Baileys (silencioso em produção) |
| `qrcode` | Geração de QR code como string/base64 para exibir no renderer |

**Peso adicional estimado:** ~4-6 MB (Baileys + deps).

### 8.2 Meta Business API

**Não requer pacote npm adicional.** As chamadas são HTTP REST padrão usando `fetch()` (disponível no Node.js 18+ e Electron 38).

---

## 9. Segurança

### 9.1 Princípios

| Área | Medida |
|------|--------|
| **Auth tokens** | Armazenados em `userData/whatsapp-auth/` com permissão `0o600` (apenas o usuário lê) |
| **Context isolation** | Mantido `contextIsolation: true`. Nenhum dado sensível atravessa a bridge sem intenção explícita |
| **Templates** | Sanitização de `<` `>` e `\n` antes do envio (previne injeção de HTML/scripts) |
| **Rate limiting** | Intervalo mínimo de 5 segundos entre mensagens (anti-spam e prevenção de ban) |
| **Phone numbers** | Apenas dígitos circulam via IPC. Sem informação crua de contato exposta desnecessariamente |
| **Logs** | `pino({ level: 'silent' })` no Baileys. Sem logs de mensagens em produção |

### 9.2 Considerações sobre os ToS do WhatsApp

| Provedor | Risco |
|----------|-------|
| **Baileys** | Viola os Termos de Serviço do WhatsApp. Uso por conta e risco do usuário. Pode resultar em banimento do número. |
| **Meta Business API** | 100% oficial. Requer conta Business verificada e número dedicado. |

A UI deve exibir um **aviso claro** ao selecionar o provedor Baileys sobre os riscos.

---

## 10. Lifecycle do Main Process

### 10.1 Diagrama de Estados da Conexão WhatsApp

```
     ┌──────────┐
     │  IDLE    │ ← estado inicial
     └────┬─────┘
          │ user.clicks('Conectar')
          ▼
     ┌──────────┐
     │CONNECTING│
     └────┬─────┘
          │
     ┌────┴────┐
     │          │
     ▼          ▼
┌────────┐  ┌───────┐
│QR_READY│  │ERROR  │──── (tentar novamente) ──► CONNECTING
└───┬────┘  └───────┘
    │ user scans QR
    ▼
┌───────────┐
│ CONNECTED │◄──── (reconexão automática em caso de queda)
└─────┬─────┘
      │ user.clicks('Desconectar') ou app fecha
      ▼
┌──────────────┐
│ DISCONNECTED │
└──────────────┘
```

### 10.2 Integração com app.whenReady() e before-quit

```js
// main.js — adições

let whatsappProvider = null;
let campaignManager = null;

app.whenReady().then(() => {
  createWindow();
  cleanOldTempFiles();
  campaignManager = new CampaignManager(app.getPath('userData'));
  campaignManager.setProgressCallback((campaignId, event, data) => {
    mainWindow.webContents.send('campaign-progress', { campaignId, event, data });
  });
});

app.on('before-quit', async () => {
  if (campaignManager) campaignManager.shutdown();
  if (whatsappProvider) {
    await whatsappProvider.disconnect();
    whatsappProvider = null;
  }
});
```

---

## 11. Roadmap de Implementação

### Fase 1 — Fundação (core sem UI)

| # | Tarefa | Arquivos |
|---|--------|----------|
| 1.1 | Criar `whatsapp/provider.js` (contrato + factory) | `whatsapp/provider.js` |
| 1.2 | Criar `whatsapp/phone-normalizer.js` com testes | `whatsapp/phone-normalizer.js` |
| 1.3 | Criar `whatsapp/auth-store.js` | `whatsapp/auth-store.js` |
| 1.4 | Criar `whatsapp/baileys-provider.js` | `whatsapp/baileys-provider.js` |
| 1.5 | Criar `whatsapp/meta-provider.js` | `whatsapp/meta-provider.js` |
| 1.6 | Criar `campaigns/campaign-store.js` | `campaigns/campaign-store.js` |
| 1.7 | Criar `campaigns/campaign-scheduler.js` | `campaigns/campaign-scheduler.js` |
| 1.8 | Criar `campaigns/template-engine.js` | `campaigns/template-engine.js` |
| 1.9 | Criar `campaigns/campaign-manager.js` | `campaigns/campaign-manager.js` |

### Fase 2 — Integração no Main Process

| # | Tarefa | Arquivos |
|---|--------|----------|
| 2.1 | Adicionar WhatsApp lifecycle em `main.js` | `main.js` |
| 2.2 | Adicionar IPC handlers (`whatsapp-*`, `campaign-*`, `template-preview`, `phone-normalize`) | `main.js` |
| 2.3 | Atualizar `preload.js` com `whatsappAPI` e `campaignAPI` | `preload.js` |
| 2.4 | Atualizar `config.js` com defaults WhatsApp | `config.js` |
| 2.5 | Adicionar `before-quit` graceful shutdown | `main.js` |

### Fase 3 — UI (Renderer)

| # | Tarefa | Arquivos |
|---|--------|----------|
| 3.1 | Adicionar item "WhatsApp" na sidebar + container no HTML | `index.html`, `renderer.js` |
| 3.2 | Criar painel de conexão (`whatsapp-panel.js`) | `renderer/whatsapp-panel.js` |
| 3.3 | Criar editor de template (`template-editor.js`) | `renderer/template-editor.js` |
| 3.4 | Criar wizard de criação de campanha (`campaign-create.js`) | `renderer/campaign-create.js` |
| 3.5 | Criar monitor de campanha (`campaign-monitor.js`) | `renderer/campaign-monitor.js` |
| 3.6 | Adicionar strings i18n para WhatsApp (pt-BR, en, es) | `renderer.js` (objeto i18n) |
| 3.7 | Conectar eventos `campaign-progress` à UI | `campaign-monitor.js` |
| 3.8 | Conectar eventos `whatsapp-status-changed` à UI | `whatsapp-panel.js` |

### Fase 4 — Build & Empacotamento

| # | Tarefa | Arquivos |
|---|--------|----------|
| 4.1 | Gerar `icon.png` (512x512) para Linux | `assets/icon.png` |
| 4.2 | Adicionar target `linux` no `package.json` | `package.json` |
| 4.3 | Atualizar `.gitignore` para `dist/linux-unpacked/` | `.gitignore` |
| 4.4 | Testar build Linux (`npm run build:linux`) | — |
| 4.5 | Testar build Windows com novas dependências | — |
| 4.6 | Atualizar README com instruções Linux e WhatsApp | `README.md` |

---

## 12. Arquitetura Final — Diagrama de Componentes

```
┌─ Renderer Process ───────────────────────────────────────────────┐
│  renderer.js (roteador de abas)                                  │
│  ├── whatsapp-panel.js     ← Conexão, QR, status                 │
│  ├── campaign-create.js    ← Wizard de campanha                  │
│  ├── campaign-monitor.js   ← Dashboard de progresso              │
│  └── template-editor.js    ← Editor de template                  │
│                                                                  │
│  State (localStorage):                                           │
│    sigma_searches[], sigma_leads[], sigma_queue[], sigma_lang    │
│                                                                  │
│  Calls: window.whatsappAPI.*  window.campaignAPI.*               │
└──────────────────────┬───────────────────────────────────────────┘
                       │ contextBridge (preload.js)
                       │ ipcRenderer.invoke / .on
┌──────────────────────▼───────────────────────────────────────────┐
│  Main Process (main.js)                                          │
│                                                                  │
│  whatsappProvider ──► BaileysProvider | MetaProvider             │
│  campaignManager  ──► CampaignManager                            │
│                         ├── CampaignStore  (campaigns.json)      │
│                         ├── CampaignScheduler (setInterval)      │
│                         └── TemplateEngine   (interpolate)       │
│                                                                  │
│  IPC Handlers:                                                   │
│    whatsapp-connect/disconnect/status                            │
│    campaign-create/update/delete/start/pause/resume/get/export   │
│    template-preview, phone-normalize                             │
│                                                                  │
│  Events → Renderer:                                              │
│    whatsapp-status-changed, campaign-progress                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 13. Riscos e Mitigações

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Baileys quebrar com update do WhatsApp | Média | Alto | Abstração via `provider.js` — trocar biblioteca sem mexer no resto |
| Banimento do número no Baileys | Média | Alto | Aviso claro na UI + suporte à Meta API como alternativa oficial |
| Vazamento de auth tokens | Baixa | Crítico | Permissões `0o600`, `contextIsolation: true`, sem log de secrets |
| Performance com muitas campanhas simultâneas | Baixa | Médio | Scheduler com `setInterval` de 1s, leve. Rate limit impede sobrecarga |
| Meta API mudar versão/endpoints | Baixa | Baixo | Versão hardcoded no provider — fácil atualizar |
| Electron + Baileys no Linux (compatibilidade) | Baixa | Médio | Testar em Ubuntu 22.04+ durante a Fase 4 |

---

## 14. Estimativa de Esforço

| Fase | Complexidade | Novos Arquivos | Arquivos Modificados |
|------|-------------|----------------|---------------------|
| Fase 1 — Fundação | Alta | 9 | 0 |
| Fase 2 — Main Process | Média | 0 | 3 |
| Fase 3 — UI | Média | 4 | 2 |
| Fase 4 — Build | Baixa | 1 | 2 |
| **Total** | | **14 novos** | **7 modificados** |

---

*Documento gerado como parte do planejamento de arquitetura. Sujeito a revisão antes do início da implementação.*
