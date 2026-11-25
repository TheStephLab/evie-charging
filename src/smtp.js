// Minimal, dependency-free SMTP client: implicit TLS (465) or STARTTLS (587/25),
// AUTH PLAIN/LOGIN, one plain-text UTF-8 message per connection.
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import os from 'node:os';
import { once } from 'node:events';

const ADDRESS = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+$/;

export function smtpConfigFromEnv(env = process.env) {
  if (!env.SMTP_HOST) return null;
  const port = Number(env.SMTP_PORT) || 587;
  return {
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || env.SMTP_USER || '',
    allowInsecure: env.SMTP_ALLOW_INSECURE === 'true', // only for trusted internal relays
    timeoutMs: 15_000,
  };
}

const bare = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
export function parseAddress(v) {
  const s = bare(v);
  const m = s.match(/<([^<>]+)>\s*$/);
  const addr = (m ? m[1] : s).trim();
  if (!ADDRESS.test(addr)) throw new Error(`Invalid email address: ${s}`);
  return addr;
}
const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

export function buildMessage({ from, to, subject, text }, now = new Date()) {
  const domain = parseAddress(from).split('@')[1];
  const headers = [
    `From: ${bare(from)}`,
    `To: ${parseAddress(to)}`,
    `Subject: ${encodeWord(bare(subject))}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${wrap76(Buffer.from(text.replace(/\r?\n/g, '\r\n')).toString('base64'))}`;
}

class Connection {
  constructor(socket, timeoutMs) {
    this.timeoutMs = timeoutMs;
    this.error = null;
    this.waiters = [];
    this.attach(socket);
  }

  attach(socket) {
    this.socket = socket;
    this.buf = '';
    socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('SMTP server timed out')));
    socket.on('data', (d) => {
      this.buf += d.toString('utf8');
      this.drain();
    });
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new Error('SMTP connection closed unexpectedly')));
  }

  fail(err) {
    this.error ??= err;
    for (const w of this.waiters.splice(0)) w.reject(this.error);
  }

  drain() {
    while (this.waiters.length) {
      const lines = [];
      let idx = 0;
      let complete = false;
      for (let nl; (nl = this.buf.indexOf('\n', idx)) !== -1; ) {
        const line = this.buf.slice(idx, nl).replace(/\r$/, '');
        idx = nl + 1;
        lines.push(line);
        if (/^\d{3}(?: |$)/.test(line)) {
          complete = true;
          break;
        }
      }
      if (!complete) return;
      this.buf = this.buf.slice(idx);
      this.waiters.shift().resolve({ code: Number(lines.at(-1).slice(0, 3)), lines: lines.map((l) => l.slice(4)) });
    }
  }

  read() {
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.drain();
    });
  }

  async cmd(line, ok, label = line?.split(' ')[0]) {
    if (line != null) this.socket.write(`${line}\r\n`);
    const res = await this.read();
    if (!ok.includes(res.code)) throw new Error(`SMTP ${label ?? 'greeting'} failed: ${res.code} ${res.lines.join(' ')}`);
    return res;
  }

  detach() {
    const s = this.socket;
    s.removeAllListeners('data');
    s.removeAllListeners('close');
    s.removeAllListeners('error');
    s.on('error', () => {});
    s.setTimeout(0);
    return s;
  }
}

const sni = (host) => (net.isIP(host) ? undefined : host);

async function open(cfg) {
  const opts = { host: cfg.host, port: cfg.port, servername: sni(cfg.host), ...cfg.tls };
  const socket = cfg.secure ? tls.connect(opts) : net.connect({ host: cfg.host, port: cfg.port });
  await Promise.race([
    once(socket, cfg.secure ? 'secureConnect' : 'connect'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP connect timed out')), cfg.timeoutMs).unref()),
  ]).catch((e) => {
    socket.destroy();
    throw e;
  });
  return socket;
}

export async function sendMail(cfg, message) {
  const from = parseAddress(message.from ?? cfg.from);
  const to = parseAddress(message.to);
  const body = buildMessage({ ...message, from: message.from ?? cfg.from });
  const conn = new Connection(await open(cfg), cfg.timeoutMs);
  const name = cfg.clientName || os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
  try {
    await conn.cmd(null, [220]);
    let ehlo = await conn.cmd(`EHLO ${name}`, [250]);
    let encrypted = cfg.secure;
    const has = (ext) => ehlo.lines.some((l) => l.toUpperCase().startsWith(ext));

    if (!encrypted && has('STARTTLS')) {
      await conn.cmd('STARTTLS', [220]);
      const tlsSocket = tls.connect({ socket: conn.detach(), servername: sni(cfg.host), ...cfg.tls });
      await once(tlsSocket, 'secureConnect');
      conn.attach(tlsSocket);
      encrypted = true;
      ehlo = await conn.cmd(`EHLO ${name}`, [250]);
    }
    if (!encrypted && !cfg.allowInsecure) {
      throw new Error('SMTP server does not offer TLS. Set SMTP_ALLOW_INSECURE=true only for a trusted internal relay.');
    }

    if (cfg.user) {
      const auth = ehlo.lines.find((l) => /^AUTH[ =]/i.test(l))?.toUpperCase() ?? '';
      if (auth.includes('PLAIN') || !auth.includes('LOGIN')) {
        const token = Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString('base64');
        await conn.cmd(`AUTH PLAIN ${token}`, [235], 'AUTH');
      } else {
        await conn.cmd('AUTH LOGIN', [334], 'AUTH');
        await conn.cmd(Buffer.from(cfg.user).toString('base64'), [334], 'AUTH');
        await conn.cmd(Buffer.from(cfg.pass).toString('base64'), [235], 'AUTH');
      }
    }

    await conn.cmd(`MAIL FROM:<${from}>`, [250]);
    await conn.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await conn.cmd('DATA', [354]);
    // Dot-stuffing isn't needed: the body is base64 and headers never start with '.'.
    await conn.cmd(`${body.replace(/\r\n$/, '')}\r\n.`, [250], 'DATA');
    await conn.cmd('QUIT', [221]).catch(() => {});
  } finally {
    conn.detach().destroy();
  }
}
