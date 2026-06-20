let activeTemplateText = '';
let activeTemplateMedia = null; // { filePath, mimetype, fileName }

function escapeTemplateHtml(value) {
  const div = document.createElement('div');
  div.textContent = value || '';
  return div.innerHTML;
}

function renderTemplateEditor(containerId, initialText, onUpdate, initialMedia) {
  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return;

  activeTemplateMedia = initialMedia || null;

  const variables = [
    { key: 'nome', label: 'Nome do lead' },
    { key: 'empresa', label: 'Nome da empresa' },
    { key: 'categoria', label: 'Categoria' },
    { key: 'telefone', label: 'Telefone' },
    { key: 'endereco', label: 'Endereço' },
    { key: 'site', label: 'Site' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'email', label: 'Email' },
    { key: 'rating', label: 'Nota (estrelas)' },
    { key: 'avaliacoes', label: 'Nº de avaliações' },
  ];

  container.innerHTML = `
    <label>${t('wa_template')}</label>
    <textarea id="waTemplateText" placeholder="Olá {{nome}}! Vi que a {{empresa}} atua como {{categoria}}...&#10;&#10;Dica: use {Olá|Oi|Hey} para variações automáticas (anti-spam)"></textarea>
    <div style="margin-bottom:10px;">
      <span style="font-size:10px;color:var(--text2);display:block;margin-bottom:4px;">${t('wa_insert_var')}:</span>
      ${variables.map(v => `<span class="wa-var-btn" data-var="{{${v.key}}}">{{${v.key}}}</span>`).join('')}
      <span class="wa-var-btn" data-var="{Olá|Oi|Hey}" style="background:var(--accent);color:#fff;border-color:var(--accent);cursor:pointer" title="Spintax: entrega uma variação aleatória a cada disparo">{Spintax}</span>
    </div>
    <div style="margin-bottom:10px;">
      <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px;">${t('wa_attachment') || 'Anexo (imagem, PDF, áudio)'}:</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <button id="waMediaAttachBtn" style="padding:4px 10px;font-size:11px;border-radius:4px;border:1px solid var(--border);background:var(--bg2);color:var(--text1);cursor:pointer;">${t('wa_choose_file') || 'Escolher arquivo'}</button>
        <span id="waMediaFileName" style="font-size:11px;color:var(--text2);"></span>
        <button id="waMediaRemoveBtn" style="display:none;padding:2px 6px;font-size:10px;border-radius:4px;border:1px solid #e44;background:transparent;color:#e44;cursor:pointer;">✕</button>
      </div>
    </div>
    <div id="waTemplatePreview" style="padding:10px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--text2);min-height:40px;margin-bottom:8px;">
      <em>${t('wa_preview')}</em>
    </div>
  `;

  const textarea = container.querySelector('#waTemplateText');
  const preview = container.querySelector('#waTemplatePreview');
  const mediaBtn = container.querySelector('#waMediaAttachBtn');
  const mediaName = container.querySelector('#waMediaFileName');
  const mediaRemove = container.querySelector('#waMediaRemoveBtn');

  textarea.value = initialText || '';

  if (activeTemplateMedia && activeTemplateMedia.fileName) {
    mediaName.textContent = activeTemplateMedia.fileName;
    mediaRemove.style.display = 'inline-block';
  }

  mediaBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.openFile({
      title: t('wa_choose_file') || 'Escolher arquivo',
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
        { name: 'Video', extensions: ['mp4', '3gp'] },
        { name: 'Audio', extensions: ['mp3', 'ogg', 'opus', 'm4a'] },
        { name: 'Documents', extensions: ['pdf', 'doc', 'docx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result && result.filePath) {
      activeTemplateMedia = { filePath: result.filePath, fileName: result.filePath.split(/[\\/]/).pop() };
      mediaName.textContent = activeTemplateMedia.fileName;
      mediaRemove.style.display = 'inline-block';
      fireUpdate();
    }
  });

  mediaRemove.addEventListener('click', () => {
    activeTemplateMedia = null;
    mediaName.textContent = '';
    mediaRemove.style.display = 'none';
    fireUpdate();
  });

  function updatePreview() {
    const txt = textarea.value || '';
    activeTemplateText = txt;
    if (!txt) {
      preview.innerHTML = `<em>${t('wa_preview')}</em>`;
      fireUpdate();
      return;
    }

    let display = escapeTemplateHtml(txt)
      .replace(/\{\{nome\}\}/g, '<strong>João Silva</strong>')
      .replace(/\{\{empresa\}\}/g, '<strong>Academia Exemplo</strong>')
      .replace(/\{\{categoria\}\}/g, '<strong>Academia</strong>')
      .replace(/\{\{telefone\}\}/g, '<strong>(21) 99999-8888</strong>')
      .replace(/\{\{endereco\}\}/g, '<strong>Rua Exemplo, 123</strong>')
      .replace(/\{\{site\}\}/g, '<strong>exemplo.com</strong>')
      .replace(/\{\{instagram\}\}/g, '<strong>@exemplo</strong>')
      .replace(/\{\{email\}\}/g, '<strong>contato@exemplo.com</strong>')
      .replace(/\{\{rating\}\}/g, '<strong>4.7</strong>')
      .replace(/\{\{nota\}\}/g, '<strong>4.7</strong>')
      .replace(/\{\{estrelas\}\}/g, '<strong>4.7</strong>')
      .replace(/\{\{avaliacoes\}\}/g, '<strong>342</strong>')
      .replace(/\{\{reviews\}\}/g, '<strong>342</strong>');

    // Preview spintax: show first option with indicator
    display = display.replace(/\{([^{}|]+)\|([^{}]+)\}/g, '<span title="Variação aleatória" style="color:var(--accent);font-weight:600;">$1</span><span style="font-size:9px;color:var(--text3);"> ↻</span>');

    preview.innerHTML = display;
    fireUpdate();
  }

  function fireUpdate() {
    const txt = textarea.value || '';
    const vars = [...new Set((txt.match(/\{\{(\w+)\}\}/g) || []).map(m => m.replace(/[{}]/g, '')))];
    const data = { text: txt, variables: vars };
    if (activeTemplateMedia) {
      data.media = activeTemplateMedia;
    }
    if (onUpdate) onUpdate(data);
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
window.getActiveTemplateMedia = () => activeTemplateMedia;
