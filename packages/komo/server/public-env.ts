import type { D1Database, RateLimit } from "@cloudflare/workers-types";

export interface ServerEnv {
  DB: D1Database;
  PROJECTS: string;
  GOOGLE_CLIENT_ID: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_SECRET: string;
  EDGE_LIMIT?: RateLimit;
  PALETTE_WEBHOOK_KEYS?: string;
  PALETTE_WEBHOOK_SEND?: (
    url: string,
    body: string,
    headers: Record<string, string>
  ) => Promise<void>;
  /** Optional server secret mixed into access token hashes. Changing it revokes every token. */
  PALETTE_TOKEN_PEPPER?: string;
  PALETTE_HOSTED?: string;
  PALETTE_PAUSED?: string;
  /** Trusted identity proxy that signs reviewers in, e.g. "gcp-iap". Off unless set. */
  PALETTE_PROXY_AUTH?: string;
  /** Explicitly allow bounded, project-scoped access tokens behind a proxy. */
  PALETTE_PROXY_ACCESS_TOKENS?: string;
  /** The audience the proxy signs its assertions for. */
  PALETTE_PROXY_AUDIENCE?: string;
  /** Older name: setting it alone turns on "gcp-iap" with this audience. */
  PALETTE_IAP_AUDIENCE?: string;
  /** Path the proxy protects for the sign-in handlers, e.g. "/backoffice". */
  PALETTE_AUTH_PATH_PREFIX?: string;
  /** Older name for PALETTE_AUTH_PATH_PREFIX. */
  PALETTE_AUTH_PREFIX?: string;
  /** "true" makes reading comments need a session. Always on with a proxy. */
  PALETTE_REQUIRE_SESSION_FOR_READS?: string;
  /** "false" refuses guest sign-in on every project. Always off with a proxy. */
  PALETTE_ALLOW_GUESTS?: string;
  /** Caps session age in days. Unset keeps sessions until sign-out. */
  PALETTE_SESSION_MAX_AGE_DAYS?: string;
  /** Path the app is served under behind a proxy that strips it, e.g. "/palette". */
  PALETTE_PUBLIC_PATH?: string;
  PALETTE_VERSION?: { id: string };
  /** @deprecated Read when PALETTE_WEBHOOK_KEYS is unset. */
  KOMO_WEBHOOK_KEYS?: string;
  /** @deprecated Read when PALETTE_WEBHOOK_SEND is unset. */
  KOMO_WEBHOOK_SEND?: (
    url: string,
    body: string,
    headers: Record<string, string>
  ) => Promise<void>;
  /** @deprecated Read when PALETTE_TOKEN_PEPPER is unset. */
  KOMO_TOKEN_PEPPER?: string;
  /** @deprecated Read when PALETTE_HOSTED is unset. */
  KOMO_HOSTED?: string;
  /** @deprecated Read when PALETTE_PAUSED is unset. */
  KOMO_PAUSED?: string;
  /** @deprecated Read when PALETTE_PROXY_AUTH is unset. */
  KOMO_PROXY_AUTH?: string;
  /** @deprecated Read when PALETTE_PROXY_ACCESS_TOKENS is unset. */
  KOMO_PROXY_ACCESS_TOKENS?: string;
  /** @deprecated Read when PALETTE_PROXY_AUDIENCE is unset. */
  KOMO_PROXY_AUDIENCE?: string;
  /** @deprecated Read when PALETTE_IAP_AUDIENCE is unset. */
  KOMO_IAP_AUDIENCE?: string;
  /** @deprecated Read when PALETTE_AUTH_PATH_PREFIX is unset. */
  KOMO_AUTH_PATH_PREFIX?: string;
  /** @deprecated Read when PALETTE_AUTH_PREFIX is unset. */
  KOMO_AUTH_PREFIX?: string;
  /** @deprecated Read when PALETTE_REQUIRE_SESSION_FOR_READS is unset. */
  KOMO_REQUIRE_SESSION_FOR_READS?: string;
  /** @deprecated Read when PALETTE_ALLOW_GUESTS is unset. */
  KOMO_ALLOW_GUESTS?: string;
  /** @deprecated Read when PALETTE_SESSION_MAX_AGE_DAYS is unset. */
  KOMO_SESSION_MAX_AGE_DAYS?: string;
  /** @deprecated Read when PALETTE_PUBLIC_PATH is unset. */
  KOMO_PUBLIC_PATH?: string;
  /** @deprecated Read when PALETTE_VERSION is unset. */
  KOMO_VERSION?: { id: string };
}

const unset = (value: unknown) => value === undefined || value === null || value === "";

/**
 * `env` with each PALETTE_ setting filled from its older KOMO_ name when unset
 * (missing, null or ""), so deployments configured before the rename keep working
 * unchanged and an empty PALETTE_ value never hides a KOMO_ one.
 */
export function paletteEnv<T extends object>(env: T): T {
  const values = env as Record<PropertyKey, unknown>;
  const legacy: Record<string, unknown> = {};
  for (const key in values)
    if (key.startsWith("KOMO_") && unset(values[`PALETTE_${key.slice(5)}`]) && !unset(values[key]))
      legacy[`PALETTE_${key.slice(5)}`] = values[key];
  if (!Object.keys(legacy).length) return env;
  // A plain copy of every binding (enumerable or not, by reference), so a spread,
  // Object.keys or JSON.stringify of the result still sees all of them.
  const copy: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(env)) copy[key] = values[key];
  for (const key in values) copy[key] = values[key];
  return Object.assign(copy, legacy) as T;
}
