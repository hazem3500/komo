import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { validateWebhookUrl } from "./webhooks";

const MAX_IN_FLIGHT = 8;
const MAX_BODY_BYTES = 16 * 1024;
let inFlight = 0;

export function isPublicAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets;
    if (octets.length !== 4 || octets.some((value) => value < 0 || value > 255))
      return false;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (version !== 6 || address.includes("%")) return false;
  const normalized = address.toLowerCase();
  // Permit only global-unicast 2000::/3; reject documentation, transition,
  // protocol-assignment, and IPv4-mapped ranges within it as well.
  if (!/^[23]/.test(normalized)) return false;
  const secondGroup = Number.parseInt(normalized.split(":")[1] || "0", 16);
  return !(
    normalized.startsWith("2001:db8:") ||
    (normalized.startsWith("2001:") && secondGroup <= 0x1ff) ||
    normalized.startsWith("2002:") ||
    normalized.startsWith("3fff:") ||
    normalized.startsWith("::ffff:")
  );
}

export function assertPublicDnsRecords(records: { address: string; family: number }[]) {
  if (!records.length || records.some((record) => !isPublicAddress(record.address)))
    throw new Error("Webhook host did not resolve exclusively to public addresses.");
}

export function pinnedLookup(address: { address: string; family: number }): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  };
}

export async function sendWebhookPinned(
  urlValue: string,
  body: string,
  headers: Record<string, string>
) {
  if (inFlight >= MAX_IN_FLIGHT) throw new Error("Webhook capacity reached.");
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES)
    throw new Error("Webhook payload exceeds the delivery limit.");
  const url = new URL(validateWebhookUrl(urlValue));
  inFlight++;
  try {
    let dnsTimer: NodeJS.Timeout | undefined;
    const records = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(() => reject(new Error("Webhook DNS lookup timed out.")), 2_000);
      }),
    ]).finally(() => clearTimeout(dnsTimer));
    assertPublicDnsRecords(records);
    const address = records[0];
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let totalTimer: NodeJS.Timeout;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimer);
        if (error) reject(error);
        else resolve();
      };
      const req = httpsRequest(
        url,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body, "utf8"),
          },
          timeout: 2_000,
          lookup: pinnedLookup(address),
        },
        (response) => {
          // Read and discard a bounded amount. Never follow redirects or log bodies.
          let read = 0;
          response.on("data", (chunk: Buffer) => {
            read += chunk.length;
            if (read > 1024) response.destroy();
          });
          response.on("end", () => finish());
          response.on("close", () => finish());
          response.on("error", (error) => finish(error));
        }
      );
      totalTimer = setTimeout(
        () => req.destroy(new Error("Webhook timed out.")),
        2_000
      );
      req.on("timeout", () => req.destroy(new Error("Webhook timed out.")));
      req.on("error", (error) => finish(error));
      req.end(body);
    });
  } finally {
    inFlight--;
  }
}
