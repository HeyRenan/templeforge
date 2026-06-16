---
description: Open a merge request / pull request from a template (GitLab, GitHub, Bitbucket, Gitea, Azure DevOps)
argument-hint: "[optional: branch/slug or short intent]"
allowed-tools: Bash(node *ship-flow.mjs*), Bash(node *mr-build.mjs*), Bash(bash *ship.sh*), Bash(git *)
---

Open a merge/pull request with templeforge. Load the plugin's `open` skill and
follow it.

Intent (optional): `$ARGUMENTS`

The flow: branch off fresh main → implement/commit (no AI signature) → write one
markdown file per template section → write `manifest.json` → `node <plugin>/scripts/ship-flow.mjs manifest.json`
(forge → ship → wrike-link), ending `DONE <url>`. Use `--dry-run` first to
preview the stages. templeforge only renders the template and opens the request —
it does not capture screenshots or video; a section body is whatever you wrote.
