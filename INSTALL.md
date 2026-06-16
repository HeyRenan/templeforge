# Install templeforge

A Claude Code plugin that forges merge/pull requests from templates. Pure node —
no browser, no heavy download.

## 1. Register + install (from GitHub)

```bash
claude plugin marketplace add HeyRenan/templeforge
claude plugin install templeforge@templeforge
```

From a local folder instead (clone or tgz extracted into your plugins dir):

```bash
claude plugin marketplace add ~/.claude/plugins/templeforge
claude plugin install templeforge@templeforge
```

After installing, `/templeforge:open` opens a request and `/templeforge:guide`
walks you through setup.

## 2. Requirements

- **node 18+** and **git** — the only hard requirements.
- **One provider token** for the forge behind your `origin` remote (GitLab and
  GitHub can use their native CLI instead):

  | Provider | Token env | Where |
  |---|---|---|
  | GitLab | `GITLAB_TOKEN` | Settings → Access Tokens, scope `api` (or `glab auth login`) |
  | GitHub | `GITHUB_TOKEN` | Developer settings → PAT, scope `repo` (or `gh auth login`) |
  | Bitbucket | `BITBUCKET_TOKEN`, or `BITBUCKET_USERNAME`+`BITBUCKET_APP_PASSWORD` | App passwords, scope `pullrequest:write` |
  | Gitea/Forgejo | `GITEA_TOKEN` (+ `GITEA_HOST` if self-hosted) | Applications → Generate Token, scope `write:repository` |
  | Azure DevOps | `AZURE_DEVOPS_TOKEN` | Personal access tokens, scope Code Read & Write |

- **Optional** `WRIKE_TOKEN` (Wrike → Apps & Integrations → API) for the linkback
  comment.

Put tokens in your shell env — never in a committed file.

## 3. Use

Restart Claude Code, then invoke `/templeforge:open`. Or run the flow directly:

```bash
node ~/.claude/plugins/templeforge/templeforge/scripts/ship-flow.mjs manifest.json --dry-run
```

## Notes

- Run the tests if you want:
  `cd ~/.claude/plugins/templeforge/templeforge && node --test 'scripts/__tests__/*.test.mjs'`
- Customize the request format per repo:
  `node <plugin>/scripts/mr-build.mjs --init-template` writes `.templeforge/template.json`.
- A neutral self-hosted host defaults to GitLab; set `TEMPLEFORGE_PROVIDER` to override.
