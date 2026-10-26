const assert = require('node:assert/strict');
const test = require('node:test');

const { interpolate, extractVariables, resolveSpintax } = require('../campaigns/template-engine');

test('variável vazia é removida da mensagem', () => {
  assert.equal(interpolate('Oi {{nome}}, tudo bem?', { name: '' }), 'Oi, tudo bem?');
});

test('campo ausente não vaza placeholder', () => {
  assert.equal(interpolate('Oi {{empresa}}', {}), 'Oi');
  assert.equal(interpolate('Falo com {{nome}}?', {}), 'Falo com?');
});

test('variável resolvida continua funcionando', () => {
  assert.equal(
    interpolate('Olá {{nome}}, sua {{categoria}} está no Maps.', {
      name: 'Ana',
      category: 'Padaria',
    }),
    'Olá Ana, sua Padaria está no Maps.',
  );
});

test('template só com variável vazia vira mensagem vazia (falha clara no envio)', () => {
  assert.equal(interpolate('{{mensagem_whatsapp_ia}}', {}).trim(), '');
});

test('spintax continua escolhendo uma variante', () => {
  for (let i = 0; i < 20; i += 1) {
    const result = interpolate('{Olá|Oi|E aí} {{nome}}', { name: 'Ana' });
    assert.ok(['Olá Ana', 'Oi Ana', 'E aí Ana'].includes(result), result);
  }
});

test('resolveSpintax devolve sempre uma das opções', () => {
  for (let i = 0; i < 20; i += 1) {
    assert.match(resolveSpintax('{a|b}'), /^[ab]$/);
  }
});

test('mídia é preservada no objeto interpolado', () => {
  const media = { filePath: 'C:/tmp/proposta.pdf', fileName: 'proposta.pdf' };
  const result = interpolate({ text: 'Segue {{nome}}', media }, { name: 'Ana' });
  assert.equal(result.text, 'Segue Ana');
  assert.equal(result.media, media);
});

test('extractVariables encontra as variáveis do template', () => {
  assert.deepEqual(
    extractVariables('Oi {{nome}}, sobre {{site}}').sort(),
    ['nome', 'site'],
  );
});
