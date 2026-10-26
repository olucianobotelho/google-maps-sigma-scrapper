const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const { isOggOpus } = require('./audio-format');

/**
 * Argumentos de codificação do PTT (mensagem de voz).
 *
 * WhatsApp recusa áudio mal formatado no Android com "This audio is not
 * available because something is wrong with the audio file". A receita
 * validada pela comunidade do Baileys é Opus em OGG, mono, 48 kHz, com
 * timestamps normalizados e sem metadados do arquivo original:
 *   -avoid_negative_ts make_zero + -map_metadata -1 + -f ogg
 */
const PTT_ENCODE_ARGS = Object.freeze([
  '-vn',
  '-ac', '1',
  '-ar', '48000',
  '-c:a', 'libopus',
  '-b:a', '48k',
  '-application', 'voip',
  '-avoid_negative_ts', 'make_zero',
  '-map_metadata', '-1',
  '-f', 'ogg',
]);

const PTT_MIMETYPE = 'audio/ogg; codecs=opus';

function guessExtension(mimetype) {
  const type = String(mimetype || '').toLowerCase();
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return '.m4a';
  if (type.includes('mpeg') || type.includes('mp3')) return '.mp3';
  if (type.includes('wav')) return '.wav';
  if (type.includes('webm')) return '.webm';
  if (type.includes('ogg') || type.includes('opus')) return '.ogg';
  return '.webm';
}

/**
 * Converte qualquer áudio em OGG/Opus (formato PTT do WhatsApp).
 * Nunca promove à força um áudio que não converteu: devolve o buffer original
 * e `converted: false` para o chamador decidir (enviar webm como PTT faz a
 * mensagem chegar e não abrir).
 */
function convertAudioToOggOpus(buffer, mimetype, { ffmpegPath = 'ffmpeg' } = {}) {
  const type = String(mimetype || '').toLowerCase();

  if (isOggOpus(type) && Buffer.isBuffer(buffer) && buffer.length > 64) {
    return Promise.resolve({ buffer, mimetype: PTT_MIMETYPE, converted: true });
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) {
    return Promise.resolve({
      buffer: buffer || Buffer.alloc(0),
      mimetype: type || 'audio/webm',
      converted: false,
      error: 'buffer_vazio',
    });
  }

  return new Promise((resolve) => {
    const base = path.join(
      os.tmpdir(),
      `sigma_audio_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    );
    const input = `${base}${guessExtension(type)}`;
    const output = `${base}.ogg`;

    const cleanup = () => {
      try { fs.unlinkSync(input); } catch { /* ignore */ }
      try { fs.unlinkSync(output); } catch { /* ignore */ }
    };

    try {
      fs.writeFileSync(input, buffer);
      execFile(
        ffmpegPath,
        ['-y', '-i', input, ...PTT_ENCODE_ARGS, output],
        { windowsHide: true, timeout: 45000 },
        (err, _stdout, stderr) => {
          if (err) {
            console.error(
              '[AUDIO] ffmpeg falhou:',
              err.message,
              String(stderr || '').slice(0, 200),
            );
            cleanup();
            resolve({
              buffer,
              mimetype: mimetype || 'audio/webm',
              converted: false,
              error: err.message,
            });
            return;
          }
          try {
            const converted = fs.readFileSync(output);
            if (!converted || converted.length < 64) {
              console.error('[AUDIO] ffmpeg gerou arquivo vazio');
              cleanup();
              resolve({
                buffer,
                mimetype: mimetype || 'audio/webm',
                converted: false,
                error: 'output_vazio',
              });
              return;
            }
            cleanup();
            resolve({
              buffer: converted,
              mimetype: PTT_MIMETYPE,
              converted: true,
              bytes: converted.length,
            });
          } catch (e) {
            cleanup();
            resolve({
              buffer,
              mimetype: mimetype || 'audio/webm',
              converted: false,
              error: e.message,
            });
          }
        },
      );
    } catch (e) {
      cleanup();
      resolve({
        buffer,
        mimetype: mimetype || 'audio/webm',
        converted: false,
        error: e.message,
      });
    }
  });
}

module.exports = { convertAudioToOggOpus, PTT_ENCODE_ARGS, PTT_MIMETYPE, guessExtension };
