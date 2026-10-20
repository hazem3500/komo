/** Display only; never use these words as a route or record identity. */
export function readablePageLabel(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  });
  const words = segments
    .filter(segment => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment))
    .map(segment => segment
      .replace(/(?<=\p{L})-(?=\p{L})/gu, " ")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return words.join(" › ") || (segments.length ? "Page link" : "Home");
}
