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
  snapshotStatus?: "pending" | "skipped";
};

export type WebhookEnv = {
  DB: D1Database;
  PALETTE_WEBHOOK_KEYS?: string;
  PALETTE_WEBHOOK_SEND?: (
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
  event: WebhookEvent,
  destination?: { webhook_url: string; webhook_secret: string; webhook_events: string; webhook_enabled: number },
  storedBody?: string
) {
  const row = destination ?? await env.DB.prepare(
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
  if (!env.PALETTE_WEBHOOK_SEND) return;
  const body = storedBody ?? JSON.stringify(event);
  if (encoder.encode(body).length > 16 * 1024) throw Error("Webhook payload exceeds delivery limit");
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = await decryptWebhookSecret(
    env.PALETTE_WEBHOOK_KEYS,
    project,
    row.webhook_secret
  );
  const signature = await signWebhook(secret, timestamp, body);
  await env.PALETTE_WEBHOOK_SEND(validateWebhookUrl(row.webhook_url), body, {
    "X-Palette-Delivery": event.id,
    "X-Palette-Event": event.event,
    "X-Palette-Signature": signature,
    // The same values under the names receivers checked before the rename.
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

export function enqueueWebhook(
  db: D1Database,
  project: string,
  event: WebhookEvent,
  commentId: string,
) {
  return db
    .prepare(
      `INSERT INTO webhook_outbox(id,project,body,attempts,next_attempt,claim_until,claim_token,state,url,secret) SELECT ?,?,?,0,?,0,'','pending',webhook_url,webhook_secret FROM project_settings WHERE EXISTS (SELECT 1 FROM comments WHERE id=?) AND project=? AND webhook_enabled=1 AND webhook_url IS NOT NULL AND webhook_secret IS NOT NULL AND webhook_events LIKE ?`,
    )
    .bind(
      event.id,
      project,
      JSON.stringify(event),
      Date.now(),
      commentId,
      project,
      `%"${event.event}"%`,
    );
}

/** A bounded drain; run periodically even when no requests arrive. */
export async function drainWebhooks(env: WebhookEnv) {
  if (!env.PALETTE_WEBHOOK_SEND) return;
  for (let count = 0; count < 20; count++) {
    const now = Date.now();
    const token = crypto.randomUUID();
    const row = await env.DB.prepare(
      `UPDATE webhook_outbox SET claim_token=?,claim_until=?,attempts=attempts+1 WHERE id=(SELECT id FROM webhook_outbox WHERE state='pending' AND next_attempt<=? AND claim_until<=? AND attempts<6 ORDER BY next_attempt,id LIMIT 1) AND state='pending' AND claim_until<=? AND attempts<6 RETURNING id,project,body,attempts,url,secret`,
    )
      .bind(token, now + 30000, now, now, now)
      .first<{
        id: string;
        project: string;
        body: string;
        attempts: number;
        url: string;
        secret: string;
      }>();
    if (!row) break;
    let state = "delivered";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        dispatchWebhook(
          env,
          row.project,
          JSON.parse(row.body) as WebhookEvent,
          {
            webhook_url: row.url,
            webhook_secret: row.secret,
            webhook_events: JSON.stringify([
              (JSON.parse(row.body) as WebhookEvent).event,
            ]),
            webhook_enabled: 1,
          },
          row.body,
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Webhook send timed out")),
            5000,
          );
        }),
      ]);
    } catch {
      state = row.attempts >= 6 ? "exhausted" : "pending";
    } finally {
      clearTimeout(timer);
    }
    await env.DB.prepare(
      `UPDATE webhook_outbox SET state=?,next_attempt=?,claim_until=0,claim_token='' WHERE id=? AND claim_token=?`,
    )
      .bind(
        state,
        Date.now() + 10000 * 2 ** (row.attempts - 1),
        row.id,
        token,
      )
      .run();
  }
  await env.DB.prepare(
    `UPDATE webhook_outbox SET state='exhausted' WHERE state='pending' AND attempts>=6 AND claim_until<=?`,
  )
    .bind(Date.now())
    .run();
}
