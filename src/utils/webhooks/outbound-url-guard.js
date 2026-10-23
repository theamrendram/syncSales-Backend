import dns from "node:dns";
import net from "node:net";

/**
 * Keeps server-side requests to user-supplied URLs off private networks.
 *
 * A route test returns the remote response to the caller, so without this a
 * user could read cloud metadata (169.254.169.254) or anything else listening
 * inside the deployment.
 *
 * The check runs inside the socket's DNS lookup rather than before the request,
 * so a hostname that resolves publicly for the check and privately for the
 * connection (DNS rebinding) is still caught.
 */

export const BLOCKED_ADDRESS_CODE = "EBLOCKEDADDRESS";

const blockList = new net.BlockList();
// IPv4. BlockList also matches the IPv4-mapped IPv6 forms (::ffff:127.0.0.1).
blockList.addSubnet("0.0.0.0", 8, "ipv4"); // "this" network
blockList.addSubnet("10.0.0.0", 8, "ipv4"); // private
blockList.addSubnet("100.64.0.0", 10, "ipv4"); // carrier-grade NAT
blockList.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blockList.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, cloud metadata
blockList.addSubnet("172.16.0.0", 12, "ipv4"); // private
blockList.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
blockList.addSubnet("192.168.0.0", 16, "ipv4"); // private
blockList.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
blockList.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
blockList.addSubnet("240.0.0.0", 4, "ipv4"); // reserved, broadcast
// IPv6
blockList.addAddress("::", "ipv6"); // unspecified
blockList.addAddress("::1", "ipv6"); // loopback
blockList.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64, can reach any IPv4
blockList.addSubnet("fc00::", 7, "ipv6"); // unique local
blockList.addSubnet("fe80::", 10, "ipv6"); // link-local
blockList.addSubnet("ff00::", 8, "ipv6"); // multicast

export const isBlockedAddress = (address) => {
  const family = net.isIP(address);
  if (family === 4) return blockList.check(address, "ipv4");
  if (family === 6) return blockList.check(address, "ipv6");
  // Not an IP at all: refuse rather than guess.
  return true;
};

const blockedAddressError = (hostname) => {
  const error = new Error(`${hostname} resolves to a private or local address`);
  error.code = BLOCKED_ADDRESS_CODE;
  return error;
};

export const isBlockedAddressError = (error) =>
  error?.code === BLOCKED_ADDRESS_CODE || error?.cause?.code === BLOCKED_ADDRESS_CODE;

/**
 * True when the URL's host is an IP literal in a blocked range. Sockets skip
 * DNS for IP literals, so `guardedLookup` never sees these.
 */
export const isBlockedIpLiteral = (url) => {
  // URL keeps the brackets on IPv6 hosts.
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  return net.isIP(host) !== 0 && isBlockedAddress(host);
};

/**
 * Drop-in for dns.lookup, for http(s) requests and axios's `lookup` option.
 * Fails the connection if any resolved address is blocked.
 */
export const guardedLookup = (hostname, options, callback) => {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const addresses = Array.isArray(address) ? address : [{ address, family }];
    if (addresses.some((entry) => isBlockedAddress(entry.address))) {
      return callback(blockedAddressError(hostname));
    }
    return callback(null, address, family);
  });
};
