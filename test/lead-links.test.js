const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeWebsite,
  normalizeInstagram,
  instagramProfileUrl,
  normalizeLeadLinks,
  normalizePhoneDisplay,
  isRealWebsite,
  isNonSiteUrl,
  isAggregatorUrl,
  isMarketplaceUrl,
  isShortenerUrl,
} = require('../utils/lead-links');

test('link do Google nunca vira site da empresa', () => {
  assert.equal(normalizeWebsite('https://maps.app.goo.gl/abc123'), '');
  assert.equal(normalizeWebsite('https://www.google.com/maps/place/Odonto'), '');
  assert.equal(normalizeWebsite('https://lh3.googleusercontent.com/p/AF1QipXYZ'), '');
  assert.equal(normalizeWebsite('https://g.co/kgs/xyz'), '');
  assert.equal(normalizeWebsite('https://goo.gl/maps/abc'), '');
  assert.equal(normalizeWebsite('http://localhost:3000/admin'), '');
  assert.equal(normalizeWebsite('javascript:alert(1)'), '');
});

test('site próprio é mantido e perde parâmetros de campanha', () => {
  assert.equal(normalizeWebsite('clinica.example'), 'https://clinica.example/');
  assert.equal(normalizeWebsite('https://www.clinica.example/contato?utm_source=gmaps#topo'), 'https://www.clinica.example/contato');
  assert.equal(normalizeWebsite('odonto-lume.com.br'), 'https://odonto-lume.com.br/');
});

test('link do Google que embrulha o site real é desembrulhado', () => {
  assert.equal(
    normalizeWebsite('https://www.google.com/url?q=https://clinica.example/contato&sa=D&usg=abc'),
    'https://clinica.example/contato',
  );
});

test('Instagram vira @handle em qualquer formato', () => {
  assert.equal(normalizeInstagram('https://www.instagram.com/odonto.lume/?igsh=abc'), '@odonto.lume');
  assert.equal(normalizeInstagram('https://instagram.com/odonto.lume/'), '@odonto.lume');
  assert.equal(normalizeInstagram('instagram.com/odonto.lume'), '@odonto.lume');
  assert.equal(normalizeInstagram('@odonto.lume'), '@odonto.lume');
  assert.equal(normalizeInstagram('odonto.lume'), '@odonto.lume');
  assert.equal(normalizeInstagram('https://www.instagram.com/p/CxYz123/'), '');
  assert.equal(normalizeInstagram('https://www.instagram.com/stories/odonto.lume/'), '');
  assert.equal(normalizeInstagram('clinica.com'), '');
  assert.equal(normalizeInstagram(''), '');
});

test('url pública do perfil é montada a partir do handle', () => {
  assert.equal(instagramProfileUrl('https://instagram.com/odonto.lume/'), 'https://instagram.com/odonto.lume');
  assert.equal(instagramProfileUrl('@odonto.lume'), 'https://instagram.com/odonto.lume');
  assert.equal(instagramProfileUrl(''), '');
});

test('site que na verdade é Instagram migra para o campo certo', () => {
  const instagramOnly = normalizeLeadLinks({ website: 'https://instagram.com/cafe.aurora', instagram: '' });
  assert.equal(instagramOnly.website, '');
  assert.equal(instagramOnly.instagram, '@cafe.aurora');

  const both = normalizeLeadLinks({
    website: 'https://cafeaurora.com?fbclid=123',
    instagram: 'https://instagram.com/cafe.aurora/',
  });
  assert.equal(both.website, 'https://cafeaurora.com/');
  assert.equal(both.instagram, '@cafe.aurora');
});

test('telefone perde glifos invisíveis do Maps', () => {
  assert.equal(normalizePhoneDisplay('\uE0B0 (21) 98765-0142'), '(21) 98765-0142');
  assert.equal(normalizePhoneDisplay('+55 21 98765-0142'), '+55 21 98765-0142');
  assert.equal(normalizePhoneDisplay('123'), '');
});

test('link-in-bio, marketplace e encurtador nunca viram site', () => {
  assert.equal(normalizeWebsite('https://linktr.ee/cafe.aurora'), '');
  assert.equal(normalizeWebsite('https://www.linktree.com/e/cafe'), '');
  assert.equal(normalizeWebsite('https://bio.site/cafe'), '');
  assert.equal(normalizeWebsite('https://beacons.ai/cafe'), '');
  assert.equal(normalizeWebsite('https://ifood.com.br/loja/cafe'), '');
  assert.equal(normalizeWebsite('https://bit.ly/cafe3'), '');
  assert.equal(normalizeWebsite('https://tinyurl.com/cafe'), '');
  assert.equal(normalizeWebsite('facebook.com/cafe.aurora'), '');
  assert.equal(normalizeWebsite('https://www.youtube.com/@cafe'), '');
});

test('isRealWebsite é a decisão única de "tem site"', () => {
  assert.equal(isRealWebsite('https://cafeaurora.com.br'), true);
  assert.equal(isRealWebsite('cafeaurora.com.br'), true);
  assert.equal(isRealWebsite('https://cafeaurora.com.br/?utm_source=gmaps'), true);
  assert.equal(isRealWebsite('https://instagram.com/cafe.aurora'), false);
  assert.equal(isRealWebsite('https://linktr.ee/cafe.aurora'), false);
  assert.equal(isRealWebsite('https://ifood.com.br/loja'), false);
  assert.equal(isRealWebsite('https://bit.ly/abc'), false);
  assert.equal(isRealWebsite(''), false);
});

test('classificadores de categoria retornam true só para o tipo', () => {
  assert.equal(isAggregatorUrl('https://linktr.ee/cafe'), true);
  assert.equal(isAggregatorUrl('https://cafeaurora.com.br'), false);
  assert.equal(isMarketplaceUrl('https://ifood.com.br/loja'), true);
  assert.equal(isMarketplaceUrl('https://cafeaurora.com.br'), false);
  assert.equal(isShortenerUrl('https://bit.ly/abc'), true);
  assert.equal(isShortenerUrl('https://cafeaurora.com.br'), false);
  assert.equal(isNonSiteUrl('https://google.com/maps'), true);
  assert.equal(isNonSiteUrl('https://cafeaurora.com.br'), false);
});

test('normalizeLeadLinks descarta agregador do campo site', () => {
  const result = normalizeLeadLinks({ website: 'https://linktr.ee/cafe.aurora', instagram: '' });
  assert.equal(result.website, '');
  assert.equal(result.instagram, '');
});

test('handle colado no campo site migra para Instagram em vez de virar site falso', () => {
  const comPonto = normalizeLeadLinks({ website: '@cafe.aurora', instagram: '' });
  assert.equal(comPonto.website, '');
  assert.equal(comPonto.instagram, '@cafe.aurora');

  // "@cafe.co" tem sufixo de domínio válido, mas o @ é handle explícito.
  const comTld = normalizeLeadLinks({ website: '@cafe.co', instagram: '' });
  assert.equal(comTld.website, '');
  assert.equal(comTld.instagram, '@cafe.co');

  // Domínio de verdade continua sendo site.
  assert.equal(normalizeLeadLinks({ website: 'cafe.co' }).website, 'https://cafe.co/');
});

test('foto do CDN da rede social nunca vira site', () => {
  assert.equal(normalizeWebsite('https://scontent.cdninstagram.com/v/t51/foto.jpg'), '');
  assert.equal(normalizeWebsite('https://scontent.xx.fbcdn.net/v/foto.jpg'), '');
  assert.equal(normalizeWebsite('https://media.licdn.com/dms/image/foto.png'), '');
  assert.equal(isNonSiteUrl('https://scontent.cdninstagram.com/v/foto.jpg'), true);
  assert.equal(isNonSiteUrl('https://loja.cafeaurora.com.br'), false);
  assert.equal(normalizeWebsite('https://loja.cafeaurora.com.br/pedidos'), 'https://loja.cafeaurora.com.br/pedidos');
});

test('agregador colado no campo Instagram não vira handle', () => {
  assert.equal(normalizeInstagram('https://linktr.ee/cafe'), '');
  assert.equal(normalizeLeadLinks({ website: '', instagram: 'https://linktr.ee/cafe' }).instagram, '');
});
