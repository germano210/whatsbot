'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../dist/assets/gestao-model.js');
const now = '2026-10-31T11:00:00Z';

function fixture() {
  const state = model.seed(now);
  state.slots = [];
  state.bookings = [];
  state.requests = [];
  return state;
}

function run(state, action, at = now) {
  const result = model.dispatch(state, action, at);
  assert.equal(result.ok, true, result.error);
  return result.state;
}

function slot(state, overrides = {}) {
  state = run(state, { type: 'slot.add', date: '2026-11-01', start: '10:00', end: '11:00', capacity: 4, mode: 'shared', ...overrides });
  return run(state, { type: 'slot.publish', id: state.slots.at(-1).id });
}

function booking(state, overrides = {}) {
  return run(state, { type: 'booking.add', slotId: state.slots[0].id, clientId: 'client-ana', quantity: 2, key: 'operation-a', ...overrides });
}

test('datas usam São Paulo, inclusive na virada UTC; seed sempre relativo ao dia atual', () => {
  assert.deepEqual(model.localNow('2026-11-01T01:30:00Z'), { date: '2026-10-31', time: '22:30' });
  assert.equal(model.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(model.validDate('2026-02-30'), false);
  for (const date of [now, '2026-11-01T02:59:00Z', '2027-02-11T18:12:00Z']) {
    const state = model.seed(date);
    assert.ok(state.slots.every(item => model.isFuture(item, date)));
    assert.ok(state.slots.every(item => item.start >= '09:00' && item.end <= '18:00'));
    assert.equal(model.restore(JSON.stringify(state), date).ok, true);
  }
});

test('capacidade compartilhada soma pessoas e acompanhantes de reservas diferentes', () => {
  let state = booking(slot(fixture()), { quantity: 3 });
  const original = JSON.stringify(state);
  const rejected = model.dispatch(state, { type: 'booking.add', slotId: state.slots[0].id, clientId: 'client-bia', quantity: 2, key: 'operation-b' }, now);
  assert.equal(rejected.ok, false);
  assert.equal(JSON.stringify(state), original);
  state = booking(state, { clientId: 'client-bia', quantity: 1, key: 'operation-b' });
  assert.equal(model.occupancy(state, state.slots[0].id), 4);
  assert.equal(model.availableSlots(state, now).length, 0);
});

test('modalidade exclusiva bloqueia outro grupo mesmo com capacidade nominal sobrando', () => {
  const state = booking(slot(fixture(), { mode: 'exclusive', capacity: 8 }));
  assert.equal(model.remaining(state, state.slots[0]), 0);
  assert.equal(model.dispatch(state, { type: 'booking.add', slotId: state.slots[0].id, clientId: 'client-bia', quantity: 1, key: 'other' }, now).ok, false);
});

test('cancelamento libera capacidade; repetir a mesma operação não duplica nem reativa', () => {
  let state = booking(slot(fixture()));
  state = booking(state);
  assert.equal(state.bookings.length, 1);
  const bookingId = state.bookings[0].id;
  state = run(state, { type: 'booking.status', id: bookingId, status: 'cancelled' });
  assert.equal(model.remaining(state, state.slots[0]), 4);
  state = booking(state);
  assert.equal(state.bookings.length, 1);
  assert.equal(state.bookings[0].status, 'cancelled');
  assert.equal(model.dispatch(state, { type: 'booking.status', id: bookingId, status: 'confirmed' }, now).ok, false);
});

test('impede reserva duplicada do mesmo cliente por chaves diferentes e grupo inválido', () => {
  const state = booking(slot(fixture()));
  for (const quantity of [0, -1, 1.5, 51, '', true]) {
    assert.equal(model.dispatch(state, { type: 'booking.add', slotId: state.slots[0].id, clientId: 'client-bia', quantity, key: 'other' }, now).ok, false);
  }
  assert.equal(model.dispatch(state, { type: 'booking.add', slotId: state.slots[0].id, clientId: 'client-ana', quantity: 1, key: 'different' }, now).ok, false);
});

test('bloqueia passado, sobreposição por loja e horários não publicados/fechados', () => {
  let state = slot(fixture());
  const overlap = { type: 'slot.add', date: '2026-11-01', start: '10:30', end: '11:30', mode: 'exclusive', capacity: 3 };
  assert.equal(model.dispatch(state, overlap, now).ok, false);
  assert.equal(model.dispatch(state, { ...overlap, date: '2026-10-30' }, now).ok, false);
  assert.equal(model.dispatch(state, { ...overlap, date: '2026-02-30' }, now).ok, false);
  state = run(state, { ...overlap, start: '11:00', end: '12:00' });
  assert.equal(model.dispatch(state, { type: 'booking.add', slotId: state.slots[1].id, clientId: 'client-bia', quantity: 1, key: 'draft' }, now).ok, false);
  assert.equal(model.dispatch(state, { type: 'booking.add', slotId: state.slots[0].id, clientId: 'client-bia', quantity: 1, key: 'past' }, '2026-11-01T13:00:00Z').ok, false);
  state = booking(state);
  state = run(state, { type: 'slot.close', id: state.slots[0].id });
  assert.equal(state.bookings.length, 1);
  assert.equal(model.remaining(state, state.slots[0]), 0);
  assert.equal(model.dispatch(state, { type: 'slot.publish', id: state.slots[0].id }, now).ok, false);
});

test('edição protege ocupação, grupos e data/hora das reservas', () => {
  let state = booking(slot(fixture()));
  state = booking(state, { clientId: 'client-bia', quantity: 1, key: 'operation-b' });
  const edit = { ...state.slots[0], type: 'slot.edit' };
  for (const patch of [{ capacity: 2 }, { mode: 'exclusive' }, { start: '09:00' }, { date: '2026-11-02' }]) {
    assert.equal(model.dispatch(state, { ...edit, ...patch }, now).ok, false);
  }
  state = run(state, { ...edit, capacity: 5 });
  assert.equal(state.slots[0].capacity, 5);
});

test('duplicar dia cria rascunhos sem reservas e é transacional diante de conflito', () => {
  let state = booking(slot(fixture()));
  state = run(state, { type: 'day.duplicate', from: '2026-11-01', to: '2026-11-02' });
  assert.equal(state.slots[1].published, false);
  assert.equal(state.bookings.length, 1);
  const result = model.dispatch(state, { type: 'day.duplicate', from: '2026-11-01', to: '2026-11-02' }, now);
  assert.equal(result.ok, false);
  assert.equal(result.state.slots.length, 2);
});

test('pedido pendente não ocupa vagas; aprovação gera faixa e reserva uma única vez', () => {
  let state = fixture();
  state = run(state, { type: 'request.add', clientId: 'client-marina', key: 'special', date: '2026-11-01', start: '15:00', end: '16:00', quantity: 3, capacity: 4, mode: 'exclusive' });
  assert.equal(state.bookings.length, 0);
  assert.equal(state.slots.length, 0);
  const requestId = state.requests[0].id;
  state = run(state, { type: 'request.approve', id: requestId });
  state = run(state, { type: 'request.approve', id: requestId });
  assert.equal(state.bookings.length, 1);
  assert.equal(state.slots.length, 1);
  assert.equal(state.requests[0].bookingId, state.bookings[0].id);
  assert.equal(state.slots[0].published, true);
  assert.equal(model.remaining(state, state.slots[0]), 0);
});

test('aprovação revalida conflito, capacidade e passado sem deixar faixa órfã', () => {
  let state = slot(fixture());
  state = run(state, { type: 'request.add', clientId: 'client-marina', key: 'special', date: '2026-11-01', start: '10:30', end: '11:30', quantity: 2, capacity: 2, mode: 'exclusive' });
  const result = model.dispatch(state, { type: 'request.approve', id: state.requests[0].id }, now);
  assert.equal(result.ok, false);
  assert.equal(result.state.slots.length, 1);
  assert.equal(result.state.requests[0].status, 'pending');
  state = run(state, { type: 'request.add', clientId: 'client-marina', key: 'special-full', date: '2026-11-01', start: '10:00', end: '11:00', quantity: 5, capacity: 5, mode: 'shared' });
  assert.equal(model.dispatch(state, { type: 'request.approve', id: state.requests[1].id }, now).ok, false);
  assert.equal(model.dispatch(state, { type: 'request.approve', id: state.requests[1].id }, '2026-11-02T13:00:00Z').ok, false);
  state = run(state, { type: 'request.reject', id: state.requests[0].id });
  assert.equal(state.bookings.length, 0);
  assert.equal(state.messages.at(-1).role, 'agent');
  assert.equal(model.dispatch(state, { type: 'request.approve', id: state.requests[0].id }, now).ok, false);
});

test('bot usa faixas publicadas dinâmicas e a mesma reserva, com confirmação idempotente', () => {
  let state = slot(fixture());
  const step = (step, rest = {}) => { state = run(state, { type: 'bot.step', clientId: 'client-julia', step, ...rest }); };
  step('schedule');
  step('slot', { slotId: state.slots[0].id });
  step('quantity', { quantity: 3 });
  assert.equal(state.bookings.length, 0);
  step('confirm');
  step('confirm');
  assert.equal(state.bookings.length, 1);
  assert.equal(state.bookings[0].source, 'bot');
  assert.equal(model.remaining(state, state.slots[0]), 1);
});

test('pedido exclusivo não reaproveita faixa compartilhada mesmo com vagas livres', () => {
  let state = booking(slot(fixture(), { capacity: 8 }));
  state = run(state, { type: 'request.add', clientId: 'client-marina', key: 'exclusive-request', date: '2026-11-01', start: '10:00', end: '11:00', quantity: 2, capacity: 2, mode: 'exclusive' });
  const result = model.dispatch(state, { type: 'request.approve', id: state.requests[0].id }, now);
  assert.equal(result.ok, false);
  assert.match(result.error, /modalidade/);
  assert.equal(result.state.bookings.length, 1);
  assert.equal(result.state.requests[0].status, 'pending');
});

test('bot diferencia falta de agenda publicada de vagas esgotadas', () => {
  let state = run(fixture(), { type: 'bot.step', clientId: 'client-julia', step: 'schedule' });
  assert.match(state.messages.at(-1).text, /não há agenda futura publicada/);
  state = booking(slot(fixture(), { mode: 'exclusive' }));
  state = run(state, { type: 'bot.step', clientId: 'client-julia', step: 'schedule' });
  assert.match(state.messages.at(-1).text, /esgotadas/);
});

test('reserva manual aceita nome fictício novo sem conceder autorização de divulgação', () => {
  let state = slot(fixture());
  state = run(state, { type: 'booking.add', slotId: state.slots[0].id, name: 'Clara Demo', quantity: 2, key: 'new-name' });
  const client = state.clients.find(item => item.name === 'Clara Demo');
  assert.equal(client.consent, false);
  assert.equal(state.bookings[0].clientId, client.id);
});

test('capacidade mudada durante fluxo é revalidada na confirmação', () => {
  let state = slot(fixture());
  for (const [step, extra] of [['schedule', {}], ['slot', { slotId: state.slots[0].id }], ['quantity', { quantity: 4 }]]) {
    state = run(state, { type: 'bot.step', clientId: 'client-julia', step, ...extra });
  }
  state = booking(state);
  assert.equal(model.dispatch(state, { type: 'bot.step', clientId: 'client-julia', step: 'confirm' }, now).ok, false);
  assert.equal(state.bookings.length, 1);
});

test('atendimento humano não reinicia menu com texto livre; enviar assume a conversa', () => {
  let state = fixture();
  state = run(state, { type: 'conversation.send', clientId: 'client-julia', text: '<img src=x onerror=alert(1)>' });
  assert.equal(state.clients.find(client => client.id === 'client-julia').mode, 'human');
  const count = state.messages.length;
  state = run(state, { type: 'conversation.client', clientId: 'client-julia', text: 'Obrigada!' });
  assert.equal(state.messages.length, count + 1);
  assert.equal(state.messages.at(-1).role, 'client');
  state = run(state, { type: 'conversation.bot', clientId: 'client-julia' });
  state = run(state, { type: 'conversation.client', clientId: 'client-julia', text: 'Olá' });
  assert.equal(state.messages.at(-1).role, 'bot');
});

test('presença e falta só nos horários adequados, sem reabrir reserva encerrada', () => {
  let state = booking(slot(fixture()), { confirmed: false });
  const bookingId = state.bookings[0].id;
  for (const status of ['attended', 'missed']) assert.equal(model.dispatch(state, { type: 'booking.status', id: bookingId, status }, now).ok, false);
  state = run(state, { type: 'booking.status', id: bookingId, status: 'confirmed' });
  state = run(state, { type: 'booking.status', id: bookingId, status: 'attended' }, '2026-11-01T13:01:00Z');
  assert.equal(model.dispatch(state, { type: 'booking.status', id: bookingId, status: 'cancelled' }, now).ok, false);
});

test('campanhas só planejam autorizados, descadastro remove de todas as listas', () => {
  let state = fixture();
  const campaign = { type: 'campaign.save', title: 'Novidades', text: 'Peças novas!', frequency: 'weekly', every: 7, anchor: '2026-10-31', time: '10:00', recipients: ['client-ana'] };
  state = run(state, campaign);
  assert.equal(model.dispatch(state, { ...campaign, recipients: ['client-julia'] }, now).ok, false);
  assert.deepEqual(model.nextPlan(state.campaigns.at(-1), now), { date: '2026-11-01', time: '10:00' });
  state = run(state, { type: 'client.unsubscribe', clientId: 'client-ana' });
  assert.equal(model.eligibleRecipients(state, state.campaigns.at(-1)).length, 0);
  assert.ok(state.campaigns.every(item => !item.recipients.includes('client-ana')));
  assert.equal(model.nextPlan({ ...campaign, frequency: 'monthly', every: 28 }, now).date, '2026-11-28');
  assert.equal(model.nextPlan({ ...campaign, frequency: 'interval', every: 3 }, now).date, '2026-10-31');
});

test('backup restaura somente schema válido, sem HTML, funções ou campos extras', () => {
  let state = booking(slot(fixture()));
  state.clients[0].name = '<script>nome literal</script>';
  state.extra = 'ignorado';
  const restored = model.restore(JSON.stringify(state), now);
  assert.equal(restored.ok, true, restored.error);
  assert.equal(restored.state.clients[0].name, '<script>nome literal</script>');
  assert.equal('extra' in restored.state, false);
  assert.equal(model.restore('{', now).ok, false);
  assert.equal(model.restore({ ...state, version: 99 }, now).ok, false);
  assert.equal(model.restore({ ...state, bookings: [{ ...state.bookings[0], quantity: 50 }] }, now).ok, false);
  assert.equal(model.restore({ ...state, slots: [...state.slots, { ...state.slots[0], id: 'duplicate-slot' }] }, now).ok, false);
  assert.equal(model.restore({ ...state, messages: [{ id: 'bad-msg', role: 'client', clientId: 'missing', text: 'x', date: '2026-11-01', time: '10:00' }] }, now).ok, false);
  assert.equal(model.restore({ ...state, requests: [{ id: 'bad-request', key: 'bad', clientId: 'client-ana', date: '2026-11-01', start: '10:00', end: '11:00', mode: 'shared', capacity: 4, quantity: 1, status: 'approved', bookingId: null }] }, now).ok, false);
});
