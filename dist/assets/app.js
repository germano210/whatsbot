(function () {
  'use strict';
  const editor = document.getElementById('message');
  const $ = id => document.getElementById(id);
  const tabs = { edit: ['tab-edit', 'edit-panel'], settings: ['tab-settings', 'settings-panel'] };
  function showTab(name, focus = false) {
    Object.entries(tabs).forEach(([tabName, [tabId, panelId]]) => {
      const active = tabName === name;
      $(tabId).setAttribute('aria-selected', String(active));
      $(tabId).tabIndex = active ? 0 : -1;
      $(panelId).hidden = !active;
    });
    if (focus) $(tabs[name][0]).focus();
  }
  Object.entries(tabs).forEach(([name, [tabId]]) => {
    $(tabId).addEventListener('click', () => showTab(name));
    $(tabId).addEventListener('keydown', event => {
      const order = Object.keys(tabs);
      const index = order.indexOf(name);
      const next = event.key === 'ArrowRight' ? order[(index + 1) % order.length]
        : event.key === 'ArrowLeft' ? order[(index - 1 + order.length) % order.length]
          : event.key === 'Home' ? order[0] : event.key === 'End' ? order.at(-1) : null;
      if (next) { event.preventDefault(); showTab(next, true); }
    });
  });
  $('open-settings').addEventListener('click', () => showTab('settings', true));
  showTab('edit');
  const codec = MessageRichText;
  const replies = MessageReplies;
  let replyOptions = [];
  const key = 'texto-pronto.draft.v1';
  let initial = 'Oi! Vamos tirar aquela ideia do papel? 🌿\n\n*Nosso encontro está confirmado!*\n\n- Quinta-feira, às 15h\n- Um café e boas ideias\n\n_Leve sua criatividade. O resto a gente resolve junto._';
  let unavailable = false;
  try { const saved = localStorage.getItem(key); if (saved !== null) { const draft = JSON.parse(saved); if (typeof draft.text !== 'string') throw Error(); initial = draft.text; } } catch (_) { unavailable = true; }
  codec.render(editor, initial);
  const value = () => codec.serialize(editor);
  const history = MessageHistory.createHistory({ value: value(), start: 0, end: 0 });
  let bookmark = null, timer, lastInput = 0, lastType = '';
  function notify(text) { $('action-status').textContent = text; }
  function position() {
    const selection = window.getSelection();
    if (!selection.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return { start: 0, end: 0 };
    const range = selection.getRangeAt(0), before = range.cloneRange();
    before.selectNodeContents(editor); before.setEnd(range.startContainer, range.startOffset);
    return { start: before.cloneContents().textContent.length, end: before.toString().length + range.cloneContents().textContent.length };
  }
  function remember() {
    const selection = window.getSelection();
    if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
      bookmark = selection.getRangeAt(0).cloneRange();
      const p = position(); history.selection(p.start, p.end);
    }
  }
  function restore(start, end) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT), nodes = [];
    let node; while ((node = walker.nextNode())) nodes.push(node);
    function point(offset) { for (const text of nodes) { if (offset <= text.length) return [text, offset]; offset -= text.length; } return nodes.length ? [nodes.at(-1), nodes.at(-1).length] : [editor, 0]; }
    const range = document.createRange(); range.setStart(...point(start)); range.setEnd(...point(end));
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); bookmark = range.cloneRange();
  }
  function update() {
    const count = Array.from(codec.serialize(editor, true)).length;
    editor.dataset.empty = String(count === 0);
    $('character-count').textContent = count.toLocaleString('pt-BR') + (count === 1 ? ' caractere' : ' caracteres');
    $('undo').disabled = !history.canUndo(); $('redo').disabled = !history.canRedo();
    $('copy').disabled = false; $('clear').disabled = !count;
  }
  function save() {
    clearTimeout(timer);
    try { localStorage.setItem(key, JSON.stringify({ text: value() })); $('save-status').textContent = 'Rascunho salvo'; $('save-status').classList.remove('error'); }
    catch (_) { $('save-status').textContent = 'Não foi possível salvar'; $('save-status').classList.add('error'); }
  }
  function changed() { update(); updateCampaign(); resetReplyMessages(); $('save-status').textContent = 'Salvando…'; clearTimeout(timer); timer = setTimeout(save, 350); }
  function record(merge = false) { history.push({ value: value(), ...position() }, merge); remember(); changed(); }
  function snapshot(item) { codec.render(editor, item.value); editor.focus({ preventScroll: true }); restore(item.start, item.end); lastInput = 0; changed(); }
  function format(action) {
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (bookmark) { selection.removeAllRanges(); selection.addRange(bookmark); }
    remember();
    const commands = { bold: 'bold', italic: 'italic', strike: 'strikeThrough', list: 'insertUnorderedList', numberedList: 'insertOrderedList' };
    let node = selection.anchorNode; if (node && node.nodeType === 3) node = node.parentElement;
    if (commands[action]) document.execCommand(commands[action], false);
    else if (action === 'quote') document.execCommand('formatBlock', false, node && node.closest('blockquote') ? 'div' : 'blockquote');
    else if (selection.rangeCount) {
      const existing = node && node.closest('code');
      if (existing && editor.contains(existing)) {
        const start = position(); existing.replaceWith(...existing.childNodes); restore(start.start, start.end);
      } else {
        const range = selection.getRangeAt(0), code = document.createElement('code');
        if (action === 'code') code.setAttribute('data-code', 'block');
        code.textContent = range.toString() || 'texto'; range.deleteContents(); range.insertNode(code); range.selectNodeContents(code);
        selection.removeAllRanges(); selection.addRange(range);
      }
    }
    record();
  }
  editor.addEventListener('beforeinput', event => {
    remember();
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); snapshot(event.inputType === 'historyUndo' ? history.undo() : history.redo()); }
  });
  editor.addEventListener('input', event => {
    const now = Date.now(), type = event.inputType;
    const merge = ['insertText', 'deleteContentBackward'].includes(type) && type === lastType && now - lastInput < 650;
    record(merge); lastInput = now; lastType = type;
  });
  ['keyup', 'pointerup'].forEach(event => editor.addEventListener(event, remember));
  editor.addEventListener('paste', event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); record(); });
  editor.addEventListener('drop', event => event.preventDefault());
  editor.addEventListener('copy', event => {
    const selection = window.getSelection();
    if (event.clipboardData && selection.rangeCount) { event.preventDefault(); const range = selection.getRangeAt(0);
      let fragment = range.cloneContents();
      let ancestor = range.commonAncestorContainer;
      if (ancestor.nodeType === 3) ancestor = ancestor.parentElement;
      while (ancestor && ancestor !== editor) {
        if (/^(STRONG|B|EM|I|S|STRIKE|DEL|CODE|PRE|BLOCKQUOTE|UL|OL|LI)$/.test(ancestor.tagName)) {
          const wrapper = document.createElement(ancestor.tagName);
          if (ancestor.tagName === 'CODE' && ancestor.getAttribute('data-code') === 'block') wrapper.setAttribute('data-code', 'block');
          if (ancestor.tagName === 'OL' && ancestor.hasAttribute('start')) wrapper.setAttribute('start', ancestor.getAttribute('start'));
          wrapper.append(fragment); fragment = wrapper;
        }
        ancestor = ancestor.parentElement;
      }
      event.clipboardData.setData('text/plain', codec.serialize(fragment)); }
  });
  document.querySelectorAll('[data-format]').forEach(button => {
    button.addEventListener('pointerdown', event => { remember(); event.preventDefault(); });
    button.addEventListener('click', () => format(button.dataset.format));
  });
  $('undo').addEventListener('click', () => snapshot(history.undo()));
  $('redo').addEventListener('click', () => snapshot(history.redo()));
  $('clear').addEventListener('click', () => { remember(); history.push({ value: '', start: 0, end: 0 }); snapshot(history.current()); notify('Mensagem limpa. Use Desfazer para recuperá-la.'); });
  editor.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const action = !event.shiftKey && key === 'b' ? 'bold' : !event.shiftKey && key === 'i' ? 'italic' : event.shiftKey && key === 'x' ? 'strike' : null;
    if (action) { event.preventDefault(); format(action); }
    if (key === 'z' || (key === 'y' && !event.shiftKey)) { event.preventDefault(); snapshot(event.shiftKey || key === 'y' ? history.redo() : history.undo()); }
  });
  const campaigns = MessageCampaigns;
  const templatesKey = 'texto-pronto.template-texts.v1';
  const savedTemplates = Object.create(null);
  let loadedTemplateId = null;
  function validatedReplyOptions(options) {
    if (!Array.isArray(options) || options.length > 3) return [];
    let validated = [];
    for (const option of options) {
      const result = replies.addOption(validated, option && option.label);
      if (!result.ok) return [];
      validated = result.options;
    }
    return validated;
  }
  let templatesUnavailable = false;
  try {
    const savedTexts = JSON.parse(localStorage.getItem(templatesKey));
    if (savedTexts && typeof savedTexts === 'object' && !Array.isArray(savedTexts)) {
      Object.entries(savedTexts).forEach(([id, saved]) => {
        if (!campaigns.templates.some(template => template.id === id)) return;
        if (typeof saved === 'string') savedTemplates[id] = { text: saved, options: [] };
        else if (saved && typeof saved.text === 'string') {
          savedTemplates[id] = { text: saved.text, options: validatedReplyOptions(saved.options) };
        }
      });
    }
  } catch (error) { templatesUnavailable = !(error instanceof SyntaxError); }
  $('copy').addEventListener('click', () => {
    const template = campaigns.templates.find(item => item.id === $('campaign-template').value);
    if (!template) { notify('Selecione um modelo válido para salvar a mensagem.'); return; }
    savedTemplates[template.id] = { text: value(), options: replyOptions.map(option => ({ ...option })) };
    try {
      localStorage.setItem(templatesKey, JSON.stringify(savedTemplates));
      templatesUnavailable = false;
      notify('Mensagem e opções salvas localmente no modelo “' + template.label + '”. Não houve envio nem aprovação pelo WhatsApp.');
    } catch (_) {
      templatesUnavailable = true;
      notify('Não foi possível salvar no navegador. O texto e as opções do modelo “' + template.label + '” estão disponíveis apenas nesta sessão.');
    }
  });
  campaigns.templates.forEach(template => {
    const option = document.createElement('option');
    option.value = template.id; option.textContent = template.label;
    $('campaign-template').append(option);
  });
  const timesKey = 'texto-pronto.template-times.v1';
  const templateTimes = Object.create(null);
  const validTime = time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  let timesUnavailable = false;
  try {
    const savedTimes = JSON.parse(localStorage.getItem(timesKey));
    if (savedTimes && typeof savedTimes === 'object' && !Array.isArray(savedTimes)) {
      Object.entries(savedTimes).forEach(([id, time]) => {
        if (campaigns.templates.some(template => template.id === id) && validTime(time)) templateTimes[id] = time;
      });
    }
  } catch (error) { timesUnavailable = !(error instanceof SyntaxError); }
  function showTemplateTime() {
    const time = templateTimes[$('campaign-template').value] || '';
    $('template-time').value = time;
    $('template-time-status').textContent = time
      ? 'Horário definido: ' + time + ' (somente configuração local; nenhum envio automático)'
      : 'Template padrão de resposta';
    $('template-time-storage').textContent = timesUnavailable
      ? 'Armazenamento indisponível. O horário funciona somente nesta sessão; não foi possível recuperar ou salvar preferências.'
      : '';
  }
  $('template-time').addEventListener('change', () => {
    const id = $('campaign-template').value, time = $('template-time').value;
    if (!campaigns.templates.some(template => template.id === id)) return;
    if ($('template-time').validity.badInput || (time && !validTime(time))) {
      $('template-time-status').textContent = 'Informe um horário válido no formato HH:MM.';
      return;
    }
    if (time) templateTimes[id] = time;
    else delete templateTimes[id];
    try { localStorage.setItem(timesKey, JSON.stringify(templateTimes)); timesUnavailable = false; }
    catch (_) { timesUnavailable = true; }
    showTemplateTime();
  });
  showTemplateTime();
  campaigns.contacts.forEach(contact => {
    if (!$('campaign-contacts')) return;
    const label = document.createElement('label'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.value = contact.id;
    checkbox.disabled = !campaigns.canReceivePromotions(contact);
    const status = contact.optOut ? 'Descadastrado' : contact.optIn ? 'Autorização fictícia registrada' : 'Sem autorização';
    label.append(checkbox, document.createTextNode(contact.label + ' — ' + status));
    $('campaign-contacts').append(label);
  });
  function selectedContacts() {
    return Array.from($('campaign-contacts')?.querySelectorAll('input:checked') || [], input => input.value);
  }
  function updateCampaign() {
    if (!$('campaign-count') || !$('simulate-campaign') || !$('campaign-result')) return;
    const selected = selectedContacts();
    const count = selected.filter(id => campaigns.canReceivePromotions(campaigns.contacts.find(contact => contact.id === id))).length;
    $('campaign-count').textContent = count + (count === 1 ? ' contato elegível selecionado' : ' contatos elegíveis selecionados');
    $('simulate-campaign').disabled = !campaigns.simulate(codec.serialize(editor, true), selected).ok;
    $('campaign-result').textContent = '';
  }
  $('campaign-template').addEventListener('change', () => {
    showTemplateTime();
    const template = campaigns.templates.find(item => item.id === $('campaign-template').value);
    loadedTemplateId = template?.id || null;
    replyOptions = (savedTemplates[template?.id]?.options || []).map(option => ({ ...option }));
    $('reply-label').value = '';
    if (!template) { renderReplyOptions(); return; }
    remember();
    const text = savedTemplates[template.id]?.text ?? template.text;
    history.push({ value: text, start: 0, end: 0 });
    snapshot(history.current());
    renderReplyOptions();
    notify('Modelo local não aprovado carregado. Use Desfazer para recuperar a mensagem anterior.');
  });
  $('campaign-contacts')?.addEventListener('change', updateCampaign);
  $('simulate-campaign')?.addEventListener('click', () => {
    if (!$('campaign-result')) return;
    const result = campaigns.simulate(codec.serialize(editor, true), selectedContacts());
    $('campaign-result').textContent = result.ok
      ? 'Simulação concluída para ' + result.recipientIds.length + ' contato(s) fictício(s). Nenhuma mensagem foi enviada.'
      : result.error + ' Nenhuma mensagem foi enviada.';
  });
  function resetReplyMessages() {
    $('reply-messages').replaceChildren();
    $('reply-messages').hidden = true;
    $('reply-status').textContent = '';
    const empty = !codec.serialize(editor, true).trim();
    $('reply-buttons').querySelectorAll('button').forEach(button => { button.disabled = empty; });
  }
  function renderReplyOptions() {
    resetReplyMessages();
    $('reply-buttons').replaceChildren();
    $('reply-options').replaceChildren();
    $('reply-buttons').hidden = !replyOptions.length;
    replyOptions.forEach(option => {
      const response = document.createElement('button');
      response.type = 'button'; response.textContent = option.label;
      response.disabled = !codec.serialize(editor, true).trim();
      response.addEventListener('click', () => {
        const choice = replies.chooseOption(replyOptions, option.id);
        if (!choice || !codec.serialize(editor, true).trim()) return;
        const bubble = document.createElement('div');
        bubble.className = 'reply-bubble'; bubble.textContent = choice.label;
        $('reply-messages').replaceChildren(bubble);
        $('reply-messages').hidden = false;
        $('reply-status').textContent = 'Resposta simulada: ' + choice.label + '. Nenhuma mensagem foi enviada.';
      });
      $('reply-buttons').append(response);
      const row = document.createElement('div'), label = document.createElement('span'), remove = document.createElement('button');
      label.textContent = option.label;
      remove.type = 'button'; remove.textContent = 'Remover';
      remove.setAttribute('aria-label', 'Remover opção ' + option.label);
      remove.addEventListener('click', () => {
        replyOptions = replies.removeOption(replyOptions, option.id);
        renderReplyOptions();
        $('reply-status').textContent = 'Opção removida.';
        $('reply-label').focus();
      });
      row.append(label, remove); $('reply-options').append(row);
    });
    $('add-reply').disabled = replyOptions.length >= 3;
  }
  function addReplyOption() {
    const result = replies.addOption(replyOptions, $('reply-label').value);
    if (!result.ok) { $('reply-status').textContent = result.error; return; }
    replyOptions = result.options;
    $('reply-label').value = '';
    renderReplyOptions();
    $('reply-status').textContent = 'Opção adicionada. Use Salvar mensagem para guardá-la neste modelo. Toque no botão da mensagem para simular uma resposta.';
    $('reply-label').focus();
  }
  $('add-reply').addEventListener('click', addReplyOption);
  $('reply-label').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addReplyOption(); }
  });
  renderReplyOptions();
  updateCampaign();
  const localServer = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
    && ['http:', 'https:'].includes(window.location.protocol);
  const adminKey = $('admin-key');
  let metaConfigured = false, autoReplyConfigured = null, metaBusy = false;
  $('meta-availability').textContent = window.location.protocol === 'file:'
    ? 'Abra o editor pelo servidor em localhost. Em file:// a conexão e os envios ficam desativados.'
    : localServer ? 'Conexão disponível somente após informar a chave local e verificar o servidor.'
      : 'Abra o editor pelo servidor em localhost para usar a integração.';
  function feedback(id, message, error = false) {
    const element = $(id);
    element.textContent = message;
    element.classList[error ? 'add' : 'remove']('error');
    element.setAttribute('role', error ? 'alert' : 'status');
  }
  function updateMetaControls() {
    const authorized = localServer && !!adminKey.value.trim();
    adminKey.disabled = metaBusy;
    $('check-meta-status').disabled = !authorized || metaBusy;
    $('test-send').disabled = !authorized || !metaConfigured || metaBusy;
    $('activate-auto-reply').disabled = !authorized || !metaConfigured || metaBusy;
    $('deactivate-auto-reply').disabled = !authorized || !metaConfigured || autoReplyConfigured === false || metaBusy;
  }
  adminKey.addEventListener('input', () => {
    metaConfigured = false;
    autoReplyConfigured = null;
    feedback('meta-status', 'Chave alterada. Verifique novamente a conexão.');
    updateMetaControls();
  });
  $('check-meta-status').addEventListener('click', async () => {
    if (!localServer || !adminKey.value.trim() || metaBusy) return;
    metaBusy = true;
    metaConfigured = false;
    updateMetaControls();
    feedback('meta-status', 'Verificando servidor…');
    try {
      const response = await fetch('/api/meta/status', { headers: { 'X-Admin-Key': adminKey.value.trim() }, cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const status = await response.json();
      if (typeof status.configured !== 'boolean' || !['test', 'off'].includes(status.mode)
        || typeof status.webhookConfigured !== 'boolean') throw new Error('Resposta inválida');
      metaConfigured = status.configured && status.mode === 'test';
      autoReplyConfigured = typeof status.autoReplyConfigured === 'boolean' ? status.autoReplyConfigured : null;
      const connection = metaConfigured ? 'API configurada em modo de teste.' : 'API não disponível para teste.';
      const webhook = status.webhookConfigured ? 'Webhook configurado.' : 'Webhook não configurado; o bot não receberá mensagens.';
      const autoReply = autoReplyConfigured === null ? ''
        : autoReplyConfigured ? 'Resposta automática configurada.' : 'Resposta automática não configurada.';
      feedback('meta-status', [connection, webhook, autoReply].filter(Boolean).join(' '), !metaConfigured);
    } catch (error) {
      feedback('meta-status', 'Falha ao verificar conexão (' + (error.message.startsWith('HTTP ') ? error.message : 'servidor indisponível ou resposta inválida') + ').', true);
    } finally { metaBusy = false; updateMetaControls(); }
  });
  $('test-send').addEventListener('click', async () => {
    if (!localServer || !metaConfigured || !adminKey.value.trim() || metaBusy) return;
    const recipient = $('test-recipient').value.trim();
    if (!/^\+[1-9]\d{1,14}$/.test(recipient)) {
      feedback('test-send-status', 'Informe um número internacional válido, como +5511999999999.', true);
      return;
    }
    metaBusy = true;
    updateMetaControls();
    feedback('test-send-status', 'Solicitando envio do template hello_world…');
    try {
      const response = await fetch('/api/meta/test-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey.value.trim() },
        body: JSON.stringify({ to: recipient.slice(1) })
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const result = await response.json();
      if (typeof result.messageId !== 'string' || !result.messageId) throw new Error('Resposta inválida');
      feedback('test-send-status', 'Solicitação aceita (ID ' + result.messageId + '). A entrega ainda não foi confirmada.');
    } catch (error) {
      feedback('test-send-status', 'Falha no teste de envio (' + (error.message.startsWith('HTTP ') ? error.message : 'servidor indisponível ou resposta inválida') + ').', true);
    } finally { metaBusy = false; updateMetaControls(); }
  });
  $('activate-auto-reply').addEventListener('click', async () => {
    if (!localServer || !metaConfigured || !adminKey.value.trim() || metaBusy) return;
    if (!loadedTemplateId || $('campaign-template').value !== loadedTemplateId) {
      feedback('auto-reply-status', 'Selecione um modelo na aba Edição antes de ativar.', true);
      return;
    }
    const text = value();
    if (!text.trim()) {
      feedback('auto-reply-status', 'O modelo selecionado precisa conter texto.', true);
      return;
    }
    metaBusy = true;
    updateMetaControls();
    feedback('auto-reply-status', 'Ativando resposta automática no servidor…');
    try {
      const response = await fetch('/api/meta/auto-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey.value.trim() },
        body: JSON.stringify({ text, buttons: replyOptions.map(option => option.label) })
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      autoReplyConfigured = true;
      feedback('auto-reply-status', 'Configuração aceita. O bot responderá somente mensagens recebidas quando o webhook estiver ativo.');
    } catch (error) {
      feedback('auto-reply-status', 'Falha ao ativar resposta automática (' + (error.message.startsWith('HTTP ') ? error.message : 'servidor indisponível') + ').', true);
    } finally { metaBusy = false; updateMetaControls(); }
  });
  $('deactivate-auto-reply').addEventListener('click', async () => {
    if (!localServer || !metaConfigured || autoReplyConfigured === false || !adminKey.value.trim() || metaBusy) return;
    metaBusy = true;
    updateMetaControls();
    feedback('auto-reply-status', 'Desativando resposta automática no servidor…');
    try {
      const response = await fetch('/api/meta/auto-reply', {
        method: 'DELETE', headers: { 'X-Admin-Key': adminKey.value.trim() }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      autoReplyConfigured = false;
      feedback('auto-reply-status', 'Resposta automática desativada no servidor.');
    } catch (error) {
      feedback('auto-reply-status', 'Falha ao desativar resposta automática (' + (error.message.startsWith('HTTP ') ? error.message : 'servidor indisponível') + ').', true);
    } finally { metaBusy = false; updateMetaControls(); }
  });
  updateMetaControls();
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  update(); $('save-status').textContent = unavailable ? 'Rascunho indisponível' : 'Rascunho local';
  if (unavailable) { $('save-status').classList.add('error'); notify('Não foi possível carregar o rascunho neste navegador.'); }
  if (templatesUnavailable) notify('Não foi possível carregar os modelos salvos neste navegador. Alterações nos modelos podem ficar apenas nesta sessão.');
})();

