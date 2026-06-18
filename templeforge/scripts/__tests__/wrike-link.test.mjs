import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskId, block } from '../wrike-link.mjs';

test('parseTaskId: permalink, numeric, API id', () => {
  assert.deepEqual(parseTaskId('https://www.wrike.com/open.htm?id=771814718'), { kind: 'numeric', id: '771814718' });
  assert.deepEqual(parseTaskId('771814718'), { kind: 'numeric', id: '771814718' });
  assert.deepEqual(parseTaskId('IEACW7SVKQPZEWKI'), { kind: 'api', id: 'IEACW7SVKQPZEWKI' });
  assert.equal(parseTaskId(''), null);
});

test('parseTaskId: a URL-looking input without ?id=<digits> is rejected, not treated as an api id', () => {
  // a permalink missing the id, or with a non-numeric id, is not a valid task ref
  assert.equal(parseTaskId('https://www.wrike.com/open.htm'), null);
  assert.equal(parseTaskId('https://www.wrike.com/open.htm?foo=bar'), null);
  assert.equal(parseTaskId('https://wrike.com/workspace?id=abc'), null);
  // a genuine API id (no slashes/colons) is still accepted
  assert.deepEqual(parseTaskId('IEACW7SVKQPZEWKI'), { kind: 'api', id: 'IEACW7SVKQPZEWKI' });
});

test('parseTaskId: surrounding whitespace on a numeric id is trimmed', () => {
  assert.deepEqual(parseTaskId('  771814718  '), { kind: 'numeric', id: '771814718' });
  assert.deepEqual(parseTaskId('\t123\n'), { kind: 'numeric', id: '123' });
  // a real API id is still trimmed but stays api-kind
  assert.deepEqual(parseTaskId('  IEACW7SVKQPZEWKI '), { kind: 'api', id: 'IEACW7SVKQPZEWKI' });
});

test('block: labeled HTML link, idempotency-friendly shape', () => {
  const b = block('https://git.x/mr/1');
  assert.match(b, /<b>MERGE REQUEST<\/b>/);
  assert.match(b, /href="https:\/\/git.x\/mr\/1"/);
});

test('block: escapes HTML-significant chars in the url (no attribute break / injection)', () => {
  const b = block('https://git.x/mr?a=1&b=2"><img src=x>');
  assert.ok(!b.includes('"><img'), 'raw quote+bracket must not survive into the markup');
  assert.match(b, /&amp;/, 'ampersand escaped');
  assert.match(b, /&quot;/, 'double quote escaped');
  assert.match(b, /&lt;|&gt;/, 'angle brackets escaped');
});
