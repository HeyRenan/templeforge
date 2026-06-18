# templeforge

[![ci](https://github.com/HeyRenan/templeforge/actions/workflows/ci.yml/badge.svg)](https://github.com/HeyRenan/templeforge/actions/workflows/ci.yml)
&nbsp;[![tests](https://img.shields.io/badge/tests-123%20passing-brightgreen)](#testes)
&nbsp;[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Leia em:** [English](README.md) · Português

Plugin de [Claude Code](https://claude.com/claude-code) que forja merge/pull
requests a partir de **templates**. Um comando cria o branch, commita, renderiza
uma descrição validada a partir do seu template, abre o request no forge que você
usa e adiciona um linkback opcional no Wrike. Zero dependências, sem MCP,
agnóstico de provedor.

templeforge faz exatamente um trabalho: transformar um template + os corpos das
suas seções num request bem-formado. Ele não tira screenshot, não grava vídeo,
não roda nenhuma outra ferramenta — o corpo de uma seção é o texto que você
escreveu.

## Por quê

Abrir request na mão diverge: seções inconsistentes, link de ticket faltando, o
formato que todo revisor pede de novo em silêncio. templeforge torna o formato
**dado** — um template que o motor valida antes do request abrir — e torna o ato
**um comando** no GitLab, GitHub, Bitbucket, Gitea e Azure.

## Como funciona

```
manifest.json ──► forge ──► ship ──► wrike-link ──► DONE <url>
                  │         │        │
                  │         │        └─ comentário de linkback opcional na tarefa Wrike
                  │         └─ branch · commit · push · abre MR/PR (provedor detectado)
                  └─ renderiza a descrição do template + corpos + vars,
                     valida contra as regras do template (rejeita antes de abrir)
```

## Início rápido

```bash
# 1. um arquivo markdown por seção do template
echo "Adiciona X para o usuário fazer Y." > summary.md
echo "- mexi em a.js, b.js" > changes.md

# 2. descreva o request
cat > manifest.json <<'JSON'
{
  "wrike": "https://www.wrike.com/open.htm?id=1234",
  "title": "feat: add X",
  "slug": "feat/add-x",
  "sections": { "summary": "summary.md", "changes": "changes.md" }
}
JSON

# 3. previa, depois envie
node scripts/ship-flow.mjs manifest.json --dry-run
node scripts/ship-flow.mjs manifest.json
# -> DONE https://.../merge_requests/42
```

Provedor, projeto e branch alvo são detectados do seu remote `origin`.
Para abrir em outro repo, adicione `"project": "owner/repo"` ao manifesto
(respeitado tanto no caminho via CLI nativa quanto no REST).
Adicione `"draft": true` ao manifesto para abrir um request em rascunho/WIP —
GitHub, Bitbucket e Azure usam a flag nativa de draft; GitLab (`Draft:`) e Gitea
(`WIP:`) usam um prefixo no título.

## O template

Template é JSON: uma linha de topo, seções ordenadas e regras. Ordem de
resolução: `.templeforge/template.json` no repo → `$TEMPLEFORGE_TEMPLATE` → o
default embutido.

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

| Regra de seção | Efeito |
|---|---|
| `maxSentences` / `minSentences` | limita a prosa (blocos de código são ignorados) |
| `mustHaveCodeBlock` | exige um bloco cercado (ex: os comandos pra rodar) |
| `mustMatch` | exige um regex (ex: id de ticket `AB-\d+`) |

| Regra global | Efeito |
|---|---|
| `noEmoji` | rejeita qualquer emoji em qualquer lugar |
| `requireWrike` | falha se a linha de topo `{wrike_url}` estiver vazia |
| `denySections` | rejeita títulos nomeados (ex: um "TODO" fora do template) |

`{wrike_url}` e qualquer `{var}` passado com `--var key=value` são substituídos na
linha de topo e em cada corpo. Violações são impressas e o request **não** abre.
Copie o embutido pra começar o seu:

```bash
node scripts/mr-build.mjs --init-template   # escreve .templeforge/template.json
```

## Provedores

O provedor vem do remote `origin` — um contrato de driver uniforme por forge.
GitLab e GitHub usam a CLI nativa (`glab` / `gh`) quando presente e autenticada,
senão REST sem dependência.

| Provedor | Chama de | Token (env) |
|---|---|---|
| GitLab | merge request | `GITLAB_TOKEN` (ou `glab auth login`) |
| GitHub | pull request | `GITHUB_TOKEN` (ou `gh auth login`) |
| Bitbucket | pull request | `BITBUCKET_TOKEN`, ou `BITBUCKET_USERNAME`+`BITBUCKET_APP_PASSWORD` |
| Gitea / Forgejo / Codeberg | pull request | `GITEA_TOKEN` (+ `GITEA_HOST`) |
| Azure DevOps | pull request | `AZURE_DEVOPS_TOKEN` (projeto é `org/project/repo`) |

Um host self-hosted neutro (ex: `git.acme.io`) assume GitLab; defina
`TEMPLEFORGE_PROVIDER` pra sobrescrever.

## Strictness (rigor)

`strictness` (`loose` / `rich` / `strict`) controla o quão forte o ship-flow faz
o lint do manifest — separado da validação dura do template. Defina o default
da máquina com o switch dono-do-script (ou `/templeforge:strictness`):

```bash
node scripts/strictness.mjs strict   # STRICTNESS strict
```

## Comandos

| Comando | Faz |
|---|---|
| `/templeforge:open` | abre um merge/pull request a partir de um template |
| `/templeforge:strictness [loose\|rich\|strict]` | define o rigor global do lint |
| `/templeforge:guide` | guia de setup de token + template |

## Testes

```bash
node --test 'scripts/__tests__/*.test.mjs'   # 123 testes, sem rede nem browser
```

## Instalação

Veja [INSTALL.md](INSTALL.md).

## Licença

[MIT](LICENSE)
