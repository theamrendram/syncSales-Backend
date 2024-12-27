const crypto = require("crypto");

function generateKey() {
  return crypto.randomBytes(16).toString("hex"); // 16 bytes = 32 hex characters
}

module.exports = { generateKey };
