# Naviga Life website

Static marketing site and Git-backed content admin for Naviga Life Ventures LLP. The public site presents expert-guided compression therapy protocols, patient-story formats, medical compression devices, and per-product PDF catalogues.

## Architecture

1. `data/*.json` is the content database and preserves display order.
2. `src/build.js` validates content and generates the static public site in `dist/`.
3. `src/template.js`, `src/styles.css`, and `src/site.js` provide dependency-free HTML, CSS, and browser behavior.
4. Sharp creates responsive WebP variants and strips image metadata during each build.
5. The public site is a single SEO-ready page with hash-addressable product details.
6. `admin/` is a static vanilla-JavaScript editor that reads and writes repository content through GitHub's API.
7. Admin publishing creates one atomic Git commit, updating the branch ref only after every blob and tree is ready.
8. `src/templates/catalogue.html` is the deterministic A4 product-catalogue design.
9. `tools/gen-pdfs.js` uses Puppeteer to print one PDF for every visible product with `catalogue: true`.
10. `.github/workflows/deploy.yml` builds the site and PDFs, then deploys `dist/` through GitHub Pages.

The site intentionally has no frontend framework, runtime library, database, analytics, service worker, or form backend. The only development dependencies are Puppeteer and Sharp.

## Run locally

Requirements: Node.js 22 or newer and npm.

```sh
npm ci
npm run build
npm run pdfs
node src/serve.js
```

Open `http://127.0.0.1:4173/`. The admin is at `http://127.0.0.1:4173/admin/`.

For the complete build, catalogue, and preview sequence, run:

```sh
npm run serve
```

Useful individual commands:

- `npm run build` rebuilds `dist/` from JSON and source assets.
- `npm run pdfs` generates `dist/catalogues/*.pdf`; run the site build first.
- `SITE_THEME=clinic npm run build` temporarily builds a named theme for QA without editing content.

## Publish through the admin

1. Open `/admin/` on the deployed site.
2. Paste a fine-grained GitHub personal access token and keep the branch as `main` for a real publication. Use a review branch only for deliberate testing.
3. Edit products, protocols, testimonials, company details, or appearance. Changes stay in memory until publication.
4. Select **Save & Publish**. The admin batches every changed, added, and deleted file into one Git commit and updates the selected branch atomically.
5. When publishing `main`, the GitHub Pages workflow builds and deploys the new site. The admin shows the Actions run status and link.
6. Use **Rebuild site** when content has not changed but a fresh `main` deployment is needed.
7. Select **Log out** when finished. Tokens are session-only unless **Remember on this device** was explicitly selected.

Never put a token in a file, terminal command, URL, issue, log, or commit.

### Create the fine-grained token

In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**, then configure:

- Resource owner: the owner of `navigalife/navigalife.github.io`.
- Repository access: **Only select repositories**, then choose `navigalife.github.io`.
- Repository permissions: **Contents: Read and write** and **Actions: Read and write**.
- Expiration: use the shortest practical period and rotate the token when it expires or is exposed.

No account-wide or organization-wide repository access is required.

## Add a product end to end

1. In the admin Products tab, select **Add product** and enter a unique immutable slug, name, category, description, conditions, model, tagline, and specification rows.
2. Copy the locked prompt shown in the form. Generate a 3:2 studio product image in edit/reference mode using the real device image as the reference. Follow `docs/brand/IMAGE-STYLE.md` exactly; do not generatively alter patient evidence images.
3. Upload one or more WebP product images. The admin normalizes uploads to at most 1600 px and stores them under `assets/products/<slug>/`.
4. Add a record to `assets/products/manifest.json` for every generated product asset, including source reference, full prompt, model, date, output path, and status. This is the replay recipe for future matching imagery.
5. Set `visible: true` when the product is ready. Set `catalogue: true` to generate its PDF automatically.
6. Save the product editor, review the image order and all visible specification rows, then select **Save & Publish**.
7. The deployment rebuilds responsive images and generates `dist/catalogues/<slug>.pdf` from the shared A4 template. No catalogue-specific design work is needed.

Product imagery always appears inside the fixed 3:2 normalization frame: `var(--surface-2)`, `object-fit: contain`, and 8% inner padding.

## PDF pipeline

`tools/gen-pdfs.js` starts a temporary loopback-only server, loads `src/templates/catalogue.html?id=<slug>` in Puppeteer, applies the active theme's light tokens, waits for images and local fonts, and prints A4 with backgrounds enabled. Each catalogue contains the brand band, normalized product image, tagline, description, conditions, full visible specification table, contact details, and medical disclaimer.

The deploy workflow runs these steps in order:

```text
npm ci
npm run build
node tools/gen-pdfs.js
upload dist as the Pages artifact
deploy the Pages artifact
```

The workflow runs only on a push to `main` or a manual `workflow_dispatch`. Work pushed to review branches does not deploy.

## Content and safety rules

- Work on `codex/001-initial-site`; never commit directly to `main`.
- Keep `scrape/` ignored and untracked.
- Do not ship source-marketplace names, URLs, metadata, or copied descriptions.
- Preserve the standard medical disclaimer on the site and every PDF.
- Patient before/after photos may be cropped, rotated, exposed, white-balanced, or deterministically letterboxed. They must never be generated or generatively edited.
- Device selection and treatment settings require qualified clinical guidance.
