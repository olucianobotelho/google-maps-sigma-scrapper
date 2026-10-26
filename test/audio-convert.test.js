const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const { convertAudioToOggOpus, PTT_ENCODE_ARGS, PTT_MIMETYPE } = require('../utils/audio-convert');
const { resolveFfmpegPath } = require('../utils/ffmpeg-path');
const { detectAudioMime } = require('../utils/audio-format');

const ffmpegPath = resolveFfmpegPath({ modulePath: require('ffmpeg-static') });
const hasFfmpeg = (() => {
  try {
    execFileSync(ffmpegPath, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function makeWebmFixture(dir) {
  const file = path.join(dir, 'in.webm');
  execFileSync(
    ffmpegPath,
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-c:a', 'libopus', '-b:a', '32k', file],
    { stdio: 'ignore' },
  );
  return fs.readFileSync(file);
}

test('receita PTT usa ogg/opus mono 48k com timestamps normalizados', () => {
  const args = PTT_ENCODE_ARGS.join(' ');
  assert.match(args, /-c:a libopus/);
  assert.match(args, /-ac 1/);
  assert.match(args, /-ar 48000/);
  assert.match(args, /-avoid_negative_ts make_zero/);
  assert.match(args, /-f ogg/);
});

test('webm de gravacao vira ogg/opus decodificavel', { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-convert-'));
  try {
    const webm = makeWebmFixture(dir);
    assert.equal(detectAudioMime(webm), 'audio/webm');

    const result = await convertAudioToOggOpus(webm, 'audio/webm;codecs=opus', { ffmpegPath });

    assert.equal(result.converted, true);
    assert.equal(result.mimetype, PTT_MIMETYPE);
    assert.equal(detectAudioMime(result.buffer), 'audio/ogg');

    // O arquivo final precisa ser decodificável por completo (Android recusa
    // áudio malformado com "algo está errado com o arquivo de áudio").
    const out = path.join(dir, 'out.ogg');
    fs.writeFileSync(out, result.buffer);
    assert.doesNotThrow(() => {
      execFileSync(ffmpegPath, ['-v', 'error', '-i', out, '-f', 'null', '-'], { stdio: 'pipe' });
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ogg/opus já correto passa sem reconversão', { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-convert-'));
  try {
    const webm = makeWebmFixture(dir);
    const first = await convertAudioToOggOpus(webm, 'audio/webm', { ffmpegPath });
    const second = await convertAudioToOggOpus(first.buffer, first.mimetype, { ffmpegPath });

    assert.equal(second.converted, true);
    assert.equal(second.buffer, first.buffer);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('áudio inválido não é promovido a ogg por engano', { skip: !hasFfmpeg }, async () => {
  const result = await convertAudioToOggOpus(Buffer.alloc(512, 7), 'audio/webm', { ffmpegPath });

  assert.equal(result.converted, false);
  assert.equal(result.mimetype, 'audio/webm');
  assert.ok(result.error);
});
