import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { sendMail, parseAddress } from '../src/smtp.js';

// Tiny scripted SMTP server: records commands and the DATA payload.
function fakeServer({ ehlo = ['AUTH PLAIN LOGIN'] } = {}) {
  const seen = { commands: [], data: '' };
  const server = net.createServer((sock) => {
    let buf = '';
    let inData = false;
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d;
      for (let nl; (nl = buf.indexOf('\r\n')) !== -1; ) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 queued\r\n');
          } else seen.data += `${line}\n`;
          continue;
        }
        seen.commands.push(line);
        const verb = line.split(/[ :]/)[0].toUpperCase();
        if (verb === 'EHLO') sock.write(['250-fake', ...ehlo.map((e) => `250-${e}`), '250 8BITMIME'].join('\r\n') + '\r\n');
        else if (verb === 'AUTH') sock.write('235 ok\r\n');
        else if (verb === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (verb === 'QUIT') sock.end('221 bye\r\n');
        else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })),
  );
}

const cfg = (port, extra = {}) => ({ host: '127.0.0.1', port, secure: false, timeoutMs: 3000, from: 'EVIE <evie@example.com>', ...extra });

test('sends a UTF-8 message with auth to a trusted relay', async () => {
  const { server, seen, port } = await fakeServer();
  try {
    await sendMail(cfg(port, { user: 'u', pass: 'p', allowInsecure: true }), {
      to: 'Dev <dev@example.com>',
      subject: '⚡ Charger 2 is ready',
      text: 'Hi Dev,\nCharger 2 is yours.',
    });
    assert.deepEqual(seen.commands.map((c) => c.split(' ')[0]), ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
    assert.equal(seen.commands[1], `AUTH PLAIN ${Buffer.from('\0u\0p').toString('base64')}`);
    assert.equal(seen.commands[2], 'MAIL FROM:<evie@example.com>');
    assert.equal(seen.commands[3], 'RCPT TO:<dev@example.com>');
    assert.match(seen.data, /^Subject: =\?UTF-8\?B\?/m);
    const body = seen.data.split('\n\n')[1].replace(/\s/g, '');
    assert.equal(Buffer.from(body, 'base64').toString(), 'Hi Dev,\r\nCharger 2 is yours.');
  } finally {
    server.close();
  }
});

test('refuses to send over an unencrypted connection by default', async () => {
  const { server, seen, port } = await fakeServer();
  try {
    await assert.rejects(sendMail(cfg(port, { user: 'u', pass: 'p' }), { to: 'a@b.co', subject: 's', text: 't' }), /does not offer TLS/);
    assert.ok(!seen.commands.some((c) => c.startsWith('AUTH')), 'credentials never sent in the clear');
  } finally {
    server.close();
  }
});

test('rejects header injection in addresses', () => {
  assert.throws(() => parseAddress('a@b.co>\r\nBcc: x@y.z'), /Invalid/);
  assert.equal(parseAddress('Someone <a@b.co>'), 'a@b.co');
});
