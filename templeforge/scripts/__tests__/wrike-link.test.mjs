import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskId, block } from '../wrike-link.mjs';

test('parseTaskId: permalink, numeric, API id', () => {
  assert.deepEqual(parseTaskId('https://www.wrike.com/open.htm?id=771814718'), { kind: 'numeric', id: '771814718' });
  assert.deepEqual(parseTaskId('771814718'), { kind: 'numeric', id: '771814718' });
  assert.deepEqual(parseTaskId('IEACW7SVKQPZEWKI'), { kind: 'api', id: 'IEACW7SVKQPZEWKI' });
  assert.equal(parseTaskId(''), null);
});

test('block: labeled HTML link, idempotency-friendly shape', () => {
  const b = block('https://git.x/mr/1');
  assert.match(b, /<b>MERGE REQUEST<\/b>/);
  assert.match(b, /href="https:\/\/git.x\/mr\/1"/);
});
