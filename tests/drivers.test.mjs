import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as github from '../templeforge/lib/github.mjs';
import * as gitlab from '../templeforge/lib/gitlab.mjs';
import * as bitbucket from '../templeforge/lib/bitbucket.mjs';
import { errorDetail, request } from '../templeforge/lib/rest.mjs';

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

// Replays canned responses in order and records every call.
function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) });
    const { status = 200, json = null } = responses.shift();
    return { ok: status < 400, status, text: async () => JSON.stringify(json) };
  };
  return calls;
}

function setEnv(vars) {
  process.env = { ...realEnv, PATH: '' };
  for (const key of Object.keys(process.env)) if (/TOKEN|BITBUCKET_/.test(key)) delete process.env[key];
  Object.assign(process.env, vars);
}

test.afterEach(() => { globalThis.fetch = realFetch; process.env = { ...realEnv }; });

const args = { host: 'github.com', project: 'o/r', source: 'feat/x', target: 'main', title: 'T', description: 'D', draft: true };

test('github creates a draft PR when none is open', async () => {
  setEnv({ GITHUB_TOKEN: 't' });
  const calls = stubFetch([{ json: [] }, { json: { html_url: 'https://github.com/o/r/pull/9' } }]);
  assert.deepEqual(await github.openOrUpdate(args), { url: 'https://github.com/o/r/pull/9', action: 'created' });
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\/o\/r\/pulls\?state=open&head=o%3Afeat%2Fx$/);
  assert.equal(calls[0].headers.Authorization, 'Bearer t');
  assert.deepEqual(calls[1].body, { title: 'T', head: 'feat/x', base: 'main', body: 'D', draft: true });
});

test('github updates the open PR and targets /api/v3 on Enterprise', async () => {
  setEnv({ GH_TOKEN: 't' });
  const calls = stubFetch([{ json: [{ number: 4 }] }, { json: { html_url: 'u' } }]);
  assert.deepEqual(await github.openOrUpdate({ ...args, host: 'ghe.acme.com' }), { url: 'u', action: 'updated' });
  assert.equal(calls[1].url, 'https://ghe.acme.com/api/v3/repos/o/r/pulls/4');
  assert.equal(calls[1].method, 'PATCH');
});

test('gitlab prefixes Draft: once and creates the MR', async () => {
  setEnv({ GITLAB_TOKEN: 't' });
  const calls = stubFetch([{ json: [] }, { json: { web_url: 'https://gitlab.com/g/r/-/merge_requests/3' } }]);
  const result = await gitlab.openOrUpdate({ ...args, host: 'gitlab.com', project: 'g/sub/r' });
  assert.deepEqual(result, { url: 'https://gitlab.com/g/r/-/merge_requests/3', action: 'created' });
  assert.equal(calls[0].url, 'https://gitlab.com/api/v4/projects/g%2Fsub%2Fr/merge_requests?state=opened&source_branch=feat%2Fx');
  assert.equal(calls[1].body.title, 'Draft: T');
  assert.equal(gitlab.draftTitle('WIP: T', true), 'WIP: T');
  assert.equal(gitlab.draftTitle('T', false), 'T');
});

test('gitlab updates the open MR by iid', async () => {
  setEnv({ GITLAB_TOKEN: 't' });
  const calls = stubFetch([{ json: [{ iid: 7 }] }, { json: { web_url: 'u' } }]);
  assert.deepEqual(await gitlab.openOrUpdate({ ...args, host: 'git.acme.io', draft: false }), { url: 'u', action: 'updated' });
  assert.equal(calls[1].url, 'https://git.acme.io/api/v4/projects/o%2Fr/merge_requests/7');
  assert.deepEqual(calls[1].body, { title: 'T', description: 'D' });
});

test('bitbucket creates with Basic auth and escapes the branch in BBQL', async () => {
  setEnv({ BITBUCKET_EMAIL: 'me@x.io', BITBUCKET_API_TOKEN: 'k' });
  const calls = stubFetch([{ json: { values: [] } }, { json: { links: { html: { href: 'https://bitbucket.org/ws/r/pull-requests/2' } } } }]);
  const result = await bitbucket.openOrUpdate({ ...args, project: 'ws/r' });
  assert.deepEqual(result, { url: 'https://bitbucket.org/ws/r/pull-requests/2', action: 'created' });
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('me@x.io:k').toString('base64')}`);
  assert.equal(calls[1].body.draft, true);
  assert.equal(decodeURIComponent(bitbucket.openPullQuery('a"b')), 'state="OPEN" AND source.branch.name="a\\"b"');
});

test('bitbucket updates the open PR', async () => {
  setEnv({ BITBUCKET_TOKEN: 't' });
  const calls = stubFetch([{ json: { values: [{ id: 5 }] } }, { json: { links: { html: { href: 'u' } } } }]);
  assert.deepEqual(await bitbucket.openOrUpdate({ ...args, project: 'ws/r' }), { url: 'u', action: 'updated' });
  assert.equal(calls[1].url, 'https://api.bitbucket.org/2.0/repositories/ws/r/pullrequests/5');
});

test('missing tokens name the fix', () => {
  setEnv({});
  assert.throws(() => github.resolveAuth('github.com'), /gh auth login/);
  assert.throws(() => gitlab.resolveAuth('gitlab.com'), /glab auth login/);
  assert.throws(() => bitbucket.resolveAuth(), /BITBUCKET_TOKEN/);
});

test('request surfaces the forge error message', async () => {
  stubFetch([{ status: 422, json: { message: 'Validation Failed', errors: [{ code: 'custom' }] } }]);
  await assert.rejects(request('GitHub', 'https://x/y'), /GitHub GET https:\/\/x\/y -> 422: Validation Failed \[\{"code":"custom"\}\]/);
  assert.equal(errorDetail('plain'), 'plain');
  assert.equal(errorDetail({ error: { message: 'nested' } }), 'nested');
});
