(function () {
  'use strict';
  const editor = document.getElementById('message');
  const $ = id => document.getElementById(id);
  const embedded = new URLSearchParams(window.location.search).get('embedded') === '1';
  if (embedded) {
    document.body.classList.add('embedded-editor');
    $('embedded-local-note').hidden = false;
    $('meta-connection').hidden = true;
  }
  const tabs = { auto: ['tab-auto', 'auto-panel'], edit: ['tab-edit', 'edit-panel'], settings: ['tab-settings', 'settings-panel'] };
  function showTab(name, focus = false) {
    if (name !== 'settings') switchComposer(name);
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
  const codec = MessageRichText;
  const replies = MessageReplies;
  const flows = MessageContinuations;
  const continuationForms = new Map();
  let replyOptions = [];
  let key = 'texto-pronto.draft.v1';
  let initial = 'Oi! Vamos tirar aquela ideia do papel? 🌿\n\n*Nosso encontro está confirmado!*\n\n- Quinta-feira, às 15h\n- Um café e boas ideias\n\n_Leve sua criatividade. O resto a gente resolve junto._';
  let unavailable = false;
  try { const saved = localStorage.getItem(key); if (saved !== null) { const draft = JSON.parse(saved); if (typeof draft.text !== 'string') throw Error(); initial = draft.text; } } catch (_) { unavailable = true; }
  codec.render(editor, initial);
  const value = () => codec.serialize(editor);
  let history = MessageHistory.createHistory({ value: value(), start: 0, end: 0 });
  let composerMode = 'edit';
  let composerReady = false;
  const composerStates = Object.create(null);
  const autoKey = 'texto-pronto.auto-draft.v1';
  let autoInitial = { text: '', options: [] };
  try {
    const stored = JSON.parse(localStorage.getItem(autoKey));
    if (stored && typeof stored.text === 'string') autoInitial = { text: stored.text, options: validatedReplyOptions(stored.options, true) };
  } catch (_) { unavailable = true; }
  function switchComposer(mode) {
    if (mode !== composerMode) {
      remember(); if (composerReady) save();
      composerStates[composerMode] = {
        text: value(), history, replyOptions, label: $('reply-label').value,
        action: $('action-status').textContent, saveStatus: $('save-status').textContent
      };
      const state = composerStates[mode] || {
        text: autoInitial.text,
        history: MessageHistory.createHistory({ value: autoInitial.text, start: 0, end: 0 }),
        replyOptions: autoInitial.options, label: '', action: '', saveStatus: 'Rascunho local'
      };
      composerMode = mode;
      key = mode === 'auto' ? autoKey : 'texto-pronto.draft.v1';
      history = state.history; replyOptions = state.replyOptions;
      codec.render(editor, state.text);
      bookmark = null; lastInput = 0; lastType = '';
      restore(history.current().start, history.current().end);
      $('reply-label').value = state.label;
      $('action-status').textContent = state.action;
      $('save-status').textContent = state.saveStatus;
      renderReplyOptions(); update();
    }
    $(mode === 'auto' ? 'auto-composer-slot' : 'periodic-composer-slot').append($('shared-composer'));
    $('periodic-models').hidden = mode === 'auto';
    $('periodic-schedule').hidden = mode === 'auto';
  }
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
    try { localStorage.setItem(key, JSON.stringify({ text: value(), ...(composerMode === 'auto' ? { options: replyOptions } : {}) })); $('save-status').textContent = 'Rascunho salvo'; $('save-status').classList.remove('error'); }
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
  function validatedReplyOptions(options, includeContinuations = false) {
    if (!Array.isArray(options) || options.length > 3) return [];
    let validated = [];
    for (const option of options) {
      const result = replies.addOption(validated, option && option.label);
      if (!result.ok) return [];
      validated = result.options;
      if (includeContinuations && option.continuation !== undefined) validated.at(-1).continuation = option.continuation;
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
    if (composerMode === 'auto') {
      save();
      notify($('save-status').textContent === 'Rascunho salvo'
        ? 'Resposta salva localmente. Ative no servidor para aplicar.' + (pendingContinuation() ? ' Há campos pendentes: use Salvar continuação em cada opção.' : '')
        : 'Não foi possível salvar a resposta; disponível apenas nesta sessão.');
      return;
    }
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
  const plansKey = 'texto-pronto.template-plans.v1';
  const plans = Object.create(null);
  let plansUnavailable = false;
  try {
    const stored = JSON.parse(localStorage.getItem(plansKey));
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      campaigns.templates.forEach(template => {
        const result = MessagePlanning.validate(stored[template.id]);
        if (result.plan) plans[template.id] = result.plan;
      });
    }
  } catch (_) { plansUnavailable = true; }
  function showPlan() {
    const plan = plans[$('campaign-template').value];
    $('schedule-period').value = plan?.period || 'weekly';
    $('schedule-count').value = String(plan?.count || 1);
    $('schedule-count').max = plan?.period === 'monthly' ? '31' : '7';
    $('schedule-recipients').value = plan?.recipients.join('\n') || '';
    if (plan) {
      $('template-time').value = plan.time;
      $('template-time-status').textContent = plan.count + (plan.count === 1 ? ' vez por ' : ' vezes por ') + (plan.period === 'weekly' ? 'semana' : 'mês')
        + ' às ' + plan.time + ' · ' + plan.recipients.length + (plan.recipients.length === 1 ? ' destinatário' : ' destinatários') + ' · Local, sem disparos.';
    }
    if (plansUnavailable) $('template-time-storage').textContent = 'Planejamento disponível apenas nesta sessão; armazenamento indisponível.';
  }
  $('schedule-period').addEventListener('change', () => {
    $('schedule-count').max = $('schedule-period').value === 'monthly' ? '31' : '7';
  });
  $('save-schedule').addEventListener('click', () => {
    if (composerMode !== 'edit') return;
    const id = $('campaign-template').value;
    if (!campaigns.templates.some(template => template.id === id)) return;
    const result = MessagePlanning.validate({ period: $('schedule-period').value, count: $('schedule-count').value,
      time: $('template-time').validity.badInput ? '' : $('template-time').value, recipients: $('schedule-recipients').value });
    if (result.error) { $('template-time-status').textContent = result.error; return; }
    plans[id] = result.plan;
    try { localStorage.setItem(plansKey, JSON.stringify(plans)); plansUnavailable = false; }
    catch (_) { plansUnavailable = true; }
    showTemplateTime();
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
  function showTemplateTime(loadPlan = true) {
    const time = templateTimes[$('campaign-template').value] || '';
    $('template-time').value = time;
    $('template-time-status').textContent = time
      ? 'Horário definido: ' + time + ' (somente configuração local; nenhum envio automático)'
      : 'Nenhum planejamento salvo';
    $('template-time-storage').textContent = timesUnavailable
      ? 'Armazenamento indisponível. O horário funciona somente nesta sessão; não foi possível recuperar ou salvar preferências.'
      : '';
    if (loadPlan) showPlan();
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
    showTemplateTime(false);
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
  function pendingContinuation() {
    return replyOptions.some(option => continuationForms.get(option)?.dirty);
  }
  function continuationForm(option) {
    if (continuationForms.has(option)) return continuationForms.get(option);
    const details = document.createElement('details'), summary = document.createElement('summary');
    details.className = 'continuation-settings';
    summary.textContent = 'Continuação — ' + option.label;
    const text = document.createElement('textarea'), type = document.createElement('select'), slots = document.createElement('textarea');
    text.rows = 4; text.placeholder = 'Mensagem enviada depois que a pessoa escolher esta opção';
    slots.rows = 4; slots.placeholder = 'Cadastre um horário ou opção por linha';
    for (const [value, title] of [['message', 'Mensagem'], ['list', 'Lista de horários']]) {
      const item = document.createElement('option'); item.value = value; item.textContent = title; type.append(item);
    }
    const textLabel = document.createElement('label'), typeLabel = document.createElement('label'), slotsLabel = document.createElement('label');
    textLabel.append(document.createTextNode('Texto da continuação'), text);
    typeLabel.append(document.createTextNode('Tipo'), type);
    slotsLabel.append(document.createTextNode('Horários/opções: 1 a 10 linhas, até 24 caracteres cada'), slots);
    const hint = document.createElement('p'), status = document.createElement('p'), actions = document.createElement('div');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    actions.className = 'continuation-actions';
    const commit = document.createElement('button'), remove = document.createElement('button');
    commit.type = remove.type = 'button'; commit.textContent = 'Salvar continuação'; remove.textContent = 'Remover continuação';
    actions.append(commit, remove);
    details.append(summary, typeLabel, textLabel, slotsLabel, hint, actions, status);
    const form = { details, text, type, slots, status, dirty: false };
    function showType() {
      slotsLabel.hidden = type.value !== 'list';
      hint.textContent = type.value === 'list' ? 'Texto: até 1024 caracteres. Somente horários cadastrados por você; nenhuma reserva automática.' : 'Texto: até 4096 caracteres. Sem lista.';
    }
    function load() {
      const saved = option.continuation;
      text.value = typeof saved?.text === 'string' ? saved.text : '';
      slots.value = Array.isArray(saved?.slots) ? saved.slots.join('\n') : '';
      type.value = Array.isArray(saved?.slots) && saved.slots.length ? 'list' : 'message';
      form.dirty = false;
      status.textContent = saved === undefined ? 'Nenhuma continuação salva.' : flows.validate(saved).error || 'Continuação salva localmente.';
      showType();
    }
    function dirty() { form.dirty = true; status.textContent = 'Alterações pendentes. Use Salvar continuação; mudar de aba não as descarta.'; }
    text.addEventListener('input', dirty); slots.addEventListener('input', dirty);
    type.addEventListener('change', () => { showType(); dirty(); });
    commit.addEventListener('click', () => {
      if (composerMode !== 'auto' || !replyOptions.includes(option)) return;
      const result = flows.validate({ text: text.value, slots: type.value === 'list' ? slots.value.split(/\r?\n/u) : [] });
      if (result.error) { status.textContent = result.error; form.dirty = true; return; }
      option.continuation = result.continuation;
      form.dirty = false;
      save(); resetReplyMessages();
      status.textContent = $('save-status').textContent === 'Rascunho salvo'
        ? 'Continuação salva localmente junto da mensagem e opções. Ative no servidor para aplicar.'
        : 'Não foi possível salvar no navegador. Continuação disponível apenas nesta sessão.';
    });
    remove.addEventListener('click', () => {
      if (composerMode !== 'auto' || !replyOptions.includes(option)) return;
      delete option.continuation; load(); save(); resetReplyMessages();
      status.textContent = $('save-status').textContent === 'Rascunho salvo' ? 'Continuação removida e rascunho salvo.' : 'Remoção apenas nesta sessão; não foi possível salvar no navegador.';
    });
    load(); continuationForms.set(option, form);
    return form;
  }
  function simulateContinuation(option) {
    if (composerMode !== 'auto') return;
    const form = continuationForm(option);
    const edit = document.createElement('button'); edit.type = 'button';
    edit.className = 'continuation-edit'; edit.textContent = 'Editar continuação';
    edit.addEventListener('click', () => {
      $('reply-settings').open = true; form.details.open = true; form.text.focus();
    });
    $('reply-messages').append(edit);
    if (option.continuation === undefined) {
      $('reply-status').textContent += ' Nenhuma continuação salva para esta opção.';
      return;
    }
    const result = flows.validate(option.continuation);
    if (result.error) { $('reply-status').textContent += ' ' + result.error; return; }
    const continuation = result.continuation, bubble = document.createElement('div');
    bubble.className = 'reply-bubble continuation-bubble'; bubble.textContent = continuation.text;
    $('reply-messages').append(bubble);
    if (form.dirty) $('reply-status').textContent += ' Prévia da versão salva; há alterações pendentes.';
    if (!continuation.slots.length) return;
    const list = document.createElement('details'), summary = document.createElement('summary'), selection = document.createElement('div');
    list.className = 'continuation-list'; summary.textContent = 'Ver horários'; list.append(summary);
    continuation.slots.forEach(slot => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = slot;
      button.addEventListener('click', () => {
        const choice = document.createElement('div'); choice.className = 'reply-bubble'; choice.textContent = slot;
        const notice = document.createElement('div'); notice.className = 'reply-bubble continuation-bubble';
        notice.textContent = 'Escolha simulada: ' + slot + '. Não é uma reserva confirmada.';
        selection.replaceChildren(choice, notice); list.open = false;
        $('reply-status').textContent = 'Escolha simulada. Não é uma reserva confirmada. Nenhuma mensagem foi enviada.';
      });
      list.append(button);
    });
    selection.className = 'continuation-selection';
    $('reply-messages').append(list, selection);
  }
  function renderReplyOptions() {
    resetReplyMessages();
    $('reply-buttons').replaceChildren();
    $('reply-options').replaceChildren();
    $('reply-buttons').hidden = !replyOptions.length;
    $('continuation-hint').hidden = composerMode !== 'auto';
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
        simulateContinuation(option);
      });
      $('reply-buttons').append(response);
      const row = document.createElement('div'), label = document.createElement('span'), remove = document.createElement('button');
      label.textContent = option.label;
      remove.type = 'button'; remove.textContent = 'Remover';
      remove.setAttribute('aria-label', 'Remover opção ' + option.label);
      remove.addEventListener('click', () => {
        if (continuationForms.get(option)?.dirty && !window.confirm('Esta opção tem alterações de continuação não salvas. Remover a opção e descartar essas alterações?')) return;
        continuationForms.delete(option);
        replyOptions = replies.removeOption(replyOptions, option.id);
        renderReplyOptions();
        $('reply-status').textContent = 'Opção removida.';
        $('reply-label').focus();
      });
      row.append(label, remove); $('reply-options').append(row);
      if (composerMode === 'auto') row.append(continuationForm(option).details);
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
  const localServer = !embedded && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
    && ['http:', 'https:'].includes(window.location.protocol);
  const adminKey = $('admin-key');
  let metaConfigured = false, autoReplyConfigured = null, metaBusy = false;
  let botVerified = false, botActive = true;
  const preview = embedded || window.location.protocol === 'file:';
  const preferencesKey = 'texto-pronto.preferences.v1';
  let fontSize = 16, previewActive = true;
  try {
    const preferences = JSON.parse(localStorage.getItem(preferencesKey));
    if (Number.isInteger(preferences?.fontSize) && preferences.fontSize >= 14 && preferences.fontSize <= 24) fontSize = preferences.fontSize;
    if (typeof preferences?.previewActive === 'boolean') previewActive = preferences.previewActive;
  } catch (_) { $('font-size-status').textContent = 'Não foi possível recuperar as preferências locais.'; }
  function renderFont() {
    $('font-size').value = String(fontSize);
    $('font-size-value').textContent = fontSize + ' px';
    editor.style.fontSize = fontSize + 'px';
  }
  function savePreferences() {
    try { localStorage.setItem(preferencesKey, JSON.stringify({ fontSize, previewActive })); }
    catch (_) { $('font-size-status').textContent = 'Preferências apenas nesta sessão; não foi possível salvar.'; }
  }
  renderFont();
  $('font-size').addEventListener('input', () => {
    const size = Number($('font-size').value);
    if (!Number.isInteger(size) || size < 14 || size > 24) return;
    fontSize = size; renderFont(); $('font-size-status').textContent = ''; savePreferences();
  });
  $('bot-state-status').textContent = preview
    ? 'Prévia local. Aplicar ao bot exige abrir pelo servidor e verificar conexão na aba robô.'
    : 'Verifique a conexão na aba robô para controlar o bot.';
  $('bot-active').addEventListener('change', async () => {
    const requested = $('bot-active').checked;
    $('bot-active').checked = preview ? previewActive : botActive;
    if (metaBusy) return;
    if (preview) {
      previewActive = requested; savePreferences(); updateMetaControls();
      feedback('bot-state-status', 'Prévia local: bot ' + (previewActive ? 'ativo' : 'pausado') + '. Aplicar ao bot exige servidor e conexão verificada na aba robô.');
      return;
    }
    if (!localServer || !botVerified || !adminKey.value.trim()) return;
    metaBusy = true; updateMetaControls();
    try {
      const response = await fetch('/api/meta/bot-state', { method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey.value.trim() },
        body: JSON.stringify({ active: requested }) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const result = await response.json();
      if (typeof result.active !== 'boolean') throw new Error('Resposta inválida');
      botActive = result.active;
      feedback('bot-state-status', botActive ? 'Bot ativo.' : 'Bot pausado. Configurações preservadas.');
    } catch (_) { feedback('bot-state-status', 'Não foi possível alterar o bot. Estado anterior mantido; verifique a conexão.', true); }
    finally { metaBusy = false; updateMetaControls(); }
  });
  $('meta-availability').textContent = embedded
    ? 'Integração desativada no editor embutido da demonstração. Use o editor independente para os controles do servidor local.'
    : window.location.protocol === 'file:'
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
    $('bot-active').disabled = metaBusy || (!preview && !(authorized && botVerified));
    $('bot-active').checked = preview ? previewActive : botActive;
  }
  adminKey.addEventListener('input', () => {
    botVerified = false;
    feedback('bot-state-status', preview ? 'Prévia local. Aplicar ao bot exige servidor e conexão verificada na aba robô.'
      : 'Verifique a conexão na aba robô para controlar o bot.');
    metaConfigured = false;
    autoReplyConfigured = null;
    feedback('meta-status', 'Chave alterada. Verifique novamente a conexão.');
    updateMetaControls();
  });
  $('check-meta-status').addEventListener('click', async () => {
    if (!localServer || !adminKey.value.trim() || metaBusy) return;
    metaBusy = true;
    metaConfigured = false;
    botVerified = false;
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
      botVerified = typeof status.botActive === 'boolean';
      if (botVerified) botActive = status.botActive;
      feedback('bot-state-status', botVerified ? (botActive ? 'Bot ativo.' : 'Bot pausado. Configurações preservadas.')
        : 'Servidor sem estado do bot. Verifique a versão e a conexão.');
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
    if (composerMode !== 'auto') {
      feedback('auto-reply-status', 'Abra a aba robô para configurar a resposta.', true);
      return;
    }
    const text = value();
    if (!text.trim()) {
      feedback('auto-reply-status', 'A resposta automática precisa conter texto.', true);
      return;
    }
    if (pendingContinuation()) {
      feedback('auto-reply-status', 'Há alterações pendentes. Salve ou remova a continuação de cada opção antes de ativar.', true);
      return;
    }
    const activation = flows.activation(text, replyOptions);
    if (activation.error) { feedback('auto-reply-status', activation.error, true); return; }
    metaBusy = true;
    updateMetaControls();
    feedback('auto-reply-status', 'Ativando resposta automática no servidor…');
    try {
      const response = await fetch('/api/meta/auto-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey.value.trim() },
        body: JSON.stringify(activation.body)
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
  showTab('auto');
  composerReady = true;
})();

