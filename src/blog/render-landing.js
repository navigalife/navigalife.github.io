// STUB (W2a replaces). See src/blog/CONTRACT.md.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const renderPostCard = (ctx, post) => `<article class="blog-card"><a href="${esc(post.href)}">${esc(post.title)}</a></article>`;
const renderLanding = (ctx) => `<section class="container"><h1>${esc(ctx.blog.name)}</h1>${ctx.posts.map((p) => renderPostCard(ctx, p)).join('')}</section>`;
const renderCategoryPage = (ctx, category) => `<section class="container"><h1>${esc(category.name)}</h1></section>`;
const renderAuthorPage = (ctx, author) => `<section class="container"><h1>${esc(author.name)}</h1></section>`;
module.exports = { renderLanding, renderCategoryPage, renderAuthorPage, renderPostCard };
