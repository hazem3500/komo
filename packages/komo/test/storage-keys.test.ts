import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { CommentsApi } from "../src/api";
import { shellNonce } from "../src/shell-session";
import { forget, legacyKey, migrateStorage } from "../src/storage-keys";

const options = { endpoint: "https://api.example.test", project: "project", repo: "repo", branch: "main" };
const user = { id: "reviewer", name: "Reviewer", verified: true };
let dom: JSDOM;
function page(url = "https://preview.example.test/") {
  dom = new JSDOM("", { url });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("location", dom.window.location);
  vi.stubGlobal("localStorage", dom.window.localStorage);
  vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
}
afterEach(() => {
  vi.unstubAllGlobals();
  dom.window.close();
});

it("copies Palette's keys from before the rename and keeps the old ones", () => {
  page();
  localStorage.setItem("branch-comments:pin-size:project:repo", "dot");
  localStorage.setItem("komo:setup:https://api.example.test:code", '{"project":"komo_1"}');
  localStorage.setItem("komo:geometry-moved", "1");
  sessionStorage.setItem("branch-comments:comments-hidden:project:repo", "1");
  migrateStorage();
  expect(localStorage.getItem("palette:pin-size:project:repo")).toBe("dot");
  expect(localStorage.getItem("palette:setup:https://api.example.test:code")).toBe('{"project":"komo_1"}');
  expect(localStorage.getItem("palette:geometry-moved")).toBe("1");
  expect(sessionStorage.getItem("palette:comments-hidden:project:repo")).toBe("1");
  // An older copy of the app on this origin, or a rollback, still reads them.
  expect(localStorage.getItem("branch-comments:pin-size:project:repo")).toBe("dot");
  expect(localStorage.getItem("komo:setup:https://api.example.test:code")).toBe('{"project":"komo_1"}');
  expect(localStorage.getItem("komo:geometry-moved")).toBe("1");
  expect(sessionStorage.getItem("branch-comments:comments-hidden:project:repo")).toBe("1");
});

it("leaves the host's own keys alone", () => {
  page();
  localStorage.setItem("komo:theme", "dark");
  localStorage.setItem("komo:cart", "3");
  localStorage.setItem("branch-comments:something-else", "x");
  localStorage.setItem("host-app:theme", "dark");
  migrateStorage();
  expect(Object.keys(localStorage).sort()).toEqual(["branch-comments:something-else", "host-app:theme", "komo:cart", "komo:theme"]);
});

it("keeps a value already written under the new name", () => {
  page();
  localStorage.setItem("palette:pin-size:project:repo", "full");
  localStorage.setItem("branch-comments:pin-size:project:repo", "dot");
  migrateStorage();
  expect(localStorage.getItem("palette:pin-size:project:repo")).toBe("full");
  expect(localStorage.getItem("branch-comments:pin-size:project:repo")).toBe("dot");
});

it("forgets a key under both names, so a cleared value doesn't come back", () => {
  page();
  sessionStorage.setItem("branch-comments:toolbar-dismissed:project:repo", "1");
  migrateStorage();
  forget(sessionStorage, "palette:toolbar-dismissed:project:repo");
  migrateStorage();
  expect(sessionStorage.getItem("palette:toolbar-dismissed:project:repo")).toBeNull();
  expect(sessionStorage.getItem("branch-comments:toolbar-dismissed:project:repo")).toBeNull();
  expect(legacyKey("palette:shell")).toBe("komo:shell");
  expect(legacyKey("palette:https://api.example.test:project")).toBe("branch-comments:https://api.example.test:project");
  expect(legacyKey("palette:unknown")).toBeUndefined();
});

it("keeps a session stored before the upgrade signed in", () => {
  page();
  localStorage.setItem(`branch-comments:${options.endpoint}:${options.project}`, "old-session");
  localStorage.setItem(
    `branch-comments:${options.endpoint}:${options.project}:user`,
    JSON.stringify({ token: "old-session", user }),
  );
  migrateStorage();
  const api = new CommentsApi(options);
  expect(api.token).toBe("old-session");
  expect(api.user).toEqual(user);
  // Signing out clears the session under both names, so the next mount can't restore it.
  api.clear();
  migrateStorage();
  expect(new CommentsApi(options).token).toBeNull();
  expect(Object.keys(localStorage).filter((key) => key.includes(options.endpoint))).toEqual([]);
});

it("recognizes a shell started before the upgrade, before Palette mounts", () => {
  const nonce = "a".repeat(32);
  page(`https://preview.example.test/?komo-shell=${nonce}`);
  sessionStorage.setItem("komo:shell", JSON.stringify({ v: 1, project: "project", nonce, origin: location.origin }));
  expect(shellNonce("project")).toBe(nonce);
  migrateStorage();
  expect(sessionStorage.getItem("palette:shell")).not.toBeNull();
  expect(shellNonce("project")).toBe(nonce);
});
