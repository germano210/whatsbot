'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLabel, addOption, removeOption, chooseOption } = require('../dist/assets/replies.js');

test('rotulos normalizam espacos e rejeitam entradas vazias ou longas', () => {
  assert.equal(normalizeLabel('  Ver   ofertas \n '), 'Ver ofertas');
  assert.equal(normalizeLabel(null), '');
  for (const label of ['', '   ', 'a'.repeat(21)]) assert.equal(addOption([], label).ok, false);
  assert.equal(addOption([], '🌿'.repeat(20)).ok, true);
});

test('opcoes sao unicas e limitadas a tres sem modificar o estado anterior', () => {
  const first = addOption([], 'Ver ofertas');
  const second = addOption(first.options, 'Falar com a loja');
  const third = addOption(second.options, 'Nao tenho interesse');
  assert.equal(third.ok, true);
  assert.equal(first.options.length, 1);
  assert.equal(new Set(third.options.map(option => option.id)).size, 3);
  assert.equal(addOption(first.options, ' VER OFERTAS ').ok, false);
  const rejected = addOption(third.options, 'Outra opcao');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.options, third.options);
});

test('remover uma opcao invalida sua resposta sem alterar outras opcoes', () => {
  const options = addOption(addOption([], 'Ver ofertas').options, 'Falar com a loja').options;
  const remaining = removeOption(options, options[0].id);
  assert.equal(options.length, 2);
  assert.equal(remaining.length, 1);
  assert.equal(chooseOption(remaining, options[0].id), null);
  assert.equal(chooseOption(remaining, 'desconhecido'), null);
  assert.equal(chooseOption(remaining, remaining[0].id).label, 'Falar com a loja');
});

test('texto semelhante a HTML permanece um rotulo literal', () => {
  const label = '<b>Oferta</b>';
  const result = addOption([], label);
  assert.equal(result.ok, true);
  assert.equal(chooseOption(result.options, result.options[0].id).label, label);
});
