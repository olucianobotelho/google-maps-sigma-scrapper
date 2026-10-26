const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { resolveFfmpegPath, ffmpegCandidates } = require('../utils/ffmpeg-path');

const ASAR_BIN = path.win32.join(
  'C:', 'Program Files', 'Sigma', 'resources', 'app.asar',
  'node_modules', 'ffmpeg-static', 'ffmpeg.exe',
);
const UNPACKED_BIN = ASAR_BIN.replace('app.asar', 'app.asar.unpacked');

test('no app empacotado usa o binário de app.asar.unpacked', () => {
  const resolved = resolveFfmpegPath({
    modulePath: ASAR_BIN,
    platform: 'win32',
    exists: (p) => p === UNPACKED_BIN,
  });
  assert.equal(resolved, UNPACKED_BIN);
});

test('candidato desempacotado vem antes do caminho virtual do asar', () => {
  const candidates = ffmpegCandidates({ modulePath: ASAR_BIN, platform: 'win32', envPath: '' });
  assert.ok(candidates.indexOf(UNPACKED_BIN) < candidates.indexOf(ASAR_BIN));
});

test('em desenvolvimento usa o caminho do node_modules', () => {
  const devBin = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe');
  const resolved = resolveFfmpegPath({
    modulePath: devBin,
    platform: 'win32',
    exists: (p) => p === devBin,
  });
  assert.equal(resolved, devBin);
});

test('FFMPEG_PATH tem prioridade quando existe', () => {
  const custom = path.resolve('tools/ffmpeg.exe');
  const resolved = resolveFfmpegPath({
    modulePath: ASAR_BIN,
    platform: 'win32',
    envPath: custom,
    exists: (p) => p === custom,
  });
  assert.equal(resolved, custom);
});

test('sem binário local cai para o ffmpeg do PATH', () => {
  const resolved = resolveFfmpegPath({
    modulePath: ASAR_BIN,
    platform: 'win32',
    exists: () => false,
  });
  assert.equal(resolved, 'ffmpeg.exe');

  const linux = resolveFfmpegPath({
    modulePath: '/opt/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg',
    platform: 'linux',
    exists: () => false,
  });
  assert.equal(linux, 'ffmpeg');
});
