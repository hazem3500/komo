/** Append safe HTTP(S) links while leaving all unmatched text as text nodes. */
export function appendMessageLinks(element: HTMLElement, text: string): void {
  // Markdown links are deliberately limited to a single-line label and URL.
  const pattern =
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>]+/gi;
  let offset = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset)
      element.append(document.createTextNode(text.slice(offset, index)));

    const markdown = match[1] !== undefined;
    const rawUrl = markdown ? match[2] : match[0];
    const { url, trailing } = trimUrlPunctuation(rawUrl);
    const safe = safeHttpUrl(url);
    if (safe) {
      if (markdown) {
        const link = document.createElement("a");
        link.href = safe;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = match[1];
        element.append(link);
      } else {
        const link = document.createElement("a");
        link.href = safe;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = url;
        element.append(link);
      }
      if (trailing) element.append(document.createTextNode(trailing));
    } else {
      element.append(document.createTextNode(match[0]));
    }
    offset = index + match[0].length;
  }

  if (offset < text.length)
    element.append(document.createTextNode(text.slice(offset)));
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function trimUrlPunctuation(value: string): { url: string; trailing: string } {
  let end = value.length;
  while (end > 0 && /[.,!?;:]$/.test(value.slice(0, end))) end--;
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    while (end > 0 && value[end - 1] === close) {
      const segment = value.slice(0, end);
      const opens = [...segment].filter((char) => char === open).length;
      const closes = [...segment].filter((char) => char === close).length;
      if (closes <= opens) break;
      end--;
    }
  }
  return { url: value.slice(0, end), trailing: value.slice(end) };
}
