// Admin preview bundle: the post page renderers
// and the blog stylesheet, packaged so the admin can draw a draft exactly as the
// site will, with no build step in the browser.
//
//   writeAdminPreview(outDir) writes
//     outDir/blog-render.js    classic script. render-landing.js + render-post.js,
//                              each wrapped in a tiny CommonJS shim whose require()
//                              maps the two admin UMDs to their globals. Load AFTER
//                              admin/blog-blocks.js and admin/content-rules.js; sets
//                              globalThis.MediVascBlogRender = { renderPost, renderPostCard }.
//     outDir/blog-preview.css  active theme tokens + src/styles.css + the blog.css
//                              concatenation, unhashed; font urls point at
//                              ../../assets/fonts/ (outDir is <site>/admin/preview/).
//   The build writes dist/admin/preview/; `node src/blog/admin-preview.js` writes
//   admin/preview/ in the source tree for the local harness (gitignored).
//   Admin modules reference the files ONLY as the literals './preview/blog-render.js'
//   and './preview/blog-preview.css'; build.js copyAdmin versions them with ?v=.
//
// MINIMAL BROWSER ctx for renderPost(ctx, post) / renderPostCard(ctx, post, variant)
// (the build's ctx has more; nothing else is read by these two):
//   {
//     depth: '../',          // prefix for every site href/src. The admin page sits at
//                            // <site>/admin/, so '../' makes films (assets/…) and the
//                            // breadcrumb/author/contact links resolve to the site.
//     blog: config,          // data/blog/config.json; reads name + navLabel (crumb label).
//     films,                 // data/films.json array; video blocks with source 'film'
//                            // render only when their src is listed here.
//     img(src, { sizes, widths, alt, className, loading, fetchpriority }) → '<img …>' HTML.
//                            // Browser: `<img src="${esc(resolveSrc(src))}" alt="${esc(alt)}"
//                            // class="${esc(className)}" loading="${loading||'lazy'}"
//                            // decoding="async">`. srcset/width/height are optional; ESCAPE
//                            // every attribute (the HTML is inserted verbatim).
//     contactHref: { whatsapp, call, contact },
//                            // closing CTA + cta blocks. Browser: whatsapp 'https://wa.me/<digits>'
//                            // (or ''), call 'tel:+91…' (or ''), contact '../#contact'.
//     related: (post) => [], // rail "Related" cards: enriched posts (see below). [] is fine.
//     featured: [],          // rail "Featured" cards: enriched posts. [] is fine.
//   }                        // related + featured both empty → the post renders with no rail.
//   imgData / absImg / posts / categories / authors / homeHref / siteUrl are NOT read by
//   renderPost or renderPostCard; omit them.
// The post must be ENRICHED like the build's (raw post fields + these):
//   categoryObj  config category + { href: '../blog/category/<slug>/' } (or null)
//   authorObj    config author + { href: '../blog/author/<slug>/' } (or null)
//   reviewerObj  same shape for post.reviewer (or null)
//   readingMinutes  MediVascBlogBlocks.readingMinutes(post)
//   published    Date (publishAt, or now for an unscheduled draft); publishedLabel '12 Nov 2026'
//   updatedLabel '' unless updatedAt is a different day
//   absUrl       'https://medivasc.in/blog/<slug>/' (share buttons)
//   href         '../blog/<slug>/' (cards only)
// Images are whatever ctx.img returns, so 'draft:<name>' srcs work through resolveSrc.

const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

// require() targets the renderers may use (render-*.js stay pure).
const EXTERNALS = {
  '../../admin/blog-blocks.js': 'MediVascBlogBlocks',
  '../../admin/content-rules.js': 'MediVascContentRules',
};
const MODULES = ['./render-landing.js', './render-post.js'];

const renderBundle = async () => {
  const sources = await Promise.all(MODULES.map(async (name) => [name, await fs.readFile(path.join(__dirname, name), 'utf8')]));
  const known = new Set([...Object.keys(EXTERNALS), ...MODULES]);
  for (const [name, source] of sources) {
    for (const [, , target] of source.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)) {
      if (!known.has(target)) {
        throw new Error(
          `Admin preview: src/blog/${name.slice(2)} requires '${target}', which the browser bundle cannot provide. `
          + 'Renderers must stay pure; only blog-blocks.js, content-rules.js and render-landing.js.',
        );
      }
    }
  }
  const externals = Object.entries(EXTERNALS).map(([name, global]) => `    ${JSON.stringify(name)}: ${JSON.stringify(global)},`).join('\n');
  const defs = sources.map(([name, source]) => `  defs[${JSON.stringify(name)}] = function (module, exports, require) {\n${source}\n};`).join('\n');
  return `// GENERATED by src/blog/admin-preview.js from src/blog/render-landing.js + render-post.js.
// Do not edit; rebuild. Load after admin/blog-blocks.js and admin/content-rules.js.
(function (global) {
  var externals = {
${externals}
  };
  var defs = {};
  var cache = {};
  function req(name) {
    if (Object.prototype.hasOwnProperty.call(externals, name)) {
      var api = global[externals[name]];
      if (!api) throw new Error('blog-render.js: load ' + name.replace('../../', '') + ' first (globalThis.' + externals[name] + ' is missing).');
      return api;
    }
    if (cache[name]) return cache[name].exports;
    if (!defs[name]) throw new Error('blog-render.js: unknown module ' + name);
    var module = { exports: {} };
    cache[name] = module;
    defs[name](module, module.exports, req);
    return module.exports;
  }
${defs}
  var landing = req('./render-landing.js');
  var post = req('./render-post.js');
  global.MediVascBlogRender = Object.freeze({ renderPost: post.renderPost, renderPostCard: landing.renderPostCard });
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
};

const previewCss = async ({ theme } = {}) => {
  // Lazy: build.js requires this module, and requiring build.js never builds.
  const { themeCss, activeTheme } = require('../build.js');
  const { blogCssSource } = require('./build-blog.js');
  const readJson = async (file) => JSON.parse(await fs.readFile(path.join(ROOT, file), 'utf8'));
  const active = theme || activeTheme(await readJson('data/themes.json'), await readJson('data/site-config.json')).theme;
  const [siteCss, blogCss] = await Promise.all([
    fs.readFile(path.join(ROOT, 'src', 'styles.css'), 'utf8'),
    blogCssSource(),
  ]);
  // Site + blog CSS address fonts relative to assets/ (url("fonts/…")).
  return `${themeCss(active)}\n${siteCss}\n${blogCss}`.replace(/url\(\s*(['"]?)fonts\//g, 'url($1../../assets/fonts/');
};

// opts.theme: the build passes the theme it resolved; the CLI resolves its own.
const writeAdminPreview = async (outDir, opts = {}) => {
  const [js, css] = await Promise.all([renderBundle(), previewCss(opts)]);
  await fs.mkdir(outDir, { recursive: true });
  const files = { js: path.join(outDir, 'blog-render.js'), css: path.join(outDir, 'blog-preview.css') };
  await Promise.all([fs.writeFile(files.js, js), fs.writeFile(files.css, css)]);
  return files;
};

module.exports = { writeAdminPreview };

if (require.main === module) {
  const outDir = path.join(ROOT, 'admin', 'preview');
  writeAdminPreview(outDir).then(
    () => console.log(`Admin preview: ${path.relative(ROOT, outDir)}/blog-render.js + blog-preview.css`),
    (error) => {
      console.error(error.message || error);
      process.exitCode = 1;
    },
  );
}
