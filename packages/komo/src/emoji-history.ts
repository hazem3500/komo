import { isEmoji } from "./emoji-sequence.js";

export const DEFAULT_EMOJI = ["👍", "❤️", "🎉", "👀", "✅", "🤔"];
export type EmojiHistory = { counts: Record<string, number>; recent?: string };

export function rankedEmoji(history: EmojiHistory, selected?: string) {
  const candidates = [
    ...new Set([...DEFAULT_EMOJI, ...Object.keys(history.counts)]),
  ].filter(isEmoji);
  const score = (emoji: string) =>
    history.counts[emoji] ?? (DEFAULT_EMOJI.includes(emoji) ? 1 : 0);
  const sort = (a: string, b: string) => score(b) - score(a);
  const result = candidates.sort(sort).slice(0, 6);
  const recent = selected ?? history.recent;
  if (recent && isEmoji(recent) && !result.includes(recent)) {
    result[result.length - 1] = recent;
    result.sort(sort);
  }
  return result;
}

const memory = new Map<string, EmojiHistory>();
export function emojiHistory(key: string): EmojiHistory {
  if (memory.has(key)) return memory.get(key)!;
  const history: EmojiHistory = { counts: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    for (const [emoji, count] of Object.entries(saved?.counts ?? {}).slice(
      0,
      200
    )) {
      if (
        isEmoji(emoji) &&
        typeof count === "number" &&
        Number.isFinite(count) &&
        count > 0
      )
        history.counts[emoji] = count;
    }
    if (isEmoji(saved?.recent)) history.recent = saved.recent;
  } catch {
    /* Storage may be unavailable in embedded previews. */
  }
  memory.set(key, history);
  return history;
}

export function recordEmoji(key: string, emoji: string) {
  if (!isEmoji(emoji)) return;
  const history = emojiHistory(key);
  history.counts[emoji] =
    (history.counts[emoji] ?? (DEFAULT_EMOJI.includes(emoji) ? 1 : 0)) + 1;
  history.recent = emoji;
  history.counts = Object.fromEntries(
    Object.entries(history.counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200)
  );
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch {
    /* Keep the in-memory preferences. */
  }
}
