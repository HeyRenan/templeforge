// Strictness is a small shared domain: the valid levels, the machine-wide store
// file, and how to read the default. Both consumers — ship-flow (lint) and the
// strictness CLI — import it from here, so the CLI no longer reaches into the
// orchestrator just for two constants.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const STRICTNESS_LEVELS = ['loose', 'rich', 'strict'];

export const GLOBAL_STRICTNESS_FILE = join(homedir(), '.claude', 'templeforge', 'strictness');

export function readStrictnessDefault(globalFile = GLOBAL_STRICTNESS_FILE) {
  try {
    const v = readFileSync(globalFile, 'utf8').trim();
    if (v) return v;
  } catch { /* no global default set */ }
  return undefined;
}
