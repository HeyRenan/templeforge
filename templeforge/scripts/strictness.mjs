#!/usr/bin/env node
// Global strictness switch — the ONLY strictness store (never per-repo).
// Strictness gates how hard templeforge lints a request description against its
// template (loose = minimal nags, strict = demand wrike + multiple sections).
//   node strictness.mjs            -> STRICTNESS <current|rich (default)>
//   node strictness.mjs <level>    -> validates, writes, STRICTNESS <level>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { GLOBAL_STRICTNESS_FILE, STRICTNESS_LEVELS } from '../lib/strictness.mjs';

// CLI body. Lives in a function (not top-level) so importing this module never
// writes the global strictness file or calls process.exit as an import side
// effect — matching every other script's main-guard.
function main(arg) {
  if (!arg) {
    let cur = 'rich (default)';
    try {
      const v = readFileSync(GLOBAL_STRICTNESS_FILE, 'utf8').trim();
      if (STRICTNESS_LEVELS.includes(v)) cur = v;
    } catch { /* unset */ }
    console.log('STRICTNESS ' + cur);
    return 0;
  }
  if (!STRICTNESS_LEVELS.includes(arg)) {
    console.error('strictness: level must be one of ' + STRICTNESS_LEVELS.join('|') + ', got: ' + arg);
    return 1;
  }
  mkdirSync(dirname(GLOBAL_STRICTNESS_FILE), { recursive: true });
  writeFileSync(GLOBAL_STRICTNESS_FILE, arg + '\n');
  console.log('STRICTNESS ' + arg);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv[2]));
}
