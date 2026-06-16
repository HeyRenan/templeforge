# Changelog

All notable changes to templeforge are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

templeforge forges merge/pull requests from templates — one command branches,
commits, renders a validated description, and opens the request on any supported
forge, with an optional Wrike linkback.

## [Unreleased]

## [1.0.0] — 2026-06-16

First stable release.

### Added
- **Template engine** (`mr-build`): a request description is assembled from a
  JSON template (top line, ordered sections, rules) plus one markdown body per
  section. Rules: `maxSentences`, `minSentences`, `mustHaveCodeBlock`,
  `mustMatch`; global `noEmoji`, `requireWrike`, `denySections`. Violations are
  rejected BEFORE the request opens.
- **`{var}` substitution**: `--var key=value` (and `{wrike_url}`) interpolate
  into the top line and every section body.
- **One-command flow** (`ship-flow`): forge (render + validate) → ship
  (branch/commit/push/open) → wrike-link, driven by a manifest, `--dry-run`
  aware, ends `DONE <url>`.
- **Five providers**, one uniform driver contract, detected from the `origin`
  remote: GitLab (merge request), GitHub, Bitbucket, Gitea/Forgejo/Codeberg and
  Azure DevOps (pull request). GitLab/GitHub use their native CLI when present,
  else zero-dep REST. `TEMPLEFORGE_PROVIDER` overrides a neutral self-hosted host.
- **Neutral vocabulary**: output says "merge request" on GitLab and "pull
  request" everywhere else.
- **Strictness levels** (`loose`/`rich`/`strict`): gate how hard ship-flow lints
  the manifest. Machine-wide default via `strictness` (the script-owned switch).
- **Wrike linkback**: optional top line + a linkback comment when `WRIKE_TOKEN`
  is set.
- **`--init-template`**: copy the built-in template to `.templeforge/template.json`
  to customize per repo.
- 62 tests, no network or browser needed.

[Unreleased]: https://github.com/HeyRenan/templeforge/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/HeyRenan/templeforge/commits/main
