import net from 'node:net';

/**
 * A tiny in-process SMTP server that accepts and records every message.
 * For local development and tests only. Never expose it publicly.
 */
export function createSmtpSink({ onMessage } = {}) {
  const messages = [];
  let failNext = 0;

  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    let data = null;
    let auth = null;
    let envelope = { from: null, to: [] };
    const reply = (line) => socket.write(`${line}\r\n`);

    reply('220 localhost ESMTP sink ready');

    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (data !== null) {
          if (line !== '.') {
            data.push(line.startsWith('..') ? line.slice(1) : line);
            continue;
          }
          const raw = data.join('\r\n');
          data = null;
          if (failNext > 0) {
            failNext -= 1;
            reply('554 Transaction failed');
          } else {
            const message = { ...envelope, raw, receivedAt: Date.now() };
            messages.push(message);
            onMessage?.(message);
            reply('250 OK queued');
          }
          envelope = { from: null, to: [] };
          continue;
        }

        if (auth === 'login-user') {
          auth = 'login-pass';
          reply('334 UGFzc3dvcmQ6');
          continue;
        }
        if (auth === 'login-pass' || auth === 'plain') {
          auth = null;
          reply('235 Authentication successful');
          continue;
        }

        const [command, ...rest] = line.split(' ');
        switch (command.toUpperCase()) {
          case 'EHLO':
            socket.write('250-localhost\r\n250-8BITMIME\r\n250-SMTPUTF8\r\n250 AUTH PLAIN LOGIN\r\n');
            break;
          case 'HELO':
            reply('250 localhost');
            break;
          case 'AUTH': {
            const method = (rest[0] ?? '').toUpperCase();
            if (method === 'PLAIN' && rest[1]) reply('235 Authentication successful');
            else if (method === 'PLAIN') {
              auth = 'plain';
              reply('334 ');
            } else if (method === 'LOGIN' && rest[1]) {
              auth = 'login-pass';
              reply('334 UGFzc3dvcmQ6');
            } else {
              auth = 'login-user';
              reply('334 VXNlcm5hbWU6');
            }
            break;
          }
          case 'MAIL':
            envelope.from = line.match(/<([^>]*)>/)?.[1] ?? null;
            reply('250 OK');
            break;
          case 'RCPT':
            envelope.to.push(line.match(/<([^>]*)>/)?.[1]);
            reply('250 OK');
            break;
          case 'DATA':
            data = [];
            reply('354 End data with <CR><LF>.<CR><LF>');
            break;
          case 'RSET':
            envelope = { from: null, to: [] };
            reply('250 OK');
            break;
          case 'NOOP':
            reply('250 OK');
            break;
          case 'QUIT':
            reply('221 Bye');
            socket.end();
            break;
          default:
            reply('502 Command not implemented');
        }
      }
    });
    socket.on('error', () => {});
  });

  return {
    messages,
    /** Makes the next `count` deliveries fail with a 554 response. */
    failNextDelivery(count = 1) {
      failNext = count;
    },
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** Decodes the plain-text part of a raw message (quoted-printable or 7bit). */
export function plainText(raw) {
  return raw.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function extractCode(raw) {
  return plainText(raw).match(/verification code is: (\d{5})/)?.[1] ?? null;
}
