#!/usr/bin/env bash
# templeforge ship: branch off fresh main -> commit (no AI signature) -> push ->
# open-or-update the MR. Zero-dep beyond git + glab. Portable: if glab is absent,
# falls back to the node GitLab client (lib/gitlab.mjs) via fetch.
#
#   ship.sh --slug feat/x --title "fix(x): y" --desc /path/desc.md \
#           [--message "commit msg"] [--project group/repo] [--target main]
#
# If --message is omitted, assumes changes are already committed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="" TITLE="" DESC="" MSG="" PROJECT="" TARGET="main"
while [ $# -gt 0 ]; do
  case "$1" in
    --slug) SLUG="$2"; shift 2;;
    --title) TITLE="$2"; shift 2;;
    --desc) DESC="$2"; shift 2;;
    --message) MSG="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    --target) TARGET="$2"; shift 2;;
    *) echo "ship.sh: unknown arg $1" >&2; exit 2;;
  esac
done
[ -n "$SLUG" ] && [ -n "$TITLE" ] && [ -n "$DESC" ] || { echo "ship.sh: --slug, --title, --desc required" >&2; exit 2; }
[ -f "$DESC" ] || { echo "ship.sh: desc file not found: $DESC" >&2; exit 1; }

# Provider routing: this script's fast-path is GitLab + glab. For GitHub or any
# non-gitlab remote, delegate to the provider-agnostic node router (ship.mjs).
ORIGIN="$(git remote get-url origin 2>/dev/null || true)"
case "$ORIGIN" in
  *github*)
    ARGS=(--slug "$SLUG" --title "$TITLE" --desc "$DESC")
    [ -n "$MSG" ] && ARGS+=(--message "$MSG")
    [ -n "$PROJECT" ] && ARGS+=(--project "$PROJECT")
    [ "$TARGET" != "main" ] && ARGS+=(--target "$TARGET")
    exec node "$HERE/ship.mjs" "${ARGS[@]}"
    ;;
esac

# Guard: never commit gitignored build/dist artifacts.
OFFENDERS="$(git diff --cached --name-only | grep -E '(^|/)(build|dist)/' || true)"
if [ -n "$OFFENDERS" ]; then
  echo "ship.sh: refusing to commit gitignored build artifacts:" >&2
  printf '  %s\n' "$OFFENDERS" >&2
  exit 1
fi

CUR="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CUR" != "$SLUG" ]; then
  git checkout "$TARGET" >/dev/null 2>&1 || true
  git pull --ff-only >/dev/null 2>&1 || true
  git checkout -b "$SLUG" 2>/dev/null || git checkout "$SLUG"
fi

# Commit only if a message was given and something is staged.
if [ -n "$MSG" ] && ! git diff --cached --quiet; then
  # Case-insensitive, whitespace-tolerant AI-signature guard. A plain shell
  # `case` glob is case-sensitive, so `co-authored-by` would slip through.
  if printf '%s' "$MSG" | grep -Eiq 'co[-_ ]?authored[-_ ]?by|generated with|🤖'; then
    echo "ship.sh: refusing AI signature in commit message" >&2; exit 1
  fi
  git commit -m "$MSG" >/dev/null
fi

git push -u origin "$SLUG" >/dev/null 2>&1 || git push >/dev/null 2>&1 || true

# Open or update the MR. Prefer glab ONLY when it is also authenticated; an
# installed-but-unauthed glab would crash mid-flow, so fall back to the node
# client (REST via GITLAB_TOKEN) in that case.
if command -v glab >/dev/null 2>&1 && glab auth status >/dev/null 2>&1; then
  EXISTING="$(glab mr view "$SLUG" -F json 2>/dev/null || true)"
  if printf '%s' "$EXISTING" | grep -q '"iid"'; then
    glab mr update "$SLUG" --description "$(cat "$DESC")" --title "$TITLE" >/dev/null
  else
    glab mr create --source-branch "$SLUG" --target-branch "$TARGET" \
      --title "$TITLE" --description "$(cat "$DESC")" --yes >/dev/null
  fi
  # MR url contains /merge_requests/ — filter on that so we never grab the author url.
  URL="$(glab mr view "$SLUG" -F json 2>/dev/null \
          | grep -oE '"web_url":[[:space:]]*"[^"]+/merge_requests/[0-9]+"' \
          | head -n1 | sed -E 's/.*"web_url":[[:space:]]*"([^"]+)".*/\1/')"
  echo "${URL:-opened MR for $SLUG (run: glab mr view $SLUG)}"
else
  [ -n "$PROJECT" ] || { echo "ship.sh: --project required when glab is absent" >&2; exit 2; }
  node "$HERE/mr.mjs" "$PROJECT" "$SLUG" "$TARGET" "$TITLE" "$DESC"
fi
