const { WhatsAppProvider } = require('./provider');
const { AuthStore } = require('./auth-store');

class MetaProvider extends WhatsAppProvider {
  constructor(config, onStatus, userDataPath) {
    super(config, onStatus);
    this.authStore = new AuthStore(userDataPath);
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.baseUrl = `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`;
    this._status = 'disconnected';
  }

  async connect() {
    this._status = 'connecting';
    this.onStatus('connecting');

    try {
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/${this.phoneNumberId}?access_token=${this.accessToken}`
      );
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `API returned ${resp.status}`);
      }
      this._status = 'connected';
      this.onStatus('connected');
    } catch (err) {
      this._status = 'error';
      this.onStatus('error', { error: `Failed to connect: ${err.message}` });
    }
  }

  async disconnect() {
    this._status = 'disconnected';
    this.onStatus('disconnected');
  }

  async sendMessage(to, message) {
    if (this._status !== 'connected') {
      return { success: false, error: 'Not connected' };
    }
    try {
      const resp = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to,
          type: 'text',
          text: { body: message }
        })
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error?.message || `HTTP ${resp.status}`);
      return { success: true, messageId: json.messages?.[0]?.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getStatus() { return this._status; }

  async sendMedia(to, content) {
    return { success: false, error: 'Media not supported on Meta API' };
  }

  async sendAudio(to, buffer, mimetype) {
    return { success: false, error: 'Audio not supported on Meta API' };
  }
}

module.exports = { MetaProvider };
