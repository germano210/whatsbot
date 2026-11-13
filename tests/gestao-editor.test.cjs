'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../dist/assets/gestao-model.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function mount(hash = '#editor') {
  const events = {};
  const storage = new Map();
  const classes = new Set();
  const attributes = {};
  let frameLoads = 0;
  const frame = {
    dataset: { src: 'index.html?embedded=1' },
    getAttribute: name => attributes[name],
    setAttribute(name, value) { attributes[name] = value; if (name === 'src') frameLoads += 1; }
  };
  const main = {
    innerHTML: '', addEventListener() {}, querySelectorAll: () => [], focus() {},
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } }
  };
  const elements = {
    conteudo: main, navigation: {}, 'editor-host': { hidden: true }, 'message-editor': frame,
    modal: { open: false, addEventListener() {} }, 'modal-body': {}, feedback: {}, 'storage-warning': {}
  };
  const window = {
    CamiGestao: model, location: { hash }, scrollTo() {},
    addEventListener(name, callback) { events[name] = callback; },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  };
  const document = { getElementById: id => elements[id] || null, activeElement: null };
  vm.runInNewContext(read('dist/assets/gestao.js'), { window, document });
  return {
    elements, document, classes, loads: () => frameLoads,
    go(route) { window.location.hash = '#' + route; events.hashchange(); }
  };
}

test('rota editor mantém navegação ativa e a mesma instância ao visitar outras áreas', () => {
  const app = mount();
  const frame = app.elements['message-editor'];
  assert.equal(app.elements['editor-host'].hidden, false);
  assert.equal(app.loads(), 1);
  assert.equal(frame.getAttribute('src'), 'index.html?embedded=1');
  assert.match(app.elements.navigation.innerHTML, /href="#editor" aria-current="page"/);
  assert.equal((app.elements.navigation.innerHTML.match(/aria-current=/g) || []).length, 1);
  assert.match(app.elements.conteudo.innerHTML, /Sem envio ou conexão com a API/);
  assert.equal(app.classes.has('editor-heading'), true);
  frame.session = { undo: ['anterior'], selection: [2, 5], draft: 'Não salvo', options: ['Uma'] };
  for (const route of ['agenda', 'conversas', 'campanhas', 'automacoes', 'editor']) {
    app.go(route);
    assert.equal(app.elements['editor-host'].hidden, route !== 'editor');
    assert.equal(app.classes.has('editor-heading'), route === 'editor');
    assert.equal(app.elements['message-editor'], frame);
    assert.equal(frame.session.draft, 'Não salvo');
    assert.equal(app.loads(), 1);
  }
  assert.match(app.document.title, /^Editor de mensagens/);
});

test('carregamento só ocorre ao abrir editor e Automações usa link interno', () => {
  const app = mount('#automacoes');
  assert.equal(app.loads(), 0);
  assert.equal(app.elements['editor-host'].hidden, true);
  assert.match(app.elements.conteudo.innerHTML, /href="#editor"[^>]*>.*Abrir editor de mensagens/);
  assert.doesNotMatch(app.elements.conteudo.innerHTML, /href="index.html"/);
  app.go('editor'); app.go('agenda'); app.go('editor');
  assert.equal(app.loads(), 1);
});

test('host não é recriado por render e reutiliza página real com título acessível', () => {
  const html = read('dist/gestao.html');
  assert.match(html, /<\/main>\s*<section id="editor-host"/);
  assert.match(html, /<iframe[^>]+title="[^"]+"[^>]+data-src="index.html\?embedded=1"/);
  assert.doesNotMatch(html, /class="editor-link"|contenteditable|postMessage/);
  const standalone = read('dist/index.html');
  assert.match(standalone, /id="embedded-local-note"[^>]+hidden/);
  assert.match(standalone, /class="management-shortcut" href="gestao.html"/);
  for (const tab of ['auto', 'edit', 'settings']) assert.match(standalone, new RegExp('id="tab-' + tab + '"'));
});

test('estilos embutidos são isolados e navegação mobile acomoda seis rótulos', () => {
  const css = read('dist/assets/styles.css');
  const embeddedRules = css.split('\n').filter(line => line.includes('embedded-editor'));
  assert.ok(embeddedRules.length >= 4);
  for (const rule of embeddedRules) {
    for (const selector of rule.split('{')[0].split(',')) assert.match(selector, /^(body)?\.embedded-editor(?: |$)/);
  }
  const layout = read('dist/assets/gestao.css');
  assert.match(layout, /repeat\(6, minmax\(108px, 1fr\)\); overflow-x: auto/);
  assert.match(layout, /\.nav-link[^}]+min-height: 44px/);
  assert.match(layout, /\.editor-host iframe[^}]+height: 72dvh; min-height: 460px/);
});
