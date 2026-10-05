import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../templeforge/scripts/templeforge.mjs', import.meta.url));

// The CLI runs in a child process, so fetch is stubbed through a preloaded module.
const FAKE_GITHUB = 'data:text/javascript,' + encodeURIComponent(`
  globalThis.fetch = async (url, init = {}) => {
    const body = init.method === 'POST' ? { html_url: 'https://github.com/o/r/pull/1' } : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };`);

const env = {
  ...process.env,
  GITHUB_TOKEN: 't',
  WRIKE_TOKEN: '',
  GIT_SSH_COMMAND: 'false',
  CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'tf-data-')),
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeRepo() {
  const remote = mkdtempSync(join(tmpdir(), 'tf-remote-'));
  const repo = mkdtempSync(join(tmpdir(), 'tf repo '));
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '--bare', remote]);
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'git@github.com:o/r.git');
  git('config', 'remote.origin.pushurl', remote);
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('push', '-q', '-u', 'origin', 'main');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  return { repo, remote, git };
}

function run(repo, args, input, extraArgs = []) {
  const result = spawnSync(process.execPath, [...extraArgs, CLI, ...args], { cwd: repo, env, input, encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
}

const request = (extra = {}) => JSON.stringify({
  title: 'feat: x', sections: { summary: 'Adds x.', changes: '- x' }, ...extra,
});

test('context reports repo, auth, branch and template rules', () => {
  const { repo } = makeRepo();
  const { code, out } = run(repo, ['context']);
  assert.equal(code, 0);
  assert.match(out, /^repo github o\/r \(github\.com\), opens a pull request$/m);
  assert.match(out, /^auth ok \(GITHUB_TOKEN\)$/m);
  assert.match(out, /^branch main {2}base main {2}ahead 0 {2}uncommitted 0$/m);
  assert.match(out, /section summary "Summary" required maxSentences=4/);
});

test('open fails on template violations before touching git', () => {
  const { repo, git } = makeRepo();
  const { code, out } = run(repo, ['open'], JSON.stringify({ title: 'x', slug: 'feat/x', sections: { summary: 'A. B. C. D. E.' } }));
  assert.equal(code, 1);
  assert.match(out, /FAIL template "default" \(nothing pushed\)/);
  assert.match(out, /Changes: required section missing/);
  assert.equal(git('branch', '--show-current').toString().trim(), 'main');
});

test('open needs a slug on the base branch and rejects bad JSON', () => {
  const { repo } = makeRepo();
  assert.deepEqual(run(repo, ['open'], request()), { code: 2, out: 'FAIL slug required: you are on main\n' });
  assert.equal(run(repo, ['open'], '{').code, 2);
  assert.match(run(repo, ['open'], '{"sections":1}').out, /title: required string; sections: required object/);
});

test('open --dry-run prints the plan and description without pushing', () => {
  const { repo } = makeRepo();
  const { code, out } = run(repo, ['open', '--dry-run'], request({ slug: 'feat/x', draft: true }));
  assert.equal(code, 0);
  assert.match(out, /^PLAN github o\/r feat\/x -> main \(draft\)$/m);
  assert.match(out, /## Summary\n\nAdds x\./);
});

test('open refuses a branch with no commits ahead of base', () => {
  const { repo } = makeRepo();
  const { code, out } = run(repo, ['open'], request({ slug: 'feat/empty' }), ['--import', FAKE_GITHUB]);
  assert.equal(code, 2);
  assert.match(out, /FAIL no commits on feat\/empty ahead of origin\/main/);
});

test('open branches, pushes, opens the PR and hands back the Wrike block', () => {
  const { repo, remote, git } = makeRepo();
  writeFileSync(join(repo, 'a.txt'), 'a');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'feat: a');
  const { code, out } = run(repo, ['open'], request({ slug: 'feat/a', wrike: 'https://www.wrike.com/open.htm?id=5' }), ['--import', FAKE_GITHUB]);
  assert.equal(code, 0, out);
  assert.match(out, /^DONE https:\/\/github\.com\/o\/r\/pull\/1 \(pull request created\)$/m);
  assert.match(out, /^WRIKE todo: no WRIKE_TOKEN; append to task 5 description/m);
  assert.equal(git('branch', '--show-current').toString().trim(), 'feat/a');
  assert.match(git('ls-remote', '--heads', remote).toString(), /refs\/heads\/feat\/a/);
});

test('open from a feature branch uses it as the slug and keeps its commits', () => {
  const { repo, remote, git } = makeRepo();
  git('checkout', '-q', '-b', 'fix/b');
  writeFileSync(join(repo, 'b.txt'), 'b');
  git('add', 'b.txt');
  git('commit', '-q', '-m', 'fix: b');
  const { code, out } = run(repo, ['open'], request(), ['--import', FAKE_GITHUB]);
  assert.equal(code, 0, out);
  assert.match(out, /^PLAN github o\/r fix\/b -> main$/m);
  assert.match(git('log', '--oneline', '-1', 'fix/b').toString(), /fix: b/);
  assert.match(execFileSync('git', ['log', '--oneline', 'fix/b'], { cwd: remote }).toString(), /fix: b/);
});

test('init-template writes once, to the repo or the plugin data dir', () => {
  const { repo } = makeRepo();
  assert.equal(run(repo, ['init-template']).code, 0);
  assert.ok(existsSync(join(repo, '.templeforge', 'template.json')));
  assert.match(run(repo, ['init-template']).out, /already exists/);
  assert.equal(run(repo, ['init-template', '--global']).code, 0);
  assert.ok(existsSync(join(env.CLAUDE_PLUGIN_DATA, 'template.json')));
});

test('unknown command prints usage', () => {
  const { repo } = makeRepo();
  assert.deepEqual(run(repo, ['nope']).code, 2);
});
