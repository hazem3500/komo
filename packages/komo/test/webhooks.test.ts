import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  signWebhook,
  validateWebhookUrl,
} from "../server/webhooks";
import {
  assertPublicDnsRecords,
  isPublicAddress,
  pinnedLookup,
} from "../server/node-webhooks";

const key = Buffer.alloc(32, 7).toString("base64");
const ring = JSON.stringify({ current: "k1", keys: { k1: key } });

describe("webhook security", () => {
  it("accepts only public HTTPS hostnames on the standard port", () => {
    expect(validateWebhookUrl("https://hooks.example.com/events")).toBe(
      "https://hooks.example.com/events"
    );
    for (const url of [
      "http://hooks.example.com/events",
      "https://127.0.0.1/events",
      "https://[::1]/events",
      "https://metadata.google.internal/",
      "https://service.local/events",
      "https://hooks.example.com:8443/events",
      "https://user:pass@hooks.example.com/events",
      "https://hooks.example.com/events#fragment",
    ])
      expect(() => validateWebhookUrl(url), url).toThrow();
  });

  it("encrypts project-bound secrets and fails closed on missing or wrong keys", async () => {
    const stored = await encryptWebhookSecret(ring, "project-a", "s".repeat(40));
    expect(stored).not.toContain("s".repeat(40));
    await expect(decryptWebhookSecret(ring, "project-a", stored)).resolves.toBe(
      "s".repeat(40)
    );
    await expect(decryptWebhookSecret(ring, "project-b", stored)).rejects.toThrow();
    await expect(decryptWebhookSecret(undefined, "project-a", stored)).rejects.toThrow();
    await expect(encryptWebhookSecret(undefined, "project-a", "s".repeat(40))).rejects.toThrow();
    await expect(encryptWebhookSecret(ring, "project-a", "short")).rejects.toThrow();
  });

  it("signs the exact timestamp-prefixed body bytes", async () => {
    const body = '{"event":"comment.created"}';
    const timestamp = 1_800_000_000;
    const signature = await signWebhook("secret", timestamp, body);
    const expected = createHmac("sha256", "secret")
      .update(`${timestamp}.${body}`)
      .digest("hex");
    expect(signature).toBe(`t=${timestamp},v1=${expected}`);
  });

  it("rejects DNS answers that include any non-public address", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    for (const ip of [
      "127.0.0.1",
      "10.2.3.4",
      "100.64.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "2001:1::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
    expect(() =>
      assertPublicDnsRecords([
        { address: "8.8.8.8", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ])
    ).toThrow(/public addresses/);
  });

  it("pins the HTTPS lookup callback to the vetted DNS answer", () => {
    const resolve = pinnedLookup({ address: "8.8.8.8", family: 4 });
    const call = resolve as unknown as (
      hostname: string,
      options: { all?: boolean },
      callback: (...values: unknown[]) => void
    ) => void;
    call("hooks.example.com", {}, (...values) => expect(values).toEqual([null, "8.8.8.8", 4]));
    call("hooks.example.com", { all: true }, (...values) =>
      expect(values).toEqual([null, [{ address: "8.8.8.8", family: 4 }]])
    );
  });
});
