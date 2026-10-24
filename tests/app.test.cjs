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

function mount(storage = new Map(), blocked = {}) {
  class Element {
    constructor(tag) {
      this.tag = tag; this.value = ''; this.textContent = ''; this.children = [];
      this.dataset = {}; this.events = {}; this.validity = { badInput: false };
      this.classList = { add() {}, remove() {} };
    }
    addEventListener(type, handler) { this.events[type] = handler; }
    append(...children) {
      this.children.push(...children);
      if (this.tag === 'select' && !this.value) this.value = children[0].value;
    }
    replaceChildren(...children) { this.children = children; }
    querySelectorAll() { return []; }
    contains() { return false; }
    focus() {}
    setAttribute() {}
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
  vm.runInNewContext(source, {
    document, window: { getSelection: () => selection, addEventListener() {} },
    NodeFilter: { SHOW_TEXT: 4 }, setTimeout: () => 1, clearTimeout() {},
    MessageHistory: history, MessageCampaigns: campaigns, MessageReplies: replies,
    MessageRichText: { render(editor, text) { editor.textContent = text; }, serialize: editor => editor.textContent },
    localStorage: {
      getItem(key) { if (blocked.read && key === templatesKey) throw Error('blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked.write && key === templatesKey) throw Error('blocked'); storage.set(key, value); }
    }
  });
  return {
    elements, storage,
    select(id) { elements['campaign-template'].value = id; },
    write(text) { elements.message.textContent = text; elements.message.events.input({ inputType: 'insertText' }); },
    click(id) { elements[id].events.click(); },
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
  assert.deepEqual(JSON.parse(app.storage.get(templatesKey)), { [first.id]: '*Oferta*\n\nTexto 🌿', [second.id]: '_Outro modelo_' });
  const reloaded = mount(app.storage);
  reloaded.select(first.id); reloaded.click('use-template');
  assert.equal(reloaded.text(), '*Oferta*\n\nTexto 🌿');
  reloaded.select(second.id); reloaded.click('use-template');
  assert.equal(reloaded.text(), '_Outro modelo_');
  reloaded.select(campaigns.templates[2].id); reloaded.click('use-template');
  assert.equal(reloaded.text(), campaigns.templates[2].text);
});

test('salva mensagem vazia e recupera pelo modelo sem impedir desfazer', () => {
  const app = mount();
  app.write('');
  assert.equal(app.elements.copy.disabled, false);
  app.click('copy');
  const reloaded = mount(app.storage);
  reloaded.write('Mensagem anterior'); reloaded.click('use-template');
  assert.equal(reloaded.text(), '');
  reloaded.click('undo');
  assert.equal(reloaded.text(), 'Mensagem anterior');
});

test('seleção inválida não altera modelos nem lança erro ao salvar ou carregar', () => {
  const app = mount();
  app.select('desconhecido'); app.write('Não salvar');
  app.click('copy'); app.click('use-template');
  assert.equal(app.storage.has(templatesKey), false);
  assert.match(app.status(), /Selecione um modelo válido/);
});

test('falha ao salvar informa uso apenas em sessão e mantém o modelo disponível', () => {
  const app = mount(new Map(), { write: true });
  app.write('Conteúdo da sessão'); app.click('copy');
  assert.match(app.status(), /Não foi possível salvar/);
  assert.match(app.status(), /apenas nesta sessão/);
  assert.equal(app.storage.has(templatesKey), false);
  app.write('Outro texto'); app.click('use-template');
  assert.equal(app.text(), 'Conteúdo da sessão');
});

test('ignora dados inválidos e informa falha real de leitura de modelos', () => {
  for (const stored of ['{', '[]', 'null', JSON.stringify({ [campaigns.templates[0].id]: 123, unknown: 'texto' })]) {
    const app = mount(new Map([[templatesKey, stored]]));
    app.click('use-template');
    assert.equal(app.text(), campaigns.templates[0].text);
  }
  assert.match(mount(new Map(), { read: true }).status(), /Não foi possível carregar os modelos/);
});

test('botão Salvar mensagem usa ícone de download sem ícone de cópia', () => {
  const button = html.match(/<button[^>]*id="copy"[\s\S]*?<\/button>/)[0];
  assert.match(button, /Salvar mensagem/);
  assert.match(button, /M12 3v12/);
  assert.doesNotMatch(button, /<rect/);
});
