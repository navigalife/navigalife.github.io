# Restoring the product catalogue PDF pipeline

The Puppeteer-based catalogue PDF pipeline was removed on 2026-07-19. This file
is the complete recipe to bring it back. Because the product **data** and
**admin management** were kept, restoring is small: two files, one dependency,
one npm script, two workflow steps.

## Why it was removed

While `productsEnabled` is `false`, `tools/gen-pdfs.js` started up and exited
immediately without generating anything. But `npm ci` on every deploy still ran
Puppeteer's install hook, which downloads a full Chromium (~500 MB) into
`~/.cache/puppeteer`. That cache is not restored by the workflow's npm cache, so
every deploy re-downloaded a browser that was never used. Removing the pipeline
took that cost to zero. Nothing product-facing changed, because the public site
already renders no products.

## What was removed

| Item | Where |
|------|-------|
| `tools/gen-pdfs.js` | Puppeteer PDF renderer |
| `src/templates/catalogue.html` | print/PDF page template |
| `puppeteer` devDependency | `package.json` + `package-lock.json` |
| `pdfs` npm script | `package.json` |
| `npm run pdfs` in `serve` script | `package.json` |
| "Generate product catalogues" step | `.github/workflows/deploy.yml` |
| `&& node tools/gen-pdfs.js` in preview graft | `.github/workflows/deploy.yml` |

## What was kept (still live)

- `data/products.json` — all device records, unchanged
- `assets/products/` — device images + `manifest.json`, unchanged
- The **Products** tab and editor in `admin/` — fully functional, dormant
- `src/build.js` product plumbing and the `productsEnabled` guard, unchanged
- `data/site-config.json` `productsEnabled: false` flag, unchanged
- `tools/build-image-manifest.js`, `tools/scrape.py` — image generation tooling

## Everything as it was: the archive branch

The exact pre-removal state lives on branch **`archive/pdf-pipeline`**
(commit `68c61cb`). The two deleted files can be restored verbatim from it:

```sh
git checkout archive/pdf-pipeline -- tools/gen-pdfs.js src/templates/catalogue.html
```

## Restore steps

1. **Restore the two files** from the archive branch (command above).

2. **Reinstall Puppeteer** (regenerates the lockfile so `npm ci` stays valid):

   ```sh
   npm install --save-dev puppeteer@^24
   ```

3. **Re-add the npm scripts** in `package.json`:

   ```json
   "scripts": {
     "build": "node src/build.js",
     "pdfs": "node tools/gen-pdfs.js",
     "serve": "npm run build && npm run pdfs && node src/serve.js"
   }
   ```

4. **Re-add the workflow step** in `.github/workflows/deploy.yml`, right after
   the "Build site (production root)" step:

   ```yaml
       - name: Generate product catalogues
         run: node tools/gen-pdfs.js
   ```

   And in the "Graft preview branch into /changes" step, restore the
   `gen-pdfs` call in the preview build line:

   ```yaml
         ( cd .preview && npm ci && npm run build && node tools/gen-pdfs.js ) || { echo "preview build failed — skipping /changes"; git worktree remove --force .preview 2>/dev/null; exit 0; }
   ```

5. **Turn products on** (only if you also want them visible/generating): flip
   `productsEnabled` to `true` in `data/site-config.json`.

6. **Verify locally:**

   ```sh
   npm run build          # site still builds
   node tools/gen-pdfs.js # writes dist/catalogues/<id>.pdf per catalogue product
   ```

## Important: the public product SECTION is a separate restore

Steps above bring back the **PDF catalogues**. Rendering products **on the
website** (the product grid/section) is a different job: `src/build.js` notes
that public render path was archived to git history in "run 1" and is not
present in the current template. Setting `productsEnabled: true` will make
`src/build.js` throw by design until that render path is restored from history.
So: PDF pipeline and public product section are two independent switches.
