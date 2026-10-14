const encoder = new TextEncoder();

export const WEBHOOK_EVENTS = [
  "comment.created",
  "comment.replied",
  "comment.resolved",
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

export type WebhookEvent = {
  id: string;
  event: WebhookEventName;
  occurredAt: string;
  projectKey: string;
  repo: string;
  branch: string;
  threadId: string;
  pageUrl: string;
  selector: string;
  author: string;
  body: string | null;
};

type WebhookEnv = {
  DB: {
    prepare(sql: string): {
      bind(...values: unknown[]): {
        first<T>(): Promise<T | null>;
      };
    };
  };
  KOMO_WEBHOOK_KEYS?: string;
  KOMO_WEBHOOK_SEND?: (
    url: string,
    body: string,
    headers: Record<string, string>
  ) => Promise<void>;
};

export function validateWebhookUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("Enter an HTTPS webhook URL under 2048 characters.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid HTTPS webhook URL.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !host.includes(".") ||
    /^(localhost|metadata|metadata\.google\.internal)(\.|$)/.test(host) ||
    /\.(localhost|local|internal|test|invalid|example)$/.test(host) ||
    host.startsWith("[") ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
  )
    throw new Error("Webhook URL must use a public HTTPS hostname on port 443.");
  url.hostname = host;
  return url.toString();
}

function keyring(raw: string | undefined) {
  if (!raw) throw new Error("Webhook encryption is not configured.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Webhook encryption is not configured.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Webhook encryption is not configured.");
  const ring = value as { current?: unknown; keys?: unknown };
  if (
    typeof ring.current !== "string" ||
    !ring.keys ||
    typeof ring.keys !== "object" ||
    Array.isArray(ring.keys)
  )
    throw new Error("Webhook encryption is not configured.");
  return ring as { current: string; keys: Record<string, string> };
}

async function aesKey(raw: string) {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("Webhook encryption key is invalid.");
  }
  if (bytes.length !== 32) throw new Error("Webhook encryption key is invalid.");
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return crypto.subtle.importKey("raw", buffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptWebhookSecret(
  rawKeyring: string | undefined,
  project: string,
  secret: string
) {
  if (secret.length < 32 || secret.length > 256)
    throw new Error("Webhook signing secret must be 32–256 characters.");
  const ring = keyring(rawKeyring);
  const material = ring.keys[ring.current];
  if (!material) throw new Error("Current webhook encryption key is unavailable.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(`komo-webhook:v1:${project}`) },
    await aesKey(material),
    encoder.encode(secret)
  );
  return `v1.${ring.current}.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptWebhookSecret(
  rawKeyring: string | undefined,
  project: string,
  stored: string
) {
  const [version, keyId, ivPart, dataPart, extra] = stored.split(".");
  if (version !== "v1" || !keyId || !ivPart || !dataPart || extra)
    throw new Error("Stored webhook secret is invalid.");
  const ring = keyring(rawKeyring);
  const material = ring.keys[keyId];
  if (!material) throw new Error("Webhook decryption key is unavailable.");
  try {
    const clear = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(ivPart),
        additionalData: encoder.encode(`komo-webhook:v1:${project}`),
      },
      await aesKey(material),
      fromBase64(dataPart)
    );
    return new TextDecoder().decode(clear);
  } catch {
    throw new Error("Webhook secret could not be decrypted.");
  }
}

export async function signWebhook(secret: string, timestamp: number, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`))
  );
  return `t=${timestamp},v1=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function dispatchWebhook(
  env: WebhookEnv,
  project: string,
  event: WebhookEvent
) {
  const row = await env.DB.prepare(
    "SELECT webhook_url,webhook_secret,webhook_events,webhook_enabled FROM project_settings WHERE project=?"
  )
    .bind(project)
    .first<{
      webhook_url: string | null;
      webhook_secret: string | null;
      webhook_events: string | null;
      webhook_enabled: number | null;
    }>();
  if (!row?.webhook_enabled || !row.webhook_url || !row.webhook_secret) return;
  const events = JSON.parse(row.webhook_events ?? "[]") as unknown;
  if (!Array.isArray(events) || !events.includes(event.event)) return;
  if (!env.KOMO_WEBHOOK_SEND) return;
  const body = JSON.stringify(event);
  if (encoder.encode(body).length > 16 * 1024) return;
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = await decryptWebhookSecret(
    env.KOMO_WEBHOOK_KEYS,
    project,
    row.webhook_secret
  );
  const signature = await signWebhook(secret, timestamp, body);
  await env.KOMO_WEBHOOK_SEND(row.webhook_url, body, {
    "X-Komo-Delivery": event.id,
    "X-Komo-Event": event.event,
    "X-Komo-Signature": signature,
  });
}

function toBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}
