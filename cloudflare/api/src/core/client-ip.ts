import type { ApiEnv } from '../env';

export const RELAY_SECRET_HEADER = 'x-relay-secret';
export const RELAY_CLIENT_IP_HEADER = 'x-relay-client-ip';

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/u;
const IPV6_CHARS = /^[0-9a-f:.]{2,45}$/iu;

/**
 * Returns the canonical text of a literal IPv4/IPv6 address, or null when the
 * value is not exactly one address (no ports, brackets, zone IDs or lists).
 */
export function normalizeIpAddress(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (IPV4.test(candidate)) return candidate;
  if (!candidate.includes(':') || !IPV6_CHARS.test(candidate)) return null;
  try {
    // The WHATWG host parser fully validates IPv6, including embedded IPv4.
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : null;
  } catch {
    return null;
  }
}

function relayAllowlist(env: ApiEnv): Set<string> {
  return new Set((env.RELAY_IPS ?? '').split(',')
    .map((item) => normalizeIpAddress(item))
    .filter((item): item is string => item !== null));
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Compares fixed-length digests so neither length nor prefix of the secret leaks. */
async function secretsEqual(provided: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(provided), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

/**
 * Single source of the caller's IP for rate limits and lockouts.
 *
 * A request is treated as coming through the trusted HK relay only when
 * RELAY_SHARED_SECRET and RELAY_IPS are configured, Cloudflare reports one of
 * the allowlisted relay addresses, and X-Relay-Secret matches. Only then is the
 * relay's X-Relay-Client-IP used, and only if it is one literal IP address.
 * Every other case keeps the original CF-Connecting-IP behaviour.
 */
export async function getClientIp(request: Request, env: ApiEnv): Promise<string> {
  const connectingIp = request.headers.get('cf-connecting-ip');
  const fallback = connectingIp ?? 'unknown';
  const secret = env.RELAY_SHARED_SECRET?.trim();
  if (!secret) return fallback;

  const providedSecret = request.headers.get(RELAY_SECRET_HEADER);
  const relayedIp = request.headers.get(RELAY_CLIENT_IP_HEADER);
  if (providedSecret === null || relayedIp === null) return fallback;

  const source = normalizeIpAddress(connectingIp);
  if (source === null || !relayAllowlist(env).has(source)) return fallback;
  if (!(await secretsEqual(providedSecret, secret))) return fallback;

  return normalizeIpAddress(relayedIp) ?? fallback;
}
