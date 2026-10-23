// Axios attaches the whole response and the request config to its errors, and
// that config holds the outgoing headers (the API key) and the lead payload.
// pino's default error serializer copies every own property, so errors are
// reduced to a fixed shape before they are written.
//
// Used both by the base logger and by pino-http, which replaces the base
// serializers on the per-request child loggers.
const errSerializer = (err) => ({
  // A raw Error carries "name"; one already run through pino's serializer
  // carries "type".
  type: err?.name || err?.type,
  message:
    typeof err?.message === "string" ? err.message.slice(0, 240) : undefined,
  code: err?.code,
  httpStatus: err?.response?.status,
  stack: typeof err?.stack === "string" ? err.stack.slice(0, 1000) : undefined,
});

export { errSerializer };
