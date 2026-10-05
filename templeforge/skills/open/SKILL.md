---
name: open
description: Use when opening a merge/pull request, shipping a finished change for review, or when the user says "abrir MR", "open MR", "open PR", "ship this for review". Renders the description from a template and opens or updates the request on GitHub, GitLab or Bitbucket, with an optional Wrike linkback.
allowed-tools: Bash(node *templeforge.mjs*), Bash(git status*), Bash(git add *), Bash(git commit *)
---

# templeforge open

The script does the work: git, template, validation, push, API, Wrike. Two calls.

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/templeforge.mjs" context
```

1. **Read `context`.** It prints provider, auth, branch, base, commits, changed
   files, and the template's sections, rules and hints.
   - `auth MISSING` → stop, tell the user the printed fix.
   - `uncommitted` > 0 → commit the work first: `git add <files> && git commit -m "<type>(<scope>): <summary>"`.
     No AI signature, no co-author line.
2. **Write the sections** to satisfy every rule and hint. English unless the repo
   says otherwise. Use only the template's section ids.
3. **Open:**

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/templeforge.mjs" open <<'JSON'
   {"title":"feat(x): add y","slug":"feat/add-y","wrike":"https://www.wrike.com/open.htm?id=123",
    "sections":{"summary":"...","testing":"..."}}
   JSON
   ```

   Optional keys: `slug` (defaults to the current branch; required on the base
   branch), `wrike`, `draft` (bool), `vars` (`{name}` placeholders).
4. **Read the result:**
   - `FAIL template ...` → fix the listed sections, run `open` again. Nothing was pushed.
   - `FAIL <other>` → fix the cause (branch, push, API), run `open` again. It is idempotent.
   - `DONE <url>` → give the user the url.
   - `WRIKE todo ...` → with the Wrike MCP, append the given HTML to that task's
     description unless the link is already there.
