export class ApiError extends Error {
  constructor(code, message, { status = 0, fields, retryAfter, details } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.retryAfter = retryAfter;
    this.details = details ?? {};
  }
}

const FALLBACK_MESSAGES = {
  NETWORK_ERROR: "We couldn't reach the server. Check your connection and try again.",
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};

const sessionExpiredListeners = new Set();

/** Subscribe to SESSION_EXPIRED responses from any request. */
export function onSessionExpired(listener) {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function readCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)(?:__Host-csrf|csrf_token)=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * JSON request to the backend under /api. Cookies carry the session; the CSRF
 * token is echoed from its cookie. Throws ApiError with a user-friendly message.
 */
export async function api(path, { method = 'GET', body, retryCsrf = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = readCsrfToken();

  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', FALLBACK_MESSAGES.NETWORK_ERROR);
  }

  if (response.status === 204) return null;
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON (e.g. a proxy error page).
  }
  if (response.ok) return data;

  const { code, message, fields, retryAfter, ...details } = data?.error ?? {};
  if (code === 'CSRF_INVALID' && retryCsrf) {
    await api('/auth/session'); // issues a fresh CSRF cookie
    return api(path, { method, body, retryCsrf: false });
  }
  if (code === 'SESSION_EXPIRED') sessionExpiredListeners.forEach((listener) => listener());

  const fallbackCode = response.status >= 500 ? 'SERVER_ERROR' : 'REQUEST_FAILED';
  throw new ApiError(code ?? fallbackCode, message ?? FALLBACK_MESSAGES.SERVER_ERROR, {
    status: response.status,
    fields,
    retryAfter,
    details,
  });
}
