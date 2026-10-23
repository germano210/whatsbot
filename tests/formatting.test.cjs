'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInline, parseMessage, applyFormat } = require('../dist/assets/formatting.js');

test('reconhece ênfase e combinações sem transformar texto em HTML', () => {
  assert.deepEqual(parseInline('*Olá _mundo_*! ~antes~'), [
    { type: 'bold', children: [{ type: 'text', text: 'Olá ' }, { type: 'italic', children: [{ type: 'text', text: 'mundo' }] }] },
    { type: 'text', text: '! ' },
    { type: 'strike', children: [{ type: 'text', text: 'antes' }] }
  ]);
});

test('conteúdo HTML permanece literal, inclusive dentro de uma marcação', () => {
  const html = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  assert.deepEqual(parseInline(html), [{ type: 'text', text: html }]);
  assert.deepEqual(parseInline('*<b>não executar</b>*'), [{ type: 'bold', children: [{ type: 'text', text: '<b>não executar</b>' }] }]);
});

test('preserva marcadores incompletos, espaços nas extremidades e palavras com underscore', () => {
  for (const value of ['um *trecho aberto', '* espaço*', '_espaço _', 'nome_do_arquivo', '**', 'abc*teste*def']) {
    assert.deepEqual(parseInline(value), [{ type: 'text', text: value }]);
  }
});

test('monoespaçado preserva marcações e quebras internas como texto', () => {
  assert.deepEqual(parseInline('```*texto*\n_outro_```'), [{ type: 'code', text: '*texto*\n_outro_' }]);
});

test('interpreta linhas, listas, numeração e citações preservando linhas vazias', () => {
  const result = parseMessage('Olá\r\n\r\n- item\n* outro\n12. número\n> citação\n');
  assert.deepEqual(result.map((block) => block.type), ['paragraph', 'paragraph', 'bullet', 'bullet', 'numbered', 'quote', 'paragraph']);
  assert.deepEqual(result[1].children, []);
  assert.equal(result[4].marker, '12.');
  assert.deepEqual(result[5].children, [{ type: 'text', text: 'citação' }]);
});

test('código em várias linhas não vira lista ou citação', () => {
  const result = parseMessage('```linha\n- literal\n> literal```\nFim');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].children, [{ type: 'code', text: 'linha\n- literal\n> literal' }]);
});

test('aplica e remove formatação mantendo o trecho selecionado', () => {
  const wrapped = applyFormat('Oi mundo!', 3, 8, 'bold');
  assert.deepEqual(wrapped, { value: 'Oi *mundo*!', start: 4, end: 9 });
  assert.deepEqual(applyFormat(wrapped.value, wrapped.start, wrapped.end, 'bold'), { value: 'Oi mundo!', start: 3, end: 8 });
  assert.deepEqual(applyFormat('*mundo*', 0, 7, 'bold'), { value: 'mundo', start: 0, end: 5 });
});

test('insere placeholder selecionado quando não há seleção', () => {
  assert.deepEqual(applyFormat('Oi ', 3, 3, 'italic'), { value: 'Oi _texto_', start: 4, end: 9 });
});

test('formatação em várias linhas preserva o conteúdo e as quebras', () => {
  assert.deepEqual(applyFormat('um\ndois', 0, 7, 'code'), { value: '```um\ndois```', start: 3, end: 10 });
  const list = applyFormat('um\ndois\nfim', 1, 7, 'list');
  assert.equal(list.value, '- um\n- dois\nfim');
  assert.equal(list.value.slice(list.start, list.end), '- um\n- dois');
  assert.equal(applyFormat(list.value, list.start, list.end, 'list').value, 'um\ndois\nfim');
});

test('lista e citação incluem a primeira linha vazia quando o cursor está em zero', () => {
  assert.deepEqual(applyFormat('\nsegunda', 0, 0, 'list'), { value: '- \nsegunda', start: 0, end: 2 });
  assert.deepEqual(applyFormat('\nsegunda', 0, 0, 'quote'), { value: '> \nsegunda', start: 0, end: 2 });
});

test('seleção terminada em newline não altera a linha seguinte', () => {
  assert.deepEqual(applyFormat('um\ndois', 0, 3, 'list'), { value: '- um\ndois', start: 0, end: 4 });
  assert.deepEqual(applyFormat('um\n', 3, 3, 'quote'), { value: 'um\n> ', start: 3, end: 5 });
});


test('código inline mantém HTML e marcações literais sem capturar três crases', () => {
  assert.deepEqual(parseInline('`*<b>literal</b>*`'), [{type: 'inlineCode', text: '*<b>literal</b>*'}]);
  assert.deepEqual(parseInline('```*texto*```'), [{type: 'code', text: '*texto*'}]);
  assert.deepEqual(parseInline('`aberto'), [{type: 'text', text: '`aberto'}]);
  assert.deepEqual(parseInline('``texto``'), [{type: 'text', text: '``texto``'}]);
});

test('código inline aplica e remove preservando seleção', () => {
  const result = applyFormat('Oi mundo', 3, 8, 'inlineCode');
  assert.deepEqual(result, { value: 'Oi `mundo`', start: 4, end: 9 });
  assert.deepEqual(applyFormat(result.value, result.start, result.end, 'inlineCode'), {value: 'Oi mundo', start: 3, end: 8});
});

test('lista numerada inclui primeira linha vazia e respeita newline final da seleção', () => {
  assert.deepEqual(applyFormat('\nsegunda', 0, 0, 'numberedList'), {value: '1. \nsegunda', start: 0, end: 3});
  const result = applyFormat('um\ndois\nfim', 0, 8, 'numberedList');
  assert.deepEqual(result, {value:'1. um\n2. dois\nfim',start:0,end:13});
  assert.equal(applyFormat(result.value, result.start, result.end, 'numberedList').value, 'um\ndois\nfim');
});

test('ênfase em várias linhas formata cada linha e preserva linhas vazias e espaços', () => {
  for (const action of ['bold', 'italic', 'strike', 'inlineCode']) {
    const value = ' um \n\ndois\n';
    const result = applyFormat(value, 0, value.length, action);
    const blocks = parseMessage(result.value);
    assert.equal(blocks[0].children[1].type, action);
    assert.deepEqual(blocks[1].children, []);
    assert.equal(blocks[2].children[0].type, action);
    assert.equal(applyFormat(result.value, result.start, result.end, action).value, value);
  }
});
