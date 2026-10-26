'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const campaigns = require('../dist/assets/campaigns.js');
const history = require('../dist/assets/history.js');
const replies = require('../dist/assets/replies.js');
const source = fs.readFileSync(path.join(__dirname, '../dist/assets/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
const templatesKey = 'texto-pronto.template-texts.v1';

function mount(storage = new Map(), blocked = {}, runtime = {}) {
  class Element {
    constructor(tag) {
      this.tag = tag; this.value = ''; this.textContent = ''; this.children = [];
      this.dataset = {}; this.events = {}; this.attributes = {}; this.validity = { badInput: false };
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
    addEventListener() {},
    createTreeWalker: () => ({ nextNode: () => null }),
    createRange() { return { setStart() {}, setEnd() {}, cloneRange() { return this; } }; }
  };
  const requests = [];
  vm.runInNewContext(source, {
    document, window: {
      getSelection: () => selection, addEventListener() {},
      location: { protocol: runtime.protocol || 'http:', hostname: runtime.hostname || 'localhost' }
    },
    NodeFilter: { SHOW_TEXT: 4 }, setTimeout: () => 1, clearTimeout() {},
    MessageHistory: history, MessageCampaigns: campaigns, MessageReplies: replies,
    MessageRichText: runtime.codec || { render(editor, text) { editor.textContent = text; }, serialize: editor => editor.textContent },
    fetch(url, options) { requests.push({ url, options }); return runtime.fetch ? runtime.fetch(url, options) : Promise.reject(Error('offline')); },
    localStorage: {
      getItem(key) { if (blocked.read && key === templatesKey) throw Error('blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked.write && key === templatesKey) throw Error('blocked'); storage.set(key, value); }
    }
  });
  return {
    elements, storage, requests,
    select(id) { elements['campaign-template'].value = id; elements['campaign-template'].events.change(); },
    write(text) { elements.message.textContent = text; elements.message.events.input({ inputType: 'insertText' }); },
    click(id) { return elements[id].events.click(); },
    key(id, key) { elements[id].events.keydown({ key, preventDefault() {} }); },
    admin(value) { elements['admin-key'].value = value; elements['admin-key'].events.input(); },
    addReply(label) { elements['reply-label'].value = label; elements['add-reply'].events.click(); },
    labels: () => elements['reply-buttons'].children.map(button => button.textContent),
    removeReply(index) { elements['reply-options'].children[index].children[1].events.click(); },
    chooseReply(index) { elements['reply-buttons'].children[index].events.click(); },
    text: () => elements.message.textContent,
    status: () => elements['action-status'].textContent
  };
}

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
  assert.equal(app.elements['template-time-status'].textContent, 'Template padrão de resposta');
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

test('abas e engrenagem preservam editor e permitem navegação por teclado', () => {
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="tab-edit"[^>]*role="tab"/);
  assert.match(html, /id="tab-settings"[^>]*role="tab"/);
  const app = mount();
  app.write('Rascunho em edição');
  app.click('open-settings');
  assert.equal(app.elements['edit-panel'].hidden, true);
  assert.equal(app.elements['settings-panel'].hidden, false);
  assert.equal(app.elements['tab-settings'].getAttribute('aria-selected'), 'true');
  assert.equal(app.elements['tab-settings'].focused, true);
  app.key('tab-settings', 'ArrowLeft');
  assert.equal(app.elements['edit-panel'].hidden, false);
  assert.equal(app.elements['settings-panel'].hidden, true);
  assert.equal(app.elements['tab-edit'].getAttribute('aria-selected'), 'true');
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
    assert.equal(app.elements['check-meta-status'].disabled, true);
    assert.equal(app.elements['test-send'].disabled, true);
    assert.equal(app.elements['activate-auto-reply'].disabled, true);
    await app.click('check-meta-status');
    await app.click('test-send');
    await app.click('activate-auto-reply');
    assert.equal(app.requests.length, 0);
    assert.equal(app.storage.size, 0);
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
  app.click('open-settings');
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
  assert.equal(app.storage.size, 0);
  app.admin('nova-chave');
  assert.equal(app.elements['test-send'].disabled, true);
});

test('ativação preserva marcações e opções do modelo carregado', async () => {
  const app = mount(new Map(), {}, {
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
  assert.match(app.elements['auto-reply-status'].textContent, /Selecione um modelo/);
  app.select(campaigns.templates[0].id);
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
  assert.equal(app.storage.size, 0);
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
  await app.click('activate-auto-reply');
  assert.match(app.elements['auto-reply-status'].textContent, /Falha.*HTTP 503/);
  assert.equal(app.elements['auto-reply-status'].getAttribute('role'), 'alert');
});
