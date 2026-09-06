import crypto from "crypto";

function generateKey() {
  return crypto.randomBytes(16).toString("hex"); // 16 bytes = 32 hex characters
}

export { generateKey };
