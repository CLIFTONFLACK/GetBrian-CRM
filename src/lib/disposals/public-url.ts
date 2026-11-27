// Guard for the server fetching a URL that a user typed (the brochure link).
// Without it, a listing's brochure link could point the server at an internal
// address (cloud metadata, localhost, a private network) and read the answer.
//
// Pure helpers only (no network), so they can be tested. The fetch itself is in
// brochure-preview-service.ts, which calls these before every request and again
// for every redirect.

/** True for an IPv4 or IPv6 literal in a private, loopback, link-local or reserved range. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.trim().toLowerCase();

  // IPv4-mapped IPv6 (::ffff:10.0.0.1 or ::ffff:0a00:0001): test the embedded v4.
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const mappedHex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  const m = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const octets = m.slice(1).map(Number);
    if (octets.some((o) => o > 255)) return true; // not a valid address: refuse
    return (
      a === 0 || // "this" network
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) || // protocol assignments, documentation
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }

  if (v.includes(":")) {
    if (v === "::" || v === "::1") return true;
    return (
      v.startsWith("fc") || // unique local fc00::/7
      v.startsWith("fd") ||
      v.startsWith("fe8") || // link-local fe80::/10
      v.startsWith("fe9") ||
      v.startsWith("fea") ||
      v.startsWith("feb") ||
      v.startsWith("ff") // multicast
    );
  }

  return true; // not an IP literal we understand: refuse
}

/**
 * The URL to fetch, or null when it must not be fetched: not https, has a user
 * or password in it, a non-default port, or a host that is plainly internal.
 * A host name that looks public can still resolve to a private address, so the
 * caller must also check the resolved addresses with isPrivateAddress.
 */
export function publicHttpsUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return null;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return null;
  // A bare IP literal in the URL: apply the address rules straight away.
  const bare = host.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(bare) || bare.includes(":")) {
    if (isPrivateAddress(bare)) return null;
  }
  if (!host.includes(".") && !host.startsWith("[")) return null;
  return u;
}
