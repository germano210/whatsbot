'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { serialize, render } = require('../dist/assets/richtext.js');
const { createHistory } = require('../dist/assets/history.js');
class Node {
  constructor(tag, text = '') { this.nodeType = tag === '#text' ? 3 : tag === '#fragment' ? 11 : 1; this.tagName = tag.toUpperCase(); this.childNodes = []; this.attributes = {}; this.data = text; this.ownerDocument = doc; }
  append(...nodes) { nodes.forEach(node => { if (node.nodeType === 11) this.append(...node.childNodes); else this.childNodes.push(node); }); }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(text) { this.childNodes = [new Node('#text', text)]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] || null; }
}
const doc = { createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text), createDocumentFragment: () => new Node('#fragment') };
function roundtrip(text) { const editor = new Node('div'); render(editor, text); return { editor, result: serialize(editor) }; }
test('rascunhos legados conservam oito formatos e combinações', () => {
  for (const markup of ['*negrito*', '_itálico_', '~tachado~', '```código\n- literal\n> literal```', '`*literal*`', '- um\n- dois', '12. doze\n13. treze', '> fala\n> outra', '*Olá _mundo_*']) assert.equal(roundtrip(markup).result, markup);
});
test('preserva quebras, linhas vazias e HTML literal usando somente nós de texto', () => {
  for (const markup of ['', '\n', 'um\n\n\nfim\n', '<img onerror="x">\n<script>x</script>', '> \n- \n1. ']) assert.equal(roundtrip(markup).result, markup);
  const { editor } = roundtrip('<img onerror="x">');
  assert.equal(editor.children[0].childNodes[0].nodeType, 3);
});
test('serializa nós nativos de edição e numeração', () => {
  const editor = new Node('div'), bold = new Node('b'), italic = new Node('i'), strike = new Node('strike');
  strike.textContent = 'texto'; italic.append(strike); bold.append(italic); editor.append(bold);
  assert.equal(serialize(editor), '*_~texto~_*');
  const list = new Node('ol'); ['um', 'dois'].forEach(text => { const li = new Node('li'); li.textContent = text; list.append(li); });
  assert.equal(serialize(list), '1. um\n2. dois');
});
test('histórico recupera conteúdo rico após limpar, sem salvar HTML', () => {
  const initial = roundtrip('*Olá*\n> fala').result;
  const history = createHistory({ value: initial, start: 1, end: 3 });
  history.push({ value: '', start: 0, end: 0 });
  assert.equal(roundtrip(history.undo().value).result, initial);
  assert.equal(history.redo().value, '');
});
test('HTML tem um único campo editável e remove prévia duplicada', () => {
  const html = fs.readFileSync(require('node:path').join(__dirname, '../dist/index.html'), 'utf8');
  assert.equal((html.match(/contenteditable="true"/g) || []).length, 1);
  assert.match(html, /class="input-wrap"/);
  assert.doesNotMatch(html, /message-bubble|id="preview"/);
  const textareas = [...html.matchAll(/<textarea\b[^>]*>/g)].map(match => match[0]);
  assert.equal(textareas.length, 1);
  assert.match(textareas[0], /id="schedule-recipients"/);
});
test('normaliza estilos adjacentes/duplicados e código ignora ênfase interna', () => {
  const editor = new Node('div');
  const a = new Node('b'), b = new Node('strong'); a.textContent = 'a'; b.textContent = 'b'; editor.append(a, b);
  assert.equal(serialize(editor), '*ab*');
  assert.equal(roundtrip(serialize(editor)).result, '*ab*');
  const outer = new Node('strong'), inner = new Node('b'); inner.textContent = 'x'; outer.append(inner);
  assert.equal(serialize(outer), '*x*');
  const code = new Node('code'), bold = new Node('b'); bold.textContent = '*literal*'; code.append(bold);
  assert.equal(serialize(code), '`*literal*`');
  code.setAttribute('data-code', 'block'); assert.equal(serialize(code), '```*literal*```');
});
test('ênfase normaliza espaços extremos e quebras para rascunhos compatíveis', () => {
  const bold = new Node('b'); bold.textContent = ' texto ';
  assert.equal(serialize(bold), ' *texto* ');
  assert.equal(roundtrip(serialize(bold)).result, ' *texto* ');
  bold.replaceChildren(new Node('#text', ' um '), new Node('br'), new Node('#text', 'dois'));
  assert.equal(serialize(bold), ' *um* \n*dois*');
  assert.equal(roundtrip(serialize(bold)).result, ' *um* \n*dois*');
});
