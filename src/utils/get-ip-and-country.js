const geoip = require("geoip-lite");

function getIpAndCountry(req) {
  const ip = getClientIp(req);
  const geo = geoip.lookup(ip);

  return {
    ip,
    country: geo ? geo.country : "Unknown",
  };
}

module.exports = getIpAndCountry;

function getClientIp(req) {
  // Check for the forwarded IP headers
  const forwarded = req.headers["x-forwarded-for"];
  const ip = forwarded ? forwarded.split(",")[0] : req.connection.remoteAddress;
  return ip;
}
