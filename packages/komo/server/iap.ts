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
// After a failed fetch, wait this long before trying again, and keep using
// the last keys for up to STALE_GRACE.
const RETRY_GAP = 30000;
const STALE_GRACE = 24 * KEY_LIFETIME;
const FETCH_TIMEOUT = 5000;
// Allowed clock difference between IAP and this server, in seconds.
const SKEW = 60;

let cached: { keys: Map<string, CryptoKey>; fetched: number } | undefined;
let pending: Promise<void> | undefined;
let failed = -Infinity;

async function load() {
  let list: (JsonWebKey & { kid?: string })[] | undefined;
  try {
    const response = await fetch(KEYS_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!response.ok) throw new Error(`IAP keys returned ${response.status}`);
    list = ((await response.json()) as { keys?: typeof list }).keys;
    if (!Array.isArray(list)) throw new Error("IAP keys are not a list");
  } catch (error) {
    failed = Date.now();
    console.error("iap_keys_unavailable", String(error));
    throw new HttpError(503, "Could not verify sign-in. Try again shortly.");
  }
  const keys = new Map<string, CryptoKey>();
  for (const { kid, ...key } of list)
    if (kid && key.kty === "EC" && key.crv === "P-256")
      try {
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
      } catch {
        /* Skip a key this runtime can't import. */
      }
  cached = { keys, fetched: Date.now() };
}
function refresh() {
  pending ??= load().finally(() => (pending = undefined));
  return pending;
}
async function signingKey(kid: string) {
  const now = Date.now();
  const age = cached ? now - cached.fetched : Infinity;
  const mayFetch = now - failed >= RETRY_GAP;
  if (age >= KEY_LIFETIME) {
    try {
      check(mayFetch, 503, "Could not verify sign-in. Try again shortly.");
      await refresh();
    } catch (error) {
      // While IAP's key endpoint is down, keep verifying with the last keys.
      if (age >= STALE_GRACE) throw error;
    }
  }
  // IAP rotates keys: refetch once before rejecting an unknown key id.
  if (!cached!.keys.has(kid) && now - cached!.fetched >= REFETCH_GAP && mayFetch)
    await refresh().catch(() => {
      /* Keep the known keys; this one is refused below. */
    });
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
  let signed: Uint8Array<ArrayBuffer>;
  try {
    header = JSON.parse(new TextDecoder().decode(decode(head)));
    claims = JSON.parse(new TextDecoder().decode(decode(payload)));
    signed = decode(signature);
  } catch {
    throw new HttpError(401, "Invalid sign-in.");
  }
  check(
    header && typeof header === "object" && claims && typeof claims === "object" &&
      header.alg === "ES256" && typeof header.kid === "string",
    401,
    "Invalid sign-in.",
  );
  const key = await signingKey(header.kid);
  check(key, 401, "Invalid sign-in.");
  const valid = await crypto.subtle
    .verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signed,
      new TextEncoder().encode(`${head}.${payload}`),
    )
    .catch(() => false);
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
