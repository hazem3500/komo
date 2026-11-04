import { afterEach, describe, expect, it, vi } from "vitest";
import { authOptions, authPrefix, publicLocation } from "../server/proxy-auth";
import { checkProjects, clientAddress, nodeSetting, trustedProxyHops } from "../server/node-config";
import { originAllowed, sitePattern } from "../server/validation";
import { paletteEnv } from "../server/public-env";

const audience = "/projects/123/global/backendServices/456";
const KEYS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";

describe("sign-in options", () => {
  it("keeps every option off by default", () => {
    expect(authOptions({})).toEqual({
      proxy: undefined,
      signInPrefix: "",
      requireSessionForReads: false,
      allowGuests: true,
      sessionMaxAge: undefined,
    });
  });

  it("turns each option on by itself", () => {
    expect(authOptions({ PALETTE_REQUIRE_SESSION_FOR_READS: "true" })).toMatchObject({
      requireSessionForReads: true,
      allowGuests: true,
    });
    expect(authOptions({ PALETTE_ALLOW_GUESTS: "false" })).toMatchObject({
      requireSessionForReads: false,
      allowGuests: false,
    });
    expect(authOptions({ PALETTE_ALLOW_GUESTS: false })).toMatchObject({ allowGuests: false });
    expect(authOptions({ PALETTE_SESSION_MAX_AGE_DAYS: "30" }).sessionMaxAge).toBe(30 * 86400000);
    for (const bad of ["0", "-1", "1.5", "30d", "36501"])
      expect(() => authOptions({ PALETTE_SESSION_MAX_AGE_DAYS: bad })).toThrow("PALETTE_SESSION_MAX_AGE_DAYS");
    for (const bad of ["yes", "1", "TRUE"]) {
      expect(() => authOptions({ PALETTE_ALLOW_GUESTS: bad })).toThrow("PALETTE_ALLOW_GUESTS must be true or false.");
      expect(() => authOptions({ PALETTE_REQUIRE_SESSION_FOR_READS: bad })).toThrow("PALETTE_REQUIRE_SESSION_FOR_READS");
    }
  });

  it("forces session reads on and guests off under a proxy", () => {
    for (const env of [
      { PALETTE_PROXY_AUTH: "gcp-iap", PALETTE_PROXY_AUDIENCE: audience },
      { PALETTE_IAP_AUDIENCE: audience },
      { PALETTE_PROXY_AUTH: "gcp-iap", PALETTE_IAP_AUDIENCE: audience },
    ]) {
      const options = authOptions({
        ...env,
        PALETTE_ALLOW_GUESTS: "true",
        PALETTE_REQUIRE_SESSION_FOR_READS: "false",
      });
      expect(options.proxy).toMatchObject({ name: "gcp-iap", signIn: "google" });
      expect(options).toMatchObject({ requireSessionForReads: true, allowGuests: false });
    }
  });

  it("fails clearly on an unknown or incomplete proxy setup", () => {
    expect(() => authOptions({ PALETTE_PROXY_AUTH: "cloudflare-access", PALETTE_PROXY_AUDIENCE: "x" })).toThrow(
      'PALETTE_PROXY_AUTH "cloudflare-access" is not supported. Use one of: gcp-iap.',
    );
    expect(() => authOptions({ PALETTE_PROXY_AUTH: "gcp-iap" })).toThrow("PALETTE_PROXY_AUTH=gcp-iap needs PALETTE_PROXY_AUDIENCE.");
    expect(() => authOptions({ PALETTE_PROXY_AUDIENCE: audience })).toThrow("PALETTE_PROXY_AUDIENCE needs PALETTE_PROXY_AUTH");
    expect(() => authOptions({ PALETTE_PROXY_AUTH: "gcp-iap", PALETTE_PROXY_AUDIENCE: "456" })).toThrow(
      "PALETTE_PROXY_AUDIENCE must be the IAP audience",
    );
    expect(() =>
      authOptions({ PALETTE_PROXY_AUDIENCE: audience, PALETTE_IAP_AUDIENCE: "/projects/1/global/backendServices/2", PALETTE_PROXY_AUTH: "gcp-iap" }),
    ).toThrow("PALETTE_PROXY_AUDIENCE and PALETTE_IAP_AUDIENCE are set to different values.");
  });

  it("accepts both names for the sign-in prefix, only with a proxy", () => {
    const proxy = { PALETTE_IAP_AUDIENCE: audience };
    expect(authOptions({ ...proxy, PALETTE_AUTH_PATH_PREFIX: "/backoffice/" }).signInPrefix).toBe("/backoffice");
    expect(authOptions({ ...proxy, PALETTE_AUTH_PREFIX: "/backoffice" }).signInPrefix).toBe("/backoffice");
    expect(() => authOptions({ ...proxy, PALETTE_AUTH_PATH_PREFIX: "/a", PALETTE_AUTH_PREFIX: "/b" })).toThrow("different values");
    expect(() => authOptions({ PALETTE_AUTH_PATH_PREFIX: "/backoffice" })).toThrow("only applies with PALETTE_PROXY_AUTH");
    expect(authPrefix(undefined)).toBe("");
    for (const bad of ["backoffice", "/back office", "/../x?", "/.", "/..", "/a/../b", "/a/./b", "//x", "/a//b"])
      expect(() => authPrefix(bad), bad).toThrow("PALETTE_AUTH_PATH_PREFIX");
  });

  it("parses PUBLIC_URL with an optional path", () => {
    expect(publicLocation("https://comments.example.com")).toEqual({ origin: "https://comments.example.com", path: "" });
    expect(publicLocation("https://comments.example.com/komo/")).toEqual({ origin: "https://comments.example.com", path: "/komo" });
    expect(publicLocation("http://localhost:8080")).toEqual({ origin: "http://localhost:8080", path: "" });
    for (const bad of ["http://comments.example.com", "https://comments.example.com/komo?x=1", "https://user:pw@comments.example.com", "https://comments.example.com/ko mo"])
      expect(() => publicLocation(bad)).toThrow("PUBLIC_URL");
  });
});

describe("IAP assertion", () => {
  const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
  let keySets: { kid: string; key: CryptoKeyPair }[][] = [];
  let fetched = 0;
  let down = false;
  let signals: unknown[] = [];
  const pair = () =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;

  async function setup(...sets: { kid: string; key: CryptoKeyPair }[][]) {
    keySets = sets;
    fetched = 0;
    down = false;
    signals = [];
    // A fresh module per test starts with an empty key cache.
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe(KEYS_URL);
      signals.push(init?.signal);
      if (down) {
        fetched++;
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      const set = keySets[Math.min(fetched++, keySets.length - 1)];
      return Response.json({
        keys: await Promise.all(
          set.map(async ({ kid, key }) => ({ ...(await crypto.subtle.exportKey("jwk", key.publicKey)), kid })),
        ),
      });
    });
    return (await import("../server/iap")).iapIdentity;
  }
  async function jwt(kid: string, key: CryptoKeyPair, claims: Record<string, unknown> = {}, alg = "ES256") {
    const now = Math.floor(Date.now() / 1000);
    const head = base64url(new TextEncoder().encode(JSON.stringify({ alg, kid })));
    const payload = base64url(
      new TextEncoder().encode(
        JSON.stringify({
          iss: "https://cloud.google.com/iap",
          aud: audience,
          sub: "accounts.google.com:1234567890",
          email: "Reviewer@Example.COM",
          iat: now,
          exp: now + 600,
          ...claims,
        }),
      ),
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(`${head}.${payload}`)),
    );
    return `${head}.${payload}.${base64url(signature)}`;
  }
  const request = (assertion?: string) =>
    new Request("https://comments.example.com/", {
      headers: assertion ? { "x-goog-iap-jwt-assertion": assertion } : {},
    });
  const status = (promise: Promise<unknown>) =>
    promise.then(
      () => 200,
      (error: { status?: number }) => error.status,
    );
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const encode = (value: string) => Buffer.from(value).toString("base64url");

  it("returns the Google account id and the lower-cased email", async () => {
    const a = await pair();
    const iapIdentity = await setup([{ kid: "a", key: a }]);
    expect(await iapIdentity(request(await jwt("a", a)), audience)).toEqual({
      id: "google:1234567890",
      email: "reviewer@example.com",
    });
  });

  it("rejects a bad issuer, audience, expiry, issue time, subject, algorithm or signature", async () => {
    const a = await pair();
    const other = await pair();
    const iapIdentity = await setup([{ kid: "a", key: a }]);
    const now = Math.floor(Date.now() / 1000);
    for (const assertion of [
      undefined,
      "not-a-jwt",
      await jwt("a", a, { iss: "https://accounts.google.com" }),
      await jwt("a", a, { aud: "/projects/1/global/backendServices/2" }),
      await jwt("a", a, { exp: now - 61 }),
      await jwt("a", a, { exp: undefined }),
      await jwt("a", a, { iat: now + 61 }),
      await jwt("a", a, { iat: "now" }),
      await jwt("a", a, { sub: "1234567890" }),
      await jwt("a", a, { sub: "accounts.google.com:12ab" }),
      await jwt("a", a, { sub: "other.example:1234567890" }),
      await jwt("a", a, { email: "no-at-sign" }),
      await jwt("a", a, {}, "HS256"),
      await jwt("a", other),
    ])
      expect(await status(iapIdentity(request(assertion), audience))).toBe(401);
    // Within the clock-skew allowance either side.
    expect(await status(iapIdentity(request(await jwt("a", a, { exp: now - 30, iat: now + 30 })), audience))).toBe(200);
  });

  it("rejects malformed assertions with 401, not a server error", async () => {
    const a = await pair();
    const iapIdentity = await setup([{ kid: "a", key: a }]);
    const [head, payload] = (await jwt("a", a)).split(".");
    for (const assertion of [
      `${encode("null")}.${payload}.abc`,
      `${encode("[]")}.${payload}.abc`,
      `${encode("1")}.${payload}.abc`,
      `${head}.${encode("null")}.abc`,
      `${head}.${payload}.!!!!`,
      `${head}.${payload}.a`,
      `${head}.${payload}.`,
      `${encode('{"alg":"none","kid":"a"}')}.${payload}.`,
      `${encode('{"alg":"ES256","kid":"__proto__"}')}.${payload}.abc`,
    ])
      expect(await status(iapIdentity(request(assertion), audience)), assertion).toBe(401);
  });

  it("times out the key fetch and backs off after a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await pair();
    const iapIdentity = await setup([{ kid: "a", key: a }]);
    down = true;
    expect(await status(iapIdentity(request(await jwt("a", a)), audience))).toBe(503);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    // Within 30 seconds of a failure, no new attempt.
    vi.setSystemTime(Date.now() + 29000);
    expect(await status(iapIdentity(request(await jwt("a", a)), audience))).toBe(503);
    expect(fetched).toBe(1);
    down = false;
    vi.setSystemTime(Date.now() + 2000);
    expect(await status(iapIdentity(request(await jwt("a", a)), audience))).toBe(200);
    expect(fetched).toBe(2);
  });

  it("keeps using the last keys for a day while a refresh fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await pair();
    const iapIdentity = await setup([{ kid: "a", key: a }]);
    await iapIdentity(request(await jwt("a", a)), audience);
    down = true;
    vi.setSystemTime(Date.now() + 61 * 60000);
    expect(await status(iapIdentity(request(await jwt("a", a)), audience))).toBe(200);
    expect(fetched).toBe(2);
    // Backing off: no fetch, still verified with the stale keys.
    vi.setSystemTime(Date.now() + 10000);
    expect(await status(iapIdentity(request(await jwt("a", a)), audience))).toBe(200);
    expect(fetched).toBe(2);
    // An unknown key id doesn't fetch while backing off either.
    expect(await status(iapIdentity(request(await jwt("b", await pair())), audience))).toBe(401);
    expect(fetched).toBe(2);
    // Past the 24-hour grace, stale keys are no longer trusted.
    vi.setSystemTime(Date.now() + 24 * 3600000);
    expect(await status(iapIdentity(request(await jwt("a", a)), audience))).toBe(503);
    vi.setSystemTime(Date.now() + 10000);
    expect(await status(iapIdentity(request(await jwt("a", a)), audience))).toBe(503);
  });

  it("caches the keys for an hour", async () => {
    const a = await pair();
    const iapIdentity = await setup([{ kid: "a", key: a }]);
    const assertion = await jwt("a", a);
    await iapIdentity(request(assertion), audience);
    vi.setSystemTime(Date.now() + 59 * 60000);
    await iapIdentity(request(await jwt("a", a)), audience);
    expect(fetched).toBe(1);
    vi.setSystemTime(Date.now() + 2 * 60000);
    await iapIdentity(request(await jwt("a", a)), audience);
    expect(fetched).toBe(2);
  });

  it("refetches once for an unknown key id, at most every 30 seconds", async () => {
    const a = await pair();
    const b = await pair();
    const iapIdentity = await setup([{ kid: "a", key: a }], [{ kid: "a", key: a }, { kid: "b", key: b }]);
    await iapIdentity(request(await jwt("a", a)), audience);
    // Just fetched: an unknown id is refused without asking again.
    expect(await status(iapIdentity(request(await jwt("b", b)), audience))).toBe(401);
    expect(fetched).toBe(1);
    vi.setSystemTime(Date.now() + 31000);
    expect(await iapIdentity(request(await jwt("b", b)), audience)).toMatchObject({ id: "google:1234567890" });
    expect(fetched).toBe(2);
    // An id still unknown after the refetch costs no further fetches.
    const forged = await pair();
    expect(await status(iapIdentity(request(await jwt("c", forged)), audience))).toBe(401);
    expect(await status(iapIdentity(request(await jwt("c", forged)), audience))).toBe(401);
    expect(fetched).toBe(2);
  });
});

describe("forwarded client address", () => {
  it("trusts no X-Forwarded-For unless hops are configured", () => {
    expect(trustedProxyHops({})).toBe(0);
    expect(clientAddress("203.0.113.9", 0, "10.0.0.2")).toBe("10.0.0.2");
    expect(clientAddress(undefined, 0, undefined)).toBe("local");
  });

  it("counts trusted hops from the right and ignores spoofed entries on the left", () => {
    // Client sent "1.1.1.1"; three proxies appended the client, the LB and the proxy before the app.
    const header = "1.1.1.1, 203.0.113.9, 10.0.0.1, 10.0.0.2";
    expect(clientAddress(header, 3, "10.0.0.3")).toBe("203.0.113.9");
    expect(clientAddress(header, 1, "10.0.0.3")).toBe("10.0.0.2");
    expect(clientAddress(["1.1.1.1, 203.0.113.9", "10.0.0.1"], 2, "10.0.0.3")).toBe("203.0.113.9");
    expect(clientAddress("2001:db8::1, 10.0.0.1", 2, "10.0.0.3")).toBe("2001:db8::1");
    // Too few entries or a non-address at that position: fall back to the peer.
    expect(clientAddress("10.0.0.1", 3, "10.0.0.3")).toBe("10.0.0.3");
    expect(clientAddress("evil, 10.0.0.1", 2, "10.0.0.3")).toBe("10.0.0.3");
    expect(clientAddress(undefined, 2, "10.0.0.3")).toBe("10.0.0.3");
  });

  it("reads both option names and rejects bad values", () => {
    expect(trustedProxyHops({ PALETTE_TRUSTED_PROXY_HOPS: "3" })).toBe(3);
    expect(trustedProxyHops({ PALETTE_PROXY_HOPS: "2" })).toBe(2);
    expect(trustedProxyHops({ PALETTE_PROXY_HOPS: "2", PALETTE_TRUSTED_PROXY_HOPS: "2" })).toBe(2);
    expect(() => trustedProxyHops({ PALETTE_PROXY_HOPS: "2", PALETTE_TRUSTED_PROXY_HOPS: "3" })).toThrow("different values");
    for (const bad of ["-1", "9", "1.5", "two"])
      expect(() => trustedProxyHops({ PALETTE_TRUSTED_PROXY_HOPS: bad })).toThrow("PALETTE_TRUSTED_PROXY_HOPS");
  });
});

describe("settings named before the rename", () => {
  // Deployments configured with KOMO_ names keep working unchanged.
  it("reads each KOMO_ name when its PALETTE_ name is unset", () => {
    expect(authOptions({
      KOMO_REQUIRE_SESSION_FOR_READS: "true",
      KOMO_ALLOW_GUESTS: "false",
      KOMO_SESSION_MAX_AGE_DAYS: "30",
    })).toEqual({ proxy: undefined, signInPrefix: "", requireSessionForReads: true, allowGuests: false, sessionMaxAge: 30 * 86400000 });
    const proxied = authOptions({ KOMO_PROXY_AUTH: "gcp-iap", KOMO_PROXY_AUDIENCE: audience, KOMO_AUTH_PATH_PREFIX: "/backoffice" });
    expect(proxied).toMatchObject({ signInPrefix: "/backoffice", requireSessionForReads: true, allowGuests: false });
    expect(proxied.proxy?.name).toBe("gcp-iap");
    expect(authOptions({ KOMO_PROXY_AUTH: "gcp-iap", KOMO_PROXY_AUDIENCE: audience, KOMO_AUTH_PREFIX: "/backoffice" }).signInPrefix).toBe("/backoffice");
    expect(trustedProxyHops({ KOMO_TRUSTED_PROXY_HOPS: "3" })).toBe(3);
    expect(trustedProxyHops({ KOMO_PROXY_HOPS: "2" })).toBe(2);
  });

  it("prefers the PALETTE_ name when both are set", () => {
    expect(authOptions({ PALETTE_ALLOW_GUESTS: "false", KOMO_ALLOW_GUESTS: "true" }).allowGuests).toBe(false);
    expect(authOptions({ PALETTE_SESSION_MAX_AGE_DAYS: "7", KOMO_SESSION_MAX_AGE_DAYS: "30" }).sessionMaxAge).toBe(7 * 86400000);
    expect(trustedProxyHops({ PALETTE_TRUSTED_PROXY_HOPS: "1", KOMO_TRUSTED_PROXY_HOPS: "3" })).toBe(1);
  });

  it("reads the KOMO_ value when the PALETTE_ name is set but empty", () => {
    for (const empty of ["", null]) {
      expect(authOptions({ PALETTE_ALLOW_GUESTS: empty, KOMO_ALLOW_GUESTS: "false" }).allowGuests).toBe(false);
      expect(authOptions({ PALETTE_REQUIRE_SESSION_FOR_READS: empty, KOMO_REQUIRE_SESSION_FOR_READS: "true" }).requireSessionForReads).toBe(true);
      expect(authOptions({ PALETTE_SESSION_MAX_AGE_DAYS: empty, KOMO_SESSION_MAX_AGE_DAYS: "30" }).sessionMaxAge).toBe(30 * 86400000);
      const iap = authOptions({ PALETTE_IAP_AUDIENCE: empty, KOMO_IAP_AUDIENCE: audience });
      expect(iap.proxy?.name).toBe("gcp-iap");
      expect(iap).toMatchObject({ requireSessionForReads: true, allowGuests: false });
      const proxied = authOptions({
        PALETTE_PROXY_AUTH: empty, KOMO_PROXY_AUTH: "gcp-iap",
        PALETTE_PROXY_AUDIENCE: empty, KOMO_PROXY_AUDIENCE: audience,
        PALETTE_AUTH_PATH_PREFIX: empty, KOMO_AUTH_PATH_PREFIX: "/backoffice",
      });
      expect(proxied.proxy?.name).toBe("gcp-iap");
      expect(proxied.signInPrefix).toBe("/backoffice");
    }
    expect(trustedProxyHops({ PALETTE_TRUSTED_PROXY_HOPS: "", KOMO_TRUSTED_PROXY_HOPS: "2" })).toBe(2);
    expect(trustedProxyHops({ PALETTE_PROXY_HOPS: "", KOMO_PROXY_HOPS: "3" })).toBe(3);
    // The Node entry reads every other setting, webhook keys included, the same way.
    expect(nodeSetting({ PALETTE_WEBHOOK_KEYS: "", KOMO_WEBHOOK_KEYS: "ring" }, "WEBHOOK_KEYS")).toBe("ring");
    expect(nodeSetting({ PALETTE_WEBHOOK_KEYS: "new", KOMO_WEBHOOK_KEYS: "ring" }, "WEBHOOK_KEYS")).toBe("new");
    expect(nodeSetting({ PALETTE_ALLOW_GUESTS: "", KOMO_ALLOW_GUESTS: "false" }, "ALLOW_GUESTS")).toBe("false");
    expect(nodeSetting({ PALETTE_ALLOW_GUESTS: "" }, "ALLOW_GUESTS")).toBeUndefined();
  });

  it("still rejects bad values under the old names", () => {
    expect(() => authOptions({ KOMO_ALLOW_GUESTS: "yes" })).toThrow("PALETTE_ALLOW_GUESTS must be true or false.");
    expect(() => trustedProxyHops({ KOMO_PROXY_HOPS: "2", KOMO_TRUSTED_PROXY_HOPS: "3" })).toThrow("different values");
  });
});

describe("the layered settings", () => {
  it("keeps every binding through a spread, Object.keys and JSON.stringify", () => {
    class FakeD1 {
      prepare(sql: string) { return sql; }
    }
    const DB = new FakeD1();
    const env: Record<string, unknown> = { DB, GOOGLE_CLIENT_SECRET: "secret-value", KOMO_ALLOW_GUESTS: "false" };
    Object.defineProperty(env, "EDGE_LIMIT", { value: { limit: () => true }, enumerable: false });
    const layered = paletteEnv(env) as Record<string, unknown>;
    const spread = { ...layered };
    expect(spread.DB).toBe(DB);
    expect((spread.DB as FakeD1).prepare("SELECT 1")).toBe("SELECT 1");
    expect(spread.EDGE_LIMIT).toBe(env.EDGE_LIMIT);
    expect(spread.PALETTE_ALLOW_GUESTS).toBe("false");
    expect(Object.keys(layered)).toEqual(expect.arrayContaining(["DB", "EDGE_LIMIT", "GOOGLE_CLIENT_SECRET", "KOMO_ALLOW_GUESTS", "PALETTE_ALLOW_GUESTS"]));
    expect(JSON.stringify(layered)).toContain("secret-value");
    expect(env.PALETTE_ALLOW_GUESTS).toBeUndefined();
  });
});

describe("site patterns", () => {
  it("accepts a wildcard port on a host, a host pattern and localhost", () => {
    for (const site of [
      "https://dev.example.com:*",
      "https://*-preview.example.com:*",
      "http://localhost:*",
      "http://127.0.0.1:*",
      "https://dev.example.com:3000",
    ])
      expect(sitePattern(site)).toBe(site);
    for (const bad of [
      "https://dev.example.com:3000:*",
      "https://dev.example.com:4*",
      "https://*.com:*",
      "https://dev.*.example.com:*",
      "http://dev.example.com:*",
      "https://dev.example.com:*/path",
      "http://localhost:3*",
    ])
      expect(() => sitePattern(bad)).toThrow("Use an HTTPS site");
  });

  it("matches any port, or none, but never widens the host or scheme", () => {
    const patterns = ["https://dev.example.com:*"];
    expect(originAllowed("https://dev.example.com:3000", patterns)).toBe(true);
    expect(originAllowed("https://dev.example.com:65535", patterns)).toBe(true);
    // The default port: browsers send the origin without it.
    expect(originAllowed("https://dev.example.com", patterns)).toBe(true);
    for (const origin of [
      "https://evil-dev.example.com:3000",
      "https://dev.example.com.evil.test:3000",
      "https://sub.dev.example.com:3000",
      "http://dev.example.com:3000",
      "https://dev.example.com:3000x",
    ])
      expect(originAllowed(origin, patterns)).toBe(false);
  });

  it("combines a wildcard port with a leftmost-label wildcard", () => {
    const patterns = ["https://*-preview.example.com:*"];
    expect(originAllowed("https://pr-1-preview.example.com:8443", patterns)).toBe(true);
    expect(originAllowed("https://pr-1-preview.example.com", patterns)).toBe(true);
    for (const origin of [
      "https://a.pr-1-preview.example.com:8443",
      "https://pr-1-preview.example.com.evil.test",
      "https://pr-1-preview.example.org:8443",
    ])
      expect(originAllowed(origin, patterns)).toBe(false);
    // Patterns without :* keep their exact port.
    expect(originAllowed("https://pr-1-preview.example.com:8443", ["https://*-preview.example.com"])).toBe(false);
  });

  it("names the project and origin when PROJECTS is invalid", () => {
    expect(() =>
      checkProjects(JSON.stringify({ review: { repo: "team/site", origins: ["https://dev.example.com:*", "http://localhost:*"] } })),
    ).not.toThrow();
    expect(() =>
      checkProjects(JSON.stringify({ review: { repo: "team/site", origins: ["https://dev.example.com:4*"] } })),
    ).toThrow('PROJECTS.review has an invalid origin "https://dev.example.com:4*". Use an HTTPS site');
    expect(() =>
      checkProjects(JSON.stringify({ review: { repo: "team/site", origins: ["https://Dev.example.com/"] } })),
    ).toThrow('PROJECTS.review has origin "https://Dev.example.com/"; write it as "https://dev.example.com".');
    expect(() => checkProjects(JSON.stringify({ review: { origins: [] } }))).toThrow("PROJECTS.review needs a repo");
    expect(() => checkProjects("{")).toThrow("PROJECTS must be JSON");
  });
});
