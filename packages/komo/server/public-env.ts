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
  /** Enables Google Cloud IAP sign-in: the IAP backend service audience. */
  KOMO_IAP_AUDIENCE?: string;
  /** Path prefix for IAP sign-in handlers, e.g. "/backoffice". */
  KOMO_AUTH_PREFIX?: string;
  /** Path the app is served under behind a proxy that strips it, e.g. "/komo". */
  KOMO_PUBLIC_PATH?: string;
  EDGE_LIMIT?: RateLimit;
  KOMO_VERSION?: { id: string };
}
