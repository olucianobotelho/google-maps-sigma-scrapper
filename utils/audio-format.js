/**
 * Formatos de áudio relevantes para o WhatsApp.
 *
 * PTT (mensagem de voz) exige container OGG com Opus. WebM/opus tem o mesmo
 * codec, mas o container não é suportado no player do app do destinatário — a
 * mensagem chega e não abre. Áudio comum aceita ogg/opus, mp3, m4a/aac, amr.
 */

function isOggOpus(mimetype) {
  const type = String(mimetype || '').toLowerCase();
  if (!type) return false;
  if (type.includes('webm')) return false;
  return type.includes('ogg') || type.includes('opus');
}

function isPlayableAudio(mimetype) {
  const type = String(mimetype || '').toLowerCase();
  if (!type) return false;
  if (isOggOpus(type)) return true;
  return /audio\/(mpeg|mp3|mp4|m4a|aac|amr|3gpp)/.test(type);
}

/**
 * Detecta o container pelos primeiros bytes. Necessário porque arquivos
 * antigos de gatilho foram salvos como .ogg mesmo quando a conversão falhou
 * (webm com extensão/mimetype de ogg), e aí o destinatário não abre.
 */
function detectAudioMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  const head = buffer.subarray(0, 12);
  const ascii = (start, end) => head.subarray(start, end).toString('latin1');

  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  // EBML/Matroska (webm)
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return 'audio/webm';
  }
  if (ascii(0, 4) === 'RIFF') return 'audio/wav';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  if (ascii(0, 3) === 'ID3') return 'audio/mpeg';
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (ascii(0, 5) === '#!AMR') return 'audio/amr';
  if (ascii(0, 4) === 'fLaC') return 'audio/flac';
  return '';
}

module.exports = { isOggOpus, isPlayableAudio, detectAudioMime };
