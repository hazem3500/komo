// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { appendMessageLinks } from "../src/message-links.js";

describe("comment message links", () => {
  const render = (text: string) => {
    const element = document.createElement("p");
    appendMessageLinks(element, text);
    return element;
  };

  it("autolinks bare URLs and retains adjacent punctuation", () => {
    const element = render(
      "See https://example.com/a(b), then http://example.org!",
    );
    expect([...element.querySelectorAll("a")].map((link) => link.href)).toEqual(
      ["https://example.com/a(b)", "http://example.org/"],
    );
    expect(element.textContent).toBe(
      "See https://example.com/a(b), then http://example.org!",
    );
  });

  it("supports simple Markdown links and escapes label text", () => {
    const element = render("[<roadmap>](https://example.com/roadmap)");
    expect(element.querySelector("a")?.textContent).toBe("<roadmap>");
    expect(element.querySelector("a")?.rel).toBe("noopener noreferrer");
    expect(element.querySelector("a")?.target).toBe("_blank");
    expect(element.children).toHaveLength(1);
  });

  it("does not link credentials or non-HTTP schemes", () => {
    const element = render("https://user:pass@example.com javascript:alert(1)");
    expect(element.querySelectorAll("a")).toHaveLength(0);
    expect(element.textContent).toBe(
      "https://user:pass@example.com javascript:alert(1)",
    );
  });
});
