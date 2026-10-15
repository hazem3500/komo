// Google Cloud Identity-Aware Proxy (IAP) sign-in. When KOMO_IAP_AUDIENCE names
// the IAP-protected backend (/projects/<number>/global/backendServices/<id>),
// the load balancer routes the sign-in paths through IAP. Sessions are minted
// from IAP's signed identity instead of a Google OAuth client, and reading
// comments requires one of those sessions.
import { check, HttpError } from "./validation";

const KEYS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";
const ISSUER = "https://cloud.google.com/iap";
let cached: { keys: Map<string, CryptoKey>; expires: number } | undefined;

async function keys(refresh = false) {
  if (!refresh && cached && cached.expires > Date.now()) return cached.keys;
  const response = await fetch(KEYS_URL);
  check(response.ok, 503, "Could not verify sign-in. Try again shortly.");
  const { keys: list } = (await response.json()) as {
    keys?: (JsonWebKey & { kid?: string })[];
  };
  const imported = new Map<string, CryptoKey>();
  for (const { kid, ...key } of list ?? [])
    if (kid && key.kty === "EC" && key.crv === "P-256")
      imported.set(
        kid,
        await crypto.subtle.importKey(
          "jwk",
          key,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        ),
      );
  cached = { keys: imported, expires: Date.now() + 3600000 };
  return imported;
}

const decode = (part: string) =>
  Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );

export type IapIdentity = { id: string; email: string };

/** Verify IAP's signed header and return the Google account it vouches for. */
export async function iapIdentity(
  request: Request,
  audience: string,
): Promise<IapIdentity> {
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
  const kid = header.kid;
  // IAP rotates keys; refetch once before rejecting an unknown key id.
  const key = (await keys()).get(kid) ?? (await keys(true)).get(kid);
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
      claims.exp > now &&
      typeof claims.iat === "number" &&
      claims.iat < now + 60,
    401,
    "Invalid sign-in.",
  );
  // IAP's subject is the same numeric Google account id the OAuth flow stores.
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

/** Path prefix for IAP sign-in handlers, e.g. "/backoffice"; "" when unset. */
export function authPrefix(value: string | undefined): string {
  if (!value) return "";
  const prefix = value.replace(/\/+$/, "");
  if (!/^(\/[A-Za-z0-9._~-]+)+$/.test(prefix))
    throw new Error("KOMO_AUTH_PREFIX must be a path such as /backoffice");
  return prefix;
}

/** Split PUBLIC_URL into its origin and an optional path the app is served under. */
export function publicLocation(value: string): { origin: string; path: string } {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  if (
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (path && !/^(\/[A-Za-z0-9._~-]+)+$/.test(path)) ||
    `${url.origin}${path}` !== value.replace(/\/+$/, "") ||
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname))
  )
    throw new Error(
      "PUBLIC_URL must be an HTTPS origin, optionally with a path such as https://example.com/komo (localhost allowed for development)",
    );
  return { origin: url.origin, path };
}
