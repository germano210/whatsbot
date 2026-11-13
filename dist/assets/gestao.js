(function () {
  'use strict';

  const model = window.CamiGestao;
  const main = document.getElementById('conteudo');
  const navigation = document.getElementById('navigation');
  const editorHost = document.getElementById('editor-host');
  const editorFrame = document.getElementById('message-editor');
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  const feedback = document.getElementById('feedback');
  const paths = {
    today: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M7 2v4m10-4v4M3 10h18m-13 5h3m-3 3h6"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M7 2v4m10-4v4M3 10h18m-14 4h2m3 0h2m3 0h2M7 18h2m3 0h2"/>',
    chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H5l-4 2 2-6v-4.5A8.5 8.5 0 0 1 11.5 3h1a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 10h10M7 14h6"/>',
    campaign: '<path d="m3 10 13-6v16L3 14v-4Zm13-2h3a2 2 0 0 1 0 8h-3M5 15l2 6h4l-3-5M21 4l-2 2m4 5h-2m0 9-2-2"/>',
    bot: '<rect x="4" y="7" width="16" height="14" rx="4"/><path d="M12 7V3m-2 0h4M1 12v5m22-5v5M8 12v2m8-2v2m-8 3h8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    people: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 4a3 3 0 0 1 0 6m3 11v-3a7 7 0 0 0-3-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7Z"/>',
    leaf: '<path d="M4 20c1-11 7-15 16-16 0 10-5 16-13 16Zm0 0L16 8M8 16l-1-5m5 1 5 1"/>',
    send: '<path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    hand: '<path d="M8 12V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v9a7 7 0 0 1-12 5l-5-7a2 2 0 0 1 3-3l2 2Z"/>'
  };
  const routes = [
    { id: 'hoje', name: 'Hoje', icon: 'today' }, { id: 'agenda', name: 'Agenda', icon: 'calendar' },
    { id: 'conversas', name: 'Conversas', icon: 'chat' }, { id: 'editor', name: 'Editor de mensagens', icon: 'edit' },
    { id: 'campanhas', name: 'Campanhas', icon: 'campaign' },
    { id: 'automacoes', name: 'Automações', icon: 'bot' }
  ];
  const statusLabels = { reserved: 'A confirmar', confirmed: 'Confirmada', cancelled: 'Cancelada', attended: 'Compareceu', missed: 'Faltou' };
  const shortDays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  let state;
  let selectedDate = model.localNow().date;
  let selectedClient = 'client-ana';
  let memoryOnly = false;
  let modalSubmit = null;
  let opener = null;
  let toastTimer;

  function escape(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.leaf) + '</svg>';
  }

  function button(label, action, attributes, kind, symbol) {
    return '<button type="button" class="button ' + (kind || 'secondary') + '" data-action="' + action + '" ' + (attributes || '') + '>' + (symbol ? icon(symbol) : '') + escape(label) + '</button>';
  }

  function dateLabel(date, options) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: model.TIME_ZONE, day: 'numeric', month: 'long', ...options }).format(new Date(date + 'T12:00:00Z'));
  }

  function shortDate(date) {
    return dateLabel(date, { day: '2-digit', month: '2-digit' });
  }

  function clientById(clientId) {
    return state.clients.find(client => client.id === clientId);
  }

  function slotById(slotId) {
    return state.slots.find(slot => slot.id === slotId);
  }

  function avatar(client) {
    return '<span class="avatar" aria-hidden="true">' + escape(client.initials) + '</span>';
  }

  function badge(label, color) {
    return '<span class="badge ' + (color || '') + '">' + escape(label) + '</span>';
  }

  function warn(text) {
    const target = document.getElementById('storage-warning');
    target.textContent = text;
    target.hidden = false;
  }

  function announce(text, error) {
    window.clearTimeout(toastTimer);
    feedback.textContent = text;
    feedback.className = 'toast visible' + (error ? ' error' : '');
    toastTimer = window.setTimeout(() => { feedback.className = 'toast'; }, error ? 9000 : 5000);
    const formError = modal.open && modal.querySelector('.form-error');
    if (error && formError) {
      formError.textContent = text;
      formError.hidden = false;
    }
  }

  function persist() {
    try {
      window.localStorage.setItem(model.STORAGE_KEY, JSON.stringify(state));
      memoryOnly = false;
      return true;
    } catch (error) {
      memoryOnly = true;
      warn('O navegador não permitiu gravar a demonstração. As mudanças ficam apenas nesta sessão. Exporte um backup local para não perder os dados.');
      return false;
    }
  }

  function load() {
    state = model.seed();
    try {
      const raw = window.localStorage.getItem(model.STORAGE_KEY);
      if (raw !== null) {
        const restored = model.restore(raw);
        state = restored.state;
        if (!restored.ok) {
          window.localStorage.setItem(model.STORAGE_KEY + '.recovery', raw);
          warn(restored.error + ' Um exemplo novo foi aberto; o conteúdo anterior foi preservado na chave local de recuperação.');
          persist();
        }
      } else persist();
    } catch (error) {
      memoryOnly = true;
      warn('Não foi possível acessar o armazenamento local. Esta demonstração funciona apenas nesta sessão. Você pode exportar um backup em Automações.');
    }
    if (!clientById(selectedClient)) selectedClient = state.clients[0].id;
  }

  function commit(action, success) {
    if (!memoryOnly) {
      try {
        const raw = window.localStorage.getItem(model.STORAGE_KEY);
        if (raw) {
          const latest = model.restore(raw);
          if (!latest.ok) {
            announce('Os dados locais foram alterados e não são válidos. Exporte esta sessão e restaure um backup antes de continuar.', true);
            return null;
          }
          if (latest.state.revision !== state.revision) state = latest.state;
        }
      } catch (error) {
        memoryOnly = true;
        warn('O armazenamento ficou indisponível. As próximas alterações permanecerão somente nesta sessão.');
      }
    }
    const result = model.dispatch(state, action);
    if (!result.ok) {
      announce(result.error, true);
      return null;
    }
    state = result.state;
    const saved = persist();
    render();
    announce((success || 'Demonstração atualizada.') + (saved ? '' : ' Apenas nesta sessão.'));
    return result.value;
  }

  function route() {
    const requested = window.location.hash.slice(1);
    return routes.some(item => item.id === requested) ? requested : 'hoje';
  }

  function go(view) {
    if (route() === view) render();
    else window.location.hash = view;
  }

  function heading(eyebrow, title, description, actions) {
    return '<div class="view-heading"><div><p class="eyebrow">' + escape(eyebrow) + '</p><h1>' + escape(title) + '</h1><p class="subtle">' + escape(description) + '</p></div><div class="actions">' + (actions || '') + '</div></div>';
  }

  function empty(title, text, action) {
    return '<div class="empty">' + icon('leaf') + '<strong>' + escape(title) + '</strong><p>' + escape(text) + '</p>' + (action || '') + '</div>';
  }

  function pendingRequests() {
    return state.requests.filter(request => request.status === 'pending');
  }

  function bookingActions(booking) {
    if (['cancelled', 'attended', 'missed'].includes(booking.status)) return '';
    const slot = slotById(booking.slotId);
    const current = model.localNow();
    const started = slot.date + slot.start <= current.date + current.time;
    const ended = slot.date + slot.end <= current.date + current.time;
    const attrs = 'data-id="' + escape(booking.id) + '"';
    return '<div class="inline-actions">'
      + (booking.status === 'reserved' && model.isFuture(slot) ? button('Confirmar', 'booking-status', attrs + ' data-status="confirmed"', 'soft small') : '')
      + (started ? button('Compareceu', 'booking-status', attrs + ' data-status="attended"', 'soft small') : '')
      + (ended ? button('Faltou', 'booking-status', attrs + ' data-status="missed"', 'secondary small') : '')
      + button('Cancelar', 'booking-status', attrs + ' data-status="cancelled"', 'danger small') + '</div>';
  }

  function bookingRow(booking, showClock) {
    const client = clientById(booking.clientId);
    const slot = slotById(booking.slotId);
    const color = booking.status === 'reserved' ? 'orange' : booking.status === 'cancelled' || booking.status === 'missed' ? 'gray' : '';
    return '<article class="booking-row"><div class="booking-main">'
      + (showClock ? '<span class="booking-clock">' + escape(slot.start) + '</span>' : '') + avatar(client)
      + '<div class="booking-person"><strong>' + escape(client.name) + '</strong><small>' + booking.quantity + ' pessoa(s), com acompanhantes · ' + (booking.source === 'bot' ? 'Bot simulado' : booking.source === 'request' ? 'Pedido especial' : 'Reserva manual') + '</small></div>'
      + badge(statusLabels[booking.status], color) + '</div>' + bookingActions(booking) + '</article>';
  }

  function requestCard(request) {
    const client = clientById(request.clientId);
    return '<article class="request-card"><div class="request-name"><strong>' + escape(client.name) + '</strong>' + badge('Aguardando', 'orange') + '</div><p>'
      + escape(shortDate(request.date)) + ' · ' + escape(request.start) + '–' + escape(request.end) + '<br>' + request.quantity + ' pessoa(s) · visita ' + (request.mode === 'exclusive' ? 'exclusiva' : 'compartilhada') + '<br>Pedido pendente não ocupa vagas.</p><div class="inline-actions">'
      + button('Revisar e aprovar', 'request-approve', 'data-id="' + escape(request.id) + '"', 'soft small', 'check')
      + button('Recusar', 'request-reject', 'data-id="' + escape(request.id) + '"', 'secondary small') + '</div></article>';
  }

  function renderToday() {
    const today = model.localNow().date;
    const todaysSlots = state.slots.filter(slot => slot.date === today);
    const bookings = state.bookings.filter(booking => slotById(booking.slotId).date === today).sort((first, second) => slotById(first.slotId).start.localeCompare(slotById(second.slotId).start));
    const next = state.bookings.filter(booking => ['reserved', 'confirmed'].includes(booking.status) && model.isFuture(slotById(booking.slotId)))
      .sort((first, second) => (slotById(first.slotId).date + slotById(first.slotId).start).localeCompare(slotById(second.slotId).date + slotById(second.slotId).start))[0];
    const slot = next && slotById(next.slotId);
    const client = next && clientById(next.clientId);
    const vacancies = todaysSlots.filter(item => item.published && model.isFuture(item)).reduce((total, item) => total + model.remaining(state, item), 0);
    const pending = pendingRequests().length + state.bookings.filter(booking => booking.status === 'reserved').length;
    const metrics = [[vacancies, 'Vagas hoje', 'pessoas em faixas publicadas', 'people', ''], [bookings.filter(booking => booking.status !== 'cancelled').length, 'Reservas do dia', 'cada grupo, uma reserva', 'calendar', ''], [pending, 'Para cuidar', 'pedidos + confirmações', 'clock', 'warm']];
    return heading('Seu brechó em movimento', 'Bom ter você por aqui, Cami.', dateLabel(today, { weekday: 'long' }) + ' · um dia de cada vez.', button('Nova reserva', 'new-booking', '', '', 'plus'))
      + '<section class="hero" aria-label="Próxima visita"><div class="hero-content"><p class="eyebrow">' + (next ? 'A próxima história começa aqui' : 'Espaço para novos encontros') + '</p><h2>'
      + (next ? escape(client.name.split(' ')[0]) + ' vem garimpar.' : 'Vamos preparar as visitas?') + '</h2><p>'
      + (next ? escape(dateLabel(slot.date)) + ' · ' + next.quantity + ' pessoa(s) · ' + (slot.mode === 'exclusive' ? 'visita exclusiva' : 'horário compartilhado') : 'Publique seus horários e experimente o atendimento local.')
      + '</p>' + (next ? button('Ver conversa', 'open-client', 'data-client="' + escape(client.id) + '"', '', 'chat') : button('Organizar agenda', 'go-agenda', '', '', 'calendar'))
      + '</div><div>' + (next ? '<div class="hero-time">' + escape(slot.start) + '<small>até ' + escape(slot.end) + ' · São Paulo</small></div>' : '<div class="hero-art">' + icon('leaf') + '</div>') + '</div></section>'
      + '<section class="metrics" aria-label="Resumo do dia">' + metrics.map(metric => '<article class="metric ' + metric[4] + '"><span class="metric-icon">' + icon(metric[3]) + '</span><strong>' + metric[0] + '</strong><span class="metric-label">' + metric[1] + '</span><span class="metric-note">' + metric[2] + '</span></article>').join('') + '</section>'
      + '<div class="columns"><section class="panel"><div class="panel-header"><div><h2>Visitas de hoje</h2><p class="subtle">Uma recepção com tempo e cuidado.</p></div>' + button('Ver agenda', 'go-agenda', '', 'secondary small') + '</div>'
      + (bookings.length ? bookings.map(booking => bookingRow(booking, true)).join('') : empty('Hoje está tranquilo por aqui', 'Suas reservas de hoje aparecerão neste espaço.', button('Explorar agenda', 'go-agenda', '', 'soft small'))) + '</section>'
      + '<div class="stack"><section class="panel"><div class="panel-header"><div><h2>Um horário diferente?</h2><p class="subtle">Revise os pedidos antes de reservar.</p></div>' + badge(String(pendingRequests().length), 'orange') + '</div>'
      + (pendingRequests().length ? pendingRequests().map(requestCard).join('') : empty('Tudo cuidado', 'Não há pedidos especiais pendentes.')) + '</section>'
      + '<aside class="callout"><h3>Seu atendimento, no seu ritmo.</h3><p>O bot usa somente as faixas publicadas. Uma conversa com a loja permanece humana até você devolver ao bot.</p>' + button('Experimentar o atendimento', 'go-conversations', '', 'soft small', 'arrow') + '</aside></div></div>';
  }

  function renderAgenda() {
    const today = model.localNow().date;
    const slots = state.slots.filter(slot => slot.date === selectedDate).sort((first, second) => first.start.localeCompare(second.start));
    return heading('Encontros que cabem na sua rotina', 'Agenda de visitas', 'Uma loja, capacidade por pessoas. Acompanhantes também contam.', button('Adicionar faixa', 'new-slot', '', '', 'plus'))
      + '<div class="date-toolbar"><div class="date-controls">' + button('Hoje', 'select-date', 'data-date="' + today + '"', 'secondary small')
      + button('Amanhã', 'select-date', 'data-date="' + model.addDays(today, 1) + '"', 'secondary small') + '<label>Escolher data<input id="agenda-date" type="date" value="' + escape(selectedDate) + '"></label></div>'
      + button('Duplicar dia', 'duplicate-day', '', 'secondary small', 'copy') + '</div>'
      + '<div class="week-strip" aria-label="Próximos sete dias">' + Array.from({ length: 7 }, (_, offset) => {
        const date = model.addDays(today, offset);
        return '<button type="button" class="day-button' + (date === selectedDate ? ' active' : '') + '" data-action="select-date" data-date="' + date + '" aria-pressed="' + (date === selectedDate) + '">' + shortDays[model.weekday(date)] + '<strong>' + Number(date.slice(8)) + '</strong></button>';
      }).join('') + '</div><div class="section-title"><div><h2>' + escape(dateLabel(selectedDate, { weekday: 'long' })) + '</h2><p class="subtle">' + slots.length + ' faixa(s) · ' + slots.filter(item => item.published && !item.closed).length + ' publicada(s) e aberta(s)</p></div>'
      + button('Reserva manual', 'new-booking', '', 'secondary small', 'plus') + '</div>'
      + '<div class="notice">Exclusiva: apenas um grupo por faixa, mesmo com vagas restantes. Compartilhada: grupos diferentes até a capacidade. Rascunhos precisam ser publicados.</div>'
      + (slots.length ? '<div class="slot-grid">' + slots.map(renderSlot).join('') + '</div>' : '<section class="panel">' + empty('Uma página em branco para receber', 'Adicione uma faixa para começar. Nada será publicado automaticamente.', button('Criar primeira faixa', 'new-slot', '', 'soft', 'plus')) + '</section>')
      + '<section class="panel agenda-requests"><div class="panel-header"><div><h2>Pedidos especiais</h2><p class="subtle">Todos os dias · aprovação revalida conflitos e vagas.</p></div>' + badge(String(pendingRequests().length), 'orange') + '</div>'
      + (pendingRequests().length ? pendingRequests().map(requestCard).join('') : '<p class="subtle">Nenhum pedido aguardando.</p>') + '</section>';
  }

  function renderSlot(slot) {
    const occupied = model.occupancy(state, slot.id);
    const bookings = state.bookings.filter(booking => booking.slotId === slot.id);
    const future = model.isFuture(slot);
    const status = slot.closed ? badge('Fechada', 'gray') : slot.published ? badge('Publicada') : badge('Rascunho', 'orange');
    return '<section class="slot-card"><div class="slot-head"><h3>' + escape(slot.start) + ' <span class="muted">– ' + escape(slot.end) + '</span></h3>' + status + '</div><p class="slot-details">'
      + (slot.mode === 'exclusive' ? 'Exclusiva · um único grupo' : 'Compartilhada · grupos diferentes') + ' · limite de ' + slot.capacity + ' pessoa(s)</p><div class="slot-occupancy">' + icon('people') + '<strong>' + occupied + '/' + slot.capacity + '</strong><span>'
      + (slot.closed ? 'fechada para novas reservas' : !future ? 'horário encerrado ou iniciado' : slot.mode === 'exclusive' && occupied ? 'grupo reservado · sem novas reservas' : model.remaining(state, slot) + ' vaga(s) para pessoas') + '</span></div>'
      + (bookings.length ? bookings.map(booking => bookingRow(booking, false)).join('') : '<p class="subtle">Nenhuma reserva nesta faixa.</p>')
      + '<div class="slot-footer">' + (!slot.published && !slot.closed && future ? button('Publicar horário', 'publish-slot', 'data-id="' + escape(slot.id) + '"', 'soft small', 'check') : '')
      + (slot.published && !slot.closed && future && model.remaining(state, slot) ? button('Reservar', 'new-booking', 'data-id="' + escape(slot.id) + '"', 'soft small', 'plus') : '')
      + (future && !slot.closed ? button('Editar', 'edit-slot', 'data-id="' + escape(slot.id) + '"', 'secondary small', 'edit') : '')
      + (!slot.closed ? button('Fechar faixa', 'close-slot', 'data-id="' + escape(slot.id) + '"', 'secondary small') : '<span class="subtle">Reservas preservadas no histórico local.</span>') + '</div></section>';
  }

  function renderConversations() {
    const client = clientById(selectedClient) || state.clients[0];
    selectedClient = client.id;
    const messages = state.messages.filter(entry => entry.clientId === client.id);
    let lastDate = '';
    const thread = messages.map(entry => {
      const divider = lastDate !== entry.date ? '<div class="thread-date">' + escape(dateLabel(entry.date)) + ' · histórico fictício</div>' : '';
      lastDate = entry.date;
      return divider + '<article class="bubble' + (entry.role !== 'client' ? ' outgoing' : '') + (entry.role === 'agent' ? ' agent' : '') + '"><span class="bubble-role">'
        + escape(entry.role === 'client' ? client.name : entry.role === 'bot' ? 'Bot · simulação' : 'Loja · simulação') + '</span><p>' + escape(entry.text) + '</p><span class="bubble-meta">' + escape(entry.time) + ' · local, sem envio</span></article>';
    }).join('');
    return heading('Conversas com presença', 'Atendimento', 'Histórico de demonstração. Não é uma importação do WhatsApp.', button('Simular cliente', 'simulate-client', '', '', 'chat'))
      + '<div class="chat-layout"><aside class="contact-list" aria-label="Clientes fictícios"><h2>Conversas <span class="muted">' + state.clients.length + '</span></h2><label class="search-label">Buscar cliente fictício<input id="contact-search" type="search" placeholder="Buscar pelo nome" maxlength="80"></label><div class="contact-items">'
      + state.clients.map(person => {
        const last = state.messages.filter(entry => entry.clientId === person.id).at(-1);
        return '<button type="button" class="contact-button' + (client.id === person.id ? ' active' : '') + '" data-action="open-client" data-client="' + escape(person.id) + '" aria-pressed="' + (client.id === person.id) + '">' + avatar(person)
          + '<span class="contact-info"><strong>' + escape(person.name) + '</strong><small>' + escape(last ? last.text : 'Comece uma simulação') + '</small><span class="contact-mode">' + (person.mode === 'human' ? 'Com a loja' : 'Bot local') + '</span></span></button>';
      }).join('') + '</div><p id="search-empty" class="subtle" hidden>Nenhum nome encontrado.</p></aside>'
      + '<section class="chat-column" aria-label="Conversa com ' + escape(client.name) + '"><header class="chat-header">' + avatar(client) + '<div class="chat-header-info"><h2>' + escape(client.name) + '</h2><p>'
      + (client.mode === 'human' ? 'Atendimento humano · bot não interfere' : state.settings.botActive ? 'Atendimento com bot local' : 'Bot local pausado') + ' · cliente fictício</p></div>'
      + (client.mode === 'human' ? button('Devolver ao bot', 'return-bot', '', 'secondary small', 'bot') : button('Assumir conversa', 'take-conversation', '', 'secondary small', 'hand')) + '</header>'
      + '<div class="thread" id="chat-thread" tabindex="0" aria-label="Histórico de mensagens fictícias">' + (thread || empty('A conversa começa com um oi', 'Use Simular cliente para experimentar o roteiro.')) + '</div>'
      + '<details class="simulator" open><summary>Teste como cliente · bot interativo local</summary>' + renderBotFlow(client) + '</details>'
      + '<form id="reply-form" class="composer"><label for="reply-text">Sua resposta como atendente · somente simulação</label><textarea id="reply-text" name="text" required maxlength="1200" placeholder="Escreva uma resposta com carinho…"></textarea><div class="composer-footer"><small>Adicionar resposta assume a conversa. Nada vai para o WhatsApp.</small><button type="submit" class="button small">' + icon('send') + 'Adicionar resposta</button></div></form></section></div>';
  }

  function botOption(label, step, detail, slotId) {
    return '<button type="button" class="bot-option" data-action="bot-step" data-step="' + step + '"' + (slotId ? ' data-slot="' + escape(slotId) + '"' : '') + '><span>' + escape(label) + (detail ? '<br><small>' + escape(detail) + '</small>' : '') + '</span>' + icon('arrow') + '</button>';
  }

  function renderBotFlow(client) {
    if (client.mode === 'human') return '<p class="flow-intro">A loja está no comando. Texto livre do cliente não reinicia o menu. Devolva ao bot para testar o roteiro.</p>' + button('Simular mensagem do cliente', 'simulate-client', '', 'secondary small');
    if (!state.settings.botActive) return '<p class="flow-intro">Bot local pausado em Automações. Mensagens do cliente continuam no histórico, sem resposta automática.</p>';
    const flow = client.flow;
    const back = button('Voltar ao menu', 'bot-step', 'data-step="menu"', 'secondary small');
    if (flow.stage === 'menu') return '<p class="flow-intro">Escolha uma opção como se você fosse o cliente. Esta prévia não reproduz exatamente o WhatsApp.</p><div class="bot-options">'
      + botOption('Agendar visita', 'schedule') + botOption('Pedir outro horário', 'special') + botOption('Falar com a loja', 'human') + '</div>';
    if (flow.stage === 'slots') {
      const available = model.availableSlots(state);
      const published = state.slots.some(slot => slot.published && !slot.closed && model.isFuture(slot));
      return '<p class="flow-intro">Horários publicados · disponibilidade atualizada a cada ação.</p><div class="bot-options">'
        + (available.length ? available.map(slot => botOption(shortDate(slot.date) + ' · ' + slot.start + '–' + slot.end, 'slot', (slot.mode === 'exclusive' ? 'Exclusiva · grupo de até ' : 'Compartilhada · vagas para ') + model.remaining(state, slot) + ' pessoa(s)', slot.id)).join('')
          : '<p class="subtle">' + (published ? 'Vagas esgotadas nos horários publicados.' : 'Nenhuma agenda futura publicada e aberta.') + ' Peça outro horário ou fale com a loja.</p>') + '</div>' + back;
    }
    const slot = flow.slotId && slotById(flow.slotId);
    if (flow.stage === 'quantity' && slot) return '<p class="flow-intro">' + escape(shortDate(slot.date)) + ' · ' + escape(slot.start) + ' · ' + model.remaining(state, slot) + ' vaga(s) para pessoas.</p><form id="bot-quantity-form"><label>Quantas pessoas, incluindo você e acompanhantes?<input type="number" name="quantity" min="1" max="50" value="1" required></label><div class="form-actions">' + back + '<button type="submit" class="button small">Revisar visita</button></div></form>';
    if (flow.stage === 'review' && slot) return '<div class="flow-confirm"><h3>Vamos confirmar?</h3><p>' + escape(dateLabel(slot.date)) + ' · ' + escape(slot.start) + '–' + escape(slot.end) + '<br>' + flow.quantity + ' pessoa(s) · ' + (slot.mode === 'exclusive' ? 'um grupo exclusivo' : 'faixa compartilhada') + '</p><p class="subtle">A confirmação cria uma reserva apenas nesta demonstração.</p><div class="inline-actions">' + button('Confirmar visita local', 'bot-step', 'data-step="confirm"', 'small', 'check') + back + '</div></div>';
    if (flow.stage === 'special') return '<p class="flow-intro">Pedido exclusivo para análise. Ainda não reserva nem bloqueia vagas.</p><form id="bot-request-form"><div class="fields"><input type="hidden" name="key" value="' + model.id('request-operation') + '"><label>Data desejada<input type="date" name="date" min="' + model.localNow().date + '" value="' + model.addDays(model.localNow().date, 1) + '" required></label><div class="field-row"><label>Início<input type="time" name="start" value="16:00" required></label><label>Fim<input type="time" name="end" value="17:00" required></label></div><label>Pessoas, incluindo acompanhantes<input name="quantity" type="number" min="1" max="50" value="2" required></label></div><div class="form-actions">' + back + '<button type="submit" class="button small">Registrar pedido local</button></div></form>';
    return '<p class="flow-intro">Visita registrada na demonstração. Confira a Agenda ou escolha outra opção.</p>' + back;
  }

  function frequencyText(campaign) {
    return campaign.frequency === 'weekly' ? 'Semanal · ' + shortDays[campaign.every % 7]
      : campaign.frequency === 'monthly' ? 'Mensal · dia ' + campaign.every : 'A cada ' + campaign.every + ' dia(s)';
  }

  function renderCampaigns() {
    return heading('Presença, não excesso', 'Campanhas com cuidado', 'Rascunhos de divulgação para listas internas autorizadas. Sem disparos.', button('Novo rascunho', 'new-campaign', '', '', 'plus'))
      + '<div class="notice">Planejamento local, sem agendador ativo. As datas abaixo são previsões: não há timers, envio automático ou confirmação de entrega.</div>'
      + '<div class="campaign-grid">' + state.campaigns.map(campaign => {
        const next = model.nextPlan(campaign);
        return '<article class="panel campaign-card"><div class="panel-header"><div><p class="eyebrow">Divulgação</p><h2>' + escape(campaign.title) + '</h2></div>' + badge('Rascunho', 'orange') + '</div><div class="campaign-copy">'
          + escape(campaign.text) + '</div><div class="campaign-facts"><div><span>PLANEJAMENTO</span>' + escape(frequencyText(campaign)) + ' · ' + escape(campaign.time) + '</div><div><span>DESTINATÁRIOS PREVISTOS</span>' + model.eligibleRecipients(state, campaign).length + ' contato(s) autorizado(s)</div><div><span>PRÓXIMA PREVISÃO LOCAL</span>'
          + (next ? escape(shortDate(next.date)) + ' às ' + escape(next.time) : 'Sem previsão') + '</div><div><span>TIPO DE LISTA</span>Interna · não é grupo WhatsApp</div></div><div class="inline-actions">'
          + button('Prévia da simulação', 'preview-campaign', 'data-id="' + escape(campaign.id) + '"', 'soft small', 'chat') + button('Editar', 'edit-campaign', 'data-id="' + escape(campaign.id) + '"', 'secondary small', 'edit') + '</div></article>';
      }).join('') + '</div><div class="columns"><section class="panel"><div class="panel-header"><div><h2>Autorizações de divulgação</h2><p class="subtle">Contatos fictícios. Autorizações também são exemplos.</p></div>' + icon('people') + '</div>'
      + state.clients.map(client => '<div class="contact-consent">' + avatar(client) + '<div class="consent-info"><strong>' + escape(client.name) + '</strong><small>' + (client.consent ? 'Autorização de exemplo · divulgação' : 'Sem autorização de divulgação') + '</small></div>'
        + (client.consent ? button('Descadastrar', 'unsubscribe', 'data-client="' + escape(client.id) + '"', 'secondary small') : badge('Não incluir', 'gray')) + '</div>').join('') + '</section><div class="stack">'
      + '<section class="panel"><p class="eyebrow">Fluxos separados</p><h2>Lembrete de visita</h2><p class="subtle">Relaciona-se a uma reserva, não a uma campanha de novidades. Lembretes automáticos não estão ativados nesta demonstração.</p>' + badge('Não implementado', 'gray') + '</section>'
      + '<section class="panel"><h2>Grupos do WhatsApp</h2><p class="subtle">Depende de validação Meta / indisponível nesta demonstração. Listas internas de contatos não são grupos do WhatsApp.</p>' + badge('Indisponível', 'gray') + '</section>'
      + '<aside class="callout"><h3>Antes de qualquer integração real</h3><p>Validar consentimento, descadastros, janela de atendimento de 24h e uso de templates aprovados quando exigidos. Salvar um rascunho aqui não aprova um template.</p></aside></div></div>';
  }

  function renderAutomations() {
    const settings = state.settings;
    return heading('Um primeiro oi com a sua cara', 'Automações locais', 'Roteiro de demonstração, independente do bot e dos modelos do servidor.', '<a class="button secondary" href="#editor">' + icon('edit') + 'Abrir editor de mensagens</a>')
      + '<div class="automation-layout"><div class="stack"><section class="panel"><div class="panel-header"><div><h2>Boas-vindas & disponibilidade</h2><p class="subtle">Salvar afeta somente a simulação desta página.</p></div>' + badge(settings.botActive ? 'Bot local ativo' : 'Bot local pausado', settings.botActive ? '' : 'gray') + '</div>'
      + '<form id="settings-form"><div class="fields"><label class="check-label"><input type="checkbox" name="botActive"' + (settings.botActive ? ' checked' : '') + '>Ativar bot na demonstração local</label><label>Mensagem de boas-vindas<textarea name="welcome" maxlength="500" required>' + escape(settings.welcome) + '</textarea><small>Até 500 caracteres. Não altera o texto do editor de mensagens.</small></label><label>Mensagem fora do expediente<textarea name="outside" maxlength="500" required>' + escape(settings.outside) + '</textarea><small>O menu de agendamento continua disponível fora do expediente.</small></label><div class="field-row"><label>Expediente · início<input name="start" type="time" value="' + escape(settings.start) + '" required></label><label>Expediente · fim<input name="end" type="time" value="' + escape(settings.end) + '" required></label></div><fieldset><legend>Dias de atendimento · São Paulo</legend><div class="days-field">'
      + shortDays.map((day, index) => '<label class="check-label"><input type="checkbox" name="days" value="' + index + '"' + (settings.days.includes(index) ? ' checked' : '') + '>' + day + '</label>').join('') + '</div></fieldset></div><div class="form-actions"><button type="submit" class="button">Salvar automações locais</button></div></form></section>'
      + '<section class="panel"><h2>Seus dados de demonstração</h2><p class="subtle">Armazenados neste navegador, na chave <code>cami.gestao.demo.v1</code>. Não há backup em nuvem nem sincronização. Exportar baixa um arquivo JSON local; restaurar substitui esta demonstração após confirmação.</p><div class="backup-actions">'
      + button('Exportar backup demo', 'export-backup', '', 'secondary small', 'download') + button('Restaurar backup demo', 'import-backup', '', 'secondary small') + button('Recomeçar exemplo', 'reset-demo', '', 'danger small')
      + '</div><input id="backup-file" class="sr-only" tabindex="-1" aria-label="Arquivo JSON de backup da demonstração" type="file" accept=".json,application/json"><p class="form-note">Use apenas dados fictícios. O editor de mensagens não é alterado. Em arquivos locais, a persistência depende do navegador.</p></section></div>'
      + '<aside class="stack"><section class="automation-preview"><p class="eyebrow">Prévia da versão salva</p><div class="bubble"><span class="bubble-role">Brechó da Cami · bot simulado</span><p>' + escape(settings.welcome) + '</p><span class="bubble-meta">Somente local</span></div><div class="bot-option"><span>Agendar visita</span>' + icon('calendar') + '</div><div class="bot-option"><span>Pedir outro horário</span>' + icon('clock') + '</div><div class="bot-option"><span>Falar com a loja</span>' + icon('chat') + '</div><p class="form-note">Aparência ilustrativa, não uma reprodução exata do WhatsApp.</p>'
      + button('Testar roteiro', 'go-conversations', '', 'soft small', 'arrow') + '</section><section class="panel"><h2>Um roteiro simples e útil</h2>'
      + [['Agenda de verdade, na demo', 'O bot consulta faixas publicadas e confirma pela mesma regra de capacidade da Agenda.'], ['O diferente vira pedido', 'Um horário especial só ocupa vagas depois de uma aprovação válida.'], ['A loja assume com um toque', 'Quando você assume ou responde, o bot para naquela conversa até ser devolvido.']].map((step, index) => '<div class="step-row"><span class="step-number">' + (index + 1) + '</span><div><strong>' + step[0] + '</strong><p>' + step[1] + '</p></div></div>').join('')
      + '</section></aside></div>';
  }

  function render() {
    const active = document.activeElement;
    const focusId = active && active.id;
    const focusAction = active && active.dataset && active.dataset.action;
    const focusItem = active && active.dataset && (active.dataset.id || active.dataset.client || active.dataset.step || active.dataset.date || '');
    const currentRoute = route();
    navigation.innerHTML = routes.map(item => '<a class="nav-link' + (item.id === currentRoute ? ' active' : '') + '" href="#' + item.id + '"' + (item.id === currentRoute ? ' aria-current="page"' : '') + '>' + icon(item.icon) + '<span>' + item.name + '</span>' + (item.id === 'conversas' ? '<span class="nav-count">' + state.clients.length + '</span>' : '') + '</a>').join('');
    const views = { hoje: renderToday, agenda: renderAgenda, conversas: renderConversations, campanhas: renderCampaigns, automacoes: renderAutomations };
    const editing = currentRoute === 'editor';
    editorHost.hidden = !editing;
    main.classList.toggle('editor-heading', editing);
    if (editing && !editorFrame.getAttribute('src')) editorFrame.setAttribute('src', editorFrame.dataset.src);
    main.innerHTML = editing
      ? heading('Seu espaço de cuidado', 'Editor de mensagens', 'Prepare e salve mensagens neste navegador. Sem envio ou conexão com a API; os modelos do editor são separados dos dados da gestão.')
      : views[currentRoute]();
    document.title = routes.find(item => item.id === currentRoute).name + ' · Brechó da Cami · Demonstração';
    const thread = document.getElementById('chat-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
    if (!modal.open) {
      const same = focusId && document.getElementById(focusId);
      const match = !same && focusAction && Array.from(main.querySelectorAll('[data-action]')).find(element => element.dataset.action === focusAction && (element.dataset.id || element.dataset.client || element.dataset.step || element.dataset.date || '') === focusItem);
      if (same && same !== document.body) same.focus({ preventScroll: true });
      else if (match) match.focus({ preventScroll: true });
      else if (active && active !== document.body && !active.isConnected) main.focus({ preventScroll: true });
    }
  }

  function showModal(title, html, onSubmit) {
    opener = document.activeElement;
    modalSubmit = onSubmit || null;
    document.getElementById('modal-title').textContent = title;
    modalBody.innerHTML = html;
    if (!modal.querySelector('.form-error')) modalBody.insertAdjacentHTML('beforeend', '<p class="form-error" role="alert" hidden></p>');
    modal.showModal();
  }

  function formActions(label) {
    return '<div class="form-actions">' + button('Voltar', 'cancel-modal', '', 'secondary') + '<button type="submit" class="button">' + escape(label) + '</button></div>';
  }

  function confirm(title, html, label, action) {
    showModal(title, '<form><div class="modal-summary">' + html + '</div><p class="modal-intro">Esta ação afeta apenas os dados locais da demonstração. Nenhuma mensagem real será enviada.</p>' + formActions(label) + '</form>', () => {
      if (action()) modal.close();
    });
  }

  function openSlot(slot) {
    const date = slot ? slot.date : selectedDate < model.localNow().date ? model.localNow().date : selectedDate;
    showModal(slot ? 'Editar faixa de visita' : 'Uma nova faixa para receber', '<p class="modal-intro">Capacidade em pessoas, incluindo acompanhantes. Não são permitidas faixas sobrepostas na mesma loja.</p><form><div class="fields"><label>Data da visita<input name="date" type="date" min="' + model.localNow().date + '" value="' + escape(date) + '" required></label><div class="field-row"><label>Início<input name="start" type="time" value="' + escape(slot ? slot.start : '10:00') + '" required></label><label>Fim<input name="end" type="time" value="' + escape(slot ? slot.end : '11:00') + '" required></label></div><label>Modalidade<select name="mode"><option value="shared"' + (!slot || slot.mode === 'shared' ? ' selected' : '') + '>Compartilhada · grupos diferentes</option><option value="exclusive"' + (slot && slot.mode === 'exclusive' ? ' selected' : '') + '>Exclusiva · apenas um grupo</option></select></label><label>Capacidade total de pessoas<input name="capacity" type="number" min="1" max="50" value="' + (slot ? slot.capacity : 6) + '" required><small>Exclusiva: o grupo pode trazer até capacidade − 1 acompanhantes. Compartilhada: todos os grupos somados respeitam o limite.</small></label></div><p class="form-note">' + (slot ? 'Reservas existentes são preservadas. A capacidade não pode ficar abaixo da ocupação.' : 'A faixa será salva como rascunho. Você decide quando publicar.') + '</p>' + formActions(slot ? 'Salvar faixa' : 'Criar rascunho') + '</form>', data => {
      const fields = Object.fromEntries(data);
      const result = commit({ type: slot ? 'slot.edit' : 'slot.add', ...fields, ...(slot ? { id: slot.id } : {}) }, slot ? 'Faixa atualizada localmente.' : 'Faixa criada como rascunho. Publique quando estiver pronta.');
      if (result) { selectedDate = result.date; modal.close(); render(); }
    });
  }

  function openBooking(slotId) {
    const available = model.availableSlots(state);
    if (!available.length) {
      announce('Não há faixa publicada com vagas no futuro. Crie ou publique uma faixa na Agenda.', true);
      go('agenda');
      return;
    }
    const preferred = slotId || (available.find(slot => slot.date === selectedDate) || available[0]).id;
    const operation = model.id('manual-operation');
    showModal('Adicionar reserva manual', '<p class="modal-intro">Use nomes fictícios nesta demonstração. O grupo inteiro conta para a capacidade. A reserva começa como “A confirmar”.</p><form><div class="fields"><label>Nome fictício da pessoa<input name="name" maxlength="80" list="client-names" autocomplete="off" required placeholder="Escolha um exemplo ou digite um nome"><datalist id="client-names">'
      + state.clients.map(client => '<option value="' + escape(client.name) + '"></option>').join('') + '</datalist></label><label>Faixa publicada<select name="slotId">'
      + available.map(slot => '<option value="' + escape(slot.id) + '"' + (slot.id === preferred ? ' selected' : '') + '>' + escape(shortDate(slot.date)) + ' · ' + escape(slot.start) + '–' + escape(slot.end) + ' · ' + (slot.mode === 'exclusive' ? 'exclusiva' : 'compartilhada') + ' · ' + model.remaining(state, slot) + ' vaga(s)</option>').join('')
      + '</select></label><label>Quantidade total de pessoas<input type="number" name="quantity" min="1" max="50" value="1" required><small>Inclua a pessoa responsável e todos os acompanhantes.</small></label></div>' + formActions('Registrar reserva local') + '</form>', data => {
      const result = commit({ type: 'booking.add', ...Object.fromEntries(data), key: operation, confirmed: false }, 'Reserva manual registrada localmente. Confirme quando combinar a visita.');
      if (result) modal.close();
    });
  }

  function openDuplicate() {
    const source = selectedDate;
    const slots = state.slots.filter(slot => slot.date === source);
    if (!slots.length) { announce('Adicione faixas antes de duplicar este dia.', true); return; }
    showModal('Duplicar dia com revisão', '<p class="modal-intro">' + escape(dateLabel(source)) + ' · ' + slots.length + ' faixa(s). Reservas não são copiadas. Todas as cópias serão rascunhos abertos, mesmo que a origem esteja fechada.</p><div class="modal-summary">'
      + slots.map(slot => '<p>' + escape(slot.start) + '–' + escape(slot.end) + ' · ' + slot.capacity + ' pessoa(s) · ' + (slot.mode === 'exclusive' ? 'exclusiva' : 'compartilhada') + '</p>').join('')
      + '</div><form><label>Data de destino<input name="to" type="date" min="' + model.localNow().date + '" value="' + model.addDays(source < model.localNow().date ? model.localNow().date : source, 1) + '" required></label><p class="form-note">Revise cada faixa copiada e publique explicitamente. Um conflito cancela a cópia do dia inteiro.</p>' + formActions('Criar cópias em rascunho') + '</form>', data => {
      const result = commit({ type: 'day.duplicate', from: source, to: data.get('to') }, 'Dia duplicado em rascunhos. Revise e publique cada faixa.');
      if (result) { selectedDate = data.get('to'); modal.close(); render(); }
    });
  }

  function openCampaign(campaign) {
    const initial = campaign || { title: '', text: '', frequency: 'weekly', every: 5, anchor: model.localNow().date, time: '10:00', recipients: [] };
    showModal(campaign ? 'Editar rascunho de divulgação' : 'Criar rascunho de divulgação', '<p class="modal-intro">Apenas planejamento local. Nenhum disparo será criado ou ativado.</p><form><div class="fields"><label>Nome do rascunho<input name="title" maxlength="70" value="' + escape(initial.title) + '" required></label><label>Mensagem<textarea name="text" maxlength="1200" required>' + escape(initial.text) + '</textarea></label><div class="field-row"><label>Frequência<select name="frequency" id="campaign-frequency"><option value="weekly"' + (initial.frequency === 'weekly' ? ' selected' : '') + '>Semanal</option><option value="monthly"' + (initial.frequency === 'monthly' ? ' selected' : '') + '>Mensal</option><option value="interval"' + (initial.frequency === 'interval' ? ' selected' : '') + '>Intervalo em dias</option></select></label><label><span id="frequency-label">Dia da semana</span><input id="campaign-every" name="every" type="number" min="1" max="365" value="' + initial.every + '" required></label></div><p id="frequency-hint" class="form-note"></p><div class="field-row"><label>Data de referência<input type="date" name="anchor" value="' + escape(initial.anchor) + '" required></label><label>Horário · São Paulo<input type="time" name="time" value="' + escape(initial.time) + '" required></label></div><fieldset><legend>Lista interna · somente autorizações fictícias</legend><div class="recipient-list">'
      + state.clients.map(client => '<label class="check-label"><input type="checkbox" name="recipients" value="' + escape(client.id) + '"' + (initial.recipients.includes(client.id) && client.consent ? ' checked' : '') + (client.consent ? '' : ' disabled') + '><span>' + escape(client.name) + '<small>' + (client.consent ? 'Autorização de exemplo para divulgação' : 'Sem autorização · não incluir') + '</small></span></label>').join('')
      + '</div></fieldset></div><p class="form-note">Data de referência = início da previsão. Um intervalo conta dias a partir dela. A simulação permite salvar uma lista vazia, mas não prevê destinatários.</p>' + formActions('Salvar rascunho local') + '</form>', data => {
      const result = commit({ type: 'campaign.save', ...Object.fromEntries(data), recipients: data.getAll('recipients'), ...(campaign ? { id: campaign.id } : {}) }, 'Rascunho e previsão salvos localmente. Nenhum envio programado.');
      if (result) modal.close();
    });
    updateFrequency();
  }

  function updateFrequency() {
    const frequency = document.getElementById('campaign-frequency');
    if (!frequency) return;
    const values = frequency.value === 'weekly' ? ['Dia da semana', '1 = segunda · 2 = terça · … · 7 = domingo.', 7]
      : frequency.value === 'monthly' ? ['Dia do mês', 'Dias 1 a 28, para existir em todos os meses.', 28]
        : ['Intervalo em dias', 'De 1 a 365 dias a partir da data de referência.', 365];
    document.getElementById('frequency-label').textContent = values[0];
    document.getElementById('frequency-hint').textContent = values[1];
    const number = document.getElementById('campaign-every');
    number.max = String(values[2]);
    if (Number(number.value) > values[2]) number.value = String(values[2]);
  }

  function previewCampaign(campaign) {
    const recipients = model.eligibleRecipients(state, campaign);
    const next = model.nextPlan(campaign);
    showModal('Prévia da simulação · sem envio', '<p class="modal-intro">' + escape(campaign.title) + ' · ' + escape(frequencyText(campaign)) + '</p><div class="preview-message">' + escape(campaign.text) + '</div><p class="subtle">'
      + recipients.length + ' destinatário(s) previsto(s): ' + (recipients.length ? recipients.map(client => escape(client.name)).join(', ') : 'nenhum contato autorizado selecionado')
      + '.</p><p class="subtle">Próxima previsão local: ' + (next ? escape(dateLabel(next.date)) + ', ' + escape(next.time) : 'indisponível') + '.</p><div class="notice warning">Isto não é envio, agendamento ativo nem comprovação de entrega. Não é template aprovado pela Meta.</div><div class="form-actions">' + button('Fechar prévia', 'cancel-modal', '', '') + '</div>');
    announce('Prévia local aberta. Nenhuma mensagem foi enviada.');
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cami-demo-' + model.localNow().date + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Backup demo preparado para download. Confira o arquivo salvo pelo navegador.');
  }

  async function importBackup(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { announce('O backup demo deve ter no máximo 2 MB.', true); return; }
    try {
      const restored = model.restore(await file.text());
      if (!restored.ok) { announce(restored.error + ' A sessão atual foi preservada.', true); return; }
      confirm('Substituir demonstração local?', escape(file.name) + '<br>' + restored.state.clients.length + ' cliente(s) fictício(s), ' + restored.state.slots.length + ' faixa(s), ' + restored.state.bookings.length + ' reserva(s).<br>Faça um backup da sessão atual antes de continuar.', 'Restaurar dados demo', () => {
        const previousRevision = state.revision;
        state = restored.state;
        state.revision = previousRevision + 1;
        selectedClient = state.clients[0].id;
        const saved = persist();
        render();
        announce(saved ? 'Backup demo restaurado neste navegador.' : 'Backup aberto apenas nesta sessão. Não foi possível gravar.');
        return true;
      });
    } catch (error) { announce('Não foi possível ler esse backup. Os dados atuais foram preservados.', true); }
  }

  main.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    const itemId = target.dataset.id;
    if (action === 'go-agenda') { selectedDate = model.localNow().date; go('agenda'); }
    else if (action === 'go-conversations') go('conversas');
    else if (action === 'select-date') { selectedDate = target.dataset.date; render(); }
    else if (action === 'new-slot') openSlot();
    else if (action === 'edit-slot') openSlot(slotById(itemId));
    else if (action === 'new-booking') openBooking(itemId);
    else if (action === 'duplicate-day') openDuplicate();
    else if (action === 'publish-slot') confirm('Publicar horário?', 'A faixa de ' + escape(slotById(itemId).start) + ' em ' + escape(shortDate(slotById(itemId).date)) + ' aparecerá no bot local assim que for publicada.', 'Publicar na demonstração', () => commit({ type: 'slot.publish', id: itemId }, 'Faixa publicada na agenda e no bot locais.'));
    else if (action === 'close-slot') confirm('Fechar faixa para novas reservas?', 'Todas as reservas existentes serão preservadas. A faixa deixa de aceitar novos grupos e não pode ser reaberta nesta demonstração.', 'Fechar faixa', () => commit({ type: 'slot.close', id: itemId }, 'Faixa fechada. Reservas preservadas.'));
    else if (action === 'booking-status') {
      const booking = state.bookings.find(item => item.id === itemId);
      confirm('Reserva · ' + statusLabels[target.dataset.status], escape(clientById(booking.clientId).name) + ' · ' + booking.quantity + ' pessoa(s).<br>' + (target.dataset.status === 'cancelled' ? 'O cancelamento libera as vagas, mas não reabre uma faixa fechada.' : 'O histórico local será atualizado.'), 'Confirmar alteração local', () => commit({ type: 'booking.status', id: itemId, status: target.dataset.status }, 'Reserva atualizada na demonstração.'));
    } else if (action === 'request-approve' || action === 'request-reject') {
      const request = state.requests.find(item => item.id === itemId);
      const approve = action === 'request-approve';
      confirm(approve ? 'Revisar e aprovar pedido' : 'Recusar pedido especial?', escape(clientById(request.clientId).name) + ' · ' + escape(shortDate(request.date)) + ' · ' + escape(request.start) + '–' + escape(request.end) + '<br>' + request.quantity + ' pessoa(s) · ' + (request.mode === 'exclusive' ? 'exclusiva' : 'compartilhada') + '<br><br>'
        + (approve ? 'A aprovação cria uma faixa publicada e uma reserva, ou usa uma faixa existente compatível. Conflitos, modalidade e vagas são conferidos agora.' : 'O pedido será encerrado. Um aviso aparecerá apenas no histórico simulado, sem envio.'), approve ? 'Aprovar e reservar localmente' : 'Recusar na simulação', () => commit({ type: approve ? 'request.approve' : 'request.reject', id: itemId }, approve ? 'Pedido aprovado e reserva criada localmente. Aviso apenas simulado.' : 'Pedido recusado. Aviso apenas no histórico simulado.'));
    } else if (action === 'open-client') { selectedClient = target.dataset.client; go('conversas'); }
    else if (action === 'take-conversation') commit({ type: 'conversation.human', clientId: selectedClient }, 'A loja assumiu esta conversa. O bot local não interfere.');
    else if (action === 'return-bot') commit({ type: 'conversation.bot', clientId: selectedClient }, 'Conversa devolvida ao bot local. A disponibilidade geral do bot continua sendo respeitada.');
    else if (action === 'simulate-client') {
      const clientId = selectedClient;
      showModal('Simular mensagem do cliente', '<p class="modal-intro">Você está testando como ' + escape(clientById(clientId).name) + '. Nada será enviado para fora desta página.</p><form><label>Mensagem fictícia<textarea name="text" maxlength="1200" required>Oi! Quero visitar o brechó.</textarea></label>' + formActions('Adicionar como cliente') + '</form>', data => {
        if (commit({ type: 'conversation.client', clientId, text: data.get('text') }, 'Mensagem fictícia adicionada ao histórico local.')) modal.close();
      });
    } else if (action === 'bot-step') commit({ type: 'bot.step', clientId: selectedClient, step: target.dataset.step, slotId: target.dataset.slot }, target.dataset.step === 'confirm' ? 'Visita confirmada localmente. Confira a Agenda.' : 'Etapa simulada atualizada.');
    else if (action === 'new-campaign') openCampaign();
    else if (action === 'edit-campaign') openCampaign(state.campaigns.find(item => item.id === itemId));
    else if (action === 'preview-campaign') previewCampaign(state.campaigns.find(item => item.id === itemId));
    else if (action === 'unsubscribe') confirm('Descadastrar da divulgação?', escape(clientById(target.dataset.client).name) + ' deixará todas as listas internas de campanhas. Reservas e conversas serão mantidas.', 'Descadastrar localmente', () => commit({ type: 'client.unsubscribe', clientId: target.dataset.client }, 'Contato fictício retirado das listas de divulgação.'));
    else if (action === 'export-backup') exportBackup();
    else if (action === 'import-backup') document.getElementById('backup-file').click();
    else if (action === 'reset-demo') confirm('Recomeçar com dados fictícios novos?', 'A agenda, as conversas, as configurações e as campanhas desta demonstração serão substituídas por exemplos relativos a hoje. Exporte um backup se quiser guardar a sessão. O editor não será alterado.', 'Recomeçar demonstração', () => {
      const revision = state.revision;
      state = model.seed();
      state.revision = revision + 1;
      selectedDate = model.localNow().date;
      selectedClient = state.clients[0].id;
      const saved = persist();
      render();
      announce(saved ? 'Novo exemplo criado e salvo localmente.' : 'Novo exemplo criado apenas nesta sessão.');
      return true;
    });
  });

  main.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.target);
    const values = Object.fromEntries(data);
    if (event.target.id === 'reply-form') commit({ type: 'conversation.send', clientId: selectedClient, text: data.get('text') }, 'Resposta adicionada somente à simulação. Atendimento humano ativado.');
    else if (event.target.id === 'bot-quantity-form') commit({ type: 'bot.step', step: 'quantity', clientId: selectedClient, quantity: data.get('quantity') }, 'Revise os detalhes antes de confirmar.');
    else if (event.target.id === 'bot-request-form') commit({ type: 'bot.step', step: 'request', clientId: selectedClient, ...values }, 'Pedido especial registrado localmente. Ainda não é uma reserva.');
    else if (event.target.id === 'settings-form') commit({ type: 'settings.save', ...values, botActive: data.has('botActive'), days: data.getAll('days') }, 'Automações salvas apenas para a demonstração local.');
  });

  main.addEventListener('change', event => {
    if (event.target.id === 'agenda-date' && model.validDate(event.target.value)) { selectedDate = event.target.value; render(); }
    if (event.target.id === 'backup-file') importBackup(event.target.files[0]);
  });

  main.addEventListener('input', event => {
    if (event.target.id !== 'contact-search') return;
    const search = event.target.value.trim().toLocaleLowerCase('pt-BR');
    let count = 0;
    main.querySelectorAll('.contact-button').forEach(element => {
      element.hidden = !clientById(element.dataset.client).name.toLocaleLowerCase('pt-BR').includes(search);
      if (!element.hidden) count += 1;
    });
    document.getElementById('search-empty').hidden = count > 0;
  });

  modal.addEventListener('submit', event => {
    event.preventDefault();
    if (!modalSubmit) return;
    const submit = event.submitter;
    if (submit) submit.disabled = true;
    try { modalSubmit(new FormData(event.target)); }
    finally { if (submit) submit.disabled = false; }
  });
  modal.addEventListener('click', event => {
    if (event.target.closest('[data-action="cancel-modal"]') || event.target.closest('#modal-close')) modal.close();
  });
  modal.addEventListener('change', event => { if (event.target.id === 'campaign-frequency') updateFrequency(); });
  modal.addEventListener('close', () => {
    modalSubmit = null;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    else main.focus({ preventScroll: true });
  });
  window.addEventListener('hashchange', () => { render(); main.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  window.addEventListener('storage', event => {
    if (event.key === model.STORAGE_KEY) warn('Outra aba alterou a demonstração. Recarregue para atualizar a tela. Ao salvar uma ação, as regras serão revalidadas com os dados locais mais recentes. Não há sincronização com servidor.');
  });
  load();
  render();
})();
