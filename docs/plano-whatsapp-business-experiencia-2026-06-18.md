# Plano Minimalista - Experiencia WhatsApp Business no Sigma

**Data:** 2026-06-18  
**Status:** planejamento de produto e engenharia  
**Objetivo:** deixar o chat do Sigma com sensacao de WhatsApp Business real, mantendo os diferenciais de funis, prospeccao e atendimento.

---

## 1. Norte do produto

O usuario deve conectar o WhatsApp, ver as conversas como veria no WhatsApp Business, responder sem friccao, abrir qualquer midia, iniciar contato novo com facilidade e usar funis sem sentir que saiu do fluxo natural do chat.

Principios:

- **Chat primeiro:** tela abre no trabalho real, nao em configuracao.
- **Paridade onde doi:** texto, midia, documento, figurinha, resposta, encaminhar, reagir, arquivar, fixar, silenciar, perfil, grupo.
- **Business por cima:** funis, respostas rapidas, etiquetas, notas, follow-up e campanhas devem aparecer como aceleradores, nao como poluicao.
- **Controle claro:** downloads, notificacoes, grupos e automacoes precisam ter configuracao visivel.
- **Tecnica invisivel:** sincronizacao, cache e download devem ser previsiveis, sem travar UI.

---

## 2. Problemas atuais visiveis

Pelos prints e codigo atual:

- Video recebido mostra thumbnail, mas abre modal com "Nao foi possivel carregar o video".
- PDF aparece como card simples, sem preview, sem abrir pagina, sem download claro.
- Imagens, videos e stickers dependem de download manual/lazy sem estado robusto.
- Links em texto viram link clicavel, mas nao tem preview de site.
- Figurinhas existem em modo basico: envia WebP e baixa recebida, mas nao ha biblioteca, favoritos, recentes ou "salvar figurinha".
- Buscar ou iniciar conversa nova pelo campo de busca nao e obvio.
- Configuracoes de WhatsApp existem, mas so cobrem notificacao, som, conversa atual e silenciadas.
- Nao existe central de midia, links e documentos funcional.
- Grupo tem separacao, mas precisa experiencia completa: foto, participantes, permissoes e regras para automacoes.
- Funis ficam bons como atalho, mas precisam se integrar ao composer e respeitar contexto.

---

## 3. Experiencia alvo

### 3.1 Primeira conexao

Fluxo esperado:

1. Usuario abre WhatsApp.
2. Ve estado claro: desconectado, conectando, QR, sincronizando, conectado, reconectando, erro.
3. Escaneia QR.
4. App mostra telefone conectado, progresso de sync e ultima sincronizacao.
5. Ao terminar, vai direto para lista de conversas reais.

Regras:

- Botao "Trocar conta" separado de "Desconectar".
- "Sair e apagar sessao" precisa confirmacao forte.
- Se conexao cair, manter cache local e mostrar banner discreto.
- Sync nao pode bloquear o chat; novas mensagens entram em tempo real.

Aceite:

- Usuario entende em 3 segundos se esta conectado.
- Usuario consegue desconectar/trocar conta sem mexer em arquivos.
- App nao mostra contatos vazios como conversa.

### 3.2 Lista de conversas

Estrutura:

- Busca / comando no topo.
- Abas: Conversas, Nao lidas, Grupos, Arquivadas, Tudo.
- Contadores por aba.
- Botao compacto para nova conversa.
- Conversas com avatar, nome, telefone/subtitulo, preview, hora, unread, pin, mute, etiqueta.

Busca deve aceitar:

- Nome.
- Telefone com ou sem DDI.
- JID interno.
- Grupo.
- Texto de mensagem, em fase posterior.

Nova conversa:

- Digitar telefone no campo: mostra opcao "Conversar com +55...".
- Validar numero antes de abrir.
- Permitir nome local opcional.
- Abrir chat vazio com estado "Nova conversa".
- Ao enviar primeira mensagem, conversa entra na lista.

Aceite:

- Novo numero sem contato salvo abre em no maximo 2 cliques.
- Conversa arquivada nao aparece na lista normal.
- Nao lidas mostram total e badge por conversa.

### 3.3 Janela de conversa

Header:

- Foto.
- Nome.
- Telefone/status.
- Indicador de grupo.
- Acoes: pesquisar na conversa, midia/docs/links, perfil, menu.

Timeline:

- Bolhas alinhadas igual WhatsApp.
- Datas separadoras.
- Status de envio/leitura para mensagens enviadas.
- Reacoes.
- Resposta citada.
- Encaminhada.
- Mensagem apagada.
- Midias com skeleton, progresso e retry.

Composer:

- Anexo.
- Emoji.
- Sticker.
- Audio.
- Campo texto auto-expand.
- Enviar.
- Resposta rapida/funis em linha.
- Menu de mais opcoes.

Aceite:

- O usuario consegue ler, responder, anexar e usar funil sem trocar de tela.
- Nenhuma midia fica com "falhou" sem botao de tentar novamente.

### 3.4 Perfil lateral

Painel do contato:

- Foto grande.
- Nome, telefone, JID copiavel.
- Dados business quando disponiveis: categoria, descricao, email, site, endereco, horario.
- Etiquetas Sigma.
- Notas internas.
- Midia, links e docs.
- Acoes: silenciar, arquivar, bloquear, limpar, exportar, abrir no WhatsApp externo.

Painel de grupo:

- Foto.
- Nome.
- Descricao.
- Participantes.
- Admins.
- Membros pesquisaveis.
- Midia, links e docs.
- Configuracao "permitir funis neste grupo".
- Configuracao "confirmar antes de enviar automacao em grupo".

Aceite:

- Perfil substitui modais soltos.
- Grupo deixa claro quando automacao esta permitida ou bloqueada.

---

## 4. Funcionalidades por dominio

### 4.1 Fotos e avatares

Precisa funcionar:

- Foto de contato na lista.
- Foto de grupo na lista.
- Foto no header.
- Foto grande no perfil.
- Cache local.
- Refresh manual.
- Fallback com inicial/icone.

Implementacao:

- Provider baixa foto via `profilePictureUrl(jid, "image")`, fallback `"preview"`.
- Cache por aliases: JID, phoneJid, LID.
- Guardar metadata: `jid`, `url/dataUrl`, `fetchedAt`, `source`, `failedAt`.
- Retry com backoff.

Aceite:

- Grupos visiveis baixam foto sem precisar abrir conversa.
- Abrir perfil mostra foto maior quando disponivel.

### 4.2 Imagens

Precisa funcionar:

- Thumbnail na bolha.
- Download full ao clicar.
- Modal full-screen com zoom, copiar, salvar, encaminhar, responder.
- Legenda.
- Enviar imagem com preview antes de enviar.
- Envio com legenda.

Implementacao:

- Nao guardar imagem grande em base64 dentro do estado principal.
- Baixar para `userData/whatsapp-media/{jid}/{messageId}`.
- Criar blob/file URL seguro no renderer.
- LRU por tamanho.

Aceite:

- Clicar imagem abre rapido.
- Imagem grande nao trava renderer.

### 4.3 Videos

Precisa funcionar:

- Thumbnail.
- Duracao.
- Download com progresso.
- Player dentro do modal.
- Salvar/encaminhar.
- Enviar MP4/MOV com legenda.
- Retry se midia expirou.

Implementacao:

- Baixar video para arquivo temporario/cache.
- Reusar `downloadMediaMessage` com `updateMediaMessage`.
- Player HTML5 com `file://` permitido so para caminho liberado.
- Se MIME nao tocar no Chromium, mostrar "abrir arquivo" e "converter".

Aceite:

- Print atual deixa de acontecer: video clicado abre player ou mostra retry acionavel.

### 4.4 Audio e voz

Precisa funcionar:

- Play/pause.
- Barra de progresso.
- Duracao real.
- Velocidade 1x/1.5x/2x.
- Enviar audio gravado como PTT.
- Enviar arquivo de audio.
- Baixar/encaminhar.

Implementacao:

- Cache local por mensagem.
- Converter gravacao para OGG/Opus com `ffmpeg-static`.
- Guardar waveform simples opcional.

Aceite:

- Audio recebido toca sem baixar de novo a cada clique.

### 4.5 PDFs e documentos

Precisa funcionar:

- Card com nome, tipo, tamanho, paginas.
- Preview de primeira pagina para PDF.
- Abrir PDF em viewer interno.
- Baixar/salvar.
- Enviar PDF/doc/docx/xlsx/csv/zip com nome correto.

Implementacao:

- Adicionar viewer PDF com `pdfjs-dist` ou BrowserWindow interna isolada.
- Para preview, renderizar primeira pagina para PNG cacheada.
- Para docs nao renderizaveis, mostrar icone e metadados.

Aceite:

- PDF nao fica so card estatico; abre leitura dentro do app.

### 4.6 Links e previews de site

Precisa funcionar:

- Detectar URL em mensagens.
- Buscar Open Graph: titulo, descricao, imagem, dominio.
- Card de preview no corpo da mensagem.
- Abrir link no navegador externo.
- Configuracao para ativar/desativar preview.

Implementacao:

- Fetch no main process, nunca direto no renderer.
- Timeout curto.
- Limite de tamanho.
- Sanitizacao de HTML.
- Cache por URL.

Aceite:

- Link comum mostra card parecido com WhatsApp.
- Link malicioso nao executa script nem quebra UI.

### 4.7 Stickers

Precisa funcionar:

- Ver sticker recebido em tamanho bom.
- Salvar sticker recebido.
- Biblioteca de stickers salvos.
- Recentes.
- Favoritos.
- Enviar sticker salvo.
- Enviar WebP local.
- Converter imagem para sticker.

Fase 1:

- Salvar sticker recebido.
- Galeria local.
- Enviar salvo.

Fase 2:

- Criar sticker a partir de PNG/JPG/WebP.
- Sticker animado a partir de GIF/MP4 curto.

Implementacao:

- `userData/stickers/`.
- `stickers.json`: id, name, hash, mimetype, animated, createdAt, lastUsedAt, favorite.
- Converter com `sharp` ou pacote especifico; avaliar peso nativo.
- Para animado, usar `ffmpeg-static` quando possivel.

Aceite:

- Clique direito em sticker recebido mostra "Salvar figurinha".
- Botao sticker abre tray com salvos/recentes.

### 4.8 Contatos, localizacao e cards especiais

Precisa funcionar:

- Mensagem de contato.
- Localizacao/mapa.
- Enquete/lista/botoes quando recebidos.
- Respostas de botoes/listas.

Implementacao:

- Renderers especificos por tipo.
- Fallback sempre legivel.
- Acoes: salvar contato, abrir mapa, copiar.

Aceite:

- Tipo desconhecido mostra conteudo util, nao some.

### 4.9 Acoes de mensagem

Menu por mensagem:

- Responder.
- Reagir.
- Copiar.
- Encaminhar.
- Apagar localmente.
- Apagar para todos quando permitido.
- Salvar midia.
- Salvar sticker.
- Salvar no funil.
- Ver detalhes.

Selecao multipla:

- Encaminhar varias.
- Apagar varias.
- Exportar trecho.

Aceite:

- Menu contextual tem acoes coerentes por tipo de mensagem.

### 4.10 Acoes de conversa

Menu por conversa:

- Arquivar/desarquivar.
- Fixar/desafixar.
- Marcar como lida/nao lida.
- Silenciar.
- Etiquetar.
- Bloquear.
- Limpar.
- Excluir local.
- Exportar conversa.

Aceite:

- Acoes destrutivas pedem confirmacao.
- Acoes nao destrutivas aplicam sem tirar usuario do fluxo.

### 4.11 Grupos

Precisa funcionar:

- Lista separada.
- Foto.
- Nome e descricao.
- Participantes.
- Identificar remetente em cada mensagem.
- Mencionar participante.
- Responder mensagem de participante.
- Enviar midia.
- Configurar automacoes/funis em grupos.

Controles essenciais:

- Toggle global: permitir funis em grupos.
- Toggle por grupo: permitir funis neste grupo.
- Confirmacao: "Enviar automacao para grupo?".
- Bloqueio padrao para campanhas em grupo.

Aceite:

- Nenhum funil dispara em grupo sem permissao explicita.

### 4.12 Notificacoes

Precisa funcionar:

- Notificacao desktop.
- Som.
- Mostrar/ocultar preview.
- Silenciar conversa.
- Silenciar grupo.
- Horario silencioso.
- Badge de nao lidas.
- Clique na notificacao abre conversa.

Configuracoes:

- Notificacoes do sistema.
- Som.
- Preview de mensagem.
- Quiet hours.
- Ignorar grupos.
- Ignorar conversas silenciadas.

Aceite:

- Usuario controla ruido sem perder mensagem.

### 4.13 Downloads e armazenamento

Precisa funcionar:

- Auto-download por tipo: imagem, audio, video, docs, stickers.
- Limite por tamanho.
- Pasta padrao.
- Botao "Salvar como".
- Limpar cache.
- Tamanho atual do cache.
- Retencao: 7/30/90 dias ou manual.

Aceite:

- Usuario sabe onde arquivos estao e quanto espaco usam.

### 4.14 Funis e Business

Funis devem virar "ferramentas de atendimento":

- Respostas rapidas.
- Sequencias com texto/audio/midia.
- Simular digitando/gravando.
- Variaveis do lead/contato.
- Confirmacao antes de enviar.
- Historico de funil aplicado por conversa.
- Pausar funil por conversa.
- Bloquear funis em grupos por padrao.

Novas ferramentas:

- Etiquetas: novo lead, quente, retorno, pago, suporte, perdido.
- Notas internas.
- Lembrete de follow-up.
- Mensagens favoritas.
- Templates salvos.
- Atalhos com `/`.

Aceite:

- O usuario consegue digitar `/boas` e aplicar funil/resposta sem tirar mao do teclado.

---

## 5. Configuracoes novas

Criar aba "WhatsApp" dentro de Configuracoes com secoes:

### Geral

- Conta conectada.
- Reconectar automaticamente.
- Iniciar WhatsApp ao abrir app.
- Apagar sessao local.

### Conversas

- Mostrar arquivadas em aba separada.
- Ordenar por recentes/fixadas/nao lidas.
- Mostrar contatos sem mensagem: desligado por padrao.
- Confirmar ao limpar/excluir.

### Midia

- Auto-download imagens.
- Auto-download audio.
- Auto-download videos.
- Auto-download documentos.
- Auto-download stickers.
- Limite maximo por arquivo.
- Pasta de downloads.
- Limpar cache.

### Previews

- Preview de links.
- Preview de PDF.
- Pre-carregar video ate X MB.
- Abrir midia em modal ou janela separada.

### Notificacoes

- Desktop.
- Som.
- Preview no alerta.
- Horario silencioso.
- Notificar grupos.
- Notificar conversas silenciadas: sempre desligado.

### Grupos

- Permitir funis em grupos.
- Confirmar funil em grupo.
- Permitir campanhas para grupos.
- Baixar foto de grupos.

### Stickers

- Salvar stickers recebidos automaticamente.
- Mostrar recentes.
- Pasta/biblioteca local.
- Limpar stickers nao usados.

### Avancado

- Tamanho de cache.
- Exportar logs.
- Reindexar mensagens.
- Rebaixar midias expiradas.
- Resetar cache de fotos.

---

## 6. Arquitetura tecnica proposta

### 6.1 Camadas

Main process:

- Provider WhatsApp.
- Download de midia.
- Link preview.
- PDF preview.
- Cache.
- Settings persistentes.
- IPC seguro.

Renderer:

- UI.
- Estado leve.
- Blob/file URLs permitidos pelo main.
- Sem fetch arbitrario para links externos.

Disco:

```text
userData/
  sigma-chats.json
  whatsapp-settings.json
  whatsapp-media/
    index.json
    {jid}/
      {messageId}.bin
      {messageId}.thumb.jpg
      {messageId}.meta.json
  whatsapp-link-preview/
    {hash}.json
  whatsapp-pdf-preview/
    {messageId}.png
  stickers/
    stickers.json
    {stickerId}.webp
```

### 6.2 Novos modelos

`whatsapp-settings.json`

```json
{
  "notifications": {
    "desktop": true,
    "sound": true,
    "showPreview": true,
    "notifyGroups": true,
    "quietHours": null
  },
  "media": {
    "autoDownloadImages": true,
    "autoDownloadAudio": true,
    "autoDownloadVideos": false,
    "autoDownloadDocuments": false,
    "autoDownloadStickers": true,
    "maxAutoDownloadBytes": 5242880,
    "cacheLimitBytes": 1073741824
  },
  "previews": {
    "links": true,
    "pdf": true,
    "videoPreloadBytes": 5242880
  },
  "groups": {
    "allowFunnels": false,
    "confirmFunnels": true,
    "allowCampaigns": false,
    "downloadPictures": true
  }
}
```

`media index`

```json
{
  "messageId": "ABC",
  "jid": "5511999999999@s.whatsapp.net",
  "type": "video",
  "mimetype": "video/mp4",
  "fileName": "ABC.mp4",
  "thumbName": "ABC.thumb.jpg",
  "size": 123456,
  "downloadedAt": 1780000000000,
  "lastAccessedAt": 1780000000000
}
```

### 6.3 IPC novo

- `whatsapp-start-chat`: `{ phone, name? }`
- `whatsapp-search`: `{ query, scope }`
- `whatsapp-download-media-to-file`: `{ jid, messageId, saveAs? }`
- `whatsapp-get-media-url`: `{ jid, messageId }`
- `whatsapp-get-link-preview`: `{ url }`
- `whatsapp-get-pdf-preview`: `{ jid, messageId }`
- `whatsapp-save-sticker`: `{ jid, messageId, name? }`
- `whatsapp-list-stickers`: `{}`
- `whatsapp-send-saved-sticker`: `{ to, stickerId }`
- `whatsapp-update-settings`: `{ patch }`
- `whatsapp-get-settings`: `{}`
- `whatsapp-clear-media-cache`: `{}`
- `whatsapp-get-cache-stats`: `{}`

---

## 7. Roadmap minimalista

### Fase 0 - Base segura

Entrega:

- Store persistente de settings.
- Media cache em arquivo, nao base64 permanente.
- IPC para media URL seguro.
- Estados de download: idle, downloading, ready, failed, expired.
- Botao retry em toda midia.

Porque vem primeiro:

- Sem isso, video/PDF/sticker sempre fica fragil.

### Fase 1 - Paridade essencial do chat

Entrega:

- Nova conversa por numero.
- Imagem full-screen.
- Video modal funcional.
- Audio cacheado.
- PDF viewer/preview.
- Download/salvar midia.
- Link preview.
- Perfil lateral com midia/docs/links reais.

Aceite:

- Usuario consegue usar o chat o dia inteiro sem abrir WhatsApp externo para ver midia comum.

### Fase 2 - Stickers e composer forte

Entrega:

- Tray de stickers.
- Salvar sticker recebido.
- Recentes/favoritos.
- Converter imagem para sticker.
- Preview antes de enviar anexo.
- Drag and drop de arquivo.
- Colar imagem do clipboard.

Aceite:

- Usuario envia figurinha e midia como no WhatsApp, sem prompt tosco de legenda.

### Fase 3 - Business workflow

Entrega:

- Etiquetas.
- Notas internas.
- Follow-up/lembrete.
- Respostas rapidas com `/`.
- Funis com midia.
- Historico de automacoes por conversa.
- Confirmacoes em grupo.

Aceite:

- Atendimento fica melhor que WhatsApp Business, sem perder simplicidade.

### Fase 4 - Grupos completos

Entrega:

- Perfil de grupo completo.
- Participantes com busca.
- Mencoes.
- Permissoes por grupo.
- Midia/docs/links do grupo.
- Fotos de grupo com cache e refresh.

Aceite:

- Grupos deixam de ser "chat especial quebrado" e viram fluxo normal.

### Fase 5 - Operacao e qualidade

Entrega:

- Busca dentro da conversa.
- Exportar conversa.
- Limpar cache com preview de impacto.
- Logs de sync e midia.
- Diagnostico de conexao.
- Testes de regressao para tipos de mensagem.

Aceite:

- Quando algo falha, usuario entende e suporte consegue diagnosticar.

---

## 8. Prioridade sugerida

Ordem pratica:

1. Settings persistentes de WhatsApp.
2. Media cache seguro.
3. Corrigir video modal.
4. PDF preview/viewer.
5. Nova conversa por numero.
6. Link preview.
7. Galeria de stickers.
8. Salvar sticker recebido.
9. Perfil lateral real: midia, links, docs.
10. Permissoes de grupo/funis.
11. Etiquetas/notas/follow-up.
12. Busca dentro da conversa.

Essa ordem remove dor visual primeiro, depois adiciona robustez Business.

---

## 9. Definition of Done

Uma funcionalidade de WhatsApp so esta pronta quando:

- Funciona recebendo mensagem real.
- Funciona enviando mensagem real, quando aplicavel.
- Tem loading.
- Tem erro legivel.
- Tem retry, quando faz sentido.
- Nao quebra com grupo.
- Nao quebra com contato LID/phoneJid.
- Nao injeta HTML inseguro.
- Nao salva arquivo fora de pasta permitida.
- Tem teste unitario ou teste manual documentado.
- Foi validada em build Windows.

---

## 10. Matriz de testes

Contas:

- Conta pessoal.
- Conta WhatsApp Business.
- Grupo comum.
- Grupo com muitos participantes.
- Numero sem contato salvo.

Mensagens:

- Texto curto/longo.
- Emoji.
- Link.
- Imagem com e sem legenda.
- Video curto.
- Audio/PTT.
- PDF.
- DOC/DOCX.
- Sticker estatico.
- Sticker animado, se suportado.
- Contato.
- Localizacao.
- Resposta citada.
- Reacao.
- Mensagem apagada.

Cenarios:

- Abrir app desconectado.
- Conectar QR novo.
- Reconectar sessao existente.
- Sync grande.
- Midia expirada.
- Internet cai e volta.
- Arquivar/desarquivar.
- Silenciar.
- Enviar funil para contato.
- Tentar funil em grupo bloqueado.
- Permitir funil em grupo e enviar com confirmacao.

---

## 11. Riscos tecnicos

- Baileys depende do protocolo Web do WhatsApp; mudancas externas podem quebrar midia ou sync.
- Midia expirada precisa `updateMediaMessage`; nem sempre WhatsApp reemite.
- Conversao de sticker pode adicionar dependencia nativa pesada.
- Preview de PDF/video pode pesar se usar base64 em memoria.
- Link preview precisa protecao contra HTML malicioso e SSRF basico.
- Grupos podem ter JIDs/LIDs mistos; aliases precisam continuar tratados.

Mitigacao:

- Cache local.
- Retry claro.
- Fallback legivel.
- Testes por tipo de mensagem.
- IPC com validacao.
- Limites de tamanho.

---

## 12. Decisao de design

Manter interface minimalista:

- Nada de dashboard dentro do chat.
- Nada de card grande explicativo.
- Acoes aparecem no contexto: mensagem, conversa, perfil, composer.
- Configuracoes ficam em aba propria.
- Funis aparecem como atalhos discretos e comando `/`.

Visual alvo:

- Lista esquerda compacta.
- Conversa central limpa.
- Perfil/config lateral sob demanda.
- Modais so para midia full-screen.
- Icones pequenos com tooltip.

---

## 13. Proxima entrega recomendada

Implementar primeiro um "WhatsApp Media Foundation":

- `whatsapp-settings.json`.
- `whatsapp-media-cache`.
- `downloadMediaToFile`.
- `getMediaUrl`.
- video modal funcional.
- PDF card com abrir/baixar.
- nova conversa por numero.

Resultado esperado:

- O print do video quebrado desaparece.
- PDFs passam a abrir.
- Novo numero fica intuitivo.
- Base fica pronta para stickers, links e business tools.
