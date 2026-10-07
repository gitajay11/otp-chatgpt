const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const COPY = {
  signup: {
    subject: (app) => `Verify your email for ${app}`,
    intro: (app) => `Use this code to verify your email and finish creating your ${app} account.`,
  },
  login: {
    subject: (app) => `Your ${app} sign-in code`,
    intro: (app) => `Use this code to finish signing in to ${app}.`,
  },
  password_reset: {
    subject: (app) => `Reset your ${app} password`,
    intro: (app) => `Use this code to confirm the password change for your ${app} account.`,
  },
};

function describeDuration(seconds) {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} seconds`;
}

/** Builds the verification email. The plain-text part is kept ASCII-only. */
export function verificationEmail({ appName, code, purpose, ttlSeconds }) {
  const copy = COPY[purpose];
  const expires = describeDuration(ttlSeconds);
  const subject = copy.subject(appName);
  const intro = copy.intro(appName);

  const text = [
    intro,
    '',
    `Your verification code is: ${code}`,
    '',
    `This code expires in ${expires} and can only be used once.`,
    "If you didn't request it, you can ignore this email. Never share this code with anyone.",
    '',
    `- ${appName}`,
  ].join('\n');

  const app = escapeHtml(appName);
  const digits = [...code]
    .map(
      (d) =>
        `<td style="width:44px;height:52px;border:1px solid #2a2f45;border-radius:10px;background:#141826;color:#ffffff;font:600 26px/52px 'SFMono-Regular',Menlo,Consolas,monospace;text-align:center;">${d}</td><td style="width:8px"></td>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#07080c;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your ${app} verification code expires in ${expires}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07080c;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#0e1018;border:1px solid #1f2333;border-radius:18px;">
        <tr><td style="height:3px;background:linear-gradient(90deg,#4d7cff,#7a5cff,#a35cff);border-radius:18px 18px 0 0;"></td></tr>
        <tr><td style="padding:36px 36px 8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <p style="margin:0 0 24px;color:#8b93a7;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;">${app}</p>
          <h1 style="margin:0 0 12px;color:#f4f6fb;font-size:22px;font-weight:600;">Your verification code</h1>
          <p style="margin:0 0 28px;color:#a3abba;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;"><tr>${digits}</tr></table>
          <p style="margin:0 0 8px;color:#a3abba;font-size:14px;line-height:1.6;">This code expires in <strong style="color:#f4f6fb;">${expires}</strong> and can only be used once.</p>
          <p style="margin:0 0 32px;color:#6b7383;font-size:13px;line-height:1.6;">If you didn't request it, you can ignore this email. Never share this code with anyone &mdash; ${app} will never ask for it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
