# MediVasc website

Static site and Git-backed content admin for **MediVasc** — prevention of foot
and leg amputation through customized, affordable vascular and lymphatic
therapy protocols delivered at home. The public site is mission-first: real
documented recoveries, the care approach, and the conditions with available
protocols. Products are archived from the public site (data and admin
management are preserved for a possible return).

## Architecture

1. `data/*.json` is the content database and preserves display order.
   `site-config.json` gates the product surface with `productsEnabled` (false).
2. `src/build.js` validates content and generates the static public site in
   `dist/`. Validation enforces the evidence rules below.
3. `src/template.js`, `src/styles.css`, and `src/site.js` provide
   dependency-free HTML, CSS, and browser behavior.
4. Sharp creates responsive WebP variants and strips image metadata during
   each build; brand marks are resized and hashed at build time.
5. `admin/` is a static vanilla-JavaScript editor that reads and writes
   repository content through GitHub's API. Publishing creates one atomic Git
   commit, updating the branch ref only after every blob and tree is ready.
6. `tools/prepare-evidence.js` and `tools/prepare-brand.js` are the one-off,
   documented pipelines that produced the patient-evidence WebPs and the brand
   set from owner-supplied originals. `tools/prepare-og.js` renders the OG
   image with the real fonts.
7. `tools/gen-pdfs.js` exits successfully without output while
   `productsEnabled` is false.
8. `.github/workflows/deploy.yml` builds `dist/` and deploys it through
   GitHub Pages on pushes to `main` (or manual dispatch).

No frontend framework, runtime library, database, analytics, or form backend.
The only development dependencies are Puppeteer and Sharp.

## Content model

`data/testimonials.json` — recovery stories, one schema, three render variants:

- `featured: true` (at most one, needs ≥2 images) renders as the 3-stage
  journey at the top of Recoveries.
- Two images (`Before therapy` + `After therapy`) render as a before/after
  card. Three add `During therapy`.
- No images renders as a quote card (`quote` required).
- With images the `remark` (MediVasc clinical note) is required; a lone image
  is invalid. `name` and `location` are always required — use
  "Identity protected" when the patient asked for privacy.

`data/protocols.json` — `audience` is `disease` or `elderly`. The public site
lists only each protocol's `condition`, grouped by track; summaries and
engagement steps stay in the data for the admin.

## Evidence policy

Patient photographs may be cropped, rotated, tonally normalized, and stripped
of metadata. They must never be generated or generatively edited. No
fabricated testimonials: placeholder quotes were removed in run 2, not
replaced with inventions.

## Run locally

Requirements: Node.js 22 or newer and npm.

```sh
npm ci
npm run build
node src/serve.js
```

Open `http://127.0.0.1:4173/`. The admin is at `http://127.0.0.1:4173/admin/`.

- `npm run build` rebuilds `dist/` from JSON and source assets.
- `SITE_THEME=sage npm run build` temporarily builds a named theme for QA.

## Publish through the admin

First run on a device: paste a fine-grained GitHub token once and choose a
device passcode (minimum 8 characters). The token is encrypted with AES-GCM
under a PBKDF2-SHA-256 key and stored only as ciphertext; the plain token is
never persisted. Later sessions unlock with the passcode alone. **Forget this
device** wipes the encrypted vault.

1. Open `/admin/` on the deployed site and unlock.
2. Edit recoveries, protocols, company details, appearance, or (archived)
   products. Changes stay in memory until publication.
3. Select **Save & Publish** — one atomic commit, then the Pages workflow
   deploys and the admin shows the run status.
4. **Rebuild site** redeploys `main` without a content change.
5. **Lock** ends the session; the tab-session token is discarded.

Never put a token in a file, terminal command, URL, issue, log, or commit.

### Create the fine-grained token

GitHub → **Settings → Developer settings → Personal access tokens →
Fine-grained tokens**: resource owner `navigalife`, repository access only
`navigalife.github.io`, permissions **Contents: Read and write** and
**Actions: Read and write**, shortest practical expiration.

## Content and safety rules

- Never commit directly to `main`; work on a branch and merge after review.
- Keep `scrape/` and `owner-assets/` ignored and untracked.
- No source-marketplace names, URLs, metadata, or copied descriptions.
- "Sequential compression" must not appear in rendered output; copy refers to
  customized medical device modalities and therapy protocols.
- Preserve the standard medical disclaimer in the site footer.
- The motto appears verbatim: "A solution is not a solution unless it is
  affordable".
