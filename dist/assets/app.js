(function () {
  'use strict';
  const editor = document.getElementById('message');
  const $ = id => document.getElementById(id);
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
  const templateTexts = Object.create(null);
  let templatesUnavailable = false;
  try {
    const savedTexts = JSON.parse(localStorage.getItem(templatesKey));
    if (savedTexts && typeof savedTexts === 'object' && !Array.isArray(savedTexts)) {
      Object.entries(savedTexts).forEach(([id, text]) => {
        if (campaigns.templates.some(template => template.id === id) && typeof text === 'string') templateTexts[id] = text;
      });
    }
  } catch (error) { templatesUnavailable = !(error instanceof SyntaxError); }
  $('copy').addEventListener('click', () => {
    const template = campaigns.templates.find(item => item.id === $('campaign-template').value);
    if (!template) { notify('Selecione um modelo válido para salvar a mensagem.'); return; }
    templateTexts[template.id] = value();
    try {
      localStorage.setItem(templatesKey, JSON.stringify(templateTexts));
      templatesUnavailable = false;
      notify('Mensagem salva localmente no modelo “' + template.label + '”. Não houve envio nem aprovação pelo WhatsApp.');
    } catch (_) {
      templatesUnavailable = true;
      notify('Não foi possível salvar no navegador. O texto do modelo “' + template.label + '” está disponível apenas nesta sessão.');
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
  $('campaign-template').addEventListener('change', showTemplateTime);
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
  $('use-template').addEventListener('click', () => {
    const template = campaigns.templates.find(item => item.id === $('campaign-template').value);
    if (!template) return;
    remember();
    const text = templateTexts[template.id] ?? template.text;
    history.push({ value: text, start: 0, end: 0 });
    snapshot(history.current());
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
    $('reply-status').textContent = 'Opção adicionada. Toque no botão da mensagem para simular uma resposta.';
    $('reply-label').focus();
  }
  $('add-reply').addEventListener('click', addReplyOption);
  $('reply-label').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addReplyOption(); }
  });
  renderReplyOptions();
  updateCampaign();
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  update(); $('save-status').textContent = unavailable ? 'Rascunho indisponível' : 'Rascunho local';
  if (unavailable) { $('save-status').classList.add('error'); notify('Não foi possível carregar o rascunho neste navegador.'); }
  if (templatesUnavailable) notify('Não foi possível carregar os modelos salvos neste navegador. Alterações nos modelos podem ficar apenas nesta sessão.');
})();

