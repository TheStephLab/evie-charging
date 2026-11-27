import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanVisitor, loadVisitor, emptyVisitor, visitorText, richText, NEW_TAB_NOTE, VISITOR_FIELDS, MAX_FIELD_LENGTH } from '../src/visitor.js';

const guide = (key) => VISITOR_FIELDS.find((f) => f.key === key).default;

test("blank fields show the guide's wording, and saving the guide's wording stores it as blank", () => {
  const shown = visitorText(emptyVisitor());
  assert.equal(shown.assemblyPoint, guide('assemblyPoint'));
  assert.equal(shown.wifi, guide('wifi'));
  assert.equal(emptyVisitor().fields.wifi, '');
  const saved = cleanVisitor({ fields: { assemblyPoint: `${guide('assemblyPoint')}\r\n`, firstAid: 'Room 1.04' } });
  assert.equal(saved.fields.assemblyPoint, '');
  assert.equal(visitorText(saved).firstAid, 'Room 1.04');
});

test('richText escapes HTML and only links safe [label](url) targets', () => {
  const tab = ' target="_blank" rel="noopener noreferrer"';
  assert.equal(richText('<b>Hi</b>\nthere'), '&lt;b&gt;Hi&lt;/b&gt;<br>there');
  assert.equal(
    richText('[Map](https://x.test/?a=1&b=2) and [Lockers](facilities.html#lockers)'),
    `<a href="https://x.test/?a=1&amp;b=2"${tab}>Map${NEW_TAB_NOTE}</a> and <a href="facilities.html#lockers">Lockers</a>`,
  );
  assert.equal(richText('[Email](mailto:a@b.test)'), '<a href="mailto:a@b.test">Email</a>');
  assert.equal(richText('[Bad](javascript:alert(1))'), '[Bad](javascript:alert(1))');
  assert.equal(richText('[x](https://a.test/id=12345678901)'), `<a href="https://a.test/id=12345678901"${tab}>x${NEW_TAB_NOTE}</a>`);
  assert.equal(richText('Call 01223 123456'), 'Call <a href="tel:01223123456">01223 123456</a>');
});

test('richText bolds **text**, and bold at the start becomes the headline', () => {
  assert.equal(richText('**Closest: [A](a.html)**\nA walk'), '<strong class="lead">Closest: <a href="a.html">A</a></strong><br>A walk');
  assert.equal(richText('Please **swipe in**'), 'Please <strong>swipe in</strong>');
});

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
