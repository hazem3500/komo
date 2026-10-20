/** Split only at top level, preserving quoted commas, escapes and CSS functions. */
export function cssParts(value: string, comma = false): string[] {
  const parts: string[] = [];
  let start = 0, depth = 0, quote = "", escaped = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { escaped = true; continue; }
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (!depth && (comma ? c === "," : /\s/.test(c))) {
      if (value.slice(start, i).trim()) parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (value.slice(start).trim()) parts.push(value.slice(start).trim());
  return parts;
}
export const primaryFamily = (value: string) => cssParts(value, true)[0]?.replace(/^(['"])(.*)\1$/, "$2") || value;
