(function (root) {
  'use strict';

  const STORAGE_KEY = 'cami.gestao.demo.v1';
  const TIME_ZONE = 'America/Sao_Paulo';
  const VERSION = 1;
  const bookingStatuses = ['reserved', 'confirmed', 'cancelled', 'attended', 'missed'];
  let sequence = 0;

  function id(prefix) {
    const suffix = root.crypto && typeof root.crypto.randomUUID === 'function'
      ? root.crypto.randomUUID() : Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    return prefix + '-' + suffix;
  }

  function localNow(now) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(now === undefined ? new Date() : new Date(now));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return { date: values.year + '-' + values.month + '-' + values.day, time: values.hour + ':' + values.minute };
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T12:00:00Z');
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function validTime(value) {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function addDays(date, amount) {
    const parsed = new Date(date + 'T12:00:00Z');
    parsed.setUTCDate(parsed.getUTCDate() + amount);
    return parsed.toISOString().slice(0, 10);
  }

  function weekday(date) {
    return new Date(date + 'T12:00:00Z').getUTCDay();
  }

  function stamp(date, time) {
    return date + 'T' + time;
  }

  function isFuture(slot, now) {
    const current = localNow(now);
    return stamp(slot.date, slot.start) > stamp(current.date, current.time);
  }

  function fail(message) {
    throw new Error(message);
  }

  function cleanText(value, limit, label) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) fail(label + ': preencha até ' + limit + ' caracteres.');
    return value.trim();
  }

  function integer(value, min, max, label) {
    if (value === '' || value === null || typeof value === 'boolean') fail(label + ' inválida.');
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) fail(label + ': use de ' + min + ' a ' + max + '.');
    return number;
  }

  function activeBookings(state, slotId) {
    return state.bookings.filter(booking => booking.slotId === slotId && booking.status !== 'cancelled');
  }

  function occupancy(state, slotId) {
    return activeBookings(state, slotId).reduce((total, booking) => total + booking.quantity, 0);
  }

  function remaining(state, slot) {
    if (slot.closed || (slot.mode === 'exclusive' && activeBookings(state, slot.id).length)) return 0;
    return Math.max(0, slot.capacity - occupancy(state, slot.id));
  }

  function availableSlots(state, now) {
    return state.slots.filter(slot => slot.published && !slot.closed && isFuture(slot, now) && remaining(state, slot) > 0)
      .sort((first, second) => stamp(first.date, first.start).localeCompare(stamp(second.date, second.start)));
  }

  function slotFields(input) {
    if (!validDate(input.date) || !validTime(input.start) || !validTime(input.end) || input.start >= input.end) {
      fail('Informe uma data válida e um fim posterior ao início, no mesmo dia.');
    }
    if (!['shared', 'exclusive'].includes(input.mode)) fail('Escolha compartilhada ou exclusiva.');
    return { date: input.date, start: input.start, end: input.end, capacity: integer(input.capacity, 1, 50, 'Capacidade'), mode: input.mode };
  }

  function assertNoOverlap(state, candidate, ignoredId) {
    if (state.slots.some(slot => slot.id !== ignoredId && slot.date === candidate.date && slot.start < candidate.end && candidate.start < slot.end)) {
      fail('Há outra faixa nesse período da loja, inclusive rascunhos ou faixas fechadas. Escolha um intervalo sem sobreposição.');
    }
  }

  function requireSlot(state, slotId) {
    const slot = state.slots.find(item => item.id === slotId);
    if (!slot) fail('Horário não encontrado.');
    return slot;
  }

  function requireClient(state, clientId) {
    const client = state.clients.find(item => item.id === clientId);
    if (!client) fail('Cliente fictício não encontrado.');
    return client;
  }

  function addSlot(state, input, now) {
    const fields = slotFields(input);
    if (!isFuture(fields, now)) fail('A faixa precisa começar no futuro, no horário de São Paulo.');
    assertNoOverlap(state, fields);
    const slot = { id: id('slot'), ...fields, published: false, closed: false };
    state.slots.push(slot);
    return slot;
  }

  function reserve(state, input, now) {
    const key = cleanText(input.key, 160, 'Identificador da operação');
    const previous = state.bookings.find(booking => booking.key === key);
    if (previous) return previous;
    const slot = requireSlot(state, input.slotId);
    let client;
    if (input.clientId) client = requireClient(state, input.clientId);
    else {
      const name = cleanText(input.name, 80, 'Nome fictício');
      client = state.clients.find(item => item.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
      if (!client) {
        client = { id: id('client'), name, initials: name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(),
          consent: false, mode: 'human', flow: { stage: 'menu' } };
        state.clients.push(client);
      }
    }
    const quantity = integer(input.quantity, 1, 50, 'Quantidade de pessoas');
    if (!isFuture(slot, now)) fail('Este horário já começou ou ficou no passado. Escolha outro.');
    if (!slot.published || slot.closed) fail('O horário não está publicado ou foi fechado.');
    if (quantity > remaining(state, slot)) fail(slot.mode === 'exclusive' ? 'Visita exclusiva já reservada ou grupo acima do limite.' : 'Não há capacidade para todas as pessoas desse grupo.');
    if (state.bookings.some(booking => booking.clientId === client.id && booking.slotId === slot.id && booking.status !== 'cancelled')) fail('Esse cliente já tem uma reserva ativa nesse horário.');
    if (state.bookings.some(booking => {
      if (booking.clientId !== client.id || booking.status === 'cancelled') return false;
      const other = requireSlot(state, booking.slotId);
      return other.date === slot.date && other.start < slot.end && slot.start < other.end;
    })) fail('Esse cliente já tem uma visita nesse período.');
    const booking = { id: id('booking'), key, slotId: slot.id, clientId: client.id, quantity,
      status: input.confirmed === false ? 'reserved' : 'confirmed', source: input.source === 'bot' ? 'bot' : input.source === 'request' ? 'request' : 'manual' };
    state.bookings.push(booking);
    return booking;
  }

  function message(state, clientId, role, text, now) {
    const current = localNow(now);
    state.messages.push({ id: id('msg'), clientId, role, text: cleanText(text, 2000, 'Mensagem'), date: current.date, time: current.time });
  }

  function menu(state, client, now) {
    const current = localNow(now);
    const inHours = state.settings.days.includes(weekday(current.date)) && current.time >= state.settings.start && current.time < state.settings.end;
    message(state, client.id, 'bot', inHours ? state.settings.welcome : state.settings.outside, now);
    client.flow = { stage: 'menu' };
  }

  function newRequest(state, input, now) {
    const previous = state.requests.find(request => request.key === input.key);
    if (previous) return previous;
    const client = requireClient(state, input.clientId);
    const fields = slotFields(input);
    if (!isFuture(fields, now)) fail('Peça um horário futuro, no fuso de São Paulo.');
    const request = { id: id('request'), key: cleanText(input.key, 160, 'Identificador'), clientId: client.id,
      ...fields, quantity: integer(input.quantity, 1, 50, 'Quantidade de pessoas'), status: 'pending', bookingId: null };
    if (request.quantity > request.capacity) fail('O grupo supera a capacidade solicitada.');
    state.requests.push(request);
    return request;
  }

  function campaignFields(state, input) {
    const frequency = input.frequency;
    if (!['weekly', 'monthly', 'interval'].includes(frequency)) fail('Frequência inválida.');
    if (!validTime(input.time) || !validDate(input.anchor)) fail('Preencha data de referência e horário válidos.');
    const recipients = [...new Set(Array.isArray(input.recipients) ? input.recipients : [])];
    recipients.forEach(clientId => {
      if (!requireClient(state, clientId).consent) fail('A lista contém contato sem autorização de divulgação.');
    });
    return {
      title: cleanText(input.title, 70, 'Nome do rascunho'), text: cleanText(input.text, 1200, 'Mensagem'),
      frequency, every: integer(input.every, 1, frequency === 'interval' ? 365 : frequency === 'weekly' ? 7 : 28, 'Recorrência'),
      anchor: input.anchor, time: input.time, recipients
    };
  }

  function eligibleRecipients(state, campaign) {
    return state.clients.filter(client => client.consent && campaign.recipients.includes(client.id));
  }

  function nextPlan(campaign, now) {
    const current = localNow(now);
    let candidate = campaign.anchor > current.date ? campaign.anchor : current.date;
    for (let attempt = 0; attempt < 800; attempt += 1) {
      let match = false;
      if (campaign.frequency === 'weekly') match = weekday(candidate) === campaign.every % 7;
      if (campaign.frequency === 'monthly') match = Number(candidate.slice(8)) === campaign.every;
      if (campaign.frequency === 'interval') {
        const distance = Math.round((new Date(candidate + 'T12:00:00Z') - new Date(campaign.anchor + 'T12:00:00Z')) / 86400000);
        match = distance >= 0 && distance % campaign.every === 0;
      }
      if (match && stamp(candidate, campaign.time) > stamp(current.date, current.time)) return { date: candidate, time: campaign.time };
      candidate = addDays(candidate, 1);
    }
    return null;
  }

  function settingsFields(input) {
    if (!validTime(input.start) || !validTime(input.end) || input.start >= input.end) fail('Defina um expediente válido dentro do mesmo dia.');
    const days = [...new Set(Array.isArray(input.days) ? input.days.map(Number) : [])];
    if (!days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) fail('Marque pelo menos um dia de atendimento.');
    return { botActive: input.botActive === true, welcome: cleanText(input.welcome, 500, 'Boas-vindas'),
      outside: cleanText(input.outside, 500, 'Fora do expediente'), start: input.start, end: input.end, days };
  }

  function mutate(state, action, now) {
    switch (action.type) {
      case 'slot.add': return addSlot(state, action, now);
      case 'slot.edit': {
        const slot = requireSlot(state, action.id);
        const fields = slotFields(action);
        if (!isFuture(fields, now) || !isFuture(slot, now)) fail('Só é possível editar faixas futuras.');
        const bookings = activeBookings(state, slot.id);
        if (bookings.length && (slot.date !== fields.date || slot.start !== fields.start || slot.end !== fields.end)) fail('Uma faixa com reservas não pode mudar de data ou horário.');
        if (fields.capacity < occupancy(state, slot.id)) fail('A capacidade não pode ficar abaixo das pessoas já reservadas.');
        if (fields.mode === 'exclusive' && bookings.length > 1) fail('Há reservas de grupos diferentes. Não é possível tornar exclusiva.');
        assertNoOverlap(state, fields, slot.id);
        Object.assign(slot, fields);
        return slot;
      }
      case 'slot.publish': {
        const slot = requireSlot(state, action.id);
        if (!isFuture(slot, now) || slot.closed) fail('Publique apenas faixas futuras e abertas.');
        slot.published = true;
        return slot;
      }
      case 'slot.close': {
        const slot = requireSlot(state, action.id);
        slot.closed = true;
        return slot;
      }
      case 'day.duplicate': {
        if (!validDate(action.from) || !validDate(action.to) || action.to === action.from) fail('Escolha uma data de destino diferente.');
        const source = state.slots.filter(slot => slot.date === action.from);
        if (!source.length) fail('Não há faixas para duplicar nesta data.');
        return source.map(slot => addSlot(state, { ...slot, date: action.to }, now));
      }
      case 'booking.add': return reserve(state, action, now);
      case 'booking.status': {
        const booking = state.bookings.find(item => item.id === action.id);
        if (!booking || !bookingStatuses.includes(action.status)) fail('Reserva ou estado inválido.');
        if (booking.status === action.status) return booking;
        const allowed = { reserved: ['confirmed', 'cancelled', 'attended', 'missed'], confirmed: ['cancelled', 'attended', 'missed'], cancelled: [], attended: [], missed: [] };
        if (!allowed[booking.status].includes(action.status)) fail('Essa reserva já foi encerrada. Crie uma nova se necessário.');
        const slot = requireSlot(state, booking.slotId);
        const current = localNow(now);
        if (action.status === 'confirmed' && !isFuture(slot, now)) fail('Não é possível confirmar uma reserva que já começou.');
        if (action.status === 'attended' && stamp(current.date, current.time) < stamp(slot.date, slot.start)) fail('Registre a presença apenas a partir do início da visita.');
        if (action.status === 'missed' && stamp(current.date, current.time) < stamp(slot.date, slot.end)) fail('Registre a falta apenas depois do fim da visita.');
        booking.status = action.status;
        return booking;
      }
      case 'request.add': return newRequest(state, action, now);
      case 'request.approve': {
        const request = state.requests.find(item => item.id === action.id);
        if (!request) fail('Pedido não encontrado.');
        if (request.status === 'approved') return state.bookings.find(booking => booking.id === request.bookingId);
        if (request.status !== 'pending') fail('Esse pedido já foi recusado.');
        let slot = state.slots.find(item => item.date === request.date && item.start === request.start && item.end === request.end);
        if (slot && slot.mode !== request.mode) fail('A modalidade do pedido não é compatível com a faixa existente. Revise a agenda antes de aprovar.');
        if (!slot) {
          slot = addSlot(state, request, now);
          slot.published = true;
        }
        const booking = reserve(state, { key: request.key + '-approval', clientId: request.clientId, slotId: slot.id,
          quantity: request.quantity, source: 'request' }, now);
        request.status = 'approved';
        request.bookingId = booking.id;
        message(state, request.clientId, 'agent', 'Seu pedido especial foi aprovado na simulação. Visita em ' + request.date.split('-').reverse().join('/') + ', às ' + request.start + ', para ' + request.quantity + ' pessoa(s).', now);
        requireClient(state, request.clientId).mode = 'human';
        return booking;
      }
      case 'request.reject': {
        const request = state.requests.find(item => item.id === action.id);
        if (!request || request.status !== 'pending') fail('O pedido não está pendente.');
        request.status = 'rejected';
        message(state, request.clientId, 'agent', 'Não conseguimos esse horário especial. Podemos procurar outro? (Aviso apenas simulado.)', now);
        requireClient(state, request.clientId).mode = 'human';
        return request;
      }
      case 'conversation.human': {
        const client = requireClient(state, action.clientId);
        client.mode = 'human';
        client.flow = { stage: 'menu' };
        return client;
      }
      case 'conversation.bot': {
        const client = requireClient(state, action.clientId);
        client.mode = 'bot';
        client.flow = { stage: 'menu' };
        return client;
      }
      case 'conversation.send': {
        const client = requireClient(state, action.clientId);
        message(state, client.id, 'agent', action.text, now);
        client.mode = 'human';
        client.flow = { stage: 'menu' };
        return client;
      }
      case 'conversation.client': {
        const client = requireClient(state, action.clientId);
        message(state, client.id, 'client', action.text, now);
        if (client.mode === 'bot' && state.settings.botActive) menu(state, client, now);
        return client;
      }
      case 'bot.step': {
        const client = requireClient(state, action.clientId);
        if (client.mode !== 'bot' || !state.settings.botActive) fail('O bot está pausado ou esta conversa está com a loja.');
        const flow = client.flow;
        if (action.step === 'menu') {
          menu(state, client, now);
        } else if (action.step === 'schedule' && flow.stage === 'menu') {
          message(state, client.id, 'client', 'Agendar visita', now);
          const published = state.slots.some(slot => slot.published && !slot.closed && isFuture(slot, now));
          const text = availableSlots(state, now).length ? 'Escolha uma faixa publicada abaixo. As vagas são conferidas novamente na confirmação.'
            : published ? 'As vagas dos horários publicados estão esgotadas. Você pode pedir outro horário ou falar com a loja.'
              : 'Ainda não há agenda futura publicada e aberta. Você pode pedir outro horário ou falar com a loja.';
          message(state, client.id, 'bot', text, now);
          client.flow = { stage: 'slots' };
        } else if (action.step === 'special' && flow.stage === 'menu') {
          message(state, client.id, 'client', 'Pedir outro horário', now);
          message(state, client.id, 'bot', 'Conte quando você gostaria de vir. É um pedido, ainda não uma reserva.', now);
          client.flow = { stage: 'special' };
        } else if (action.step === 'human' && flow.stage === 'menu') {
          message(state, client.id, 'client', 'Falar com a loja', now);
          message(state, client.id, 'bot', 'A loja assume por aqui na demonstração. Nenhuma notificação real será enviada.', now);
          client.mode = 'human';
          client.flow = { stage: 'menu' };
        } else if (action.step === 'slot' && flow.stage === 'slots') {
          const slot = availableSlots(state, now).find(item => item.id === action.slotId);
          if (!slot) fail('Essa faixa esgotou ou não está mais disponível. Escolha outra.');
          client.flow = { stage: 'quantity', slotId: slot.id };
          message(state, client.id, 'bot', 'Quantas pessoas virão? Inclua você e todos os acompanhantes.', now);
        } else if (action.step === 'quantity' && flow.stage === 'quantity') {
          const slot = requireSlot(state, flow.slotId);
          const quantity = integer(action.quantity, 1, 50, 'Quantidade de pessoas');
          if (!isFuture(slot, now) || !slot.published || slot.closed || quantity > remaining(state, slot)) fail('Não há mais vagas para esse grupo. Volte e escolha outra faixa.');
          client.flow = { stage: 'review', slotId: slot.id, quantity, key: id('bot-reservation') };
          message(state, client.id, 'client', quantity + ' pessoa(s), contando acompanhantes.', now);
        } else if (action.step === 'confirm' && flow.stage === 'review') {
          const booking = reserve(state, { ...flow, clientId: client.id, source: 'bot' }, now);
          message(state, client.id, 'bot', 'Visita confirmada somente na demonstração! Você encontra a reserva na Agenda e no resumo do dia.', now);
          client.flow = { stage: 'done', bookingId: booking.id };
          return booking;
        } else if (action.step === 'confirm' && flow.stage === 'done') {
          return state.bookings.find(booking => booking.id === flow.bookingId);
        } else if (action.step === 'request' && flow.stage === 'special') {
          const request = newRequest(state, { ...action, key: action.key, mode: 'exclusive', capacity: action.quantity }, now);
          message(state, client.id, 'client', 'Pedido especial: ' + request.date + ', ' + request.start + '–' + request.end + ', ' + request.quantity + ' pessoa(s).', now);
          message(state, client.id, 'bot', 'Pedido recebido na simulação. Aguarde a aprovação da loja: ainda não ocupa vagas.', now);
          client.flow = { stage: 'menu' };
          return request;
        } else fail('Essa etapa mudou. Volte ao menu e tente novamente.');
        return client;
      }
      case 'campaign.save': {
        const fields = campaignFields(state, action);
        if (action.id) {
          const campaign = state.campaigns.find(item => item.id === action.id);
          if (!campaign) fail('Rascunho não encontrado.');
          Object.assign(campaign, fields);
          return campaign;
        }
        const campaign = { id: id('campaign'), ...fields };
        state.campaigns.push(campaign);
        return campaign;
      }
      case 'client.unsubscribe': {
        const client = requireClient(state, action.clientId);
        client.consent = false;
        state.campaigns.forEach(campaign => { campaign.recipients = campaign.recipients.filter(clientId => clientId !== client.id); });
        return client;
      }
      case 'settings.save': state.settings = settingsFields(action); return state.settings;
      default: fail('Ação desconhecida.');
    }
  }

  function dispatch(input, action, now) {
    try {
      const state = JSON.parse(JSON.stringify(input));
      const value = mutate(state, action, now);
      state.revision += 1;
      return { ok: true, state, value };
    } catch (error) {
      return { ok: false, state: input, error: error.message };
    }
  }

  function seed(now) {
    const current = localNow(now);
    const tomorrow = addDays(current.date, 1);
    const hour = Math.max(10, Number(current.time.slice(0, 2)) + 1);
    const visitDate = hour < 18 ? current.date : tomorrow;
    const visitStart = visitDate === current.date ? String(hour).padStart(2, '0') + ':00' : '09:00';
    const visitEnd = visitDate === current.date ? String(hour + 1).padStart(2, '0') + ':00' : '10:00';
    const state = {
      version: VERSION, revision: 0, createdDate: current.date,
      settings: { botActive: true, welcome: 'Oi! Que bom te ver no Brechó da Cami 🌿 Como podemos ajudar?',
        outside: 'Oi! A loja está fora do expediente. Você pode agendar uma visita por aqui ou deixar um pedido para a Cami.',
        start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5, 6] },
      clients: [
        { id: 'client-ana', name: 'Ana Souza', initials: 'AS', consent: true, mode: 'bot', flow: { stage: 'menu' } },
        { id: 'client-bia', name: 'Beatriz Lima', initials: 'BL', consent: true, mode: 'human', flow: { stage: 'menu' } },
        { id: 'client-julia', name: 'Júlia Alves', initials: 'JA', consent: false, mode: 'bot', flow: { stage: 'menu' } },
        { id: 'client-marina', name: 'Marina Costa', initials: 'MC', consent: true, mode: 'bot', flow: { stage: 'menu' } },
        { id: 'client-luiza', name: 'Luiza Santos', initials: 'LS', consent: false, mode: 'bot', flow: { stage: 'menu' } }
      ],
      slots: [
        { id: 'slot-next', date: visitDate, start: visitStart, end: visitEnd, capacity: 6, mode: 'shared', published: true, closed: false },
        { id: 'slot-tomorrow', date: tomorrow, start: '11:00', end: '12:00', capacity: 4, mode: 'exclusive', published: true, closed: false },
        { id: 'slot-draft', date: tomorrow, start: '14:00', end: '15:00', capacity: 8, mode: 'shared', published: false, closed: false }
      ],
      bookings: [
        { id: 'booking-ana', key: 'seed-ana', slotId: 'slot-next', clientId: 'client-ana', quantity: 2, status: 'confirmed', source: 'manual' },
        { id: 'booking-bia', key: 'seed-bia', slotId: 'slot-next', clientId: 'client-bia', quantity: 1, status: 'reserved', source: 'manual' }
      ],
      requests: [{ id: 'request-marina', key: 'seed-marina', clientId: 'client-marina', date: tomorrow, start: '16:00', end: '17:00',
        quantity: 2, capacity: 2, mode: 'exclusive', status: 'pending', bookingId: null }],
      campaigns: [{ id: 'campaign-new', title: 'Novidades da semana', text: 'Oi! Chegaram peças cheias de história no Brechó da Cami 🌿 Que tal agendar uma visita para garimpar?',
        frequency: 'weekly', every: 5, anchor: current.date, time: '10:00', recipients: ['client-ana', 'client-bia', 'client-marina'] }],
      messages: []
    };
    message(state, 'client-ana', 'client', 'Oi, Cami! Posso levar uma amiga na minha visita?', now);
    message(state, 'client-ana', 'bot', 'Pode sim! Sua reserva de demonstração já conta com 2 pessoas, incluindo você.', now);
    message(state, 'client-bia', 'client', 'Adorei o garimpo da semana! Vou passar aí 💚', now);
    message(state, 'client-bia', 'agent', 'Vai ser um prazer te receber, Bia! Sua visita está na nossa agenda de demonstração.', now);
    message(state, 'client-marina', 'client', 'Consigo um horário especial amanhã, às 16h? Somos duas.', now);
    return state;
  }

  function restore(raw, now) {
    try {
      const source = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!source || source.version !== VERSION || !validDate(source.createdDate)) fail('Versão ou cabeçalho do backup inválido.');
      const array = (key, max) => {
        if (!Array.isArray(source[key]) || source[key].length > max) fail('Coleção inválida: ' + key);
        return source[key];
      };
      const seen = new Set();
      const safeId = value => {
        if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,160}$/.test(value) || seen.has(value)) fail('Identificador inválido ou duplicado.');
        seen.add(value);
        return value;
      };
      const state = { version: VERSION, revision: integer(source.revision, 0, Number.MAX_SAFE_INTEGER - 1, 'Revisão'), createdDate: source.createdDate,
        settings: settingsFields(source.settings), clients: [], slots: [], bookings: [], requests: [], campaigns: [], messages: [] };
      state.clients = array('clients', 500).map(client => {
        if (!['human', 'bot'].includes(client.mode) || typeof client.consent !== 'boolean') fail('Cliente inválido.');
        return { id: safeId(client.id), name: cleanText(client.name, 80, 'Nome'), initials: cleanText(client.initials, 3, 'Iniciais'),
          consent: client.consent, mode: client.mode, flow: { stage: 'menu' } };
      });
      if (!state.clients.length) fail('O backup precisa de clientes fictícios.');
      state.slots = array('slots', 2000).map(slot => {
        if (typeof slot.published !== 'boolean' || typeof slot.closed !== 'boolean') fail('Publicação inválida.');
        return { id: safeId(slot.id), ...slotFields(slot), published: slot.published, closed: slot.closed };
      });
      state.slots.forEach(slot => assertNoOverlap(state, slot, slot.id));
      const keys = new Set();
      state.bookings = array('bookings', 5000).map(booking => {
        requireSlot(state, booking.slotId);
        requireClient(state, booking.clientId);
        const key = cleanText(booking.key, 160, 'Operação');
        if (keys.has(key) || !bookingStatuses.includes(booking.status) || !['bot', 'manual', 'request'].includes(booking.source)) fail('Reserva duplicada ou inválida.');
        keys.add(key);
        return { id: safeId(booking.id), key, slotId: booking.slotId, clientId: booking.clientId,
          quantity: integer(booking.quantity, 1, 50, 'Quantidade'), status: booking.status, source: booking.source };
      });
      state.slots.forEach(slot => {
        const active = activeBookings(state, slot.id);
        if (occupancy(state, slot.id) > slot.capacity || (slot.mode === 'exclusive' && active.length > 1) || new Set(active.map(booking => booking.clientId)).size !== active.length) fail('Reservas incompatíveis com a capacidade.');
      });
      const requestKeys = new Set();
      state.requests = array('requests', 2000).map(request => {
        requireClient(state, request.clientId);
        const key = cleanText(request.key, 160, 'Pedido');
        if (requestKeys.has(key) || !['pending', 'approved', 'rejected'].includes(request.status)) fail('Pedido inválido ou duplicado.');
        requestKeys.add(key);
        const fields = slotFields(request);
        const quantity = integer(request.quantity, 1, fields.capacity, 'Quantidade');
        if (request.status === 'approved') {
          const booking = state.bookings.find(item => item.id === request.bookingId);
          const slot = booking && requireSlot(state, booking.slotId);
          if (!booking || booking.clientId !== request.clientId || booking.quantity !== quantity || slot.date !== fields.date || slot.start !== fields.start || slot.end !== fields.end) fail('Pedido aprovado sem reserva compatível.');
        } else if (request.bookingId !== null) fail('Pedido pendente/recusado não pode reservar.');
        return { id: safeId(request.id), key, clientId: request.clientId, ...fields, quantity, status: request.status,
          bookingId: request.status === 'approved' ? request.bookingId : null };
      });
      state.campaigns = array('campaigns', 500).map(campaign => ({ id: safeId(campaign.id), ...campaignFields(state, campaign) }));
      state.messages = array('messages', 20000).map(entry => {
        requireClient(state, entry.clientId);
        if (!['client', 'bot', 'agent'].includes(entry.role) || !validDate(entry.date) || !validTime(entry.time)) fail('Mensagem inválida.');
        return { id: safeId(entry.id), clientId: entry.clientId, role: entry.role, text: cleanText(entry.text, 2000, 'Mensagem'), date: entry.date, time: entry.time };
      });
      array('clients', 500).forEach(original => {
        const client = requireClient(state, original.id);
        const flow = original.flow;
        if (!flow || !['menu', 'slots', 'quantity', 'review', 'special', 'done'].includes(flow.stage)) return;
        if (['menu', 'slots', 'special'].includes(flow.stage)) client.flow = { stage: flow.stage };
        if (['quantity', 'review'].includes(flow.stage) && state.slots.some(slot => slot.id === flow.slotId)) {
          client.flow = { stage: flow.stage, slotId: flow.slotId };
          if (flow.stage === 'review') Object.assign(client.flow, { quantity: integer(flow.quantity, 1, 50, 'Grupo'), key: cleanText(flow.key, 160, 'Operação') });
        }
        if (flow.stage === 'done' && state.bookings.some(booking => booking.id === flow.bookingId && booking.clientId === client.id)) client.flow = { stage: 'done', bookingId: flow.bookingId };
      });
      return { ok: true, state };
    } catch (error) {
      return { ok: false, state: seed(now), error: 'Não foi possível restaurar a demonstração: ' + error.message };
    }
  }

  const api = { STORAGE_KEY, TIME_ZONE, id, localNow, validDate, validTime, addDays, weekday, isFuture,
    activeBookings, occupancy, remaining, availableSlots, eligibleRecipients, nextPlan, dispatch, seed, restore };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CamiGestao = api;
})(typeof globalThis === 'object' ? globalThis : this);
