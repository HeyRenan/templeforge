# templeforge

[![ci](https://github.com/HeyRenan/templeforge/actions/workflows/ci.yml/badge.svg)](https://github.com/HeyRenan/templeforge/actions/workflows/ci.yml)
&nbsp;[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A [Claude Code](https://claude.com/claude-code) plugin that opens merge/pull
requests from a **template**. It validates the description against the
template's rules, branches, pushes, opens or updates the request on GitHub,
GitLab or Bitbucket, and links it back to a Wrike task. Zero dependencies.

The agent makes two script calls. It does not run git or API calls by hand, so a
request costs few tokens.

## Install

```bash
claude plugin marketplace add HeyRenan/templeforge
claude plugin install templeforge@templeforge
```

Requires node 18+ and git. Then ask Claude to open a PR, or run `/templeforge:open`.

## Auth

| Provider | Preferred | Or set |
|---|---|---|
| GitHub (incl. Enterprise) | `gh auth login` | `GITHUB_TOKEN` |
| GitLab (incl. self-managed) | `glab auth login` | `GITLAB_TOKEN` (scope `api`) |
| Bitbucket Cloud | | `BITBUCKET_TOKEN`, or `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN` |
| Wrike (optional) | Wrike MCP | `WRIKE_TOKEN` |

templeforge reuses the token that `gh` or `glab` already stores. If you need an
env var, put it in the `env` block of `~/.claude/settings.json`, not in your
shell rc. Without `WRIKE_TOKEN`, the agent links the Wrike task through the
Wrike MCP instead.

templeforge detects the provider from the `origin` remote. A host that contains
neither `github` nor `bitbucket` is treated as GitLab.

## CLI

```bash
tf=templeforge/scripts/templeforge.mjs
node $tf context                  # repo, auth, branch, commits, template rules + hints
node $tf open [--dry-run] < req   # validate, branch, push, open/update, link Wrike
node $tf init-template [--global] # copy the built-in template to start your own
```

`open` reads one JSON object on stdin:

```json
{
  "title": "feat(cart): add coupon field",
  "slug": "feat/coupon-field",
  "wrike": "https://www.wrike.com/open.htm?id=123",
  "draft": false,
  "vars": { "ticket": "AB-12" },
  "sections": { "summary": "Adds a coupon field to checkout.", "changes": "- cart.js" }
}
```

Only `title` and `sections` are required. `slug` defaults to the current branch.
`open` validates first. If validation fails, it pushes nothing.

## Templates

templeforge uses the first template it finds:

1. `.templeforge/template.json` in the repo (shared with the team)
2. `template.json` in the plugin data dir, `~/.claude/plugins/data/templeforge-templeforge/` (your personal default, kept across plugin updates)
3. the built-in [`templates/default.json`](templeforge/templates/default.json)

Uninstalling the plugin, or removing its marketplace, deletes the data dir. Keep a copy of your personal template.

```json
{
  "name": "default",
  "topLine": "Wrike: {wrike_url}",
  "global": { "noEmoji": true, "requireWrike": false, "denySections": ["TODO"], "hint": "..." },
  "sections": [
    { "id": "summary", "title": "Summary", "required": true, "rules": { "maxSentences": 4 }, "hint": "What and why." }
  ]
}
```

| Rule | Effect |
|---|---|
| `maxSentences` / `minSentences` | bound the prose; fenced code is ignored |
| `mustHaveCodeBlock` | require a fenced block |
| `mustMatch` | require a regex match |
| `noEmoji` | reject emoji anywhere |
| `requireWrike` | require a Wrike url |
| `denySections` | reject these headings |

`hint` fields are free text. `context` passes them to the agent so it writes a
passing description on the first try. `{wrike_url}` and any `vars` are
substituted in the top line and every section.

## Tests

```bash
node --test 'tests/*.test.mjs'
```

## License

[MIT](LICENSE)
