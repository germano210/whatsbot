(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MessageHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function createHistory(initial, limit = 100) {
    let entries = [{ ...initial }];
    let index = 0;
    return {
      current: () => ({ ...entries[index] }),
      canUndo: () => index > 0,
      canRedo: () => index < entries.length - 1,
      selection(start, end) { entries[index] = { ...entries[index], start, end }; },
      push(snapshot, merge = false) {
        if (snapshot.value === entries[index].value) { entries[index] = { ...snapshot }; return; }
        const canMerge = merge && index > 0 && index === entries.length - 1;
        entries = entries.slice(0, index + 1);
        if (canMerge) entries[index] = { ...snapshot };
        else { entries.push({ ...snapshot }); index++; }
        if (entries.length > limit) { entries.shift(); index--; }
      },
      undo() { if (index > 0) index--; return { ...entries[index] }; },
      redo() { if (index < entries.length - 1) index++; return { ...entries[index] }; }
    };
  }
  return { createHistory };
});
