#!/usr/bin/env bash
# templeforge ship (back-compat shim).
#
# The real ship logic — branch off fresh target, commit (no AI signature), push,
# open-or-update the request — lives in ship.mjs, which routes ALL providers
# (GitLab / GitHub / Bitbucket / Gitea / Azure) via lib/host.mjs. This shim only
# exists so the documented `bash ship.sh ...` entry point keeps working; it
# forwards every flag verbatim to node ship.mjs. Prefer calling ship.mjs directly.
#
#   ship.sh --slug feat/x --title "fix(x): y" --desc /path/desc.md \
#           [--message "msg"] [--project group/repo] [--target main] [--draft]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/ship.mjs" "$@"
