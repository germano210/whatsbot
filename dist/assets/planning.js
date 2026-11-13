(function (root) {
  'use strict';
  function validate(input) {
    if (!input || !['weekly', 'monthly'].includes(input.period)) return { error: 'Escolha semana ou mês.' };
    const count = Number(input.count), limit = input.period === 'weekly' ? 7 : 31;
    if (!Number.isInteger(count) || count < 1 || count > limit) return { error: 'Informe de 1 a ' + limit + ' vezes.' };
    if (typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) return { error: 'Informe um horário válido no formato HH:MM.' };
    const recipients = Array.isArray(input.recipients) ? input.recipients : typeof input.recipients === 'string' ? input.recipients.trim().split(/\r?\n/) : [];
    if (!recipients.length || recipients.some(number => typeof number !== 'string' || !/^\+[1-9]\d{5,14}$/.test(number.trim()))) {
      return { error: 'Informe destinatários internacionais com +, um por linha, sem espaços ou pontuação.' };
    }
    return { plan: { period: input.period, count, time: input.time, recipients: [...new Set(recipients.map(number => number.trim()))] } };
  }
  const api = { validate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MessagePlanning = api;
})(typeof globalThis === 'object' ? globalThis : this);
