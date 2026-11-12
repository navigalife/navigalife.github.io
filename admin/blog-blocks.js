// STUB (W2c replaces). UMD classic script, see src/blog/CONTRACT.md.
(function (root) {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const renderInline = (inline) => (typeof inline === 'string' ? esc(inline) : (inline || []).map((r) => esc(r.t || '')).join(''));
  const renderBlocks = (list) => (list || []).map((b) => (b.text ? `<p>${renderInline(b.text)}</p>` : '')).join('');
  const slugify = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const headingsOf = (list) => (list || []).filter((b) => b.type === 'heading').map((b) => ({ level: b.level, text: b.text, anchor: b.anchor || slugify(b.text) }));
  const plainText = (post) => (post.blocks || []).map((b) => (typeof b.text === 'string' ? b.text : '')).join(' ');
  const readingMinutes = (post) => Math.max(1, Math.round(plainText(post).split(/\s+/).length / 220));
  const api = Object.freeze({ renderBlocks, renderInline, headingsOf, plainText, readingMinutes, slugify, BLOCK_TYPES: [] });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MediVascBlogBlocks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
