// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { anchorPass, captureAnchor, resolveAnchor } from "../src/anchors.js";

const point = { x: 20, y: 20 };
const capture = (element: Element) => captureAnchor(element, point, point);
beforeEach(() => {
  document.body.innerHTML = "";
  vi.stubGlobal("CSS", {
    escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"),
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    toJSON() {},
  });
});

describe("precise anchors", () => {
  it("resolves controls inside a body-level portal outside the app root", () => {
    document.body.innerHTML =
      '<div id="root"><button>Open</button></div><div data-komo></div><div role="dialog"><h2>Edit</h2><button>Save</button></div>';
    const save = document.querySelector('[role="dialog"] button')!;
    const anchor = capture(save);
    expect(resolveAnchor(anchor)).toBe(save);
    // Reopening the dialog renders a fresh portal at the end of body.
    document.querySelector('[role="dialog"]')!.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="dialog"><h2>Edit</h2><button>Save</button></div>',
    );
    expect(resolveAnchor(anchor)).toBe(
      document.querySelector('[role="dialog"] button'),
    );
  });
  it("recovers a repeated control within its stable scope after reordering cards", () => {
    document.body.innerHTML =
      '<section id="cards"><article><h2>Alpha</h2><button>Edit</button></article><article><h2>Beta</h2><button>Edit</button></article></section>';
    const cards = document.querySelector("section")!;
    const target = cards.querySelector("button")!;
    const anchor = capture(target);
    expect(anchor.context).toMatchObject({
      tag: "button",
      nearby: "Alpha Edit",
      scope: "#cards",
    });
    cards.append(cards.firstElementChild!);
    expect(resolveAnchor(anchor)).toBe(target);
    expect(resolveAnchor(anchor, cards.querySelector("button"))).toBe(target);
  });

  it("does not confuse a stable ancestor with a stable target for legacy anchors", () => {
    document.body.innerHTML = '<ul id="list"><li>Alpha</li><li>Beta</li></ul>';
    const list = document.querySelector("ul")!;
    const anchor = capture(list.firstElementChild!);
    delete anchor.context;
    list.prepend(list.lastElementChild!);
    expect(resolveAnchor(anchor)).toBeNull();
  });

  it("preserves a directly identified target through copy edits, but rejects duplicate IDs", () => {
    document.body.innerHTML = '<button id="save">Save</button>';
    const target = document.querySelector("button")!;
    const anchor = capture(target);
    target.setAttribute("data-comment-anchor", "save-action");
    target.textContent = "Save changes";
    expect(resolveAnchor(anchor)).toBe(target);
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button id="save">Save changes</button>',
    );
    expect(resolveAnchor(anchor, target)).toBeNull();
    expect(capture(target).selector).not.toBe("#save");
  });

  it("keeps legacy inline text anchors attached without introducing boundary spaces", () => {
    document.body.innerHTML =
      "<section><button>Save <b>changes</b>!</button></section>";
    const target = document.querySelector("button")!;
    const anchor = capture(target);
    delete anchor.context;
    anchor.text = "Save changes!";
    expect(resolveAnchor(anchor)).toBe(target);
  });

  it("detaches indistinguishable positional controls with and without a stable scope", () => {
    for (const id of ['id="toolbar"', ""]) {
      document.body.innerHTML = `<section ${id}><button>Edit</button><button>Edit</button></section>`;
      const parent = document.querySelector("section")!;
      const target = parent.lastElementChild!;
      const anchor = capture(target);
      expect(resolveAnchor(anchor, target)).toBeNull();
      parent.prepend(target);
      expect(resolveAnchor(anchor, target)).toBeNull();
    }
  });

  it("refuses ambiguous recovery rather than choosing the first matching control", () => {
    document.body.innerHTML =
      '<section id="cards"><article><h2>Alpha</h2><button>Edit</button></article></section>';
    const target = document.querySelector("button")!;
    const anchor = capture(target);
    target.remove();
    document.querySelector("section")!.innerHTML =
      "<div><article><h2>Alpha</h2><button>Edit</button></article><article><h2>Alpha</h2><button>Edit</button></article></div>";
    expect(resolveAnchor(anchor)).toBeNull();
  });

  it("captures semantic labels without form values or editable/script/style text", () => {
    document.body.innerHTML =
      '<section id="settings"><label for="name">Display name</label><input id="name" value="secret"><textarea>private draft</textarea><div contenteditable>private edit</div><script>secretCode()</script><style>.secret{}</style><button aria-label="Delete item"><svg></svg></button></section>';
    const button = document.querySelector("button")!;
    button.setAttribute(
      "style",
      "width: 120px; background-image: url(https://example.test/secret)",
    );
    const anchor = capture(button);
    expect(anchor.context?.styles).toContain("width: 120px");
    expect(anchor.context?.styles).not.toMatch(/url|secret/);
    expect(anchor.context?.label).toBe("Delete item");
    expect(anchor.context?.nearby).toBe("Display name");
    expect(capture(document.querySelector("input")!).context?.label).toBe(
      "Display name",
    );
    expect(
      JSON.stringify(capture(document.querySelector("section")!)),
    ).not.toMatch(/secret|private/);
  });

  it("captures only wholly contained public selections and resolves source after area promotion", () => {
    document.body.innerHTML =
      '<section id="area"><span>Public text</span><p>Outside</p></section>';
    const span = document.querySelector("span")!;
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(capture(span).context?.selectedText).toBe("Public text");
    range.setEndAfter(document.querySelector("p")!);
    expect(capture(span).context?.selectedText).toBeUndefined();
    Object.defineProperty(span, "getBoundingClientRect", {
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 30,
        height: 30,
        right: 30,
        bottom: 30,
        toJSON() {},
      }),
    });
    const source = vi.fn((element) => element.id + ".tsx");
    const anchor = captureAnchor(span, point, { x: 80, y: 80 }, source);
    expect(anchor.selector).toBe("#area");
    expect(source).toHaveBeenCalledWith(document.querySelector("section"));
    expect(anchor.source).toBe("area.tsx");
  });
});

it("indexes shared target scopes once per pass and revalidates after DOM changes", () => {
  document.body.innerHTML =
    '<section id="cards">' +
    Array.from(
      { length: 40 },
      (_, i) => `<article><h2>Item ${i}</h2><button>Edit</button></article>`,
    ).join("") +
    "</section>";
  const buttons = [...document.querySelectorAll("button")];
  const anchors = buttons.map(capture);
  const walks = vi.spyOn(document, "createTreeWalker");
  const pass = anchorPass();
  for (const [i, anchor] of anchors.entries()) {
    expect(pass.resolve(anchor)).toBe(buttons[i]);
    expect(pass.locate(anchor).attached).toBe(true);
    expect(pass.resolve(anchor)).toBe(buttons[i]);
  }
  expect(walks.mock.calls.length).toBeLessThan(300);
  const target = buttons[0];
  target.parentElement!.remove();
  expect(anchorPass().resolve(anchors[0])).toBeNull();
  expect(anchorPass().resolve(anchors[1])).toBe(buttons[1]);
});

describe("changing targets", () => {
  it("keeps a header attached when a counter disappears from its text", () => {
    document.body.innerHTML =
      '<div id="radix-_r_15_"><div><div class="flex header"><span>Get started</span><span class="count">2 / 4</span></div></div></div>';
    const header = document.querySelector(".header")!;
    const anchor = capture(header);
    expect(anchor.text).toBe("Get started 2 / 4");
    header.querySelector(".count")!.remove();
    expect(resolveAnchor(anchor)).toBe(header);
    expect(anchorPass().resolve(anchor)).toBe(header);
  });

  it("detaches when the selected element now has unrelated text", () => {
    document.body.innerHTML =
      '<main><div class="header">Get started 2 / 4</div></main>';
    const header = document.querySelector(".header")!;
    const anchor = capture(header);
    header.textContent = "Billing history";
    expect(resolveAnchor(anchor)).toBeNull();
  });

  it("skips generated React and Radix ids when building selectors", () => {
    for (const id of ["radix-_r_15_", ":r1:", "_r_15_", "«r3»"]) {
      document.body.innerHTML = `<section data-testid="panel"><div id="${id}"><p>Note</p></div></section>`;
      const anchor = capture(document.querySelector("p")!);
      expect(anchor.selector).not.toContain("#");
      expect(anchor.selector.startsWith('[data-testid="panel"]')).toBe(true);
      expect(anchor.context?.scope).toBe('[data-testid="panel"]');
    }
    document.body.innerHTML = '<div id="settings"><p>Note</p></div>';
    expect(capture(document.querySelector("p")!).selector).toMatch(/^#settings/);
  });
});
