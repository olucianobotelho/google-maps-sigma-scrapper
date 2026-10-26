const DEFAULT_COUNTRY_CODE = '55';

// Prefixos de serviços que não recebem WhatsApp (0800, 0300, 0500, 0900).
// Avaliados antes de remover o zero de discagem para não confundir com DDD.
const SERVICE_NUMBER_PREFIXES = ['0800', '0300', '0500', '0900'];

function isServiceNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return SERVICE_NUMBER_PREFIXES.some((prefix) => digits.startsWith(prefix));
}

/**
 * Normaliza telefone para o formato internacional (somente dígitos).
 *
 * Regra de país (o bug do DDD 55): o prefixo do país NÃO pode ser inferido só
 * por `startsWith`. Um número local de 10–11 dígitos — inclusive com DDD 55
 * (Santa Maria/RS) — precisa receber o código do país; só é considerado
 * internacional quando o tamanho bate com país + número (10 ou 11 dígitos).
 */
function normalizePhone(phone, countryCode = DEFAULT_COUNTRY_CODE) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, number: null, reason: 'Telefone vazio' };
  }

  const raw = phone.trim();
  if (!raw) {
    return { valid: false, number: null, reason: 'Telefone vazio' };
  }

  if (!/[\d]/.test(raw)) {
    return { valid: false, number: null, reason: 'Telefone sem dígitos' };
  }

  if (isServiceNumber(raw)) {
    return {
      valid: false,
      number: null,
      reason: 'Número de serviço (0800/0300) não recebe WhatsApp',
    };
  }

  const cc = String(countryCode || DEFAULT_COUNTRY_CODE);
  const ccLen = cc.length;

  // Remove apenas o zero de discagem/DDD-tronco (011, 021...), não zeros internos.
  let digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) {
    return { valid: false, number: null, reason: 'Telefone vazio' };
  }

  const explicitInternational = raw.startsWith('+');
  const looksInternational =
    digits.startsWith(cc) &&
    digits.length >= ccLen + 10 &&
    digits.length <= ccLen + 11;

  if (!explicitInternational && !looksInternational) {
    // Local (10 ou 11 dígitos) ou número com zero de operadora: prefixa o país.
    digits = cc + digits;
  }

  const minLength = explicitInternational ? 10 : ccLen + 10;
  if (digits.length < minLength) {
    return { valid: false, number: null, reason: `Número deve ter pelo menos ${minLength} dígitos` };
  }

  if (digits.length > 15) {
    return { valid: false, number: null, reason: 'Número excede 15 dígitos' };
  }

  return { valid: true, number: digits };
}

module.exports = { normalizePhone, isServiceNumber, DEFAULT_COUNTRY_CODE };
