// Local mail catcher for development: an SMTP server on 127.0.0.1 that prints
// received messages to this terminal instead of delivering them.
// Point the app at it with SMTP_HOST=127.0.0.1, SMTP_PORT=1025 and SMTP_USER unset.
import { createSmtpSink, plainText } from '../test/helpers/smtp-sink.js';

const port = Number(process.env.DEV_SMTP_PORT || 1025);

const sink = createSmtpSink({
  onMessage({ to, raw }) {
    const subject = raw.match(/^Subject: (.*)$/m)?.[1] ?? '(no subject)';
    const text = plainText(raw).match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/)?.[1] ?? '';
    console.log(`\n── ${new Date().toLocaleTimeString()} ─ to ${to.join(', ')}\n   ${subject}\n\n${text.trim()}\n`);
  },
});

await sink.listen(port, '127.0.0.1');
console.log(`Dev SMTP catcher listening on 127.0.0.1:${port}. Messages are printed here and never delivered.`);
