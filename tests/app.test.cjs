'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const campaigns = require('../dist/assets/campaigns.js');
const history = require('../dist/assets/history.js');
const replies = require('../dist/assets/replies.js');
const planning = require('../dist/assets/planning.js');
const continuations = require('../dist/assets/continuations.js');
const source = fs.readFileSync(path.join(__dirname, '../dist/assets/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
const templatesKey = 'texto-pronto.template-texts.v1';

function mount(storage = new Map(), blocked = {}, runtime = {}) {
  class Element {
    constructor(tag) {
      this.tag = tag; this.value = ''; this.textContent = ''; this.children = [];
      this.dataset = {}; this.events = {}; this.attributes = {}; this.validity = { badInput: false };
      this.style = {};
      this.classList = { add() {}, remove() {} };
    }
    addEventListener(type, handler) { this.events[type] = handler; }
    append(...children) {
      this.children.push(...children);
      if (this.tag === 'select' && !this.value) this.value = children[0].value;
    }
    replaceChildren(...children) { this.children = children; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.tag === selector ? [child] : []), ...(child.querySelectorAll ? child.querySelectorAll(selector) : [])]);
    }
    contains() { return false; }
    focus() { this.focused = true; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
  }
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1] === 'campaign-template' ? 'select' : 'div')]));
  const selection = { rangeCount: 0, removeAllRanges() {}, addRange() {} };
  const document = {
    getElementById: id => elements[id] || null,
    createElement: tag => new Element(tag),
    createTextNode: text => ({ textContent: text }),
    querySelectorAll: () => [],
    body: new Element('body'),
    addEventListener() {},
    createTreeWalker: () => ({ nextNode: () => null }),
    createRange() { return { setStart() {}, setEnd() {}, cloneRange() { return this; } }; }
  };
  const requests = [];
  vm.runInNewContext(source, {
    document, window: {
      getSelection: () => selection, addEventListener() {}, confirm: () => runtime.confirmRemoval === true,
      location: { protocol: runtime.protocol || 'http:', hostname: runtime.hostname || 'localhost', search: runtime.search || '' }
    },
    URLSearchParams, NodeFilter: { SHOW_TEXT: 4 }, setTimeout: () => 1, clearTimeout() {},
    MessageHistory: history, MessageCampaigns: campaigns, MessageReplies: replies, MessagePlanning: planning, MessageContinuations: continuations,
    MessageRichText: runtime.codec || { render(editor, text) { editor.textContent = text; }, serialize: editor => editor.textContent },
    fetch(url, options) { requests.push({ url, options }); return runtime.fetch ? runtime.fetch(url, options) : Promise.reject(Error('offline')); },
    localStorage: {
      getItem(key) { if ((blocked.read && key === templatesKey) || blocked.readKeys?.includes(key)) throw Error('blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if ((blocked.write && key === templatesKey) || blocked.writeKeys?.includes(key)) throw Error('blocked'); storage.set(key, value); }
    }
  });
  if (!runtime.startAuto) elements['tab-edit'].events.click();
  return {
    elements, storage, requests,
    select(id) { elements['campaign-template'].value = id; elements['campaign-template'].events.change(); },
    write(text) { elements.message.textContent = text; elements.message.events.input({ inputType: 'insertText' }); },
    click(id) { return elements[id].events.click(); },
    key(id, key) { elements[id].events.keydown({ key, preventDefault() {} }); },
    change(id, value) { elements[id].value = value; return elements[id].events.change(); },
    toggle(active) { elements['bot-active'].checked = active; return elements['bot-active'].events.change(); },
    font(size) { elements['font-size'].value = size; elements['font-size'].events.input(); },
    admin(value) { elements['admin-key'].value = value; elements['admin-key'].events.input(); },
    addReply(label) { elements['reply-label'].value = label; elements['add-reply'].events.click(); },
    labels: () => elements['reply-buttons'].children.map(button => button.textContent),
    removeReply(index) { elements['reply-options'].children[index].children[1].events.click(); },
    chooseReply(index) { elements['reply-buttons'].children[index].events.click(); },
    continuation(index) {
      const details = elements['reply-options'].children[index].children[2];
      if (!details) return null;
      const [text, slots] = details.querySelectorAll('textarea');
      const type = details.querySelectorAll('select')[0];
      const [save, remove] = details.querySelectorAll('button');
      return { details, text, slots, type, status: details.children.at(-1),
        edit(message, items = '', kind = 'message') {
          text.value = message; text.events.input(); slots.value = items; slots.events.input();
          type.value = kind; type.events.change();
        }, save: () => save.events.click(), remove: () => remove.events.click() };
    },
    text: () => elements.message.textContent,
    status: () => elements['action-status'].textContent
  };
}

test('embedded=1 mantém editor local mesmo em localhost e bloqueia todas as ações de API', async () => {
  const app = mount(new Map(), {}, { search: '?embedded=1', startAuto: true });
  assert.equal(app.elements['embedded-local-note'].hidden, false);
  assert.equal(app.elements['meta-connection'].hidden, true);
  app.write('Rascunho integrado\n*com marcações*');
  app.addReply('Agendar');
  app.admin('chave-ficticia');
  for (const id of ['check-meta-status', 'test-send', 'activate-auto-reply', 'deactivate-auto-reply']) {
    assert.equal(app.elements[id].disabled, true);
    await app.click(id);
  }
  await app.toggle(false);
  app.click('tab-settings'); app.click('tab-edit'); app.click('tab-auto');
  assert.equal(app.text(), 'Rascunho integrado\n*com marcações*');
  assert.deepEqual(app.labels(), ['Agendar']);
  assert.equal(app.requests.length, 0);
  assert.match(app.elements['meta-availability'].textContent, /Integração desativada/);
});

test('continuações são independentes, preservam rascunhos legados e recarregam associadas aos itens renumerados', () => {
  const key = 'texto-pronto.auto-draft.v1';
  const storage = new Map([[key, JSON.stringify({ text: '*Meu texto*\nOriginal', options: [
    { id: 'reply-9', label: 'Comprar roupa' }, { id: 'reply-4', label: 'vender roupa' }, { id: 'reply-8', label: 'agendar horário' }
  ] })]]);
  const app = mount(storage, {}, { startAuto: true });
  assert.deepEqual(app.labels(), ['Comprar roupa', 'vender roupa', 'agendar horário']);
  assert.equal(app.continuation(2).slots.value, '');
  app.continuation(0).edit('Comprar\nTexto'); app.continuation(0).save();
  app.continuation(2).edit('Escolha um horário', '  Manhã   livre \nTarde', 'list'); app.continuation(2).save();
  const saved = JSON.parse(storage.get(key));
  assert.equal(saved.text, '*Meu texto*\nOriginal');
  assert.deepEqual(saved.options[0].continuation, { text: 'Comprar\nTexto', slots: [] });
  assert.equal(saved.options[1].continuation, undefined);
  assert.deepEqual(saved.options[2].continuation, { text: 'Escolha um horário', slots: ['Manhã livre', 'Tarde'] });
  app.removeReply(0); app.addReply('Nova opção'); app.click('copy');
  const reloaded = mount(storage, {}, { startAuto: true });
  assert.deepEqual(reloaded.labels(), ['vender roupa', 'agendar horário', 'Nova opção']);
  assert.equal(reloaded.continuation(0).text.value, '');
  assert.equal(reloaded.continuation(1).text.value, 'Escolha um horário');
  assert.equal(reloaded.continuation(1).slots.value, 'Manhã livre\nTarde');
  assert.equal(reloaded.continuation(2).text.value, '');
  reloaded.continuation(1).remove();
  assert.equal(JSON.parse(storage.get(key)).options[1].continuation, undefined);
  assert.equal(mount(storage, {}, { startAuto: true }).continuation(1).text.value, '');
  assert.equal(app.requests.length + reloaded.requests.length, 0);
});

test('campos inválidos ou pendentes sobrevivem a simulação, adição/remoção de outra opção e troca de aba', () => {
  const app = mount(new Map(), {}, { startAuto: true });
  app.write('Raiz'); app.addReply('Uma'); app.addReply('Outra');
  const form = app.continuation(0);
  form.edit('Não salvo', 'Repetido\n repetido ', 'list'); form.save();
  assert.match(form.status.textContent, /Não repita/);
  app.chooseReply(1); app.removeReply(1); app.addReply('Terceira');
  assert.equal(app.continuation(0).details, form.details);
  app.click('copy'); assert.match(app.status(), /campos pendentes/);
  const saved = JSON.parse(app.storage.get('texto-pronto.auto-draft.v1'));
  assert.equal(saved.options[0].continuation, undefined);
  app.click('tab-edit');
  app.addReply('Periódica');
  assert.equal(app.continuation(0), null);
  app.click('copy');
  assert.equal(JSON.parse(app.storage.get(templatesKey))[campaigns.templates[0].id].options[0].continuation, undefined);
  app.click('tab-settings'); app.click('tab-auto');
  assert.equal(app.continuation(0).details, form.details);
  assert.equal(form.text.value, 'Não salvo'); assert.equal(form.slots.value, 'Repetido\n repetido ');
  app.removeReply(0);
  assert.deepEqual(app.labels(), ['Uma', 'Terceira']);
  form.remove(); app.removeReply(0);
  assert.deepEqual(app.labels(), ['Terceira']);
});

test('prévia segura simula mensagem, lista selecionável e escolha sem reserva; editar abre o formulário certo', () => {
  const app = mount(new Map(), {}, { startAuto: true });
  app.write('Raiz'); app.addReply('Mensagem'); app.addReply('Agendar');
  app.continuation(0).edit('<img onerror=alert(1)>\nLiteral'); app.continuation(0).save();
  app.chooseReply(0);
  const messages = app.elements['reply-messages'];
  assert.equal(messages.children[0].textContent, 'Mensagem');
  assert.equal(messages.children[2].textContent, '<img onerror=alert(1)>\nLiteral');
  assert.equal(messages.children[2].children.length, 0);
  assert.equal(messages.querySelectorAll('details').length, 0);
  messages.children[1].events.click();
  assert.equal(app.elements['reply-settings'].open, true);
  assert.equal(app.continuation(0).details.open, true);
  assert.equal(app.continuation(0).text.focused, true);
  app.continuation(1).edit('Disponibilidade cadastrada', '<b>Manhã</b>\nTarde', 'list'); app.continuation(1).save();
  app.chooseReply(1);
  assert.equal(messages.children[0].textContent, 'Agendar');
  assert.equal(messages.children[2].textContent, 'Disponibilidade cadastrada');
  const list = messages.querySelectorAll('details')[0];
  assert.equal(list.children[0].textContent, 'Ver horários');
  assert.deepEqual(list.querySelectorAll('button').map(item => item.textContent), ['<b>Manhã</b>', 'Tarde']);
  list.querySelectorAll('button')[0].events.click();
  const selection = messages.children.at(-1);
  assert.equal(selection.children[0].textContent, '<b>Manhã</b>');
  assert.equal(selection.children[0].children.length, 0);
  assert.match(selection.children[1].textContent, /Não é uma reserva confirmada/);
  assert.match(app.elements['reply-status'].textContent, /Nenhuma mensagem foi enviada/);
  list.querySelectorAll('button')[1].events.click();
  assert.equal(selection.children.length, 2);
  assert.equal(selection.children[0].textContent, 'Tarde');
  assert.equal(app.requests.length, 0);
});

test('ativação captura continuações por índice atual e bloqueia pendências sem chamadas reais', async () => {
  const app = mount(new Map(), {}, { startAuto: true, fetch: async () => ({ ok: true,
    json: async () => ({ configured: true, mode: 'test', webhookConfigured: true }) }) });
  app.write('Raiz'); app.addReply('Excluir'); app.addReply('Agendar');
  const form = app.continuation(1);
  form.edit('Escolha', 'Disponível A\nDisponível B', 'list'); form.save();
  app.removeReply(0); app.addReply('Sem fluxo');
  app.admin('chave-local');
  assert.equal(app.requests.length, 0);
  await app.click('check-meta-status');
  form.edit('Pendente', '', 'list');
  await app.click('activate-auto-reply');
  assert.equal(app.requests.length, 1);
  assert.match(app.elements['auto-reply-status'].textContent, /pendentes/);
  form.save();
  assert.match(form.status.textContent, /linhas vazias/);
  await app.click('activate-auto-reply'); assert.equal(app.requests.length, 1);
  form.edit('Escolha\nSalva', 'Disponível A\nDisponível B', 'list'); form.save();
  await app.click('activate-auto-reply');
  assert.deepEqual(JSON.parse(app.requests[1].options.body), { text: 'Raiz', buttons: ['Agendar', 'Sem fluxo'],
    continuations: [{ buttonIndex: 0, text: 'Escolha\nSalva', slots: ['Disponível A', 'Disponível B'] }] });
  form.remove();
  await app.click('activate-auto-reply');
  assert.deepEqual(JSON.parse(app.requests[2].options.body), { text: 'Raiz', buttons: ['Agendar', 'Sem fluxo'] });
});

test('continuação inválida carregada não desaparece silenciosamente; armazenamento bloqueado informa sessão', async () => {
  const key = 'texto-pronto.auto-draft.v1';
  const stored = JSON.stringify({ text: 'Raiz', options: [{ label: 'Uma', continuation: { text: 'Revisar', slots: ['A', 'a'] } }] });
  const app = mount(new Map([[key, stored]]), {}, { startAuto: true, fetch: async () => ({ ok: true,
    json: async () => ({ configured: true, mode: 'test', webhookConfigured: true }) }) });
  const form = app.continuation(0);
  assert.equal(form.slots.value, 'A\na'); assert.match(form.status.textContent, /Não repita/);
  app.click('copy');
  assert.deepEqual(JSON.parse(app.storage.get(key)).options[0].continuation, { text: 'Revisar', slots: ['A', 'a'] });
  app.admin('chave-local'); await app.click('check-meta-status'); await app.click('activate-auto-reply');
  assert.equal(app.requests.length, 1); assert.match(app.elements['auto-reply-status'].textContent, /Não repita/);
  const blocked = mount(new Map([[key, stored]]), { writeKeys: [key] }, { startAuto: true });
  blocked.continuation(0).edit('Válida'); blocked.continuation(0).save();
  assert.match(blocked.continuation(0).status.textContent, /apenas nesta sessão/);
  blocked.click('tab-edit'); blocked.click('tab-auto');
  assert.equal(blocked.continuation(0).text.value, 'Válida');
  assert.equal(blocked.storage.get(key), stored);
  assert.equal(mount(blocked.storage, {}, { startAuto: true }).continuation(0).text.value, 'Revisar');
});

test('inicializa na estrutura sem campanha e salva somente o modelo selecionado após recarga', () => {
  const [first, second] = campaigns.templates;
  const app = mount();
  assert.equal(app.elements['campaign-contacts'], undefined);
  app.select(first.id); app.write('*Oferta*\n\nTexto 🌿'); app.click('copy');
  app.select(second.id); app.write('_Outro modelo_'); app.click('copy');
  assert.deepEqual(JSON.parse(app.storage.get(templatesKey)), {
    [first.id]: { text: '*Oferta*\n\nTexto 🌿', options: [] },
    [second.id]: { text: '_Outro modelo_', options: [] }
  });
  const reloaded = mount(app.storage);
  reloaded.select(first.id);
  assert.equal(reloaded.text(), '*Oferta*\n\nTexto 🌿');
  reloaded.select(second.id);
  assert.equal(reloaded.text(), '_Outro modelo_');
  reloaded.select(campaigns.templates[2].id);
  assert.equal(reloaded.text(), campaigns.templates[2].text);
});

test('salva mensagem vazia e recupera pelo modelo sem impedir desfazer', () => {
  const app = mount();
  app.write('');
  assert.equal(app.elements.copy.disabled, false);
  app.click('copy');
  const reloaded = mount(app.storage);
  reloaded.write('Mensagem anterior'); reloaded.select(campaigns.templates[0].id);
  assert.equal(reloaded.text(), '');
  reloaded.click('undo');
  assert.equal(reloaded.text(), 'Mensagem anterior');
});

test('seleção inválida não altera modelos nem lança erro ao salvar ou carregar', () => {
  const app = mount();
  app.select('desconhecido'); app.write('Não salvar');
  app.click('copy');
  assert.equal(app.storage.has(templatesKey), false);
  assert.match(app.status(), /Selecione um modelo válido/);
});

test('falha ao salvar informa uso apenas em sessão e mantém o modelo disponível', () => {
  const app = mount(new Map(), { write: true });
  app.write('Conteúdo da sessão'); app.click('copy');
  assert.match(app.status(), /Não foi possível salvar/);
  assert.match(app.status(), /apenas nesta sessão/);
  assert.equal(app.storage.has(templatesKey), false);
  app.write('Outro texto'); app.select(campaigns.templates[0].id);
  assert.equal(app.text(), 'Conteúdo da sessão');
});

test('ignora dados inválidos e informa falha real de leitura de modelos', () => {
  for (const stored of ['{', '[]', 'null', JSON.stringify({ [campaigns.templates[0].id]: 123, unknown: 'texto' })]) {
    const app = mount(new Map([[templatesKey, stored]]));
    app.select(campaigns.templates[0].id);
    assert.equal(app.text(), campaigns.templates[0].text);
  }
  assert.match(mount(new Map(), { read: true }).status(), /Não foi possível carregar os modelos/);
});

test('botão Salvar mensagem usa ícone de download sem ícone de cópia', () => {
  const button = html.match(/<button[^>]*id="copy"[\s\S]*?<\/button>/)[0];
  assert.match(button, /Salvar mensagem/);
  assert.match(button, /M12 3v12/);
  assert.doesNotMatch(button, /<rect/);
  assert.doesNotMatch(html, /id="use-template"/);
});

test('startup preserva o rascunho sem carregar automaticamente o primeiro modelo', () => {
  const app = mount(new Map([
    ['texto-pronto.draft.v1', JSON.stringify({ text: 'Rascunho em andamento' })],
    [templatesKey, JSON.stringify({ [campaigns.templates[0].id]: 'Modelo salvo diferente' })]
  ]));
  assert.equal(app.text(), 'Rascunho em andamento');
  assert.equal(app.elements.undo.disabled, true);
  app.select(campaigns.templates[1].id);
  assert.equal(app.text(), campaigns.templates[1].text);
  app.click('undo');
  assert.equal(app.text(), 'Rascunho em andamento');
});

test('troca imediata atualiza texto e horário, mantém Desfazer e exige salvar explicitamente', () => {
  const [first, second] = campaigns.templates;
  const storedTexts = JSON.stringify({ [first.id]: 'Primeiro salvo', [second.id]: 'Segundo salvo' });
  const app = mount(new Map([
    [templatesKey, storedTexts],
    ['texto-pronto.template-times.v1', JSON.stringify({ [first.id]: '09:30', [second.id]: '18:05' })]
  ]));
  app.select(first.id);
  assert.equal(app.text(), 'Primeiro salvo');
  assert.equal(app.elements['template-time'].value, '09:30');
  app.write('Edição ainda não salva');
  app.select(second.id);
  assert.equal(app.text(), 'Segundo salvo');
  assert.equal(app.elements['template-time'].value, '18:05');
  assert.match(app.elements['template-time-status'].textContent, /Horário definido: 18:05/);
  assert.equal(app.storage.get(templatesKey), storedTexts);
  app.click('undo');
  assert.equal(app.text(), 'Edição ainda não salva');
  app.select(first.id);
  assert.equal(app.text(), 'Primeiro salvo');
  app.select(campaigns.templates[2].id);
  assert.equal(app.text(), campaigns.templates[2].text);
  assert.equal(app.elements['template-time'].value, '');
  assert.equal(app.elements['template-time-status'].textContent, 'Nenhum planejamento salvo');
});

test('opções salvas pertencem somente ao modelo selecionado e troca limpa a resposta simulada', () => {
  const [first, second] = campaigns.templates;
  const app = mount();
  app.select(first.id); app.addReply('camiseta'); app.addReply('camisola'); app.click('copy');
  app.chooseReply(0);
  assert.equal(app.elements['reply-messages'].hidden, false);
  app.select(second.id);
  assert.deepEqual(app.labels(), []);
  assert.equal(app.elements['reply-buttons'].hidden, true);
  assert.equal(app.elements['reply-messages'].hidden, true);
  assert.equal(app.elements['reply-messages'].children.length, 0);
  app.addReply('Quero saber mais'); app.click('copy');
  app.select(first.id);
  assert.deepEqual(app.labels(), ['camiseta', 'camisola']);
  app.select(second.id);
  assert.deepEqual(app.labels(), ['Quero saber mais']);
});

test('recarga recupera opções por modelo e remover todas e salvar não altera outro modelo', () => {
  const [first, second] = campaigns.templates;
  const app = mount();
  app.select(first.id); app.addReply('Primeira'); app.addReply('Segunda'); app.click('copy');
  app.select(second.id); app.addReply('Outro modelo'); app.click('copy');
  const reloaded = mount(app.storage);
  assert.deepEqual(reloaded.labels(), []);
  reloaded.select(first.id);
  assert.deepEqual(reloaded.labels(), ['Primeira', 'Segunda']);
  reloaded.removeReply(0); reloaded.click('copy');
  const afterRemoval = mount(app.storage);
  afterRemoval.select(first.id);
  assert.deepEqual(afterRemoval.labels(), ['Segunda']);
  afterRemoval.removeReply(0); afterRemoval.click('copy');
  const final = mount(app.storage);
  final.select(first.id);
  assert.deepEqual(final.labels(), []);
  final.select(second.id);
  assert.deepEqual(final.labels(), ['Outro modelo']);
});

test('adicionar ou remover sem salvar não persiste, não vaza e não reaparece como salvo', () => {
  const [first, second] = campaigns.templates;
  const app = mount();
  app.select(first.id); app.addReply('Não salvar');
  assert.equal(app.storage.has(templatesKey), false);
  app.elements['reply-label'].value = 'Rótulo pendente';
  app.select(second.id);
  assert.deepEqual(app.labels(), []);
  assert.equal(app.elements['reply-label'].value, '');
  app.select(first.id);
  assert.deepEqual(app.labels(), []);
  app.addReply('Salva'); app.click('copy');
  const saved = app.storage.get(templatesKey);
  app.removeReply(0); app.addReply('Não salva');
  app.select(second.id); app.select(first.id);
  assert.deepEqual(app.labels(), ['Salva']);
  assert.equal(app.storage.get(templatesKey), saved);
});

test('dados de opções inválidos são rejeitados pelas regras de replies preservando texto válido', () => {
  const first = campaigns.templates[0];
  const invalidOptions = [null, {}, 'texto', [null], [{ label: 123 }], [{ label: '   ' }],
    [{ label: 'x'.repeat(21) }], [{ label: '😀'.repeat(21) }],
    [{ label: 'Sim' }, { label: ' sim ' }], Array.from({ length: 4 }, (_, index) => ({ label: String(index) }))];
  for (const options of invalidOptions) {
    const app = mount(new Map([[templatesKey, JSON.stringify({ [first.id]: { text: '*Texto salvo*', options } })]]));
    app.select(first.id);
    assert.equal(app.text(), '*Texto salvo*');
    assert.deepEqual(app.labels(), []);
  }
  const app = mount(new Map([[templatesKey, JSON.stringify({
    [first.id]: { text: 'Texto válido', options: [{ id: '<script>', label: '  <b>Oferta</b>  ' }, { label: '😀'.repeat(20) }] },
    unknown: { text: 'Desconhecido', options: [{ label: 'Não carregar' }] }
  })]]));
  app.select(first.id);
  assert.deepEqual(app.labels(), ['<b>Oferta</b>', '😀'.repeat(20)]);
  assert.equal(app.elements['reply-buttons'].children[0].children.length, 0);
  app.chooseReply(0);
  assert.equal(app.elements['reply-messages'].children[0].textContent, '<b>Oferta</b>');
  app.select('unknown');
  assert.deepEqual(app.labels(), []);
  assert.equal(app.elements['reply-messages'].hidden, true);
});

test('falha de armazenamento mantém opções apenas na sessão e informa que não foram persistidas', () => {
  const [first, second] = campaigns.templates;
  const app = mount(new Map(), { write: true });
  app.select(first.id); app.addReply('Na sessão'); app.click('copy');
  assert.match(app.status(), /texto e as opções/);
  assert.match(app.status(), /apenas nesta sessão/);
  assert.equal(app.storage.has(templatesKey), false);
  app.select(second.id);
  assert.deepEqual(app.labels(), []);
  app.select(first.id);
  assert.deepEqual(app.labels(), ['Na sessão']);
  const reloaded = mount(app.storage);
  reloaded.select(first.id);
  assert.deepEqual(reloaded.labels(), []);
});

test('opções salvas preservam carregamento de texto, horário, Desfazer e formatos legados', () => {
  const [first, second] = campaigns.templates;
  const app = mount(new Map([
    [templatesKey, JSON.stringify({ [first.id]: { text: '*Novo*', options: [{ label: 'Sim' }] }, [second.id]: '_Legado_' })],
    ['texto-pronto.template-times.v1', JSON.stringify({ [first.id]: '09:30', [second.id]: '18:05' })]
  ]));
  app.select(first.id);
  assert.equal(app.text(), '*Novo*');
  assert.deepEqual(app.labels(), ['Sim']);
  assert.equal(app.elements['template-time'].value, '09:30');
  app.write('Edição anterior'); app.select(second.id);
  assert.equal(app.text(), '_Legado_');
  assert.deepEqual(app.labels(), []);
  assert.equal(app.elements['template-time'].value, '18:05');
  app.click('undo');
  assert.equal(app.text(), 'Edição anterior');
  assert.deepEqual(app.labels(), []);
  app.click('copy');
  const reloaded = mount(app.storage);
  reloaded.select(first.id);
  assert.deepEqual(reloaded.labels(), ['Sim']);
  reloaded.select(second.id);
  assert.equal(reloaded.text(), 'Edição anterior');
  assert.deepEqual(reloaded.labels(), []);
});

test('três abas de ícones preservam estados e permitem navegação por teclado', () => {
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="tab-edit"[^>]*role="tab"/);
  assert.match(html, /id="tab-settings"[^>]*role="tab"/);
  assert.doesNotMatch(html, /id="open-settings"/);
  const app = mount(new Map(), {}, { startAuto: true });
  assert.equal(app.elements['auto-panel'].hidden, false);
  app.write('Resposta automática'); app.addReply('Automática');
  app.click('tab-edit');
  app.write('Rascunho em edição');
  app.addReply('Periódica');
  app.click('tab-settings');
  assert.equal(app.elements['edit-panel'].hidden, true);
  assert.equal(app.elements['settings-panel'].hidden, false);
  assert.equal(app.elements['tab-settings'].getAttribute('aria-selected'), 'true');
  app.key('tab-settings', 'ArrowLeft');
  assert.equal(app.elements['edit-panel'].hidden, false);
  assert.equal(app.elements['settings-panel'].hidden, true);
  assert.equal(app.elements['tab-edit'].getAttribute('aria-selected'), 'true');
  assert.equal(app.text(), 'Rascunho em edição');
  assert.deepEqual(app.labels(), ['Periódica']);
  app.key('tab-edit', 'Home');
  assert.equal(app.text(), 'Resposta automática');
  assert.deepEqual(app.labels(), ['Automática']);
  app.click('undo');
  assert.equal(app.text(), '');
  app.key('tab-auto', 'ArrowRight');
  assert.equal(app.text(), 'Rascunho em edição');
  app.click('undo');
  assert.notEqual(app.text(), 'Rascunho em edição');
  assert.equal(app.requests.length, 0);
});

test('file:// e origem não local impedem qualquer chamada, mesmo com chave informada', async () => {
  assert.match(html, /type="password" id="admin-key"/);
  assert.doesNotMatch(html, /name="META_ACCESS_TOKEN"|id="meta-token"/);
  for (const runtime of [{ protocol: 'file:', hostname: '' }, { protocol: 'https:', hostname: 'example.com' }]) {
    const app = mount(new Map(), {}, runtime);
    app.admin('chave-local');
    if (runtime.protocol === 'file:') assert.match(app.elements['bot-state-status'].textContent, /Prévia local/);
    assert.equal(app.elements['check-meta-status'].disabled, true);
    assert.equal(app.elements['test-send'].disabled, true);
    assert.equal(app.elements['activate-auto-reply'].disabled, true);
    await app.click('check-meta-status');
    await app.click('test-send');
    await app.click('activate-auto-reply');
    assert.equal(app.requests.length, 0);
    assert.equal(app.storage.has(templatesKey), false);
  }
});

test('status e teste só chamam backend após clique, com chave em memória e número válido', async () => {
  const app = mount(new Map(), {}, {
    fetch(url) {
      if (url === '/api/meta/status') return Promise.resolve({ ok: true, json: async () => ({ configured: true, mode: 'test', webhookConfigured: false, autoReplyConfigured: false }) });
      return Promise.resolve({ ok: true, json: async () => ({ messageId: 'wamid.teste' }) });
    }
  });
  app.admin('chave-local');
  app.click('tab-settings');
  assert.equal(app.requests.length, 0);
  assert.equal(app.elements['test-send'].disabled, true);
  await app.click('check-meta-status');
  assert.equal(app.requests[0].url, '/api/meta/status');
  assert.equal(app.requests[0].options.headers['X-Admin-Key'], 'chave-local');
  assert.match(app.elements['meta-status'].textContent, /Webhook não configurado/);
  assert.equal(app.elements['test-send'].disabled, false);
  app.elements['test-recipient'].value = '11 99999-9999';
  await app.click('test-send');
  assert.equal(app.requests.length, 1);
  assert.match(app.elements['test-send-status'].textContent, /número internacional válido/);
  app.elements['test-recipient'].value = '+5511999999999';
  app.write('Texto livre que não pode ser enviado');
  await app.click('test-send');
  assert.equal(app.requests[1].url, '/api/meta/test-send');
  assert.equal(app.requests[1].options.method, 'POST');
  assert.equal(app.requests[1].options.headers['X-Admin-Key'], 'chave-local');
  assert.deepEqual(JSON.parse(app.requests[1].options.body), { to: '5511999999999' });
  assert.doesNotMatch(app.requests[1].options.body, /Texto livre/);
  assert.match(app.elements['test-send-status'].textContent, /entrega ainda não foi confirmada/);
  assert.equal(app.storage.has(templatesKey), false);
  app.admin('nova-chave');
  assert.equal(app.elements['test-send'].disabled, true);
});

test('ativação usa resposta própria da aba robô sem exigir modelo periódico', async () => {
  const app = mount(new Map(), {}, {
    startAuto: true,
    codec: {
      render(editor, text) { editor.textContent = text; },
      serialize(editor, plain) { return plain ? editor.textContent.replace(/\*([^*]+)\*/g, '$1') : editor.textContent; }
    },
    fetch(url) {
      if (url === '/api/meta/status') return Promise.resolve({ ok: true, json: async () => ({ configured: true, mode: 'test', webhookConfigured: true }) });
      return Promise.resolve({ ok: true });
    }
  });
  app.admin('chave-local');
  await app.click('check-meta-status');
  await app.click('activate-auto-reply');
  assert.equal(app.requests.length, 1);
  assert.match(app.elements['auto-reply-status'].textContent, /precisa conter texto/);
  app.write('*Olá*, responda por aqui');
  app.addReply('Sim');
  app.addReply('Não');
  await app.click('activate-auto-reply');
  assert.equal(app.requests[1].url, '/api/meta/auto-reply');
  assert.equal(app.requests[1].options.headers['X-Admin-Key'], 'chave-local');
  assert.deepEqual(JSON.parse(app.requests[1].options.body), { text: '*Olá*, responda por aqui', buttons: ['Sim', 'Não'] });
  assert.match(app.elements['auto-reply-status'].textContent, /somente mensagens recebidas/);
  assert.equal(app.elements['deactivate-auto-reply'].disabled, false);
  await app.click('deactivate-auto-reply');
  assert.equal(app.requests[2].url, '/api/meta/auto-reply');
  assert.equal(app.requests[2].options.method, 'DELETE');
  assert.equal(app.requests[2].options.headers['X-Admin-Key'], 'chave-local');
  assert.equal(app.elements['deactivate-auto-reply'].disabled, true);
  assert.match(app.elements['auto-reply-status'].textContent, /desativada no servidor/);
  assert.equal(app.storage.has(templatesKey), false);
});

test('status indisponível e erros HTTP não habilitam ou simulam envio', async () => {
  const off = mount(new Map(), {}, { fetch: async () => ({ ok: true, json: async () => ({ configured: false, mode: 'off', webhookConfigured: false }) }) });
  off.admin('chave-local');
  await off.click('check-meta-status');
  assert.equal(off.elements['test-send'].disabled, true);
  assert.equal(off.elements['activate-auto-reply'].disabled, true);
  const failing = mount(new Map(), {}, { fetch: async () => ({ ok: false, status: 401 }) });
  failing.admin('chave-errada');
  await failing.click('check-meta-status');
  assert.match(failing.elements['meta-status'].textContent, /HTTP 401/);
  assert.equal(failing.elements['meta-status'].getAttribute('role'), 'alert');
  assert.equal(failing.elements['test-send'].disabled, true);
});

test('falhas de envio e de ativação aparecem sem declarar entrega ou bot ativo', async () => {
  const app = mount(new Map(), {}, {
    fetch: async url => url === '/api/meta/status'
      ? { ok: true, json: async () => ({ configured: true, mode: 'test', webhookConfigured: true }) }
      : { ok: false, status: 503 }
  });
  app.admin('chave-local');
  await app.click('check-meta-status');
  app.elements['test-recipient'].value = '+5511999999999';
  await app.click('test-send');
  assert.match(app.elements['test-send-status'].textContent, /Falha.*HTTP 503/);
  assert.equal(app.elements['test-send-status'].getAttribute('role'), 'alert');
  app.select(campaigns.templates[0].id);
  app.click('tab-auto'); app.write('Resposta');
  await app.click('activate-auto-reply');
  assert.match(app.elements['auto-reply-status'].textContent, /Falha.*HTTP 503/);
  assert.equal(app.elements['auto-reply-status'].getAttribute('role'), 'alert');
});

test('estrutura tem três ícones acessíveis, IDs únicos e configurações apenas básicas', () => {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const tabButtons = [...html.matchAll(/<button[^>]*role="tab"[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
  assert.equal(tabButtons.length, 3);
  for (const button of tabButtons) {
    assert.match(button, /aria-label="[^"]+"/);
    assert.match(button, /title="[^"]+"/);
    assert.match(button, /<svg/);
    assert.equal(button.replace(/<[^>]*>/g, '').trim(), '');
  }
  const settings = html.slice(html.indexOf('<section id="settings-panel"'));
  assert.match(settings, /id="font-size"/);
  assert.match(settings, /id="bot-active"/);
  assert.doesNotMatch(settings, /id="admin-key"|id="activate-auto-reply"|id="test-send"/);
  assert.match(html, /<details id="periodic-schedule"[^>]*>\s*<summary>Frequência e destinatários/);
  assert.match(html, /<details id="meta-connection"[^>]*>\s*<summary>Conexão do WhatsApp/);
});

test('rascunhos e opções automática/periódica sobrevivem recarga sem sobrescrever legado na abertura', () => {
  const draftKey = 'texto-pronto.draft.v1';
  const legacy = JSON.stringify({ text: '*Legado*\n\nÚltima edição' });
  const storage = new Map([[draftKey, legacy]]);
  const app = mount(storage, {}, { startAuto: true });
  assert.equal(app.text(), '');
  assert.equal(storage.get(draftKey), legacy);
  app.write('_Resposta_\nNova linha'); app.addReply('Responder'); app.click('copy');
  app.click('tab-edit');
  assert.equal(app.text(), '*Legado*\n\nÚltima edição');
  assert.deepEqual(app.labels(), []);
  app.write('Periódico'); app.click('copy');
  app.click('tab-auto');
  assert.equal(app.text(), '_Resposta_\nNova linha');
  assert.deepEqual(app.labels(), ['Responder']);
  const reloaded = mount(storage, {}, { startAuto: true });
  assert.equal(reloaded.text(), '_Resposta_\nNova linha');
  assert.deepEqual(reloaded.labels(), ['Responder']);
  reloaded.click('tab-edit');
  assert.equal(reloaded.text(), 'Periódico');
  assert.deepEqual(reloaded.labels(), []);
  assert.equal(app.requests.length + reloaded.requests.length, 0);
});

test('planejamentos por modelo são locais, distintos e restaurados sem apagar horários legados', () => {
  const [first, second] = campaigns.templates;
  const times = JSON.stringify({ [first.id]: '08:00' });
  const app = mount(new Map([['texto-pronto.template-times.v1', times]]));
  app.select(first.id);
  app.elements['schedule-count'].value = '3';
  app.elements['schedule-recipients'].value = '+5511999999999\n+5511999999999\n+351912345678';
  app.change('template-time', '09:30');
  assert.equal(app.elements['schedule-count'].value, '3');
  assert.match(app.elements['schedule-recipients'].value, /351/);
  app.click('save-schedule');
  app.select(second.id);
  assert.equal(app.elements['schedule-recipients'].value, '');
  app.change('schedule-period', 'monthly');
  app.elements['schedule-count'].value = '31';
  app.elements['template-time'].value = '18:45';
  app.elements['schedule-recipients'].value = '+5511988888888';
  app.click('save-schedule');
  app.click('tab-auto'); app.click('tab-settings'); app.click('tab-edit');
  assert.equal(app.elements['schedule-count'].value, '31');
  const saved = JSON.parse(app.storage.get('texto-pronto.template-plans.v1'));
  assert.equal(saved[first.id].recipients.length, 2);
  assert.equal(saved[second.id].period, 'monthly');
  const reloaded = mount(app.storage);
  reloaded.select(first.id);
  assert.equal(reloaded.elements['schedule-count'].value, '3');
  assert.equal(reloaded.elements['template-time'].value, '09:30');
  assert.match(reloaded.elements['template-time-status'].textContent, /semana.*09:30.*2 destinatário.*Local, sem disparos/);
  reloaded.select(second.id);
  assert.equal(reloaded.elements['schedule-period'].value, 'monthly');
  assert.equal(reloaded.elements['schedule-count'].max, '31');
  assert.equal(app.requests.length + reloaded.requests.length, 0);
});

test('planejamento inválido não sobrescreve versão salva e armazenamento bloqueado avisa sessão', () => {
  const plansKey = 'texto-pronto.template-plans.v1';
  const first = campaigns.templates[0];
  const saved = JSON.stringify({ [first.id]: { period: 'weekly', count: 2, time: '10:00', recipients: ['+5511999999999'] } });
  const app = mount(new Map([[plansKey, saved]]));
  app.select(first.id);
  for (const [field, invalid] of [['schedule-count', '8'], ['template-time', '24:00'], ['schedule-recipients', '+12']]) {
    app.select(first.id); app.elements[field].value = invalid; app.click('save-schedule');
    assert.equal(app.storage.get(plansKey), saved);
  }
  const blocked = mount(new Map([[plansKey, saved]]), { writeKeys: [plansKey] });
  blocked.select(first.id); blocked.elements['schedule-count'].value = '4'; blocked.click('save-schedule');
  assert.match(blocked.elements['template-time-storage'].textContent, /apenas nesta sessão/);
  blocked.select(campaigns.templates[1].id); blocked.select(first.id);
  assert.equal(blocked.elements['schedule-count'].value, '4');
  const invalid = mount(new Map([[plansKey, JSON.stringify({ [first.id]: { period: 'monthly', count: 32, time: '10:00', recipients: ['+5511999999999'] } })]]));
  invalid.select(first.id);
  assert.equal(invalid.elements['schedule-count'].value, '1');
  assert.equal(invalid.elements['schedule-recipients'].value, '');
});

test('fonte 14–24 persiste; prévia file não altera servidor e avisa o limite', async () => {
  const runtime = { protocol: 'file:', hostname: '', startAuto: true };
  const app = mount(new Map(), {}, runtime);
  app.font('24');
  assert.equal(app.elements.message.style.fontSize, '24px');
  app.font('25');
  assert.equal(app.elements.message.style.fontSize, '24px');
  await app.toggle(false);
  assert.equal(app.elements['bot-active'].checked, false);
  assert.match(app.elements['bot-state-status'].textContent, /Prévia local.*pausado.*exige servidor/);
  const reloaded = mount(app.storage, {}, runtime);
  assert.equal(reloaded.elements.message.style.fontSize, '24px');
  assert.equal(reloaded.elements['bot-active'].checked, false);
  assert.equal(app.requests.length + reloaded.requests.length, 0);
  const blocked = mount(new Map(), { writeKeys: ['texto-pronto.preferences.v1'] }, runtime);
  blocked.font('14');
  assert.match(blocked.elements['font-size-status'].textContent, /apenas nesta sessão/);
});

test('switch sincroniza status, só aplica após sucesso e reverte em erro sem persistir chave', async () => {
  let fail = false;
  const app = mount(new Map(), {}, { startAuto: true, fetch: async url => url === '/api/meta/status'
    ? { ok: true, json: async () => ({ configured: false, mode: 'off', webhookConfigured: false, botActive: true }) }
    : fail ? { ok: false, status: 503 } : { ok: true, json: async () => ({ active: false }) } });
  assert.equal(app.elements['bot-active'].disabled, true);
  app.admin('segredo-local');
  await app.toggle(false);
  assert.equal(app.requests.length, 0);
  await app.click('check-meta-status');
  assert.equal(app.elements['bot-active'].disabled, false);
  assert.equal(app.elements['bot-active'].checked, true);
  const pending = app.toggle(false);
  assert.equal(app.elements['bot-active'].checked, true);
  assert.equal(app.elements['bot-active'].disabled, true);
  await pending;
  assert.equal(app.elements['bot-active'].checked, false);
  assert.equal(app.requests[1].url, '/api/meta/bot-state');
  assert.equal(app.requests[1].options.method, 'PUT');
  assert.equal(app.requests[1].options.headers['X-Admin-Key'], 'segredo-local');
  assert.deepEqual(JSON.parse(app.requests[1].options.body), { active: false });
  fail = true;
  await app.toggle(true);
  assert.equal(app.elements['bot-active'].checked, false);
  assert.match(app.elements['bot-state-status'].textContent, /Estado anterior mantido/);
  app.admin('outra-chave');
  assert.equal(app.elements['bot-active'].disabled, true);
  assert.doesNotMatch([...app.storage.values()].join(''), /segredo-local|outra-chave/);
});

test('status sem botActive ou inválido não habilita controle do bot', async () => {
  for (const body of [{ configured: true, mode: 'test', webhookConfigured: true }, { botActive: true }]) {
    const app = mount(new Map(), {}, { fetch: async () => ({ ok: true, json: async () => body }) });
    app.admin('chave'); await app.click('check-meta-status');
    assert.equal(app.elements['bot-active'].disabled, true);
  }
});
