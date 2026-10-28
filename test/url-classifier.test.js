const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyUrl } = require('../lead-scoring/url-classifier');

test('classifica plataformas sem usar substring', () => {
  assert.equal(classifyUrl('instagram.com/empresa?x=1#bio').kind, 'social');
  assert.equal(classifyUrl('https://linktr.ee/empresa').kind, 'link_aggregator');
  assert.equal(classifyUrl('empresa.wixsite.com/site').kind, 'free_builder');
  assert.equal(classifyUrl('minhafacebook.com.br').kind, 'own_domain');
});

test('classifica domínio próprio e hosted subdomain', () => {
  const own = classifyUrl('HTTPS://Empresa.com.br/pagina?q=1');
  assert.equal(own.kind, 'own_domain');
  assert.equal(own.registrableDomain, 'empresa.com.br');
  assert.equal(own.crawlPolicy, 'full');
  assert.equal(classifyUrl('loja.vercel.app').kind, 'hosted_subdomain');
});

test('bloqueia esquemas e hosts privados', () => {
  assert.equal(classifyUrl('http://127.0.0.1:3000').kind, 'suspicious');
  assert.equal(classifyUrl('http://169.254.169.254/latest').kind, 'suspicious');
  assert.equal(classifyUrl('file:///etc/passwd').kind, 'suspicious');
  assert.equal(classifyUrl('not a url').kind, 'invalid');
});

test('plataformas de link-in-bio e encurtadores conhecidas', () => {
  assert.equal(classifyUrl('https://linktree.com/e/empresa').kind, 'link_aggregator');
  assert.equal(classifyUrl('https://bio.link/empresa').kind, 'link_aggregator');
  assert.equal(classifyUrl('https://lnk.bio/empresa').kind, 'link_aggregator');
  assert.equal(classifyUrl('https://linkin.bio/empresa').kind, 'link_aggregator');
  assert.equal(classifyUrl('https://allmylinks.com/empresa').kind, 'link_aggregator');
  assert.equal(classifyUrl('https://bit.ly/abc123').kind, 'shortener');
  assert.equal(classifyUrl('https://fb.me/abc123').kind, 'social');
  assert.equal(classifyUrl('https://instagr.am/empresa').kind, 'social');
  assert.equal(classifyUrl('https://carrd.co/empresa').kind, 'free_builder');
});
