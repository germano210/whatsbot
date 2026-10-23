(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./formatting.js') : root.MessageFormatting);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MessageRichText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (formatting) {
  'use strict';
  const delimiters = { STRONG: '*', B: '*', EM: '_', I: '_', S: '~', STRIKE: '~', DEL: '~', CODE: '`' };
  function wrap(value, delimiter) {
    return value.split('\n').map(line => line.replace(/^(\s*)(.*?)(\s*)$/, (_, before, text, after) => before + (text ? delimiter + text + delimiter : '') + after)).join('\n');
  }
  function serialize(node, plain = false, inherited = []) {
    if (node.nodeType === 3) return node.textContent.replace(/\u00a0/g, ' ');
    const tag = node.tagName;
    if (tag === 'BR') return '\n';
    if (tag === 'CODE' || tag === 'PRE') {
      const text = node.textContent || '';
      const fence = tag === 'PRE' || node.getAttribute('data-code') === 'block' ? '```' : '`';
      return plain || !text ? text : fence === '`' ? wrap(text, fence) : fence + text + fence;
    }
    if (tag === 'UL' || tag === 'OL') return Array.from(node.children).map((child, index) => (plain ? '' : tag === 'UL' ? '- ' : (index + Number(node.getAttribute('start') || 1)) + '. ') + serialize(child, plain, inherited).replace(/\n$/, '')).join('\n');
    let value = '';
    const ownDelimiter = delimiters[tag];
    const active = ownDelimiter ? [...inherited, ownDelimiter] : inherited;
    const children = Array.from(node.childNodes || []);
    children.forEach((child, index) => {
      const block = /^(DIV|P|UL|OL|BLOCKQUOTE|PRE)$/.test(child.tagName || '');
      if (index && (block || /^(DIV|P|UL|OL|BLOCKQUOTE|PRE)$/.test(children[index - 1].tagName || ''))) value += '\n';
      const childValue = serialize(child, plain, active);
      const previous = children[index - 1];
      const delimiter = delimiters[child.tagName];
      if (!plain && delimiter && previous && delimiters[previous.tagName] === delimiter && !active.includes(delimiter) && value.endsWith(delimiter) && childValue.startsWith(delimiter)) value = value.slice(0, -delimiter.length) + childValue.slice(delimiter.length);
      else value += childValue;
    });
    if (/^(DIV|P|LI|BLOCKQUOTE)$/.test(tag) && children.length === 1 && children[0].tagName === 'BR') value = '';
    if (plain) return value;
    if (tag === 'BLOCKQUOTE') return value.split('\n').map(line => '> ' + line).join('\n');
    if (tag === 'PRE' || (tag === 'CODE' && node.getAttribute('data-code') === 'block')) return '```' + (node.textContent || '') + '```';
    const delimiter = delimiters[tag];
    return delimiter && value && !inherited.includes(delimiter) ? wrap(value, delimiter) : value;
  }
  function render(editor, markup) {
    const doc = editor.ownerDocument;
    const tags = { bold: 'strong', italic: 'em', strike: 's', code: 'code', inlineCode: 'code' };
    function inline(tokens, target) {
      tokens.forEach(token => {
        if (token.type === 'text') target.append(doc.createTextNode(token.text));
        else {
          const node = doc.createElement(tags[token.type]);
          if ('text' in token) { node.textContent = token.text; if (token.type === 'code') node.setAttribute('data-code', 'block'); }
          else inline(token.children, node);
          target.append(node);
        }
      });
    }
    const fragment = doc.createDocumentFragment();
    formatting.parseMessage(markup).forEach(block => {
      const line = doc.createElement(block.type === 'quote' ? 'blockquote' : block.type === 'bullet' ? 'ul' : block.type === 'numbered' ? 'ol' : 'div');
      let body = line;
      if (block.type === 'bullet' || block.type === 'numbered') { body = doc.createElement('li'); line.append(body); if (block.marker) line.setAttribute('start', parseInt(block.marker, 10)); }
      inline(block.children, body);
      if (!body.childNodes.length) body.append(doc.createElement('br'));
      fragment.append(line);
    });
    editor.replaceChildren(fragment);
  }
  return { serialize, render };
});

