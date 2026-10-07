/** An error whose code and message are safe to show to the client. */
export class AppError extends Error {
  constructor(status, code, message, { fields, retryAfter, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
    this.details = details;
  }
}

export const validationError = (fields) =>
  new AppError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields });

export function errorHandler(logger) {
  // Express recognises error handlers by their four-argument signature.
  return (err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (res.headersSent) return req.socket.destroy();

    if (err instanceof AppError) {
      if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
      return res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.fields && { fields: err.fields }),
          ...(err.retryAfter && { retryAfter: err.retryAfter }),
          ...err.details,
        },
      });
    }

    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request could not be read.' } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' } });
    }

    // Unexpected: log details server-side only; the client gets a generic message.
    logger.error('Unhandled request error', { method: req.method, path: req.path, error: err?.stack ?? String(err) });
    return res.status(500).json({
      error: { code: 'SERVER_ERROR', message: 'Something went wrong on our end. Please try again.' },
    });
  };
}
