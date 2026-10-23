(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MessageFormatting = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const punctuation = /[\s.,!?;:()[\]{}"'“”‘’<>]/;
  function boundary(character) { return !character || punctuation.test(character); }

  // Return text nodes and semantic tokens. User content is never interpreted as HTML.
  function parseInline(text, excluded) {
    const nodes = [];
    let plain = '';
    const flush = () => { if (plain) { nodes.push({ type: 'text', text: plain }); plain = ''; } };
    for (let i = 0; i < text.length;) {
      const delimiter = text.startsWith('```', i) ? '```' : text[i];
      const types = { '*': 'bold', '_': 'italic', '~': 'strike', '```': 'code', '`': 'inlineCode' };
      if (types[delimiter] && delimiter !== excluded && (delimiter === '```' || boundary(text[i - 1])) && !(delimiter === '`' && (text[i - 1] === '`' || text[i + 1] === '`'))) {
        let end = text.indexOf(delimiter, i + delimiter.length);
        while (end !== -1) {
          const inside = text.slice(i + delimiter.length, end);
          const valid = inside && !(delimiter === '`' && (text[end - 1] === '`' || text[end + 1] === '`')) && (delimiter === '```' || (!/^[\s]|[\s]$/.test(inside) && !inside.includes('\n') && boundary(text[end + delimiter.length])));
          if (valid) {
            flush();
            nodes.push(delimiter === '```' || delimiter === '`' ? { type: types[delimiter], text: inside } : { type: types[delimiter], children: parseInline(inside, delimiter) });
            i = end + delimiter.length;
            break;
          }
          end = text.indexOf(delimiter, end + delimiter.length);
        }
        if (end !== -1) continue;
      }
      plain += text[i++];
    }
    flush();
    return nodes;
  }

  function parseMessage(value) {
    const text = value.replace(/\r\n?/g, '\n');
    const lines = [];
    let line = '';
    let code = false;
    for (let i = 0; i < text.length; i++) {
      if (text.startsWith('```', i)) { code = !code; line += '```'; i += 2; }
      else if (text[i] === '\n' && !code) { lines.push(line); line = ''; }
      else line += text[i];
    }
    lines.push(line);
    return lines.map((entry) => {
      const quote = /^> ?(.*)$/s.exec(entry);
      const bullet = /^[-*] (.*)$/s.exec(entry);
      const numbered = /^(\d+)\. (.*)$/s.exec(entry);
      if (quote) return { type: 'quote', children: parseInline(quote[1]) };
      if (bullet) return { type: 'bullet', children: parseInline(bullet[1]) };
      if (numbered) return { type: 'numbered', marker: numbered[1] + '.', children: parseInline(numbered[2]) };
      return { type: 'paragraph', children: parseInline(entry) };
    });
  }

  function applyFormat(value, start, end, action) {
    const delimiters = { bold: '*', italic: '_', strike: '~', code: '```', inlineCode: '`' };
    const delimiter = delimiters[action];
    if (delimiter) {
      const selected = value.slice(start, end);
      if (action !== 'code' && selected.includes('\n')) {
        const replacement = selected.split('\n').map((line) => {
          if (!line.trim()) return line;
          const leading = line.match(/^\s*/)[0];
          const trailing = line.match(/\s*$/)[0];
          const content = line.slice(leading.length, line.length - trailing.length);
          return leading + applyFormat(content, 0, content.length, action).value + trailing;
        }).join('\n');
        return { value: value.slice(0, start) + replacement + value.slice(end), start, end: start + replacement.length };
      }
      if (start >= delimiter.length && value.slice(start - delimiter.length, start) === delimiter && value.slice(end, end + delimiter.length) === delimiter) {
        return { value: value.slice(0, start - delimiter.length) + selected + value.slice(end + delimiter.length), start: start - delimiter.length, end: end - delimiter.length };
      }
      if (selected.length > delimiter.length * 2 && selected.startsWith(delimiter) && selected.endsWith(delimiter)) {
        const content = selected.slice(delimiter.length, -delimiter.length);
        return { value: value.slice(0, start) + content + value.slice(end), start, end: start + content.length };
      }
      const content = selected || 'texto';
      return { value: value.slice(0, start) + delimiter + content + delimiter + value.slice(end), start: start + delimiter.length, end: start + delimiter.length + content.length };
    }
    if (action === 'list' || action === 'quote' || action === 'numberedList') {
      const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
      const selectionEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
      const nextBreak = value.indexOf('\n', selectionEnd);
      const lineEnd = nextBreak === -1 ? value.length : nextBreak;
      const lines = value.slice(lineStart, lineEnd).split('\n');
      const prefix = action === 'list' ? '- ' : '> ';
      const numbered = action === 'numberedList';
      const remove = lines.every((line) => numbered ? /^\d+\. /.test(line) : line.startsWith(prefix));
      const replacement = lines.map((line, index) => remove ? (numbered ? line.replace(/^\d+\. /, '') : line.slice(prefix.length)) : (numbered ? (index + 1) + '. ' : prefix) + line).join('\n');
      return { value: value.slice(0, lineStart) + replacement + value.slice(lineEnd), start: lineStart, end: lineStart + replacement.length };
    }
    return { value, start, end };
  }
  return { parseInline, parseMessage, applyFormat };
});
