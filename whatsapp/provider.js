class WhatsAppProvider {
  constructor(config, onStatus) {
    this.config = config;
    this.onStatus = onStatus;
  }

  async connect() { throw new Error('Not implemented'); }
  async disconnect() { throw new Error('Not implemented'); }
  async sendMessage(to, message) { throw new Error('Not implemented'); }
  async sendMedia(to, content) { throw new Error('Not implemented'); }
  async sendAudio(to, buffer, mimetype) { throw new Error('Not implemented'); }
  getStatus() { throw new Error('Not implemented'); }
  getPhoneNumber() { return null; }
  getChats() { return []; }
  getMessages(jid) { return []; }
  async loadMessages(jid, limit) { return []; }
  async markRead(jid) {}
}

function WhatsAppProviderFactory(type, config, onStatus, onChatEvent, userDataPath) {
  if (type === 'baileys') {
    const { BaileysProvider } = require('./baileys-provider');
    return new BaileysProvider(config, onStatus, onChatEvent, userDataPath);
  }
  if (type === 'meta') {
    const { MetaProvider } = require('./meta-provider');
    return new MetaProvider(config, onStatus, userDataPath);
  }
  throw new Error(`Unknown provider: ${type}`);
}

module.exports = { WhatsAppProvider, WhatsAppProviderFactory };
