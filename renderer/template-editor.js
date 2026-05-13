let activeTemplateText = '';

function renderTemplateEditor(containerId, initialText, onUpdate) {
  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return;

  const variables = [
    { key: 'nome', label: 'Nome do lead' },
    { key: 'empresa', label: 'Nome da empresa' },
    { key: 'categoria', label: 'Categoria' },
    { key: 'telefone', label: 'Telefone' },
    { key: 'endereco', label: 'Endereço' },
    { key: 'site', label: 'Site' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'email', label: 'Email' },
  ];

  container.innerHTML = `
    <label>${t('wa_template')}</label>
    <textarea id="waTemplateText" placeholder="Olá {{nome}}! Vi que a {{empresa}} atua como {{categoria}}..."></textarea>
    <div style="margin-bottom:10px;">
      <span style="font-size:10px;color:var(--text2);display:block;margin-bottom:4px;">${t('wa_insert_var')}:</span>
      ${variables.map(v => `<span class="wa-var-btn" data-var="{{${v.key}}}">{{${v.key}}}</span>`).join('')}
    </div>
    <div id="waTemplatePreview" style="padding:10px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--text2);min-height:40px;margin-bottom:8px;">
      <em>${t('wa_preview')}</em>
    </div>
  `;

  const textarea = container.querySelector('#waTemplateText');
  const preview = container.querySelector('#waTemplatePreview');

  textarea.value = initialText || '';

  function updatePreview() {
    const txt = textarea.value || '';
    activeTemplateText = txt;

    let display = txt;
    if (!display) {
      preview.innerHTML = `<em>${t('wa_preview')}</em>`;
      if (onUpdate) onUpdate({ text: '', variables: [] });
      return;
    }

    display = display
      .replace(/\{\{nome\}\}/g, '<strong>João Silva</strong>')
      .replace(/\{\{empresa\}\}/g, '<strong>Academia Exemplo</strong>')
      .replace(/\{\{categoria\}\}/g, '<strong>Academia</strong>')
      .replace(/\{\{telefone\}\}/g, '<strong>(21) 99999-8888</strong>')
      .replace(/\{\{endereco\}\}/g, '<strong>Rua Exemplo, 123</strong>')
      .replace(/\{\{site\}\}/g, '<strong>exemplo.com</strong>')
      .replace(/\{\{instagram\}\}/g, '<strong>@exemplo</strong>')
      .replace(/\{\{email\}\}/g, '<strong>contato@exemplo.com</strong>');

    preview.innerHTML = display;

    const vars = [...new Set((txt.match(/\{\{(\w+)\}\}/g) || []).map(m => m.replace(/[{}]/g, '')))];
    if (onUpdate) onUpdate({ text: txt, variables: vars });
  }

  textarea.addEventListener('input', updatePreview);

  container.querySelectorAll('.wa-var-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cursorPos = textarea.selectionStart;
      const textBefore = textarea.value.substring(0, cursorPos);
      const textAfter = textarea.value.substring(cursorPos);
      textarea.value = textBefore + btn.dataset.var + textAfter;
      textarea.focus();
      const newPos = cursorPos + btn.dataset.var.length;
      textarea.setSelectionRange(newPos, newPos);
      updatePreview();
    });
  });

  updatePreview();
}

window.renderTemplateEditor = renderTemplateEditor;
