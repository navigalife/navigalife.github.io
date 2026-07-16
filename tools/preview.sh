#!/bin/sh
# preview.sh — deterministic /changes staging workflow for MediVasc
# ---------------------------------------------------------------------------
# The live root (medivasc.in) is ALWAYS built from `main`. The `preview` branch
# is a staging clone the deploy Action mounts at medivasc.in/changes.
#
# `main` has TWO writers (the admin CMS + the advisor), so `preview` MUST start
# from the current `main` before any owner-facing edit — otherwise the owner
# reviews stale content at /changes and the eventual promotion stops being a
# clean linear fast-forward. This script removes the "remember to do that" step.
#
#   tools/preview.sh status    How origin/main and origin/preview relate.
#   tools/preview.sh sync      Reset origin/preview -> origin/main. RUN THIS
#                              BEFORE you start editing preview.
#   tools/preview.sh publish   Push local `preview`, then trigger a `main` deploy
#                              so medivasc.in/changes refreshes (a bare preview
#                              push can't deploy — the env only deploys from main).
#   tools/preview.sh ship      Promote preview -> main linearly, then re-sync.
#                              Dry-run by default; pass --yes to actually push.
#
# `main` is NEVER force-pushed. The pre-push hook (tools/hooks/pre-push) and the
# server ruleset both enforce that; this script only ever force-pushes `preview`.
set -eu

repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"
log() { printf '%s\n' "$*" >&2; }

require_clean_tree() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    log "ERROR: you have uncommitted tracked changes. Commit or stash first."
    exit 1
  fi
}

cmd_status() {
  git fetch -q origin main preview 2>/dev/null || git fetch -q origin
  m=$(git rev-parse --short origin/main 2>/dev/null || echo '-')
  log "origin/main:    $m"
  if git rev-parse -q --verify origin/preview >/dev/null 2>&1; then
    log "origin/preview: $(git rev-parse --short origin/preview)"
    if [ "$(git rev-parse origin/main)" = "$(git rev-parse origin/preview)" ]; then
      log "state: CLEAN — preview == main (idle live-clone). Ready to edit."
    elif git merge-base --is-ancestor origin/main origin/preview 2>/dev/null; then
      log "state: preview is $(git rev-list --count origin/main..origin/preview) commit(s) AHEAD of main (un-shipped):"
      git log --oneline origin/main..origin/preview >&2
    else
      log "state: DIVERGED / STALE — preview is missing main commits. Run: tools/preview.sh sync"
      log "  main has that preview lacks:"
      git log --oneline origin/preview..origin/main >&2
    fi
  else
    log "origin/preview: (none) — run: tools/preview.sh sync to create it from main."
  fi
}

cmd_sync() {
  git fetch -q origin main
  main_sha=$(git rev-parse origin/main)
  log "Resetting origin/preview -> origin/main ($(git rev-parse --short "$main_sha")) ..."
  git push --force origin "$main_sha:refs/heads/preview"
  log "Done. preview is now a clean clone of main — safe to start editing preview."
}

cmd_publish() {
  if git rev-parse -q --verify preview >/dev/null 2>&1; then
    log "Pushing local preview -> origin/preview ..."
    git push origin preview
  else
    log "No local 'preview' branch; refreshing /changes from origin/preview as-is."
  fi
  log "Refreshing medivasc.in/changes needs a main deploy (the env is main-only)."
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    log "Dispatching a main deploy via gh ..."
    if gh workflow run deploy.yml --ref main; then
      log "Dispatched. Watch: gh run list --workflow deploy.yml"
      return 0
    fi
    log "gh dispatch failed."
  fi
  log "gh not authenticated here — refresh /changes with an empty main deploy"
  log "(works over your normal git push):"
  log "  git commit --allow-empty -m 'ci: refresh /changes' && git push origin main"
}

cmd_ship() {
  yes=""
  for a in "$@"; do [ "$a" = "--yes" ] && yes=1; done
  require_clean_tree
  git fetch -q origin main preview
  git rev-parse -q --verify origin/preview >/dev/null 2>&1 || { log "No origin/preview to ship."; exit 1; }
  if [ "$(git rev-parse origin/main)" = "$(git rev-parse origin/preview)" ]; then
    log "Nothing to ship — preview == main."; exit 0
  fi
  orig=$(git rev-parse --abbrev-ref HEAD)
  tmp="ship-$(git rev-parse --short origin/preview)"
  git branch -f "$tmp" origin/preview
  # Replay preview's commits on top of the latest main so the push to main is a
  # clean linear fast-forward (main requires linear history).
  if ! git rebase origin/main "$tmp"; then
    git rebase --abort 2>/dev/null || true
    git checkout -q "$orig"; git branch -D "$tmp" 2>/dev/null || true
    log "Rebase onto main conflicts — resolve by hand, then push the result to main."
    exit 1
  fi
  log "Validating merged content (node src/build.js) ..."
  node src/build.js >/dev/null
  log ""
  log "Will promote to main:"
  git log --oneline origin/main.."$tmp" >&2
  if [ -z "$yes" ]; then
    git checkout -q "$orig"; git branch -D "$tmp"
    log ""
    log "Dry run — nothing pushed. Promote for real with: tools/preview.sh ship --yes"
    exit 0
  fi
  git push origin "$tmp:main"        # fast-forward; the pre-push hook allows this
  git checkout -q "$orig"; git branch -D "$tmp"
  log "Shipped to main. Re-syncing preview to the new main ..."
  cmd_sync
}

case "${1:-}" in
  status)  cmd_status ;;
  sync)    cmd_sync ;;
  publish) shift; cmd_publish "$@" ;;
  ship)    shift; cmd_ship "$@" ;;
  *) log "usage: tools/preview.sh {status | sync | publish | ship [--yes]}"; exit 2 ;;
esac
