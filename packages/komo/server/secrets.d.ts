interface Env {
  GOOGLE_CLIENT_SECRET: string;
  KOMO_WEBHOOK_KEYS?: string;
  KOMO_WEBHOOK_SEND?: (
    url: string,
    body: string,
    headers: Record<string, string>
  ) => Promise<void>;
  KOMO_HOSTED?: string;
  KOMO_PAUSED?: string;
  EDGE_LIMIT?: RateLimit;
  KOMO_VERSION?: { id: string };
}

declare module "*.txt" {
  const content: string;
  export default content;
}
