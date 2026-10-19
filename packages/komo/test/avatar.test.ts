// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { avatar, avatarSrc, setAvatarResolver } from "../src/dom";

const google = { id: "google:1", name: "Ada Lovelace", verified: true };
const photo = "https://lh3.googleusercontent.com/a/ada=s96-c";

afterEach(() => setAvatarResolver(undefined));

it("renders the stored photo safely over the initial", () => {
  const node = avatar({ ...google, avatarUrl: photo });
  const image = node.querySelector("img")!;
  expect(node.textContent).toBe("AL");
  expect(image.getAttribute("src")).toBe(photo);
  expect(image.alt).toBe("");
  expect(image.referrerPolicy).toBe("no-referrer");
  // jsdom does not reflect these two; browsers do (checked in the screenshot run).
  expect(image.loading).toBe("lazy");
  expect(image.decoding).toBe("async");
});

it("falls back to the initial when the photo is missing or fails to load", () => {
  expect(avatar(google).querySelector("img")).toBeNull();
  const node = avatar({ ...google, avatarUrl: photo });
  node.querySelector("img")!.dispatchEvent(new Event("error"));
  expect(node.querySelector("img")).toBeNull();
  expect(node.textContent).toBe("AL");
});

it("rejects non-HTTPS photo URLs", () => {
  for (const avatarUrl of [
    "http://example.test/a.png",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg onload=alert(1)>",
    '"><img src=x onerror=alert(1)>',
  ]) {
    expect(avatarSrc({ ...google, avatarUrl })).toBeUndefined();
    expect(avatar({ ...google, avatarUrl }).querySelector("img")).toBeNull();
  }
  // Photos uploaded in the Account panel stay supported.
  expect(
    avatarSrc({ ...google, avatarUrl: "data:image/jpeg;base64,AAAA" }),
  ).toBe("data:image/jpeg;base64,AAAA");
});

it("uses the host avatar resolver only when the server has no photo", () => {
  const calls: unknown[] = [];
  setAvatarResolver((user) => {
    calls.push(user);
    return `https://avatars.example/${user.name}.png`;
  });
  expect(avatarSrc({ ...google, name: "ada" })).toBe(
    "https://avatars.example/ada.png",
  );
  expect(calls).toEqual([{ id: "google:1", name: "ada" }]);
  expect(avatarSrc({ ...google, avatarUrl: photo })).toBe(photo);
  expect(calls).toHaveLength(1);
});

it("keeps the initial for guests and for unsafe or throwing resolvers", () => {
  setAvatarResolver(() => "https://avatars.example/guest.png");
  expect(avatarSrc({ id: "guest:1", name: "Guest", verified: false })).toBe(
    undefined,
  );
  setAvatarResolver(() => "http://avatars.example/a.png");
  expect(avatarSrc(google)).toBeUndefined();
  setAvatarResolver(() => undefined);
  expect(avatarSrc(google)).toBeUndefined();
  setAvatarResolver(() => {
    throw new Error("lookup failed");
  });
  expect(avatar(google).textContent).toBe("AL");
});
