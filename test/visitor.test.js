import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanVisitor, loadVisitor, emptyVisitor, MAX_FIELD_LENGTH } from '../src/visitor.js';

test('visitor info keeps known fields as trimmed plain text and drops unknown ones', () => {
  const v = cleanVisitor({ fields: { assemblyPoint: '  Car park B\r\nby the gate ', evil: '<script>', firstAid: 12 } }, 5);
  assert.equal(v.fields.assemblyPoint, 'Car park B\nby the gate');
  assert.equal(v.fields.firstAid, '12');
  assert.equal(v.fields.evil, undefined);
  assert.equal(v.fields.wifi, '');
  assert.equal(v.updatedAt, 5);
});

test('overlong fields are rejected and corrupt stored data falls back to empty', () => {
  assert.throws(() => cleanVisitor({ fields: { wifi: 'x'.repeat(MAX_FIELD_LENGTH + 1) } }), /1000 characters/);
  assert.deepEqual(loadVisitor({ fields: { wifi: 'x'.repeat(5000) } }), emptyVisitor());
  assert.equal(loadVisitor({ fields: { wifi: 'Guest' }, updatedAt: 9 }).fields.wifi, 'Guest');
});
