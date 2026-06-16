---
description: Set the global default strictness level for templeforge lint (loose | rich | strict)
argument-hint: "[loose|rich|strict]"
allowed-tools: Bash(node *strictness.mjs*)
---

Set the templeforge GLOBAL default strictness. ship-flow.mjs resolves it as:
explicit manifest value → `~/.claude/templeforge/strictness` → `rich`. It is
machine-wide — there is no per-repo file.

Requested level: `$ARGUMENTS`

The switch is SCRIPT-owned — run `node <plugin>/scripts/strictness.mjs <level>`
(it validates, persists, prints `STRICTNESS <level>`); never write the file by
hand.

1. If `$ARGUMENTS` is empty: run `node <plugin>/scripts/strictness.mjs` (prints
   the current level), show this table, stop.

   | Level | Lint behavior |
   |---|---|
   | `loose` | Minimal nags. |
   | `rich` (default) | Nudges for a Wrike top line. |
   | `strict` | Demands a Wrike url and at least two sections. |

2. Otherwise run `node <plugin>/scripts/strictness.mjs $ARGUMENTS` and relay the
   `STRICTNESS <level>` line.

Strictness gates ship-flow's manifest lint only. The template's own rules
(required sections, sentence limits, forbidden sections) are always hard-enforced
by mr-build regardless of level.
