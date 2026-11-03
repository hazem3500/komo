// Google Cloud Identity-Aware Proxy (KOMO_PROXY_AUTH=gcp-iap). IAP signs every
// request it forwards with an ES256 JWT in x-goog-iap-jwt-assertion; its
// subject is the numeric Google account id that Google OAuth also uses.
import type { ProxyAuthProvider, ProxyIdentity } from "./proxy-auth";
import { check, ConfigError, HttpError } from "./validation";

const KEYS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";
const ISSUER = "https://cloud.google.com/iap";
const KEY_LIFETIME = 3600000;
// An unknown key id refetches the set, at most this often, so forged ids
// can't turn each request into a fetch.
const REFETCH_GAP = 30000;
// Allowed clock difference between IAP and this server, in seconds.
const SKEW = 60;

let cached: { keys: Map<string, CryptoKey>; fetched: number } | undefined;
let pending: Promise<void> | undefined;

async function load() {
  const response = await fetch(KEYS_URL);
  check(response.ok, 503, "Could not verify sign-in. Try again shortly.");
  const { keys: list } = (await response.json()) as {
    keys?: (JsonWebKey & { kid?: string })[];
  };
  const keys = new Map<string, CryptoKey>();
  for (const { kid, ...key } of list ?? [])
    if (kid && key.kty === "EC" && key.crv === "P-256")
      keys.set(
        kid,
        await crypto.subtle.importKey(
          "jwk",
          key,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        ),
      );
  cached = { keys, fetched: Date.now() };
}
function refresh() {
  pending ??= load().finally(() => (pending = undefined));
  return pending;
}
async function signingKey(kid: string) {
  if (!cached || Date.now() - cached.fetched >= KEY_LIFETIME) await refresh();
  // IAP rotates keys: refetch once before rejecting an unknown key id.
  if (!cached!.keys.has(kid) && Date.now() - cached!.fetched >= REFETCH_GAP)
    await refresh();
  return cached!.keys.get(kid);
}

const decode = (part: string) =>
  Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );

/** Verify IAP's signed header and return the Google account it vouches for. */
export async function iapIdentity(
  request: Request,
  audience: string,
): Promise<ProxyIdentity> {
  const jwt = request.headers.get("x-goog-iap-jwt-assertion") ?? "";
  const [head, payload, signature, extra] = jwt.split(".");
  check(
    head && payload && signature && extra === undefined,
    401,
    "Sign in with your Google account.",
  );
  let header: { alg?: unknown; kid?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(decode(head)));
    claims = JSON.parse(new TextDecoder().decode(decode(payload)));
  } catch {
    throw new HttpError(401, "Invalid sign-in.");
  }
  check(
    header.alg === "ES256" && typeof header.kid === "string",
    401,
    "Invalid sign-in.",
  );
  const key = await signingKey(header.kid);
  check(key, 401, "Invalid sign-in.");
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    decode(signature),
    new TextEncoder().encode(`${head}.${payload}`),
  );
  const now = Date.now() / 1000;
  check(
    valid &&
      claims.iss === ISSUER &&
      claims.aud === audience &&
      typeof claims.exp === "number" &&
      claims.exp > now - SKEW &&
      typeof claims.iat === "number" &&
      claims.iat <= now + SKEW,
    401,
    "Invalid sign-in.",
  );
  // IAP's subject is the same numeric Google account id the OAuth flow stores,
  // so both sign-ins share one account.
  const sub =
    typeof claims.sub === "string"
      ? claims.sub.match(/^accounts\.google\.com:(\d{1,40})$/)?.[1]
      : undefined;
  check(
    sub &&
      typeof claims.email === "string" &&
      claims.email.length <= 254 &&
      claims.email.includes("@"),
    401,
    "Invalid sign-in.",
  );
  return { id: `google:${sub}`, email: claims.email.toLowerCase() };
}

export function gcpIap(audience: string): ProxyAuthProvider {
  if (!/^\/projects\/\d+\/[A-Za-z0-9/_-]+$/.test(audience))
    throw new ConfigError(
      "KOMO_PROXY_AUDIENCE must be the IAP audience, such as /projects/PROJECT_NUMBER/global/backendServices/SERVICE_ID.",
    );
  return {
    name: "gcp-iap",
    signIn: "google",
    identify: (request) => iapIdentity(request, audience),
  };
}
