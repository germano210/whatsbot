(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MessageCampaigns = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const templates = [
    { id: 'novidades', label: 'Novidades da semana', text: '*Novidades da semana* 🌿\n\nConfira as novidades da nossa loja!\n\n_Exemplo de promoção: ajuste as informações antes de copiar._' },
    { id: 'desconto', label: 'Desconto especial', text: '*Oferta de exemplo* ✨\n\n10% de desconto nos itens selecionados até sexta-feira.\n\n_Condições fictícias para demonstração._' },
    { id: 'lembrete', label: 'Últimos dias', text: '*Últimos dias da promoção de exemplo!*\n\nAproveite as ofertas selecionadas até domingo.\n\n_Confira preços, estoque e condições antes de usar._' }
  ];
  const contacts = [
    { id: 'demo-1', label: 'Cliente fictício A', optIn: true, optOut: false },
    { id: 'demo-2', label: 'Cliente fictício B', optIn: true, optOut: false },
    { id: 'demo-3', label: 'Cliente fictício C', optIn: false, optOut: false },
    { id: 'demo-4', label: 'Cliente fictício D', optIn: true, optOut: true }
  ];
  function canReceivePromotions(contact) {
    return !!contact && contact.optIn === true && contact.optOut !== true;
  }
  function simulate(text, selectedIds) {
    const fail = error => ({ ok: false, recipientIds: [], error });
    if (typeof text !== 'string' || !text.trim()) return fail('Escreva uma mensagem antes de simular.');
    if (!Array.isArray(selectedIds) || !selectedIds.length) return fail('Selecione pelo menos um contato elegível.');
    const recipientIds = [...new Set(selectedIds)];
    for (const id of recipientIds) {
      const contact = contacts.find(item => item.id === id);
      if (!contact) return fail('Contato desconhecido. Selecione apenas os contatos fictícios locais.');
      if (!canReceivePromotions(contact)) return fail('Seleção inválida: há contato sem autorização ou descadastrado.');
    }
    return { ok: true, recipientIds };
  }
  return { templates, contacts, canReceivePromotions, simulate };
});
