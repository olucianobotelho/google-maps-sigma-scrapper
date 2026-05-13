const DEFAULT_COUNTRY_CODE = '55';

function normalizePhone(phone, countryCode = DEFAULT_COUNTRY_CODE) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, number: null, reason: 'Telefone vazio' };
  }

  let digits = phone.replace(/\D/g, '');
  digits = digits.replace(/^0+/, '');

  const ccLen = countryCode.length;

  if (digits.startsWith(countryCode)) {
    // already has country code
  } else if (digits.length >= 10) {
    digits = countryCode + digits;
  } else {
    return { valid: false, number: null, reason: 'Número muito curto' };
  }

  if (digits.length < ccLen + 10) {
    return { valid: false, number: null, reason: `Número deve ter pelo menos ${ccLen + 10} dígitos` };
  }

  if (digits.length > 15) {
    return { valid: false, number: null, reason: 'Número excede 15 dígitos' };
  }

  return { valid: true, number: digits };
}

module.exports = { normalizePhone, DEFAULT_COUNTRY_CODE };
