const VARIABLE_MAP = {
  'nome': 'name',
  'empresa': 'name',
  'categoria': 'category',
  'telefone': 'phone',
  'endereco': 'address',
  'site': 'website',
  'instagram': 'instagram',
  'email': 'email',
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

function interpolate(template, leadData) {
  if (typeof template === 'string') {
    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => resolveVar(varName, leadData) || match);
  }

  if (typeof template === 'object' && template !== null) {
    const result = {};
    if (template.text) {
      result.text = String(template.text).replace(/\{\{(\w+)\}\}/g, (match, varName) => resolveVar(varName, leadData) || match);
    }
    if (template.header) {
      result.header = String(template.header).replace(/\{\{(\w+)\}\}/g, (match, varName) => resolveVar(varName, leadData) || match);
    }
    if (template.footer) {
      result.footer = String(template.footer).replace(/\{\{(\w+)\}\}/g, (match, varName) => resolveVar(varName, leadData) || match);
    }
    if (Array.isArray(template.buttons)) {
      result.buttons = template.buttons.map(b => ({
        id: b.id || b.buttonId,
        text: String(b.text || b.buttonText || '').replace(/\{\{(\w+)\}\}/g, (match, varName) => resolveVar(varName, leadData) || match),
      }));
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

module.exports = { interpolate, extractVariables };
