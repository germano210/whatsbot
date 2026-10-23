'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistory } = require('../dist/assets/history.js');
const state = (value, start = value.length, end = start) => ({ value, start, end });

test('limpar é recuperável com texto e seleção pelo histórico', () => {
  const history = createHistory(state('mensagem importante', 0, 8));
  history.push(state(''));
  assert.equal(history.canUndo(), true);
  assert.deepEqual(history.undo(), state('mensagem importante', 0, 8));
  assert.equal(history.canRedo(), true);
  assert.deepEqual(history.redo(), state(''));
});

test('agrupar digitação permite desfazer a palavra e refazê-la', () => {
  const history = createHistory(state(''));
  history.push(state('o'));
  history.push(state('ol'), true);
  history.push(state('olá'), true);
  assert.deepEqual(history.undo(), state(''));
  assert.deepEqual(history.redo(), state('olá'));
});

test('editar após desfazer descarta somente o futuro abandonado', () => {
  const history = createHistory(state('primeiro'));
  history.push(state('segundo'));
  history.push(state('terceiro'));
  history.undo();
  history.push(state('alternativo'));
  assert.equal(history.canRedo(), false);
  assert.equal(history.undo().value, 'segundo');
  assert.equal(history.undo().value, 'primeiro');
});

test('limite restringe memória sem perder o estado corrente ou criar snapshots mutáveis', () => {
  const history = createHistory(state('0'), 3);
  for (let i = 1; i <= 4; i++) history.push(state(String(i)));
  const current = history.current();
  current.value = 'não alterar';
  assert.equal(history.current().value, '4');
  assert.equal(history.undo().value, '3');
  assert.equal(history.undo().value, '2');
  assert.equal(history.canUndo(), false);
});
