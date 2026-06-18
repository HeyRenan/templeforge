import { test } from 'node:test';
import assert from 'node:assert/strict';

// Drive each provider driver against a stubbed global.fetch + env token, covering
// the previously-untested core: find -> create/update, response mapping to
// { web_url, iid, action }, and create-vs-update selection. No real network.

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

function withStub(seq, fn) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
    const r = seq.shift();
    return { ok: r.ok !== false, status: r.status || 200, text: async () => JSON.stringify(r.json ?? null) };
  };
  return fn(calls).finally(() => { globalThis.fetch = realFetch; });
}

function resetEnv(vars) {
  for (const k of Object.keys(process.env)) if (/_TOKEN$|_APP_PASSWORD$|_USERNAME$/.test(k)) delete process.env[k];
  Object.assign(process.env, vars);
}

test.afterEach(() => { globalThis.fetch = realFetch; process.env = { ...realEnv }; });

test('github: no existing PR -> create, maps html_url/number/action', async () => {
  resetEnv({ GITHUB_TOKEN: 't' });
  const gh = await import('../../lib/github.mjs');
  await withStub(
    [{ json: [] }, { json: { html_url: 'https://github.com/o/r/pull/9', number: 9 } }],
    async (calls) => {
      const r = await gh.openOrUpdatePR('o/r', { sourceBranch: 'feat/x', targetBranch: 'main', title: 'T', description: 'D' });
      assert.deepEqual(r, { web_url: 'https://github.com/o/r/pull/9', iid: 9, action: 'created' });
      assert.equal(calls[1].method, 'POST');
    });
});

test('github: existing PR -> update (PATCH), action updated', async () => {
  resetEnv({ GITHUB_TOKEN: 't' });
  const gh = await import('../../lib/github.mjs');
  await withStub(
    [{ json: [{ number: 5, html_url: 'https://github.com/o/r/pull/5' }] }, { json: { html_url: 'https://github.com/o/r/pull/5', number: 5 } }],
    async (calls) => {
      const r = await gh.openOrUpdatePR('o/r', { sourceBranch: 'feat/x', title: 'T2', description: 'D2' });
      assert.equal(r.action, 'updated');
      assert.equal(r.iid, 5);
      assert.equal(calls[1].method, 'PATCH');
    });
});

test('gitlab: no existing MR -> create, maps web_url/iid/action', async () => {
  resetEnv({ GITLAB_TOKEN: 't' });
  const gl = await import('../../lib/gitlab.mjs');
  await withStub(
    [{ json: [] }, { json: { web_url: 'https://gitlab.com/g/r/-/merge_requests/3', iid: 3 } }],
    async (calls) => {
      const r = await gl.openOrUpdateMR('g/r', { sourceBranch: 'feat/x', targetBranch: 'main', title: 'T', description: 'D' });
      assert.deepEqual(r, { web_url: 'https://gitlab.com/g/r/-/merge_requests/3', iid: 3, action: 'created' });
      assert.equal(calls[1].method, 'POST');
    });
});

test('bitbucket: existing PR -> update (PUT), action updated', async () => {
  resetEnv({ BITBUCKET_TOKEN: 't' });
  const bb = await import('../../lib/bitbucket.mjs');
  await withStub(
    [{ json: { values: [{ id: 8 }] } }, { json: { id: 8, links: { html: { href: 'https://bitbucket.org/w/r/pull-requests/8' } } } }],
    async (calls) => {
      const r = await bb.openOrUpdateMR('w/r', { sourceBranch: 'feat/x', title: 'T', description: 'D' });
      assert.equal(r.action, 'updated');
      assert.equal(r.web_url, 'https://bitbucket.org/w/r/pull-requests/8');
      assert.equal(calls[1].method, 'PUT');
    });
});

test('azure: no existing PR -> create, builds web_url from ids', async () => {
  resetEnv({ AZURE_DEVOPS_TOKEN: 't' });
  const az = await import('../../lib/azure.mjs');
  await withStub(
    [{ json: { value: [] } }, { json: { pullRequestId: 11 } }],
    async (calls) => {
      const r = await az.openOrUpdateMR('org/proj/repo', { sourceBranch: 'feat/x', targetBranch: 'main', title: 'T', description: 'D' });
      assert.equal(r.action, 'created');
      assert.equal(r.iid, 11);
      assert.match(r.web_url, /pullrequest\/11$/);
      assert.equal(calls[1].method, 'POST');
    });
});

test('gitea: resolves base, finds none via base/head endpoint, then creates', async () => {
  resetEnv({ GITEA_TOKEN: 't' });
  const gt = await import('../../lib/gitea.mjs');
  await withStub(
    [
      { json: { default_branch: 'main' } },          // getDefaultBranch
      { ok: false, status: 404, json: { message: 'no pr' } }, // findOpenPR base/head -> none
      { json: { number: 4, html_url: 'https://codeberg.org/o/r/pulls/4' } }, // create
    ],
    async (calls) => {
      const r = await gt.openOrUpdateMR('o/r', { sourceBranch: 'feat/x', title: 'T', description: 'D' });
      assert.deepEqual(r, { web_url: 'https://codeberg.org/o/r/pulls/4', iid: 4, action: 'created' });
      assert.match(calls[1].url, /\/pulls\/main\/feat%2Fx/); // exact base/head lookup, no pagination
      assert.equal(calls[2].method, 'POST');
    });
});

test('error body surfaces the readable message (shared errorDetail)', async () => {
  resetEnv({ GITLAB_TOKEN: 't' });
  const gl = await import('../../lib/gitlab.mjs');
  await withStub(
    [{ ok: false, status: 401, json: { message: '401 Unauthorized' } }],
    async () => {
      await assert.rejects(
        () => gl.openOrUpdateMR('g/r', { sourceBranch: 'b', title: 'T', description: 'D' }),
        /401 Unauthorized/);
    });
});
