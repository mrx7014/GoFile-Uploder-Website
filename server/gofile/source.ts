import { lookup as lookupDns } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";

export type SafeTarget = {
  url: URL;
  address: string;
  family: 4 | 6;
};

export function parseSourceUrl(input: unknown): URL {
  if (typeof input !== "string" || input.length > 8192) {
    throw new Error("Enter a valid direct file URL.");
  }

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Could not read that URL. Check that you copied the full link.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS links are supported.");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing login credentials are not allowed.");
  }
  if (url.port) {
    throw new Error("Use a URL on the default HTTP or HTTPS port.");
  }
  if (!url.hostname || url.hostname.endsWith(".")) {
    throw new Error("The hostname in that URL is invalid.");
  }
  url.hash = "";
  return url;
}

function ipv4IsPublic(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 2 && c === 0) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase().split("%")[0];
  if (!value || value.includes(":::")) return null;

  const lastColon = value.lastIndexOf(":");
  const tail = value.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const octets = tail.split(".").map(Number);
    value = `${value.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;

  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [
    ...left.map((part) => parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((part) => parseInt(part, 16)),
  ];
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4IsPublic(address);
  if (family !== 6) return false;

  const groups = ipv6Groups(address);
  if (!groups) return false;

  const isIpv4Mapped = groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff;
  if (isIpv4Mapped) {
    const embedded = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
    return ipv4IsPublic(embedded);
  }

  // Only globally assigned unicast space (2000::/3) is accepted. This excludes
  // unspecified, loopback, unique-local, link-local, multicast and mapped ranges.
  if ((groups[0] & 0xe000) !== 0x2000) return false;
  if (groups[0] === 0x2001 && (groups[1] === 0 || groups[1] === 0x0db8)) return false; // transition and documentation ranges
  if (groups[0] === 0x2002) return false; // 6to4 can encapsulate private IPv4 destinations
  return true;
}

export async function resolvePublicTarget(url: URL): Promise<SafeTarget> {
  const hostname = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const literalFamily = isIP(hostname);
  let records: Array<{ address: string; family: number }>;

  try {
    records = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await lookupDns(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Could not reach the URL's host. Check the link and try again.");
  }

  if (records.length === 0 || records.some((record) => !isPublicIp(record.address))) {
    throw new Error("This URL points to a non-public network address and was blocked to protect the server.");
  }

  const selected = records[0];
  return {
    url,
    address: selected.address,
    family: selected.family as 4 | 6,
  };
}

export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  const lookup = (_hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const actualCallback = typeof options === "function" ? options as (...args: unknown[]) => void : callback;
    const actualOptions = typeof options === "object" && options !== null ? options as { all?: boolean } : {};
    if (actualOptions.all) {
      actualCallback(null, [{ address, family }]);
    } else {
      actualCallback(null, address, family);
    }
  };
  return lookup as unknown as LookupFunction;
}

export function sanitizeFileName(value: string): string {
  const safe = value
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");
  return (safe || "download.bin").slice(0, 220);
}

export function filenameFromHeaders(disposition: string | undefined, url: URL): string {
  if (disposition) {
    const encoded = disposition.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1]?.trim().replace(/^"|"$/g, "");
    if (encoded) {
      try {
        return sanitizeFileName(decodeURIComponent(encoded));
      } catch {
        // Fall back to the legacy filename parameter.
      }
    }
    const plain = disposition.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i);
    const candidate = plain?.[1] ?? plain?.[2];
    if (candidate) return sanitizeFileName(candidate.trim());
  }

  const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
  if (lastSegment) {
    try {
      return sanitizeFileName(decodeURIComponent(lastSegment));
    } catch {
      return sanitizeFileName(lastSegment);
    }
  }
  return "download.bin";
}
