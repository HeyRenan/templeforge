import { execFileSync } from 'node:child_process';

export function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function tryGit(args) {
  try { return git(args); } catch { return null; }
}

export const repoRoot = () => tryGit(['rev-parse', '--show-toplevel']);
export const originUrl = () => tryGit(['remote', 'get-url', 'origin']);
export const currentBranch = () => tryGit(['symbolic-ref', '--short', 'HEAD']);

// Local origin/HEAD first (no network), then ask the remote, then assume main.
export function defaultBranch() {
  const local = tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (local) return local.replace(/^origin\//, '');
  const remote = tryGit(['ls-remote', '--symref', 'origin', 'HEAD']);
  const match = remote?.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m);
  return match ? match[1] : 'main';
}

export function uncommittedFiles() {
  const status = tryGit(['status', '--porcelain']);
  return status ? status.split('\n') : [];
}

// Best effort: offline, the last fetched origin/<base> is used.
export function fetchBase(base) {
  tryGit(['fetch', '--quiet', 'origin', base]);
}

// Null when origin/<base> does not exist locally, so the caller can skip the check.
export function commitsAhead(base) {
  const count = tryGit(['rev-list', '--count', `origin/${base}..HEAD`]);
  return count === null ? null : Number(count);
}

// Lands on `slug`. From the base branch it branches off the freshly pulled base;
// from any other branch it branches off HEAD, so existing commits come along.
export function switchToBranch(slug, base) {
  const current = currentBranch();
  if (current === slug) return;
  if (current === base) tryGit(['pull', '--ff-only']);
  const exists = tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${slug}`]) !== null;
  git(exists ? ['checkout', slug] : ['checkout', '-b', slug]);
}

export function push(branch) {
  git(['push', '-u', 'origin', branch]);
}
