/** Cookie names. Secure deployments use prefixes the browser enforces. */
export function cookieNames(secure) {
  return secure
    ? { session: '__Host-sid', csrf: '__Host-csrf', flow: '__Secure-otp_flow' }
    : { session: 'sid', csrf: 'csrf_token', flow: 'otp_flow' };
}

export function parseCookies(header) {
  const cookies = Object.create(null);
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (name in cookies) continue; // the first (most specific) value wins
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function cookieParser() {
  return (req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  };
}
