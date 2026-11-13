(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MessageContinuations = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function validate(input) {
    if (!input || typeof input.text !== 'string' || !Array.isArray(input.slots)) return { error: 'Continuação inválida. Revise e salve novamente.' };
    const limit = input.slots.length ? 1024 : 4096;
    if (!input.text.trim()) return { error: 'Digite o texto da continuação.' };
    if (Array.from(input.text).length > limit) return { error: 'Use até ' + limit + ' caracteres no texto da continuação.' };
    if (input.slots.length > 10) return { error: 'Cadastre de 1 a 10 horários/opções.' };
    const slots = [], seen = new Set();
    for (const slot of input.slots) {
      if (typeof slot !== 'string') return { error: 'Cada horário/opção deve ser um texto.' };
      const normalized = slot.trim().replace(/\s+/gu, ' ');
      if (!normalized || Array.from(normalized).length > 24) return { error: 'Cada horário/opção deve ter de 1 a 24 caracteres; não deixe linhas vazias.' };
      const key = normalized.toLowerCase();
      if (seen.has(key)) return { error: 'Não repita horários/opções (mesmo com espaços ou maiúsculas diferentes).' };
      seen.add(key); slots.push(normalized);
    }
    return { continuation: { text: input.text, slots } };
  }
  function activation(text, options) {
    const continuations = [];
    for (const [buttonIndex, option] of options.entries()) {
      if (option.continuation === undefined) continue;
      const result = validate(option.continuation);
      if (result.error) return { error: option.label + ': ' + result.error };
      continuations.push({ buttonIndex, ...result.continuation });
    }
    return { body: { text, buttons: options.map(option => option.label), ...(continuations.length ? { continuations } : {}) } };
  }
  return { validate, activation };
});
