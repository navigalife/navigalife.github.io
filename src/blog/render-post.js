// STUB (W2b replaces). See src/blog/CONTRACT.md.
const blocks = require('../../admin/blog-blocks.js');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const renderPost = (ctx, post) => `<article class="container"><h1>${esc(post.title)}</h1>${blocks.renderBlocks(post.blocks, { img: ctx.img, depth: ctx.depth, films: ctx.films, references: post.references, contactHref: ctx.contactHref })}</article>`;
module.exports = { renderPost };
