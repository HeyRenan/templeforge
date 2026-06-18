# Changelog

All notable changes to templeforge are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

templeforge forges merge/pull requests from templates — one command branches,
commits, renders a validated description, and opens the request on any supported
forge, with an optional Wrike linkback.

## [Unreleased]

### Fixed
- **Open skill used repo-relative script paths.** The skill told the agent to run
  `node scripts/ship-flow.mjs` (and mr-build/strictness) — but the agent runs in
  the *user's* repo, where `scripts/` doesn't exist, so it would `ENOENT`. The
  paths now use the `<plugin>/scripts/…` form the command file already used.
- **Agent flow no longer hardcodes `main` as the base branch.** The open command
  and skill instructed `git checkout main` for step 1 — which fails on a repo whose
  default is `master` or custom, contradicting the default-branch resolution the
  drivers already do. They now resolve the real default (`origin/HEAD`, falling
  back to `main`) before branching.
- **Gitea no longer duplicates an existing PR on busy repos.** `findOpenPR`
  listed open PRs and matched the branch client-side, but Gitea's list endpoint
  paginates (~30/page) with no head filter — so on a repo with many open PRs the
  existing one was missed and ship opened a duplicate instead of updating. It now
  uses Gitea's exact `pulls/{base}/{head}` lookup (server-side, no pagination),
  resolving the base from the target/default branch; the list scan remains only as
  a fallback when the base is unknown.
- **GitLab now resolves the project's default branch.** `gitlab.mjs` was the only
  driver missing `getDefaultBranch`, so ship always fell back to `main` for GitLab
  — opening the MR against a non-existent target on repos whose default is
  `master` or custom. Added it (`GET /projects/:id` → `default_branch`), completing
  the uniform driver contract; fixed the now-stale `host.mjs` contract comment.
- **Friendly manifest load errors** (`ship-flow`). A missing manifest path or a
  JSON typo surfaced as a raw `ENOENT` / `SyntaxError`; a new `loadManifest()`
  reports `manifest not found: <path>` and `manifest is not valid JSON (<path>): …`.
- **Manifest type checks** (`ship-flow`). `validateManifest` now rejects a
  `sections` that isn't a non-empty `id -> string-path` map (an array or
  non-string values slipped through and `Object.entries` later produced garbage
  `--section`/`readFileSync` calls) and a `vars` that isn't an object map — a
  common `"vars": "k=v"` typo used to expand into one bogus var per character.
- **Self-managed / Enterprise hosts now work over REST.** The REST drivers read
  their API host from `$GITLAB_HOST`/`$GITHUB_HOST`/`$GITEA_HOST` at import and
  ignored the host `detectHost` parsed from the `origin` remote — so a
  `gitlab.acme.com` (or GHE, or self-hosted Gitea) remote sent every REST call to
  `gitlab.com`/`api.github.com`/`codeberg.org`. The router now points each driver
  at the detected host (`setHost`), with the env var as an override. (Native
  `glab`/`gh` paths were unaffected; this was the zero-CLI fallback.)
- **Azure remotes detected from `origin` now work.** A real Azure remote is
  `dev.azure.com/{org}/{project}/_git/{repo}`; `parseRemote` kept the `_git` path
  segment, so `azure.splitRepo` produced `repo: "_git/repo"` and every API call
  404'd. `splitRepo` now drops the `_git` segment. Added `detectHost` routing
  tests (incl. this Azure case) — previously untested.
- **`strictness.mjs` is now import-safe.** Its whole CLI body ran at module load
  with no main-guard — importing it would *write the global strictness file* and
  call `process.exit` as a side effect. The body now lives in a guarded `main()`,
  matching every other script.
- **A malformed `denySections` no longer crashes the build** (`mr-build`). A
  non-array value, or a stray non-string entry (e.g. `[123]` / `[null]` from a
  missed quote), threw `bad.replace is not a function`; entries are now validated
  (must be an array of non-empty strings) and bad ones are skipped.
- **An invalid `mustMatch` regex no longer crashes the build** (`mr-build`). A
  typo'd author regex (e.g. `([unclosed`) threw a raw `SyntaxError` and killed the
  run; it's now caught and reported as a normal validation error. (A template with
  no `name` also reports as its file name instead of `"undefined"`.)
- **Actionable "no origin remote" error.** Running outside a git repo (or one with
  no `origin`) said only `No origin remote URL to parse.`; it now tells the user to
  run inside a repo whose `origin` points at the forge.
- **Clear error when a section file is missing** (`mr-build`). A manifest pointing
  a section at a non-existent file surfaced a raw `ENOENT: … open 'NOPE.md'`; it now
  reads `section "summary" points to a file that can't be read: NOPE.md`.
- **Clear error for a malformed template** (`mr-build`). A hand-edited
  `.templeforge/template.json` missing or mistyping `sections` used to fail with a
  raw `template.sections is not iterable` deep in the assemble loop. A new
  `assertTemplate()` validates the shape right after parse and reports exactly
  what's wrong. It now covers the **whole** template contract in one place —
  `sections` (array of `id`+`title`), each section's `rules`
  (`maxSentences`/`minSentences` positive numbers, `mustHaveCodeBlock` boolean,
  `mustMatch` string), and `global` (`denySections` array of strings,
  `noEmoji`/`requireWrike` booleans) — so a typo in any rule fails fast with a
  precise message instead of crashing mid-validate. (Runtime guards in
  `validate`/`assemble` remain for direct programmatic use.)
- **Refuse to commit/push on the wrong branch** (`ship.mjs`). The branch checkout
  was best-effort (`checkout -b slug` then `checkout slug`, both error-swallowed):
  if a dirty tree or a pre-existing branch made both fail, ship silently stayed on
  the current branch (often `main`) and committed + pushed there. `gitInit` now
  asserts HEAD is the slug branch and aborts loudly otherwise. `gitPush` likewise
  throws if the push truly fails instead of swallowing it and opening the request
  against an unpushed branch.
- **`splitRepo` ignores empty path segments** (Bitbucket, Gitea, Azure): a
  `project` carrying a trailing slash (e.g. a hand-written manifest `"acme/repo/"`,
  which never passes through `parseRemote`'s normalization) leaked the slash into
  the repo name → malformed API paths. Azure's strict `org/project/repo`
  validation still rejects genuinely short forms.
- **Wrike linkback HTML-escapes the url** (`wrike-link`): the request url is
  interpolated into an `<a href>` in a Wrike (HTML) description. An unescaped `&`
  in a query string broke the attribute — and idempotency, since the stored
  `&amp;` no longer matched the raw url on the next run, re-appending the block
  every time. The url is now escaped, the idempotency probe matches the escaped
  form, and a stray quote/bracket can no longer break out of the attribute.
- **`parseTaskId` trims surrounding whitespace** before classifying — `"  123  "`
  is now a numeric id, not a string API id (which would have hit `/tasks/  123  `).
- **Wrike linkback prints the real task permalink, consistently.** The two exit
  paths (link-already-present vs description-updated) hand-built the result url
  differently — the already-present path emitted a broken `…/open.htm?id` for a
  task referenced by API id. Both now prefer the API's own `permalink` field (fetched
  alongside the description) with a single consistent fallback.
- **`parseTaskId` rejects a URL-shaped input without `?id=<digits>`** instead of
  treating the whole URL as an API id (which sent `GET /tasks/https://…` to Wrike).
  A malformed permalink now fails up front with a clear `could not read a task id`
  message; genuine API ids (no `/ : ?`) still pass.
- **Remote URL parsing edge cases** (`parseRemote`):
  - `https://user@host/…` / `https://user:token@host/…` now strip the userinfo
    from the detected host (was `host: "user@github.com"`, polluting `webBase`
    and provider detection).
  - `…/repo.git/` (`.git` followed by a trailing slash) now yields `repo`, not
    `repo.git` — slashes are trimmed before the `.git` suffix.
- **No more orphan top line.** A `topLine` like `Wrike: {wrike_url}` rendered a
  bare `Wrike: ` label when the manifest omitted `wrike` (a documented, valid
  case). `assemble` now drops a top line whose placeholders all resolve empty;
  a static line, or one with any filled value, is kept — and `requireWrike` still
  hard-fails an empty url independently.
- **No more bare section headings.** An optional section handed an empty or
  whitespace-only body rendered a dangling `## Heading` with nothing under it.
  `assemble` now skips empty bodies; a required-but-empty section is still
  rejected by `validate` before the request opens (the two paths are independent).
- **Gitea request url extraction.** `ship-flow` parsed the opened-request url with
  a pattern that knew GitLab/GitHub/Bitbucket/Azure but not Gitea's `/pulls/<n>`,
  so Gitea PRs fell through to a loose "first url" guess — breaking the final
  `DONE <url>` and the wrike-link stage. The matcher now covers all five shapes
  (longest-segment-first so `pull` can't shadow `pulls`/`pull-requests`), lifted
  into a tested `extractRequestUrl()`.
- **Five-provider routing through the main flow.** `ship-flow` now ships via
  `ship.mjs` (the provider-agnostic driver) instead of `ship.sh`, which only knew
  GitLab and GitHub — Bitbucket, Gitea, and Azure remotes were silently funneled
  to the GitLab client. The advertised five providers now all work end to end.
- **`ship.mjs` no longer runs on import** (guarded `main()`), so its helpers are
  importable and unit-testable; removed a dead `HERE` binding.

### Changed
- **The open command now says what to do with its `$ARGUMENTS` intent.** The
  command captured an optional intent but neither it nor the skill said how to use
  it; it now states the intent derives the branch slug, request title, and
  implementation scope (and is inferred from the branch when absent).
- **Consistent error-message prefixes.** `ship.mjs` prefixed its errors with
  `ship.mjs:` while every other script used `<name>:` (no extension). Standardized
  to `ship:` so logs/CI scrapes read uniformly across all five commands.
- **ship-flow notes the rendered description artifact.** `mr-desc.md` is written
  into the working dir and left there (it's the body that was sent); ship-flow now
  prints a one-line note that it's a generated artifact to gitignore, so it isn't
  committed by accident via a blind `git add .`.
- **Docs name `WRIKE_TOKEN` for the linkback.** README and the open skill described
  the optional Wrike linkback but never named the env var that enables it — users
  set `wrike` in the manifest and wondered why nothing was posted. Both now state
  the linkback is posted only when `WRIKE_TOKEN` is set (otherwise the MCP calls
  are printed). Also documented self-managed/Enterprise host support across the
  README, INSTALL and the open skill (the drivers target the remote's host).
- **Corrected stale comments to match the code.** The gitlab/github/gitea file
  headers still claimed the host came only from `$*_HOST`/the cloud default,
  contradicting the actual resolution (detected remote → env → default) added with
  self-managed support. Also: `host.mjs` documented the `detectHost` return shape
  without its `term` field, and `ship.mjs`'s header read as GitLab/GitHub-only when
  it routes all five forges. Also: ship's target-resolution comment still said
  "GitLab MRs default to main" when GitLab now resolves its real default branch
  like every driver. All now match the code.
- **Strictness is its own domain module** (`lib/strictness.mjs`): the levels, the
  global store path, and `readStrictnessDefault` moved out of `ship-flow.mjs`. The
  strictness CLI imports them from there instead of reaching into the orchestrator
  for two constants; `ship-flow` re-exports them for compatibility.
- **Native CLI paths now report created/updated**, matching the REST path. The
  `glab`/`gh` fast paths printed only the final url; they now also emit
  `merge/pull request created|updated via glab|gh` on stderr, so the feedback is
  consistent regardless of which path opened the request.
- **Readable, consistent API error messages across all drivers.** Only the GitHub
  driver extracted the human `message`/`errors` from an error body; GitLab,
  Bitbucket, Gitea and Azure dumped raw JSON (`{"message":"401 Unauthorized"}`
  instead of `401 Unauthorized`). The response-body parsing + error-detail logic —
  the genuinely identical part repeated in all five `req()` functions — now lives
  in one tiny zero-dep `lib/rest.mjs` (`parseBody`, `errorDetail`); each driver
  still owns its own fetch/url/auth, so the providers stay independent.
- **`ship-flow` propagates a failing stage's exit code** (and prints it in the
  `FAILED (exit N)` line) instead of always exiting `1` — cleaner CI gating and
  log scraping. The failing stage's own stderr still streams live.
- **`ship.sh` is now a thin shim** that execs `ship.mjs`. The ship logic lives in
  exactly one place, ending the drift between the two implementations (commit
  guards, AI-signature refusal, draft handling).

### Removed
- **Ghost `uploadFile` references.** `github.mjs`'s export list and `host.mjs`'s
  contract comment both advertised an `uploadFile()` that was never implemented or
  called. Removed the dead doc so the documented surface matches the real one.
- **`scripts/mr.mjs`** — a GitLab-only, untested helper that existed solely as
  `ship.sh`'s portable fallback. With `ship.sh` collapsed into a shim, nothing
  referenced it; `ship.mjs` already covers GitLab (and every other provider) via
  `lib/gitlab.mjs`.

### Added
- **CLI exit-contract tests for every command** (mr-build, ship-flow, wrike-link;
  strictness already had them). The documented exit codes and user-facing messages
  are now covered end to end via spawned processes — the wiring the pure-function
  tests couldn't reach. mr-build: 0 PASS / 2 usage / 1 error (required-section,
  unreadable-section-file). ship-flow: 2 usage & bad-manifest, 0 dry-run (prints
  the plan), and a failing stage stops before `ship` with a non-zero exit (the CI
  gate). wrike-link: input guards exit 2; with no token it prints the offline MCP
  plan and exits 0.
- **Driver tests with a stubbed `fetch`** — the previously-untested core of every
  provider (find → create/update, response mapping to `{web_url, iid, action}`,
  create-vs-update selection, and the shared readable error message) is now
  covered without touching the network, including Gitea's exact `pulls/{base}/{head}`
  lookup. Guards against silent regressions in request/response shape.
- **Draft requests**, wired end to end across ALL five providers: manifest
  `"draft": true` → `ship-flow` → `ship.mjs`. A single `applyDraft(provider,…)`
  policy resolves the right mechanism per forge — GitHub / Bitbucket / Azure use
  the native draft flag; GitLab (`Draft:`) and Gitea/Forgejo (`WIP:`) use an
  idempotent title prefix (those forges have no draft flag). Covered by tests for
  `applyDraft` on every provider and the ship-flow draft plumbing.

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
