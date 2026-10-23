'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { templates, contacts, canReceivePromotions, simulate } = require('../dist/assets/campaigns.js');

test('modelos e publico de demonstracao nao incluem telefones ou credenciais', () => {
  assert.equal(templates.length, 3);
  assert.equal(new Set(templates.map(template => template.id)).size, 3);
  assert.ok(templates.every(template => template.label && template.text.trim()));
  assert.equal(contacts.length, 4);
  assert.ok(contacts.every(contact => !('phone' in contact) && !('token' in contact)));
});

test('descadastro prevalece sobre autorizacao promocional', () => {
  assert.equal(canReceivePromotions(contacts.find(contact => contact.id === 'demo-1')), true);
  assert.equal(canReceivePromotions(contacts.find(contact => contact.id === 'demo-2')), true);
  assert.equal(canReceivePromotions(contacts.find(contact => contact.id === 'demo-3')), false);
  assert.equal(canReceivePromotions(contacts.find(contact => contact.id === 'demo-4')), false);
  assert.equal(canReceivePromotions(null), false);
  assert.equal(canReceivePromotions({ optIn: 'true', optOut: false }), false);
});

test('simulacao exige conteudo e destinatarios', () => {
  for (const text of ['', '   ', '\n\t', null, undefined]) {
    const result = simulate(text, ['demo-1']);
    assert.equal(result.ok, false);
    assert.deepEqual(result.recipientIds, []);
    assert.ok(result.error);
  }
  assert.equal(simulate('Oferta de exemplo', []).ok, false);
});

test('selecao manipulada nao permite contatos bloqueados ou desconhecidos', () => {
  for (const selectedIds of [['demo-3'], ['demo-4'], ['desconhecido'], ['demo-1', 'demo-4']]) {
    const result = simulate('Oferta de exemplo', selectedIds);
    assert.equal(result.ok, false);
    assert.deepEqual(result.recipientIds, []);
    assert.ok(result.error);
  }
});

test('simulacao valida deduplica destinatarios sem alterar a selecao', () => {
  const selectedIds = ['demo-1', 'demo-2', 'demo-1'];
  const result = simulate('Oferta de exemplo', selectedIds);
  assert.equal(result.ok, true);
  assert.deepEqual(result.recipientIds, ['demo-1', 'demo-2']);
  assert.deepEqual(selectedIds, ['demo-1', 'demo-2', 'demo-1']);
});
