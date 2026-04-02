function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = forwarded
    ? forwarded.split(",")[0].trim()
    : req.connection?.remoteAddress || req.socket?.remoteAddress;
  return raw || "";
}

module.exports = getClientIp;
