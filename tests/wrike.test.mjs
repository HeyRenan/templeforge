import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkBlock, linkTask, parseTaskRef } from '../templeforge/lib/wrike.mjs';

const realFetch = globalThis.fetch;
const realToken = process.env.WRIKE_TOKEN;

test.afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.WRIKE_TOKEN;
  else process.env.WRIKE_TOKEN = realToken;
});

function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body });
    const json = responses.shift();
    return { ok: true, status: 200, text: async () => JSON.stringify(json) };
  };
  return calls;
}

test('parseTaskRef reads permalinks (any host), numeric ids and API ids', () => {
  assert.deepEqual(parseTaskRef('https://app-eu.wrike.com/open.htm?id=123'), { host: 'app-eu.wrike.com', permalinkId: '123' });
  assert.deepEqual(parseTaskRef(' 456 '), { host: 'www.wrike.com', permalinkId: '456' });
  assert.deepEqual(parseTaskRef('IEAAB3DE'), { host: 'www.wrike.com', apiId: 'IEAAB3DE' });
  assert.equal(parseTaskRef('https://www.wrike.com/open.htm'), null);
  assert.equal(parseTaskRef(''), null);
});

test('linkBlock escapes the url', () => {
  assert.equal(linkBlock('https://x/?a=1&b="2"'),
    '<br/><b>MERGE REQUEST</b><br/><a href="https://x/?a=1&amp;b=&quot;2&quot;">https://x/?a=1&amp;b=&quot;2&quot;</a>');
});

test('linkTask without WRIKE_TOKEN returns the block to append via MCP', async () => {
  delete process.env.WRIKE_TOKEN;
  const result = await linkTask('https://www.wrike.com/open.htm?id=9', 'https://pr/1');
  assert.equal(result.status, 'todo');
  assert.equal(result.taskId, '9');
});

test('linkTask finds the task by permalink and appends the block', async () => {
  process.env.WRIKE_TOKEN = 't';
  const calls = stubFetch([{ data: [{ id: 'IEA1', description: 'old' }] }, { data: [{}] }]);
  const result = await linkTask('https://www.wrike.com/open.htm?id=9', 'https://pr/1');
  assert.equal(result.status, 'linked');
  assert.match(calls[0].url, /\/api\/v4\/tasks\?permalink=https%3A%2F%2Fwww\.wrike\.com%2Fopen\.htm%3Fid%3D9&fields=/);
  assert.equal(calls[1].url, 'https://www.wrike.com/api/v4/tasks/IEA1');
  assert.equal(calls[1].body.get('description'), 'old' + linkBlock('https://pr/1'));
});

test('linkTask is idempotent', async () => {
  process.env.WRIKE_TOKEN = 't';
  const calls = stubFetch([{ data: [{ id: 'IEA1', description: linkBlock('https://pr/1') }] }]);
  assert.equal((await linkTask('IEA1', 'https://pr/1')).status, 'present');
  assert.deepEqual(calls.map((call) => call.url), ['https://www.wrike.com/api/v4/tasks/IEA1']);
});
