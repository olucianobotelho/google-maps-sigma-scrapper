const fs = require('fs');
const path = require('path');

/**
 * Candidatos de caminho para o binário do ffmpeg.
 *
 * No app empacotado o electron-builder faz smartUnpack dos .exe dentro de
 * node_modules: o `require('ffmpeg-static')` devolve
 * `.../resources/app.asar/node_modules/ffmpeg-static/ffmpeg.exe`, mas o
 * executável real fica em `.../resources/app.asar.unpacked/...`. Executar o
 * caminho virtual falha com ENOENT; sem conversão o áudio de voz sai em webm e
 * o destinatário não consegue abrir.
 */
function ffmpegCandidates({ modulePath, platform = process.platform, envPath = process.env.FFMPEG_PATH } = {}) {
  const candidates = [];
  if (envPath) candidates.push(envPath);

  if (modulePath) {
    // Preferir o arquivo desempacotado antes do virtual.
    if (String(modulePath).includes('app.asar')) {
      candidates.push(String(modulePath).replace('app.asar', 'app.asar.unpacked'));
    }
    candidates.push(modulePath);
  }

  candidates.push(platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return [...new Set(candidates.filter(Boolean))];
}

/**
 * Resolve o binário: caminho absoluto que exista ou o nome no PATH do SO.
 */
function resolveFfmpegPath({ modulePath, platform, envPath, exists = fs.existsSync } = {}) {
  const candidates = ffmpegCandidates({ modulePath, platform, envPath });

  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) return candidate;
    try {
      if (exists(candidate)) return candidate;
    } catch {
      /* caminho inválido: tenta o próximo */
    }
  }

  return candidates[candidates.length - 1] || 'ffmpeg';
}

module.exports = { resolveFfmpegPath, ffmpegCandidates };
