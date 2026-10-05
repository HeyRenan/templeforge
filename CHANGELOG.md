# Changelog

## [2.0.0] — 2026-10-05

A rewrite around one script, so the agent opens a request in two calls.

### Changed
- **One CLI, `scripts/templeforge.mjs`.** `context` prints the repo, auth,
  branch, commits and the template's rules and hints. `open` reads the request
  as JSON on stdin, then validates, branches, pushes, opens or updates the
  request, and links Wrike. There are no manifest, section or `mr-desc.md`
  files in the user's repo anymore.
- **Config lives in the plugin data dir.** The personal template moved from
  `$TEMPLEFORGE_TEMPLATE` / `~/.claude/templeforge/` to
  `$CLAUDE_PLUGIN_DATA/template.json`, which survives plugin updates. No shell
  rc changes needed.
- **REST only.** GitHub and GitLab reuse the `gh` / `glab` login token. Only open
  requests are matched, so a reused branch name no longer edits a merged PR/MR.
- **Bitbucket auth** uses `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN` (Atlassian
  API token) or `BITBUCKET_TOKEN`, replacing app passwords.
- **Base branch** comes from `origin/HEAD` (or `git ls-remote`), with no API call.
- `context` and `open` fetch the base branch first, so the commit list and the
  "no commits ahead" check are not stale.
- **Template `hint` fields** (template, global, section) are shown to the agent.
- **Unknown section ids** are a validation error.

### Fixed
- The branch step now keeps the commits from the current feature branch. Before,
  it branched off the base and left them out.
- `open` refuses a branch with no commits ahead of the base before pushing.
- Wrike permalinks resolve through `GET /tasks?permalink=`, and the API host
  follows the permalink's host.
- `noEmoji` no longer rejects arrows and other plain symbols.
- Scripts no longer exit silently when the plugin path has spaces or symlinks.

### Removed
- Gitea/Forgejo and Azure DevOps drivers.
- Strictness levels and `/templeforge:strictness`. Use the template rules
  `requireWrike` and `required` sections instead.
- `/templeforge:guide`. `context` reports missing auth and the fix.
- `TEMPLEFORGE_TEMPLATE`, `TEMPLEFORGE_PROVIDER`, `GITLAB_HOST`, `GITHUB_HOST`,
  `WRIKE_HOST`, `ship.sh`, `ship-flow.mjs`, `mr-build.mjs`, `wrike-link.mjs`.

## 1.x

See the `v1.0.0` and `v1.0.1` tags.
