---
description: Open a merge request / pull request from a template (GitLab, GitHub, Bitbucket, Gitea, Azure DevOps)
argument-hint: "[optional: branch/slug or short intent]"
allowed-tools: Bash(node *ship-flow.mjs*), Bash(node *mr-build.mjs*), Bash(node *ship.mjs*), Bash(bash *ship.sh*), Bash(git *)
---

Open a merge/pull request with templeforge. Load the plugin's `open` skill and
follow it.

Intent (optional): `$ARGUMENTS` — if given, use it to derive the branch slug and
the request title (and to scope what to implement); if empty, infer them from the
work already on the branch.

The flow: branch off the fresh default branch (often `main` — respect `master`/custom) → implement/commit (no AI signature) → write one
markdown file per template section → write `manifest.json` → `node <plugin>/scripts/ship-flow.mjs manifest.json`
(forge → ship → wrike-link), ending `DONE <url>`. Use `--dry-run` first to
preview the stages. templeforge only renders the template and opens the request —
it does not capture screenshots or video; a section body is whatever you wrote.
