const VARIABLE_MAP = {
  'nome': 'name',
  'empresa': 'name',
  'categoria': 'category',
  'telefone': 'phone',
  'endereco': 'address',
  'site': 'website',
  'instagram': 'instagram',
  'email': 'email',
  'rating': 'rating',
  'nota': 'rating',
  'estrelas': 'rating',
  'avaliacoes': 'totalReviews',
  'reviews': 'totalReviews',
  'totalreviews': 'totalReviews',
};

function resolveVar(varName, leadData) {
  const field = VARIABLE_MAP[varName.toLowerCase()] || varName.toLowerCase();
  const value = leadData[field];
  if (value == null || value === '') return '';
  return String(value)
    .replace(/[<>]/g, '')
    .replace(/[\n\r]+/g, ' ')
    .trim();
}

/**
 * Resolve spintax patterns like {Olá|Oi|Hey} by picking a random variant.
 * Supports nested patterns and multiple occurrences per string.
 */
function resolveSpintax(text) {
  if (typeof text !== 'string') return text;
  let maxIterations = 20;
  while (text.includes('{') && maxIterations-- > 0) {
    const result = _resolveOneSpintax(text);
    if (result === text) break;
    text = result;
  }
  return text;
}

function _resolveOneSpintax(text) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const inner = text.substring(start + 1, i);
        const options = inner.split('|');
        if (options.length > 1) {
          const chosen = options[Math.floor(Math.random() * options.length)];
          return text.substring(0, start) + chosen + text.substring(i + 1);
        }
        start = -1;
      }
    }
  }
  return text;
}

function interpolate(template, leadData) {
  if (typeof template === 'string') {
    let result = template.replace(/\{\{(\w+)\}\}/g, (match, varName) => resolveVar(varName, leadData) || match);
    result = resolveSpintax(result);
    return result;
  }
  if (typeof template === 'object' && template !== null) {
    const result = {};
    if (template.text) {
      result.text = resolveSpintax(
        String(template.text).replace(/\{\{(\w+)\}\}/g, (match, varName) => resolveVar(varName, leadData) || match)
      );
    }
    if (template.header) {
      result.header = resolveSpintax(
        String(template.header).replace(/\{\{(\w+)\}\}/g, (match, varName) => resolveVar(varName, leadData) || match)
      );
    }
    if (template.footer) {
      result.footer = resolveSpintax(
        String(template.footer).replace(/\{\{(\w+)\}\}/g, (match, varName) => resolveVar(varName, leadData) || match)
      );
    }
    if (Array.isArray(template.buttons)) {
      result.buttons = template.buttons.map(b => ({
        id: b.id || b.buttonId,
        text: resolveSpintax(
          String(b.text || b.buttonText || '').replace(/\{\{(\w+)\}\}/g, (match, varName) => resolveVar(varName, leadData) || match)
        ),
      }));
    }
    // Pass media attachment through (no interpolation needed for binary)
    if (template.media) {
      result.media = template.media;
    }
    return result;
  }
  return template;
}

function extractVariables(template) {
  let text = '';
  if (typeof template === 'string') {
    text = template;
  } else if (typeof template === 'object' && template !== null) {
    text = [template.header, template.text, template.footer, ...(template.buttons || []).map(b => b.text || b.buttonText)].filter(Boolean).join(' ');
  }
  const matches = text.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))];
}

module.exports = { interpolate, extractVariables, resolveSpintax };
