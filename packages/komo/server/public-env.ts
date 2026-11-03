import type { D1Database, RateLimit } from "@cloudflare/workers-types";

export interface ServerEnv {
  DB: D1Database;
  PROJECTS: string;
  GOOGLE_CLIENT_ID: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_SECRET: string;
  KOMO_WEBHOOK_KEYS?: string;
  KOMO_WEBHOOK_SEND?: (
    url: string,
    body: string,
    headers: Record<string, string>
  ) => Promise<void>;
  /** Optional server secret mixed into access token hashes. Changing it revokes every token. */
  KOMO_TOKEN_PEPPER?: string;
  KOMO_HOSTED?: string;
  KOMO_PAUSED?: string;
  /** Trusted identity proxy that signs reviewers in, e.g. "gcp-iap". Off unless set. */
  KOMO_PROXY_AUTH?: string;
  /** The audience the proxy signs its assertions for. */
  KOMO_PROXY_AUDIENCE?: string;
  /** Older name: setting it alone turns on "gcp-iap" with this audience. */
  KOMO_IAP_AUDIENCE?: string;
  /** Path the proxy protects for the sign-in handlers, e.g. "/backoffice". */
  KOMO_AUTH_PATH_PREFIX?: string;
  /** Older name for KOMO_AUTH_PATH_PREFIX. */
  KOMO_AUTH_PREFIX?: string;
  /** "true" makes reading comments need a session. Always on with a proxy. */
  KOMO_REQUIRE_SESSION_FOR_READS?: string;
  /** "false" refuses guest sign-in on every project. Always off with a proxy. */
  KOMO_ALLOW_GUESTS?: string;
  /** Caps session age in days. Unset keeps sessions until sign-out. */
  KOMO_SESSION_MAX_AGE_DAYS?: string;
  /** Path the app is served under behind a proxy that strips it, e.g. "/komo". */
  KOMO_PUBLIC_PATH?: string;
  EDGE_LIMIT?: RateLimit;
  KOMO_VERSION?: { id: string };
}
