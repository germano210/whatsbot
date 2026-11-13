'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const flows = require('../dist/assets/continuations.js');

test('valida limites por pontos de código e preserva texto e quebras', () => {
  const text = ' 😀\n'.repeat(1000);
  assert.deepEqual(flows.validate({ text, slots: [] }).continuation, { text, slots: [] });
  assert.ok(flows.validate({ text: '😀'.repeat(4096), slots: [] }).continuation);
  assert.ok(flows.validate({ text: '😀'.repeat(4097), slots: [] }).error);
  assert.ok(flows.validate({ text: '😀'.repeat(1024), slots: ['😀'.repeat(24)] }).continuation);
  assert.ok(flows.validate({ text: '😀'.repeat(1025), slots: ['Item'] }).error);
  assert.ok(flows.validate({ text: 'Texto', slots: ['😀'.repeat(25)] }).error);
});

test('lista normaliza espaços, rejeita duplicatas, itens vazios e estruturas inválidas', () => {
  assert.deepEqual(flows.validate({ text: '<b>Literal</b>\nTexto', slots: ['  Manhã   livre ', 'Tarde'] }).continuation,
    { text: '<b>Literal</b>\nTexto', slots: ['Manhã livre', 'Tarde'] });
  for (const input of [null, {}, { text: '', slots: [] }, { text: ' \n ', slots: [] },
    { text: 1, slots: [] }, { text: 'Texto', slots: 'Item' }, { text: 'Texto', slots: [null] },
    { text: 'Texto', slots: [' '] }, { text: 'Texto', slots: ['Manhã livre', ' MANHÃ   LIVRE '] },
    { text: 'Texto', slots: Array.from({ length: 11 }, (_, index) => String(index)) }]) {
    assert.ok(flows.validate(input).error, JSON.stringify(input));
  }
  assert.ok(flows.validate({ text: 'Texto', slots: Array.from({ length: 10 }, (_, index) => String(index)) }).continuation);
});

test('ativação usa índice atual, não ID; não inclui campo opcional vazio nem altera itens', () => {
  const first = { id: 'reply-3', label: 'Primeira', continuation: { text: 'Resposta', slots: [] } };
  const second = { id: 'reply-1', label: 'Segunda' };
  const before = JSON.stringify(first);
  assert.deepEqual(flows.activation('Raiz', [second, first]).body, {
    text: 'Raiz', buttons: ['Segunda', 'Primeira'], continuations: [{ buttonIndex: 1, text: 'Resposta', slots: [] }]
  });
  assert.equal(JSON.stringify(first), before);
  assert.deepEqual(flows.activation('Raiz', [second]).body, { text: 'Raiz', buttons: ['Segunda'] });
  assert.match(flows.activation('Raiz', [{ label: 'Inválida', continuation: { text: '', slots: [] } }]).error, /Inválida/);
});
