const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { isOggOpus, isPlayableAudio, detectAudioMime } = require('../utils/audio-format');

const pad = (buffer, size = 32) =>
  Buffer.concat([buffer, Buffer.alloc(Math.max(0, size - buffer.length))]);

const OGG = pad(Buffer.from('OggS'), 32);
const WEBM = pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 32);
const MP3_ID3 = pad(Buffer.from('ID3'), 32);
const MP3_FRAME = pad(Buffer.from([0xff, 0xfb, 0x90, 0x64]), 32);
const RIFF = pad(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]), 32);
const MP4 = pad(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A ')]), 32);
const AMR = pad(Buffer.from('#!AMR'), 32);

test('ogg/opus é PTT válido e webm não é', () => {
  assert.equal(isOggOpus('audio/ogg; codecs=opus'), true);
  assert.equal(isOggOpus('audio/ogg'), true);
  assert.equal(isOggOpus('audio/opus'), true);
  assert.equal(isOggOpus('audio/webm;codecs=opus'), false);
  assert.equal(isOggOpus(''), false);
});

test('webm não é reproduzível no WhatsApp e mp3/m4a são', () => {
  assert.equal(isPlayableAudio('audio/webm;codecs=opus'), false);
  assert.equal(isPlayableAudio('audio/ogg; codecs=opus'), true);
  assert.equal(isPlayableAudio('audio/mpeg'), true);
  assert.equal(isPlayableAudio('audio/mp4'), true);
  assert.equal(isPlayableAudio('audio/wav'), false);
});

test('detecta ogg pelos bytes', () => {
  assert.equal(detectAudioMime(OGG), 'audio/ogg');
});

test('detecta webm mesmo quando o arquivo foi salvo como .ogg', () => {
  assert.equal(detectAudioMime(WEBM), 'audio/webm');
  assert.equal(isOggOpus(detectAudioMime(WEBM)), false);
});

test('detecta mp3, m4a, wav e amr', () => {
  assert.equal(detectAudioMime(MP3_ID3), 'audio/mpeg');
  assert.equal(detectAudioMime(MP3_FRAME), 'audio/mpeg');
  assert.equal(detectAudioMime(MP4), 'audio/mp4');
  assert.equal(detectAudioMime(RIFF), 'audio/wav');
  assert.equal(detectAudioMime(AMR), 'audio/amr');
});

test('buffer desconhecido ou curto não vira ogg por engano', () => {
  assert.equal(detectAudioMime(Buffer.from('abc')), '');
  assert.equal(detectAudioMime(Buffer.alloc(0)), '');
  assert.equal(detectAudioMime(null), '');
});

test('provider recusa PTT em webm em vez de enviar áudio que não abre', async () => {
  const { BaileysProvider } = require('../whatsapp/baileys-provider');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-audio-'));
  try {
    const provider = new BaileysProvider({}, () => {}, () => {}, dir);
    provider._status = 'connected';
    provider.sock = {};

    const result = await provider.sendMedia('123@g.us', {
      audio: Buffer.alloc(256, 1),
      mimetype: 'audio/webm;codecs=opus',
      ptt: true,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /ogg\/opus/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
