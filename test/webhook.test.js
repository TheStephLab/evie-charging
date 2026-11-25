import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cleanWebhookUrl, detectFormat, maskUrl, buildPayload, postWebhook } from '../src/webhook.js';

const TEAMS = 'https://prod-12.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=SECRETsig1234';

test('only public https webhook URLs are accepted', () => {
  assert.equal(cleanWebhookUrl(` ${TEAMS} `), TEAMS);
  for (const bad of ['http://hooks.slack.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://u:p@hooks.slack.com/x', 'https://box.local/x', 'nope', '']) {
    assert.throws(() => cleanWebhookUrl(bad), undefined, bad);
  }
});

test('Teams Workflows URLs get Adaptive Cards, others get {text}', () => {
  assert.equal(detectFormat(TEAMS), 'teams');
  assert.equal(detectFormat('https://contoso.webhook.office.com/webhookb2/x'), 'teams');
  assert.equal(detectFormat('https://hooks.slack.com/services/x'), 'text');
  const card = buildPayload('teams', { title: 'T', text: 'B', link: 'https://evie.example/c/1' });
  assert.equal(card.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.deepEqual(card.attachments[0].content.body.map((b) => b.text), ['T', 'B']);
  assert.equal(card.attachments[0].content.actions[0].url, 'https://evie.example/c/1');
  assert.deepEqual(buildPayload('text', { title: 'T', text: 'B' }), { text: 'T\nB' });
});

test('masking hides the signature', () => {
  const m = maskUrl(TEAMS);
  assert.ok(m.startsWith('https://prod-12.westeurope.logic.azure.com/…'));
  assert.ok(!m.includes('SECRETsig'));
});

test('posts the payload and reports HTTP failures', async () => {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      bodies.push(JSON.parse(b));
      res.writeHead(req.url === '/fail' ? 400 : 202).end(req.url === '/fail' ? 'bad card' : '');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await postWebhook({ url: `${base}/ok`, format: 'teams' }, { title: 'Hi' }), 202);
    assert.equal(bodies[0].type, 'message');
    await assert.rejects(postWebhook({ url: `${base}/fail`, format: 'text' }, { title: 'Hi' }), /HTTP 400: bad card/);
  } finally {
    server.close();
  }
});
