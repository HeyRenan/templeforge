#!/usr/bin/env node
// Open-or-update an MR via the GitLab API (no glab binary). Used by ship.sh as
// the portable fallback. Prints the MR web_url.
//   node mr.mjs <group/repo> <sourceBranch> <targetBranch> <title> <descFile>
import { openOrUpdateMR } from '../lib/gitlab.mjs';
import { readFileSync } from 'node:fs';

const [project, sourceBranch, targetBranch, title, descFile] = process.argv.slice(2);
if (!project || !sourceBranch || !title || !descFile) {
  console.error('usage: mr.mjs <group/repo> <sourceBranch> <targetBranch> <title> <descFile>');
  process.exit(2);
}
const description = readFileSync(descFile, 'utf8');
const r = await openOrUpdateMR(project, { sourceBranch, targetBranch: targetBranch || 'main', title, description });
console.error('MR ' + r.action + ' (!' + r.iid + ')');
console.log(r.web_url);
