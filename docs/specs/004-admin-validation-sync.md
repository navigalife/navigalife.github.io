# Spec 004 — Admin validation sync with layout-integrity build guards

- **Status**: final
- **Executor**: Codex (branch `codex/004-admin-validation-sync`)
- **Advisor**: Claude (spec author + reviewer)

> Numbering note: there is no in-repo spec 003. "003" was the advisor-implemented
> Run-3 design overhaul (branch `design/003-overhaul`, shipped @ `ec7036a`/`ad589f5`),
> which had no `docs/specs` entry. This is the next real spec, hence 004.

## 1. Context

Commit `f54a287` ("guard admin edits against layout-breaking states") tightened the
build's `validate()` (`src/build.js:164-234`). Two of those guards now diverge from
the admin app's client-side validation (`admin/app.js`), so the owner can save a
draft the admin accepts but `npm run build` rejects → a confusing failed publish.
The deploy job `needs: build`, so the *live site stays safe* (last good deploy keeps
serving), but the owner sees an opaque failed GitHub Actions run with no inline
explanation. This spec closes that admin↔build drift.

The build now enforces, per testimonial (`src/build.js:188-231`):

- `images.length` ∈ {0, 2, 3} — exactly 1 is rejected; > 3 is rejected.
- each image has a `src` and a `stage` in {`Before therapy`, `During therapy`, `After therapy`}.
- a **featured** testimonial has **exactly 3** images (fills the hero three-up strip).
- **exactly one** featured testimonial across the whole collection.

The admin diverges in two places:

- `admin/app.js:581` accepts a featured story with 2 images (`buffer.featured && count < 2`);
  the build requires exactly 3.
- The admin unsets other featured stories on save (`app.js:602-609`), so there is *at
  most one* featured — but nothing prevents *zero* featured. The owner can un-feature the
  only featured story, or delete it, reaching a state the build rejects.

(Single-image stories are already blocked at `app.js:575`, so that build rule is already
mirrored. This spec keeps it and adds a publish-time backstop for it.)

## 2. Goal

The owner can never save or publish a testimonial state the build's `validate()` would
reject. Every such state is stopped at **edit time** — or, as an authoritative backstop,
at **publish time** — with a clear inline message, never as an opaque failed Actions run.
No change to visual design, the appearance selector, the `themes.json` token contract, or
any non-testimonial flow.

## 3. Constraints (non-negotiable)

- Branch `codex/004-admin-validation-sync`. **Never commit to `main`** (main deploys to
  GitHub Pages). Update `PROGRESS.md` at each checkpoint.
- Touch **only `admin/app.js`.** No changes to `src/build.js`, `src/template.js`, styles,
  `themes.json`, data files, or any other admin file.
- **The admin must be stricter-or-equal to the build** for testimonials. Never make the
  admin accept something the build rejects. It is fine for the admin to be slightly
  stricter (it already requires the Before/After pair, which the build does not).
- Owner-facing message copy: match the file's existing typography — curly quotes
  (`’ “ ”`), and **no em dashes or en dashes** (use a colon, comma, or period). Use the
  exact strings given in §6.
- Zero-featured resolution is **block, never auto-promote** (design decision, §4). The
  tool must never silently choose which recovery journey anchors the hero.
- No new dependencies, no build-step change, no test framework. Verify with
  `npm run build` (must stay green) + the manual UI checklist in §7.
- Do **not** edit `AGENTS.md` (advisor-curated; folded post-merge) or anything outside
  `admin/app.js`.

## 4. Architecture (decisions already made — do not re-litigate)

Three point-of-action guards (friendly, stop the owner early) plus one publish-time
backstop (authoritative mirror of the build). Defense in depth: even if a UI path is
missed, the publish guard refuses to commit an invalid draft.

- **D1 — Featured needs exactly 3 images.** Fix the per-story check at `app.js:581`.
- **D2 — Un-featuring the only featured story is blocked** in `saveEditor`. If the saved
  version of the story being edited is currently the sole featured one and the owner
  unchecks Featured, refuse the save (a `throw`, surfaced by the existing form-error
  path) telling them to feature another story first.
- **D3 — Deleting the only featured story is blocked** in `deleteItem`. Mirror the
  existing "product still referenced" idiom (`app.js:629-635`): `showStatus(...)` +
  `return`, no `confirm`.
- **D4 — Publish-time `validateDraft`.** A pure guard invoked at the top of `publish()`,
  before `collectChanges()`, that mirrors the build's testimonial invariants: for each
  testimonial `images.length !== 1`, `<= 3`, and `featured ⇒ exactly 3 images`; plus
  exactly one featured across the collection. On failure, `showStatus(...)` with the
  specific reason and **abort without calling `state.api.publish` and without setting
  `state.publishing`**.

Rationale for block-not-promote (D2/D3): which story is featured is an editorial choice
that changes what anchors the hero. Auto-selecting a replacement silently rewrites the
owner's front page. Blocking keeps them in control and matches the delete-guard idiom
already in the file.

## 5. Repo layout / file pointers

`admin/app.js` only:

- `validateStory` (`569-583`) — the `:581` featured check → **D1**.
- `saveEditor` (`585-616`), testimonials branch (`600-610`) — add **D2** before the
  cross-unset loop (before the buffer is committed into `state.draft`).
- `deleteItem` (`627-642`) — add **D3**, following the products-reference guard at
  `629-635`.
- `publish` (`870-899`) — add the **D4** `validateDraft` call at the top, after the
  `state.editor` guard (`872`) and before `collectChanges()` (`873`).
- Data model: testimonial `{ featured, images: [{ src, stage }], … }`; `STAGES` keys
  `before/during/after` → labels at `21-25` (already exactly match the build enum — do
  not change).

Read-only reference for the invariants to mirror: `src/build.js:188-231`.

## 6. Phases

### Phase 1 — Point-of-action guards

**Tasks**

- **D1.** At `app.js:581`, change the condition `buffer.featured && count < 2` to
  `buffer.featured && count !== 3`, and replace the message with exactly:
  > `The featured story fills the hero’s three-up strip, so it needs all three photographs: Before, During, and After.`
- **D2.** In `saveEditor`, inside the `kind === 'testimonials'` branch and before the
  cross-unset loop (`602-609`), compute whether this save would leave zero featured and
  block it. Precisely: let `wasFeatured = index >= 0 && state.draft.testimonials[index].featured`
  and `othersFeatured = state.draft.testimonials.some((t, i) => i !== index && t.featured)`.
  If `wasFeatured && !buffer.featured && !othersFeatured`, `throw new Error(` with exactly:
  > `One story must stay featured to anchor the hero. Feature another story first, then remove this one from featured.`
- **D3.** In `deleteItem`, for `kind === 'testimonials'`, before the `confirm(...)` at
  `636`: if the item is featured and no other testimonial is featured
  (`item.featured && !state.draft.testimonials.some((t, i) => i !== index && t.featured)`),
  `showStatus(` with exactly title / body, then `return`:
  > title: `The featured story can’t be deleted`
  > body: `One story must stay featured to anchor the hero. Feature another story first, then delete this one.`

**Checkpoint**: build green; the manual checks in §7 items 1–6 pass.
**Verify**: `npm run build` (green; `admin/` copied into `dist/`). Record the manual
results in `PROGRESS.md`.

### Phase 2 — Publish-time backstop

**Tasks**

- Add a pure function `validateDraft(testimonials)` (near the other validators) that
  throws on the first violation, mirroring `src/build.js`:
  - per testimonial: `images.length !== 1`; `images.length <= 3`;
    if `featured`, `images.length === 3`.
  - exactly one `featured` across the array.
- Call it at the top of `publish()`, after the `state.editor` guard and before
  `collectChanges()`. Wrap so a throw becomes `showStatus('Cannot publish yet', <message>)`
  and returns **before** `state.publishing = true` and **before** `state.api.publish`.
- Messages (exact), using the testimonial `id` for the label:
  - wrong featured count: `Exactly one story must be featured before publishing (currently N). The featured story anchors the hero.` (substitute the real count for `N`).
  - featured wrong image count: `The featured story “ID” needs exactly 3 photographs to fill the hero strip (has N).`
  - single image: `Story “ID” has a single photograph; use 0, 2, or 3.`

**Checkpoint**: driving the app to any zero-/multi-featured or non-3 featured state (if
reachable through the UI) shows the "Cannot publish yet" status and fires **no** network
call to `api.publish`.
**Verify**: `npm run build` green; `PROGRESS.md` updated with the phase result.

## 7. Acceptance criteria (checkable; advisor verifies by driving the admin against the mocked GitHub API)

1. Editing a featured story with exactly **2** images and Saving is **refused** with the
   D1 message. (Before this spec: accepted.)
2. A featured story with exactly **3** images Saves successfully.
3. On a draft with a single featured story, opening it, un-checking Featured, and Saving
   is **refused** with the D2 message; the story stays featured.
4. Deleting the **only** featured story is **refused** with the D3 status; the story
   remains in the list.
5. When a **second** story is featured first, un-featuring or deleting the original is
   **allowed** (the guards fire only when it would leave zero featured).
6. Saving a **1-image** story is still refused (regression; behavior unchanged).
7. `publish()` invoked on a draft with zero featured, more than one featured, or a
   featured story with ≠ 3 images shows the "Cannot publish yet" status and does **not**
   call `state.api.publish` (no commit attempted, `state.publishing` never set).
8. `npm run build` is green and the git diff is confined to `admin/app.js`;
   products / protocols / company / appearance flows are unchanged.
9. Stage labels the admin writes remain exactly `Before therapy` / `During therapy` /
   `After therapy` (unchanged; matches the build enum).

## 8. Out of scope

- Any change to build / template / styles / themes / data files.
- The P1/P2 admin-QA items (publish atomicity & `409` handling, error-message clarity
  audit, PAT-vault security review, image-pipeline audit, multi-tab / reload UX) — the
  advisor retains these.
- `AGENTS.md` updates (advisor-curated; the new build invariants are folded post-merge).
- Auto-promoting a replacement featured story (explicitly rejected — see §4).
- Any visual, design, or appearance change.

## Addendum (post-start changes only)

_none yet_
