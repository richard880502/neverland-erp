import { BlockList, isIP } from "net";

/**
 * Cloudflare edge ranges, from https://www.cloudflare.com/ips/ (fetched 2026-11-20).
 * Only requests whose direct peer is inside these ranges may set the client IP
 * through CF-Connecting-IP; anyone connecting to the origin directly cannot.
 */
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [network, prefix] = range.split("/");
  cloudflare.addSubnet(network, Number(prefix), network.includes(":") ? "ipv6" : "ipv4");
}

export function isCloudflareIp(ip: string): boolean {
  const family = isIP(ip);
  if (!family) return false;
  return cloudflare.check(ip, family === 6 ? "ipv6" : "ipv4");
}

/**
 * The visitor's IP address.
 *
 * Coolify's Traefik is not configured with trusted IPs, so it overwrites
 * X-Forwarded-For with the address that actually connected to it. The last
 * hop is therefore the real peer. When that peer is a Cloudflare edge, the
 * visitor's address is in CF-Connecting-IP; otherwise the peer itself is the
 * visitor (direct or local requests).
 */
export function getClientIp(request?: Request): string | null {
  if (!request) return null;
  const hops = request.headers.get("x-forwarded-for")?.split(",").map((hop) => hop.trim()).filter(Boolean) ?? [];
  const peer = hops.at(-1) || request.headers.get("x-real-ip")?.trim() || null;
  if (peer && isCloudflareIp(peer)) {
    const visitor = request.headers.get("cf-connecting-ip")?.trim();
    if (visitor && isIP(visitor)) return visitor;
  }
  return peer;
}
