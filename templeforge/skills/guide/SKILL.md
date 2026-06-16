---
name: guide
description: Walk the user through setting up templeforge — checking node/git, generating a provider token (GITLAB_TOKEN / GITHUB_TOKEN / BITBUCKET / GITEA / AZURE), the optional WRIKE_TOKEN, and an optional per-repo template. Use when the user asks how to set up templeforge, configure tokens, or says "templeforge guide", "setup guide", "como instalar o templeforge".
---

# templeforge setup guide

templeforge is pure node — no browser, no heavy download. Setup is: confirm
node + git, generate ONE provider token for the forge you use, optionally a
Wrike token, optionally a per-repo template.

## What to do

1. **Confirm the basics** — `node --version` (18+) and `git --version`. Both are
   the only hard requirements.

2. **Generate a provider token** for the forge behind your `origin` remote (only
   one needed; the native CLI path skips it):

   | Provider | Token | Where |
   |---|---|---|
   | GitLab | `GITLAB_TOKEN` | Settings → Access Tokens, scope `api` (or `glab auth login`) |
   | GitHub | `GITHUB_TOKEN` | Settings → Developer settings → PAT, scope `repo` (or `gh auth login`) |
   | Bitbucket | `BITBUCKET_TOKEN`, or `BITBUCKET_USERNAME`+`BITBUCKET_APP_PASSWORD` | Personal settings → App passwords, scope `pullrequest:write` |
   | Gitea/Forgejo | `GITEA_TOKEN` (+ `GITEA_HOST` if self-hosted) | Settings → Applications → Generate Token, scope `write:repository` |
   | Azure DevOps | `AZURE_DEVOPS_TOKEN` | User settings → Personal access tokens, scope Code Read & Write |

   Put it in the shell env (e.g. `export GITLAB_TOKEN=...` in your shell rc, or a
   local untracked env file) — never in a committed file.

3. **Optional Wrike linkback** — `WRIKE_TOKEN` from Wrike → Apps & Integrations →
   API. Without it, the `wrike` top line still renders; only the linkback comment
   is skipped.

4. **Optional per-repo template** — `node <plugin>/scripts/mr-build.mjs --init-template`
   writes `.templeforge/template.json`. Edit its sections and rules to fit the
   team's request format.

5. **First request** — write `summary.md` / `changes.md`, a `manifest.json`, then
   `node <plugin>/scripts/ship-flow.mjs manifest.json --dry-run` to preview, drop
   `--dry-run` to ship.

## Neutral self-hosted host

If `origin` is a self-hosted forge with a neutral name (e.g. `git.acme.io`),
templeforge defaults to GitLab. Set `TEMPLEFORGE_PROVIDER=gitea|github|...` to
override.
