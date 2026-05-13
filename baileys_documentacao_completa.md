# 📱 Baileys — Documentação Completa (PT-BR)

> **Biblioteca:** `@whiskeysockets/baileys`
> **Versão:** Multi-Device (MD) | Node.js
> **Modo:** Modo Caveman 🦴 — direto ao ponto, sem enrolação

---

## 📦 Instalação

```bash
npm install @whiskeysockets/baileys
# ou com yarn:
yarn add @whiskeysockets/baileys
```

**Dependências recomendadas:**

```bash
npm install qrcode-terminal pino
```

---

## 🔌 Criando a Conexão

### Estrutura mínima funcional

```js
const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')

async function conectar() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info')

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // mostra QR no terminal
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            const deveReconectar =
                new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
            if (deveReconectar) conectar()
            else console.log('Deslogado. Apague a pasta auth_info e reconecte.')
        }
        if (connection === 'open') console.log('✅ Conectado!')
    })

    return sock
}

conectar()
```

> **`sock` = objeto principal.** Tudo que você faz passa por ele.

---

## 📡 Eventos Principais

Os eventos são a espinha dorsal do Baileys. Você escuta eventos com `sock.ev.on(...)`.

| Evento | Quando dispara |
|--------|----------------|
| `connection.update` | Conexão muda (conectando, conectado, desconectado) |
| `creds.update` | Credenciais atualizadas — salve sempre! |
| `messages.upsert` | Nova mensagem chegou ou foi atualizada |
| `messages.update` | Status de mensagem mudou (lida, entregue, etc.) |
| `messaging-history.set` | Histórico de chats sincronizado após conexão |
| `chats.set` | Lista de chats carregada |
| `chats.update` | Um chat foi modificado |
| `contacts.set` | Lista de contatos carregada |
| `contacts.update` | Um contato foi modificado |
| `groups.update` | Metadados de grupo foram atualizados |
| `group-participants.update` | Participante entrou/saiu/foi promovido num grupo |
| `presence.update` | Alguém ficou online, offline, digitando, etc. |
| `messages.delete` | Mensagem foi apagada |
| `call` | Chamada recebida |

---

## 📨 Recebendo Mensagens

```js
sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return // ignora mensagens antigas

    const msg = messages[0]
    if (!msg.message) return // ignora mensagens vazias

    const jid = msg.key.remoteJid           // quem mandou
    const fromMe = msg.key.fromMe           // eu mandei?
    const isGroup = jid.endsWith('@g.us')   // é grupo?

    // Extrair texto da mensagem
    const texto =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || ''

    console.log(`De: ${jid} | Texto: ${texto}`)
})
```

### Tipos de mensagem disponíveis em `msg.message`

| Chave | Tipo |
|-------|------|
| `conversation` | Texto simples |
| `extendedTextMessage` | Texto com link/formatação/resposta |
| `imageMessage` | Imagem |
| `videoMessage` | Vídeo |
| `audioMessage` | Áudio / PTT |
| `documentMessage` | Documento |
| `stickerMessage` | Sticker |
| `locationMessage` | Localização |
| `contactMessage` | Contato |
| `reactionMessage` | Reação (emoji) |
| `pollCreationMessage` | Enquete |
| `buttonsMessage` | Botões (legado) |
| `listMessage` | Lista interativa (legado) |
| `templateMessage` | Template |

---

## 📤 Enviando Mensagens

> **Formato do JID:**
> - Contato: `5521999999999@s.whatsapp.net`
> - Grupo: `XXXXXXXXXXX@g.us`
> - Status: `status@broadcast`

### Texto simples

```js
await sock.sendMessage(jid, { text: 'Oi! 👋' })
```

### Texto com formatação

```js
await sock.sendMessage(jid, {
    text: '*negrito* _itálico_ ~tachado~ ```monoespaçado```'
})
```

### Responder uma mensagem (quoted)

```js
await sock.sendMessage(jid, { text: 'Respondendo!' }, { quoted: msg })
```

### Mencionar alguém no grupo

```js
await sock.sendMessage(jid, {
    text: '@5521999999999 atenção!',
    mentions: ['5521999999999@s.whatsapp.net']
})
```

### Imagem

```js
// Por URL
await sock.sendMessage(jid, {
    image: { url: 'https://exemplo.com/foto.jpg' },
    caption: 'Legenda aqui'
})

// Por arquivo local
const fs = require('fs')
await sock.sendMessage(jid, {
    image: fs.readFileSync('./foto.jpg'),
    caption: 'Legenda aqui'
})
```

### Vídeo

```js
await sock.sendMessage(jid, {
    video: { url: './video.mp4' },
    caption: 'Legenda do vídeo',
    gifPlayback: false // true para enviar como GIF
})
```

### Áudio / PTT (mensagem de voz)

```js
await sock.sendMessage(jid, {
    audio: { url: './audio.mp3' },
    mimetype: 'audio/mp4',
    ptt: true // true = aparece como áudio de voz
})
```

### Documento

```js
await sock.sendMessage(jid, {
    document: { url: './relatorio.pdf' },
    mimetype: 'application/pdf',
    fileName: 'relatorio.pdf'
})
```

### Sticker

```js
await sock.sendMessage(jid, {
    sticker: fs.readFileSync('./sticker.webp')
})
```

### Localização

```js
await sock.sendMessage(jid, {
    location: {
        degreesLatitude: -22.9068,
        degreesLongitude: -43.1729
    }
})
```

### Contato

```js
const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:Nome Aqui\nTEL;type=CELL;type=VOICE;waid=5521999999999:+55 21 99999-9999\nEND:VCARD`
await sock.sendMessage(jid, {
    contacts: {
        displayName: 'Nome Aqui',
        contacts: [{ vcard }]
    }
})
```

### Reação (emoji)

```js
await sock.sendMessage(jid, {
    react: {
        text: '🔥',        // string vazia '' para remover reação
        key: msg.key
    }
})
```

### Enquete (poll)

```js
await sock.sendMessage(jid, {
    poll: {
        name: 'Qual a melhor linguagem?',
        values: ['JavaScript', 'Python', 'Go', 'Rust'],
        selectableCount: 1 // quantas opções o usuário pode marcar
    }
})
```

### Encaminhar mensagem

```js
const content = await sock.generateForwardMessageContent(msg, false)
const forwardMsg = sock.generateWAMessageFromContent(jid, content, {})
await sock.relayMessage(jid, forwardMsg.message, { messageId: forwardMsg.key.id })
```

---

## 👁️ Leitura e Presença

### Marcar mensagem como lida

```js
await sock.readMessages([msg.key])
```

### Atualizar sua presença (status de digitação, etc.)

```js
await sock.sendPresenceUpdate('composing', jid)   // digitando
await sock.sendPresenceUpdate('recording', jid)   // gravando áudio
await sock.sendPresenceUpdate('available', jid)   // online / disponível
await sock.sendPresenceUpdate('unavailable', jid) // offline
await sock.sendPresenceUpdate('paused', jid)      // parou de digitar
```

### Assinar presença de um contato

```js
await sock.presenceSubscribe(jid)
sock.ev.on('presence.update', ({ id, presences }) => {
    console.log(id, presences)
})
```

---

## 👤 Perfil e Contatos

### Verificar se número tem WhatsApp

```js
const [resultado] = await sock.onWhatsApp('5521999999999')
console.log(resultado.exists)  // true ou false
console.log(resultado.jid)     // JID completo
```

### URL da foto de perfil

```js
const url = await sock.profilePictureUrl(jid, 'image')
// 'image' = miniatura | 'preview' = alta resolução (nem sempre disponível)
```

### Atualizar foto de perfil

```js
await sock.updateProfilePicture(jid, fs.readFileSync('./nova_foto.jpg'))
```

### Atualizar status de texto

```js
await sock.updateProfileStatus('Ocupado agora 🔴')
```

### Buscar perfil business

```js
const perfil = await sock.getBusinessProfile(jid)
console.log(perfil)
```

---

## 🚫 Bloqueio

```js
// Bloquear
await sock.updateBlockStatus(jid, 'block')

// Desbloquear
await sock.updateBlockStatus(jid, 'unblock')

// Ver lista de bloqueados
const bloqueados = await sock.fetchBlocklist()
console.log(bloqueados)
```

---

## 👥 Grupos

### Criar grupo

```js
const grupo = await sock.groupCreate('Nome do Grupo', [
    '5521999999999@s.whatsapp.net',
    '5521888888888@s.whatsapp.net'
])
console.log(grupo.id) // JID do grupo criado
```

### Metadados do grupo

```js
const meta = await sock.groupMetadata(groupJid)
console.log(meta.subject)       // nome do grupo
console.log(meta.desc)          // descrição
console.log(meta.participants)  // array de participantes
console.log(meta.owner)         // dono do grupo
```

### Gerenciar participantes

```js
// Adicionar
await sock.groupParticipantsUpdate(groupJid, [jid], 'add')

// Remover
await sock.groupParticipantsUpdate(groupJid, [jid], 'remove')

// Tornar admin
await sock.groupParticipantsUpdate(groupJid, [jid], 'promote')

// Remover admin
await sock.groupParticipantsUpdate(groupJid, [jid], 'demote')
```

### Alterar nome e descrição

```js
await sock.groupUpdateSubject(groupJid, 'Novo Nome do Grupo')
await sock.groupUpdateDescription(groupJid, 'Nova descrição aqui')
```

### Configurações do grupo

```js
// Somente admins podem enviar mensagens
await sock.groupSettingUpdate(groupJid, 'announcement')

// Todos podem enviar mensagens
await sock.groupSettingUpdate(groupJid, 'not_announcement')

// Somente admins editam informações
await sock.groupSettingUpdate(groupJid, 'locked')

// Todos editam informações
await sock.groupSettingUpdate(groupJid, 'unlocked')
```

### Sair / Deletar grupo

```js
await sock.groupLeave(groupJid)
```

### Link de convite

```js
const codigo = await sock.groupInviteCode(groupJid)
const link = `https://chat.whatsapp.com/${codigo}`

// Revogar link
await sock.groupRevokeInvite(groupJid)

// Entrar via link
const info = await sock.groupGetInviteInfo(codigo)
await sock.groupAcceptInvite(codigo)
```

---

## 📥 Download de Mídia Recebida

```js
const {
    downloadContentFromMessage,
    downloadMediaMessage
} = require('@whiskeysockets/baileys')
const fs = require('fs')

// Método 1 — direto (mais simples)
const buffer = await downloadMediaMessage(msg, 'buffer', {})
fs.writeFileSync('./arquivo_recebido.jpg', buffer)

// Método 2 — streaming (para arquivos grandes)
const stream = await downloadContentFromMessage(
    msg.message.imageMessage,
    'image' // tipo: 'image' | 'video' | 'audio' | 'document' | 'sticker'
)
const chunks = []
for await (const chunk of stream) chunks.push(chunk)
fs.writeFileSync('./arquivo.jpg', Buffer.concat(chunks))
```

---

## 🧠 Store (Memória local)

O Store guarda chats, mensagens e contatos em memória RAM para você consultar sem precisar chamar a API.

```js
const { makeInMemoryStore } = require('@whiskeysockets/baileys')
const store = makeInMemoryStore({})

// IMPORTANTE: vincule ANTES de qualquer evento disparar
store.bind(sock.ev)

// Buscar mensagens de um chat
const msgs = await store.loadMessages(jid, 10)

// Buscar chat
const chat = store.chats.get(jid)

// Buscar contato
const contato = store.contacts[jid]
```

> **Atenção:** O Store é volátil — ao reiniciar o processo, os dados somem. Para persistência, salve em arquivo:

```js
// Salvar a cada 10 segundos
setInterval(() => {
    store.writeToFile('./store_data.json')
}, 10_000)

// Carregar ao iniciar
store.readFromFile('./store_data.json')
```

---

## 🔐 Autenticação e Sessão

### Multi-File Auth (recomendado)

```js
const { useMultiFileAuthState } = require('@whiskeysockets/baileys')
const { state, saveCreds } = await useMultiFileAuthState('./pasta_auth')
// Salva vários arquivos de credencial numa pasta
```

### Single-File Auth (legado)

```js
const { useSingleFileAuthState } = require('@whiskeysockets/baileys')
const { state, saveState } = useSingleFileAuthState('./auth.json')
```

### Logout

```js
await sock.logout()  // Desloga e invalida a sessão
sock.end()           // Apenas fecha o socket (sem deslogar)
```

---

## ⚙️ Opções do makeWASocket

```js
const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,         // QR Code no terminal
    browser: ['Meu App', 'Chrome', '1.0.0'], // nome exibido no WhatsApp Web
    syncFullHistory: false,           // não sincronizar histórico completo
    getMessage: async (key) => {      // necessário para reenvio de mensagens
        return store.loadMessage(key.remoteJid, key.id)
    },
    logger: pino({ level: 'silent' }), // silenciar logs internos
    connectTimeoutMs: 60_000,          // timeout de conexão
    keepAliveIntervalMs: 10_000,       // intervalo de keep-alive
    markOnlineOnConnect: true,         // aparecer online ao conectar
})
```

---

## 🗑️ Deletar Mensagem

```js
// Apagar para todos (somente mensagens suas, dentro do prazo)
await sock.sendMessage(jid, {
    delete: msg.key
})

// Apagar para mim
await sock.chatModify(
    { clear: { messages: [{ id: msg.key.id, fromMe: true }] } },
    jid
)
```

---

## 📌 Gerenciar Chats

```js
// Arquivar chat
await sock.chatModify({ archive: true, lastMessages: [msg] }, jid)

// Desarquivar
await sock.chatModify({ archive: false, lastMessages: [msg] }, jid)

// Silenciar (em milissegundos — 0 = indefinido)
await sock.chatModify({ mute: 8 * 60 * 60 * 1000 }, jid)

// Desmutar
await sock.chatModify({ mute: null }, jid)

// Fixar chat (pin)
await sock.chatModify({ pin: true }, jid)

// Desafixar
await sock.chatModify({ pin: false }, jid)

// Marcar como não lido
await sock.chatModify({ markRead: false, lastMessages: [msg] }, jid)
```

---

## 🔄 Fluxo de Inicialização Correto

```
1. makeWASocket()
        ↓
2. store.bind(sock.ev)       ← ANTES de qualquer evento
        ↓
3. sock.ev.on('creds.update', saveCreds)
        ↓
4. connection.update → 'open'
        ↓
5. messaging-history.set     ← agora os chats chegaram
        ↓
6. messages.upsert           ← recebe mensagens em tempo real
```

> **NÃO** tente acessar chats logo no evento `open`. Espere o `messaging-history.set`.

---

## 🆔 Referência de JIDs

| Tipo | Formato | Exemplo |
|------|---------|---------|
| Contato | `DDDDNÚMERO@s.whatsapp.net` | `5521999999999@s.whatsapp.net` |
| Grupo | `HASH@g.us` | `120363000000000000@g.us` |
| Broadcast | `HASH@broadcast` | `status@broadcast` |
| Status | `status@broadcast` | — |

> **Dica:** Para transformar número em JID: `const jid = numero + '@s.whatsapp.net'`

---

## ⚠️ Erros Comuns e Soluções

| Erro | Causa | Solução |
|------|-------|---------|
| `getChats returning 0` | Buscou chats antes do sync | Espere `messaging-history.set` |
| `DisconnectReason.loggedOut` | Sessão invalidada | Apague a pasta auth e reconecte |
| `DisconnectReason.connectionClosed` | Conexão caiu | Reconecte automaticamente |
| `DisconnectReason.timedOut` | Timeout na conexão | Aumente `connectTimeoutMs` |
| `rate-overlimit` | Enviou mensagens rápido demais | Adicione delay entre envios |
| Stream error | Problema no WebSocket | Reconecte; pode ser ban temporário |

---

## 🛡️ Boas Práticas

- **Nunca** envie mensagens em massa sem delay — risco de ban.
- **Sempre** salve as credenciais no evento `creds.update`.
- **Sempre** vincule o store ao `sock.ev` antes de qualquer listener.
- Use `logger: pino({ level: 'silent' })` para limpar os logs em produção.
- Implemente reconexão automática com controle de tentativas.
- Não use o mesmo número simultaneamente no celular e no Baileys por longo tempo.

---

## 🔗 Links Úteis

- **Repositório oficial:** https://github.com/WhiskeySockets/Baileys
- **Documentação oficial:** https://baileys.wiki/docs/intro/
- **API Reference:** https://baileys.wiki/docs/api/
- **Issues e suporte:** https://github.com/WhiskeySockets/Baileys/issues

