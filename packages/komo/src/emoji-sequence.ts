// The browser's check for one emoji: flags, keycaps, tag sequences, and
// pictographs with optional modifiers joined by ZWJ. It follows the Unicode
// emoji grammar instead of bundling emoji-regex's 14 KB table; the API still
// validates reactions with the exact list (./emoji.ts).
const sequence =
  /^(?:\p{RI}\p{RI}|[#*0-9]️?⃣|\p{Extended_Pictographic}[️\p{Emoji_Modifier}]?(?:‍\p{Extended_Pictographic}[️\p{Emoji_Modifier}]?)*|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F})$/u;

export const isEmoji = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && sequence.test(value);
