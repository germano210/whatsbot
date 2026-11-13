'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../dist/assets/planning.js');

test('valida limites semanais/mensais, horário e destinatários internacionais', () => {
  const valid = { period: 'weekly', count: 7, time: '23:59', recipients: ['+5511999999999'] };
  assert.deepEqual(validate(valid).plan, valid);
  assert.equal(validate({ ...valid, period: 'monthly', count: 31 }).plan.count, 31);
  for (const patch of [{ period: 'daily' }, { count: 0 }, { count: 8 }, { count: 1.5 }, { count: '' },
    { period: 'monthly', count: 32 }, { time: '24:00' }, { time: '1:00' }, { time: '' },
    { recipients: [] }, { recipients: '' }, { recipients: ['+12'] }, { recipients: ['+0123456789'] },
    { recipients: ['+1234567890123456'] }, { recipients: ['5511999999999'] }, { recipients: ['+55 11999999999'] },
    { recipients: [123] }]) assert.ok(validate({ ...valid, ...patch }).error, JSON.stringify(patch));
  assert.ok(validate(null).error);
});

test('normaliza linhas/deduplica destinatários sem alterar entrada', () => {
  const input = { period: 'monthly', count: '2', time: '00:00', recipients: ' +123456 \r\n+351912345678\n+123456' };
  assert.deepEqual(validate(input).plan, { period: 'monthly', count: 2, time: '00:00', recipients: ['+123456', '+351912345678'] });
  assert.equal(input.count, '2');
});
