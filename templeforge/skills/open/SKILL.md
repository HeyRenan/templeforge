---
name: open
description: Use when opening a merge request or pull request, shipping a finished change for review, or when the user says "abrir MR", "open MR", "open PR", "create the merge request", "ship this for review", or invokes /templeforge:open. Branches, commits, renders the description from a template, and opens the request on GitLab / GitHub / Bitbucket / Gitea / Azure DevOps, with an optional Wrike linkback.
---

# templeforge

## Overview

templeforge opens a merge request (GitLab) or pull request (GitHub, Bitbucket,
Gitea/Forgejo, Azure DevOps) from a **template**. It branches, commits, pushes,
renders a validated description from your template + section bodies, opens the
request, and (optionally) drops a linkback comment on a Wrike task.

templeforge does ONE job: turn a template into a well-formed request. It knows
nothing about screenshots, video, or any other tool. A section body is whatever
you wrote — text, links, a table, code. If you want a body to contain output
from some other tool, run that tool yourself and paste the result; templeforge
just renders and ships what you give it.

**Write the request in English** — title, sections, commit messages — unless the
repo's own convention says otherwise. Quoted product UI copy stays in its
original language.

Scripts live in this plugin's `scripts/` dir. The provider is detected from the
`origin` remote; override a neutral self-hosted host with `$TEMPLEFORGE_PROVIDER`.

## The template

A template is JSON: a top line, ordered sections, and rules. Resolution:
`.templeforge/template.json` in the repo → `$TEMPLEFORGE_TEMPLATE` → the built-in
`default` (Summary / Changes / Testing, Wrike top line, no emoji).

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

Section rules: `maxSentences`, `minSentences`, `mustHaveCodeBlock`, `mustMatch`
(regex). Global rules: `noEmoji`, `requireWrike`, `denySections`. Template
placeholders `{wrike_url}` and any `{var}` you pass with `--var key=value` are
substituted in the top line and every body. `mr-build` rejects violations BEFORE
the request opens — exit 0 PASS, 1 FAIL with the list.

Copy the built-in to start your own: `node scripts/mr-build.mjs --init-template`
writes `.templeforge/template.json`. Edit sections and rules there.

## The flow (manifest-first)

1. **Branch off fresh main** — `git checkout main && git pull --ff-only && git checkout -b feat/<slug>`.
2. **Implement** if not done. Match surrounding style. Commit with no AI
   signature: `git commit -m "<type>(<scope>): <summary>"`. Never commit
   gitignored `build/`/`dist/`.
3. **Write section bodies** — one markdown file per template section (`summary.md`,
   `changes.md`, `testing.md`).
4. **Write `manifest.json`**:

   ```json
   {
     "wrike": "https://www.wrike.com/open.htm?id=XXXX",
     "title": "feat: thing",
     "slug": "feat/thing",
     "project": "group/repo",
     "strictness": "rich",
     "vars": { "ticket": "AB-12" },
     "sections": { "summary": "summary.md", "changes": "changes.md", "testing": "testing.md" }
   }
   ```

   `project` is optional — omitted, it's detected from the remote. `wrike` is
   optional — omitted, there's no top line and no linkback stage.
5. **Ship** — `node scripts/ship-flow.mjs manifest.json`. ONE command chains
   forge (render + validate) → ship (branch/commit/push/open) → wrike-link. Fails
   loudly at the first broken stage, ends `DONE <url>`. `--dry-run` previews the
   stage commands.
6. **Fix lints, re-run** — ship-flow lints the manifest against its strictness
   level (`LINT <level>: <msg>` on stderr, exit 0). Fix warnings, re-run.
7. **Report** — give the request URL.

## Strictness levels

Manifest `"strictness": "loose"|"rich"|"strict"` — absent = global default, then
**rich**. Strictness gates how hard ship-flow lints the manifest (it does NOT
change what the template enforces — that's always hard-validated by mr-build).

| Level | Lint behavior |
|---|---|
| `loose` | Minimal nags. |
| `rich` (DEFAULT) | Nudges for a Wrike top line. |
| `strict` | Demands a Wrike url and at least two sections. |

**Strictness as a command** — `/templeforge:strictness <level>` (or any wording
asking to set it) runs `node scripts/strictness.mjs <level>`: validates,
persists the GLOBAL default, prints `STRICTNESS <level>`. Never write the file by
hand. It is machine-wide, never per-repo. Relay the output.

## Providers

The provider comes from the `origin` remote. Each has a zero-dep driver in
`lib/`; GitLab and GitHub also use their native CLI (`glab` / `gh`) when present
and authed, else fall back to REST.

| Provider | Term | Token env |
|---|---|---|
| GitLab | merge request | `GITLAB_TOKEN` (or `glab auth login`) |
| GitHub | pull request | `GITHUB_TOKEN` (or `gh auth login`) |
| Bitbucket | pull request | `BITBUCKET_TOKEN`, or `BITBUCKET_USERNAME`+`BITBUCKET_APP_PASSWORD` |
| Gitea/Forgejo/Codeberg | pull request | `GITEA_TOKEN` (+ `GITEA_HOST` for self-hosted) |
| Azure DevOps | pull request | `AZURE_DEVOPS_TOKEN` (project is `org/project/repo`) |

A neutral self-hosted host (e.g. `git.acme.io`) defaults to GitLab; set
`$TEMPLEFORGE_PROVIDER` to override.

## Portability rules

- No absolute personal paths (`/Users/...`), no personal hosts, no machine-local
  assumptions in anything committed or in request content.
- Tokens resolve from the user's env at runtime — never hardcode or paste one.
- No AI signature anywhere — no `Co-Authored-By`, no "Generated with".

## Red flags — STOP

- About to put a screenshot/gif/video pipeline in here → wrong plugin; templeforge
  only renders templates and opens requests. Run any capture tool yourself, paste
  its output into a section body.
- About to write the request in Portuguese → English, unless the repo says
  otherwise; quoted UI copy stays original.
- About to ship with `LINT` warnings unaddressed → fix the manifest first.
- About to add a co-author line or hardcode a credential → don't.
- About to hand-edit `.templeforge/template.json` to bypass a validation FAIL →
  fix the body, not the rule (unless the rule itself is wrong).
