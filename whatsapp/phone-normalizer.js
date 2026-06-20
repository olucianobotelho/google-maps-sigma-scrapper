const DEFAULT_COUNTRY_CODE = '55';

function normalizePhone(phone, countryCode = DEFAULT_COUNTRY_CODE) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, number: null, reason: 'Telefone vazio' };
  }

  const raw = phone.trim();
  let digits = raw.replace(/\D/g, '');
  digits = digits.replace(/^0+/, '');

  const ccLen = countryCode.length;

  const explicitInternational = raw.startsWith('+');

  if (explicitInternational) {
    // Explicit international number: keep its country code.
  } else if (digits.startsWith(countryCode)) {
    // already has country code
  } else if (digits.length >= 10) {
    digits = countryCode + digits;
  } else {
    return { valid: false, number: null, reason: 'Número muito curto' };
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

module.exports = { normalizePhone, DEFAULT_COUNTRY_CODE };
