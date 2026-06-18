# templeforge

[![ci](https://github.com/HeyRenan/templeforge/actions/workflows/ci.yml/badge.svg)](https://github.com/HeyRenan/templeforge/actions/workflows/ci.yml)
&nbsp;[![tests](https://img.shields.io/badge/tests-123%20passing-brightgreen)](#tests)
&nbsp;[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Read in:** English · [Português](README.pt-BR.md)

A [Claude Code](https://claude.com/claude-code) plugin that forges merge/pull
requests from **templates**. One command branches, commits, renders a validated
description from your template, opens the request on whatever forge you use, and
drops an optional Wrike linkback. Zero dependencies, no MCP, provider-agnostic.

templeforge does exactly one job: turn a template + your section bodies into a
well-formed request. It does not capture screenshots, record video, or run any
other tool — a section body is whatever text you wrote.

## Why

Opening a request by hand drifts: inconsistent sections, missing ticket links,
the format every reviewer quietly re-requests. templeforge makes the format
**data** — a template the motor enforces before the request ever opens — and
makes the act **one command** across GitLab, GitHub, Bitbucket, Gitea and Azure.

## How it works

```
manifest.json ──► forge ──► ship ──► wrike-link ──► DONE <url>
                  │         │        │
                  │         │        └─ optional linkback comment on the Wrike task
                  │         │           (posted when WRIKE_TOKEN is set)
                  │         └─ branch · commit · push · open MR/PR (provider-detected)
                  └─ render description from template + section bodies + vars,
                     validate against the template's rules (reject before opening)
```

## Quick start

```bash
# 1. write one markdown file per template section
echo "Adds X so users can Y." > summary.md
echo "- touched a.js, b.js" > changes.md

# 2. describe the request
cat > manifest.json <<'JSON'
{
  "wrike": "https://www.wrike.com/open.htm?id=1234",
  "title": "feat: add X",
  "slug": "feat/add-x",
  "sections": { "summary": "summary.md", "changes": "changes.md" }
}
JSON

# 3. preview, then ship
node scripts/ship-flow.mjs manifest.json --dry-run
node scripts/ship-flow.mjs manifest.json
# -> DONE https://.../merge_requests/42
```

Provider, project and target branch are detected from your `origin` remote.
To open against a different repo, add `"project": "owner/repo"` to the manifest
(honored on both the native-CLI and REST paths).
Add `"draft": true` to the manifest to open a draft/WIP request — GitHub,
Bitbucket and Azure use the native draft flag, GitLab (`Draft:`) and Gitea
(`WIP:`) a title prefix.

## The template

A template is JSON: a top line, ordered sections, and rules. Resolution order:
`.templeforge/template.json` in the repo → `$TEMPLEFORGE_TEMPLATE` → the built-in
default.

```json
{
  "name": "default",
  "topLine": "Wrike: {wrike_url}",
  "global": { "noEmoji": true, "requireWrike": false, "denySections": ["Checklist", "TODO"] },
  "sections": [
    { "id": "summary", "title": "Summary", "required": true, "rules": { "maxSentences": 4 } },
    { "id": "changes", "title": "Changes", "required": true },
    { "id": "testing", "title": "Testing", "required": false, "rules": { "minSentences": 1 } }
  ]
}
```

| Section rule | Effect |
|---|---|
| `maxSentences` / `minSentences` | bound the prose (code blocks are ignored) |
| `mustHaveCodeBlock` | require a fenced block (e.g. the commands to run) |
| `mustMatch` | require a regex (e.g. a ticket id `AB-\d+`) |

| Global rule | Effect |
|---|---|
| `noEmoji` | reject any emoji anywhere |
| `requireWrike` | fail if the `{wrike_url}` top line is empty |
| `denySections` | reject named headings (e.g. an off-template "TODO") |

`{wrike_url}` and any `{var}` you pass with `--var key=value` are substituted in
the top line and every body. Violations are printed and the request does **not**
open. Copy the built-in to start your own:

```bash
node scripts/mr-build.mjs --init-template   # writes .templeforge/template.json
```

## Providers

The provider comes from the `origin` remote — one uniform driver contract per
forge. GitLab and GitHub use their native CLI (`glab` / `gh`) when present and
authed, else zero-dep REST.

| Provider | Says | Token env |
|---|---|---|
| GitLab | merge request | `GITLAB_TOKEN` (or `glab auth login`) |
| GitHub | pull request | `GITHUB_TOKEN` (or `gh auth login`) |
| Bitbucket | pull request | `BITBUCKET_TOKEN`, or `BITBUCKET_USERNAME`+`BITBUCKET_APP_PASSWORD` |
| Gitea / Forgejo / Codeberg | pull request | `GITEA_TOKEN` (+ `GITEA_HOST`) |
| Azure DevOps | pull request | `AZURE_DEVOPS_TOKEN` (project is `org/project/repo`) |

A neutral self-hosted host (e.g. `git.acme.io`) defaults to GitLab; set
`TEMPLEFORGE_PROVIDER` to override.

Self-managed GitLab, GitHub Enterprise and self-hosted Gitea/Forgejo work out of
the box — the REST drivers target the host from your `origin` remote. Set
`GITLAB_HOST` / `GITHUB_HOST` / `GITEA_HOST` only to override that (e.g. when the
API lives on a different host than the git remote).

## Strictness

`strictness` (`loose` / `rich` / `strict`) gates how hard ship-flow lints the
manifest — separate from the template's own hard validation. Set the machine-wide
default with the script-owned switch (or `/templeforge:strictness`):

```bash
node scripts/strictness.mjs strict   # STRICTNESS strict
```

## Commands

| Command | Does |
|---|---|
| `/templeforge:open` | open a merge/pull request from a template |
| `/templeforge:strictness [loose\|rich\|strict]` | set the global lint strictness |
| `/templeforge:guide` | walk through token + template setup |

## Tests

```bash
node --test 'scripts/__tests__/*.test.mjs'   # 123 tests, no network or browser
```

## Install

See [INSTALL.md](INSTALL.md).

## License

[MIT](LICENSE)
