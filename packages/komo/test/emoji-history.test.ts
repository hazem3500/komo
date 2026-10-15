import { describe, expect, it, vi, afterEach } from "vitest";
import { isEmoji } from "../src/emoji";
import { isEmoji as isEmojiSequence } from "../src/emoji-sequence";
import {
  DEFAULT_EMOJI,
  emojiHistory,
  rankedEmoji,
  recordEmoji,
} from "../src/emoji-history";

afterEach(() => vi.unstubAllGlobals());
describe("emoji preferences", () => {
  it.each([
    ["API", isEmoji],
    ["browser", isEmojiSequence],
  ])("%s check accepts one complete emoji, including flags, skin tones and joined sequences", (_, check) => {
    for (const emoji of ["❤️", "👩🏽‍💻", "🇺🇸", "1️⃣", "👨‍👩‍👧‍👦", "🫶🏽", "🏳️‍🌈", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", ...DEFAULT_EMOJI])
      expect(check(emoji)).toBe(true);
    for (const value of ["", "hi", "1", "#", "👍👍", "👍 text", "<b>👍</b>", 1])
      expect(check(value)).toBe(false);
  });
  it("inserts a custom choice at the end, then promotes it with repeated use", () => {
    expect(rankedEmoji({ counts: {} })).toEqual(DEFAULT_EMOJI);
    expect(rankedEmoji({ counts: { "🦊": 1 }, recent: "🦊" })).toEqual([
      ...DEFAULT_EMOJI.slice(0, 5),
      "🦊",
    ]);
    expect(rankedEmoji({ counts: { "🦊": 2 }, recent: "🦊" })[0]).toBe("🦊");
    expect(rankedEmoji({ counts: { "🦊": 2, "🎉": 5 } })[0]).toBe("🎉");
  });
  it("persists per-reviewer history and keeps the selected emoji available", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    recordEmoji("reviewer-a", "🦊");
    recordEmoji("reviewer-a", "🦊");
    expect(JSON.parse(store.get("reviewer-a")!).counts["🦊"]).toBe(2);
    expect(emojiHistory("reviewer-b").counts).toEqual({});
    expect(rankedEmoji({ counts: {} }, "🦊")).toContain("🦊");
    store.set("restored-reviewer", store.get("reviewer-a")!);
    expect(rankedEmoji(emojiHistory("restored-reviewer"))[0]).toBe("🦊");
  });
});
