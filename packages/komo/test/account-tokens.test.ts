// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, type CommentsApi } from "../src/api";
import { accountTokens, relativeTime, type ApiToken } from "../src/account-tokens";

const day = 864e5;
const now = Date.UTC(2026, 9, 20, 12);
const token = (id: string, name: string, extra: Partial<ApiToken> = {}): ApiToken => ({
  id, name, prefix: `komo_pat_${id}`, last4: "wxyz", scopes: ["comments:read"], projects: null,
  createdAt: now - 3 * day, expiresAt: now + 27 * day, lastUsedAt: null, expired: false, ...extra,
});
const SECRET = `komo_pat_newtoken0001_${"S".repeat(39)}abcd`;
const list = (tokens: ApiToken[]) => ({ tokens, projects: ["site", "other"], scopes: ["comments:read", "comments:write"] });
const client = () => ({ token: "session", user: { id: "google:reviewer" }, request: vi.fn() }) as unknown as CommentsApi;
const settled = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const frame = () => new Promise((done) => setTimeout(done, 60));
let back: ReturnType<typeof vi.fn>;
const mount = async (api: CommentsApi) => {
  const host = document.createElement("div");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const view = accountTokens(api, "site", back);
  shadow.append(view);
  await settled();
  return { view, shadow };
};
const buttonNamed = (root: ParentNode, name: string) =>
  [...root.querySelectorAll("button")].find((node) => (node.getAttribute("aria-label") || node.textContent) === name)!;
const escape = (target: Element) => target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now });
  back = vi.fn();
  window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  localStorage.clear();
});

it("formats relative times in both directions", () => {
  expect(relativeTime(now - 30e3, now)).toBe("just now");
  expect(relativeTime(now - 3 * day, now)).toBe("3 days ago");
  expect(relativeTime(now + 27 * day, now)).toBe("in 4 wk.");
  expect(relativeTime(now + 365 * day, now)).toBe("next yr.");
});

it("shows loading, then lists tokens with exact times for assistive tech", async () => {
  const api = client();
  let resolve!: (value: unknown) => void;
  vi.mocked(api.request).mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const { view } = await mount(api);
  expect(view.getAttribute("role")).toBe("region");
  expect(view.querySelector("[aria-busy=true] .api-tokens-skeleton")).not.toBeNull();
  expect(view.textContent).toContain("Loading API tokens");
  resolve(list([token("deploybot001", "Deploy bot", { scopes: ["comments:read", "comments:write"], projects: ["site"], lastUsedAt: now - 2 * 36e5 }), token("oldscript001", "Old script", { expired: true, expiresAt: now - day })]));
  await settled();
  const items = view.querySelectorAll("ul[aria-label='Your API tokens'] > li");
  expect(items).toHaveLength(2);
  expect([...items[0].querySelectorAll(".api-token-chip")].map((chip) => chip.textContent)).toEqual(["Read", "Write", "This project"]);
  const created = items[0].querySelector("time")!;
  expect(created.textContent).toBe("3 days ago");
  expect(created.dateTime).toBe(new Date(now - 3 * day).toISOString());
  expect(created.dataset.tip).toMatch(/2026/);
  expect(created.nextElementSibling!.className).toBe("sr-only");
  expect(items[1].textContent).toContain("Expired");
  expect(items[1].textContent).toContain("Never");
  expect(api.request).toHaveBeenCalledWith("account/tokens");
});

it("shows an empty state and explains servers without tokens without offering a retry", async () => {
  const api = client();
  vi.mocked(api.request).mockResolvedValueOnce(list([]));
  expect((await mount(api)).view.textContent).toContain("No tokens yet");
  vi.mocked(api.request).mockRejectedValueOnce(new ApiError(404, "Not found."));
  const missing = (await mount(api)).view;
  expect(missing.querySelector("[role=alert]")!.textContent).toBe("This komo server doesn’t support API tokens.");
  expect(buttonNamed(missing, "Try again")).toBeUndefined();
  vi.mocked(api.request).mockRejectedValueOnce(new ApiError(429, "Too many requests. Try again shortly."));
  const limited = (await mount(api)).view;
  expect(limited.querySelector("[role=alert]")!.textContent).toBe("Too many requests. Try again shortly.");
  vi.mocked(api.request).mockResolvedValueOnce(list([token("a00000000001", "Recovered")]));
  buttonNamed(limited, "Try again").click();
  await settled();
  expect(limited.textContent).toContain("Recovered");
});

it("creates only on submit, reveals the secret once and never stores it", async () => {
  const api = client();
  vi.mocked(api.request).mockResolvedValueOnce(list([]));
  const { view } = await mount(api);
  buttonNamed(view, "New token").click();
  const form = view.querySelector("form")!;
  expect(api.request).toHaveBeenCalledTimes(1);
  form.requestSubmit();
  await settled();
  expect(form.querySelector("[role=alert]")!.textContent).toBe("Name your token.");
  expect(api.request).toHaveBeenCalledTimes(1);
  form.querySelector<HTMLInputElement>("input[type=text]")!.value = "  CI bot ";
  form.querySelector<HTMLInputElement>("input[value='comments:read']")!.checked = false;
  form.requestSubmit();
  await settled();
  expect(form.querySelector("[role=alert]")!.textContent).toBe("Choose read, write, or both.");
  form.querySelector<HTMLInputElement>("input[value='comments:write']")!.checked = true;
  form.querySelector<HTMLInputElement>("input[name=projects][value=all]")!.checked = true;
  form.querySelector<HTMLInputElement>("input[name=expiry][value=null]")!.checked = true;
  vi.mocked(api.request).mockResolvedValueOnce({ token: SECRET, item: token("newtoken0001", "CI bot", { last4: "abcd" }) });
  form.requestSubmit();
  await settled();
  expect(api.request).toHaveBeenLastCalledWith("account/tokens", "POST", { name: "CI bot", scopes: ["comments:write"], expiresInDays: null, projects: [] });
  expect(view.querySelector(".api-tokens-secret code")!.textContent).toBe(SECRET);
  expect(view.textContent).toContain("You won’t see this token again.");
  expect(view.querySelectorAll("li")).toHaveLength(1);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  buttonNamed(view, "Copy token").click();
  await settled();
  expect(writeText).toHaveBeenCalledWith(SECRET);
  await frame();
  expect(view.querySelector("[aria-live=polite]")!.textContent).toBe("Token copied to the clipboard.");
  // Escape never discards an unread secret.
  escape(view.querySelector("h2")!);
  expect(back).not.toHaveBeenCalled();
  expect(view.querySelector(".api-tokens-secret")).not.toBeNull();
  buttonNamed(view, "Done").click();
  expect(view.innerHTML).not.toContain(SECRET);
  expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain(SECRET);
});

it("explains rate limits and quota errors on create and keeps the form", async () => {
  const api = client();
  vi.mocked(api.request).mockResolvedValueOnce(list([]));
  const { view } = await mount(api);
  buttonNamed(view, "New token").click();
  const form = view.querySelector("form")!;
  form.querySelector<HTMLInputElement>("input[type=text]")!.value = "CI bot";
  vi.mocked(api.request).mockRejectedValueOnce(new ApiError(429, "Too many requests. Try again shortly."));
  form.requestSubmit();
  await settled();
  expect(form.querySelector("[role=alert]")!.textContent).toBe("You’ve created several tokens recently. Try again later.");
  expect(form.querySelector<HTMLInputElement>("input[name=projects]:checked")!.value).toBe("this");
  vi.mocked(api.request).mockRejectedValueOnce(new ApiError(409, "You can have up to 25 active tokens. Revoke one first."));
  form.requestSubmit();
  await settled();
  expect(form.querySelector("[role=alert]")!.textContent).toBe("You can have up to 25 active tokens. Revoke one first.");
  expect(view.querySelector("form")).toBe(form);
  escape(form.querySelector("input")!);
  expect(view.querySelector("form")).toBeNull();
  expect(back).not.toHaveBeenCalled();
  escape(view.querySelector("h2")!);
  expect(back).toHaveBeenCalledTimes(1);
});

it("revokes after an inline confirm, optimistically, with rollback on failure", async () => {
  const api = client();
  vi.mocked(api.request).mockResolvedValueOnce(list([token("first0000001", "First"), token("second000001", "Second"), token("third0000001", "Third")]));
  const { view } = await mount(api);
  buttonNamed(view, "Revoke First").click();
  expect(view.querySelector("[role=group]")!.getAttribute("aria-label")).toBe("Revoke First");
  escape(view.querySelector("[role=group] button")!);
  expect(view.querySelector("[role=group]")).toBeNull();
  expect(api.request).toHaveBeenCalledTimes(1);

  let fail!: (error: Error) => void;
  vi.mocked(api.request).mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
  buttonNamed(view, "Revoke Second").click();
  buttonNamed(view, "Revoke token").click();
  expect([...view.querySelectorAll("li strong")].map((node) => node.textContent)).toEqual(["First", "Third"]);
  expect(api.request).toHaveBeenLastCalledWith("account/tokens/second000001", "DELETE");
  fail(new ApiError(500, "Comments are temporarily unavailable. Try again."));
  await settled();
  expect([...view.querySelectorAll("li strong")].map((node) => node.textContent)).toEqual(["First", "Second", "Third"]);
  expect(view.querySelector("li [role=alert]")!.textContent).toContain("temporarily unavailable");
  await frame();
  expect(view.querySelector("[aria-live=polite]")!.textContent).toBe("Couldn’t revoke Second.");

  // Already gone on the server counts as revoked.
  vi.mocked(api.request).mockRejectedValueOnce(new ApiError(404, "Token not found."));
  buttonNamed(view, "Revoke Third").click();
  buttonNamed(view, "Revoke token").click();
  await settled();
  await frame();
  expect([...view.querySelectorAll("li strong")].map((node) => node.textContent)).toEqual(["First", "Second"]);
  expect(view.querySelector("[aria-live=polite]")!.textContent).toBe("Revoked Third.");
});
