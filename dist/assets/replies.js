(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MessageReplies = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function normalizeLabel(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  }
  function addOption(options, label) {
    const normalized = normalizeLabel(label);
    const fail = error => ({ ok: false, options, error });
    if (!normalized) return fail('Digite o texto da opção.');
    if (Array.from(normalized).length > 20) return fail('Use até 20 caracteres por opção.');
    if (options.some(option => normalizeLabel(option.label).toLowerCase() === normalized.toLowerCase())) return fail('Essa opção já foi adicionada.');
    if (options.length >= 3) return fail('Adicione no máximo três opções.');
    let suffix = 1;
    while (options.some(option => option.id === 'reply-' + suffix)) suffix += 1;
    return { ok: true, options: [...options, { id: 'reply-' + suffix, label: normalized }] };
  }
  function removeOption(options, id) {
    return options.filter(option => option.id !== id);
  }
  function chooseOption(options, id) {
    const option = options.find(item => item.id === id);
    return option ? { id: option.id, label: option.label } : null;
  }
  return { normalizeLabel, addOption, removeOption, chooseOption };
});
