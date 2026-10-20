import { expect, it } from "vitest";
import { readablePageLabel } from "../src/page-label";
import { pagePath } from "../server/validation";

it.each([
  ["/", "Home"],
  ["/reports/123/summary", "reports › 123 › summary"],
  ["/monthly-sales-report/2026-10-19/42", "monthly sales report › 2026-10-19 › 42"],
  ["/hello%20world/caf%C3%A9_notes", "hello world › café notes"],
  ["/reports/550e8400-e29b-41d4-a716-446655440000/summary", "reports › summary"],
  ["/550e8400-e29b-41d4-a716-446655440000", "Page link"],
  ["/%E0%A4%A", "%E0%A4%A"],
  ["/" + "long".repeat(100), "long".repeat(100)],
])("labels %s without modifying the URL", (path, expected) => {
  const url = new URL(path + "?date=2026#totals", "https://example.test");
  const exact = url.href;
  expect(readablePageLabel(url)).toBe(expected);
  expect(url.href).toBe(exact);
});
it("stores pathnames only; query/hash belong to the current URL context", () => {
  expect(pagePath("/reports/123/summary")).toBe("/reports/123/summary");
  expect(() => pagePath("/reports/123/summary?date=2026#totals")).toThrow();
});
