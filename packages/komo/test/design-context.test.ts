// @vitest-environment jsdom
// Design mode comments name the theme state and component they were made in,
// as plain lines the comment card ignores and the CLI turns into a DesignEdit.
import { afterEach, describe, expect, it } from "vitest";
import { designProposal } from "../src/design-export";
import { parseDesignComment } from "../src/design-comment";
import { designContext } from "../src/react-props-panel";
import { registerInspectableRoot, type InspectableComponent } from "../src/react-inspector";
import type { DesignSystem, ThemeAxis } from "../src/design-system";
// @ts-expect-error CLI modules are plain JavaScript.
import { designEditFromComment } from "../cli/design-edit.mjs";

const card: InspectableComponent = {
  id: "promo-card",
  name: "PromoCard",
  source: "examples/react-props/src/card.tsx",
  line: 19,
  props: [
    { name: "title", kind: "string", required: true, typeLabel: "string" },
    { name: "tone", kind: "enum", values: ["calm", "bold"], required: true, typeLabel: '"calm" | "bold"' },
    { name: "compact", kind: "boolean", required: false, typeLabel: "boolean | undefined" },
    { name: "visits", kind: "number", required: true, typeLabel: "number" },
  ],
};
const axis = (id: string, current: string): ThemeAxis => ({ id, options: [{ id: current }], current: () => current, apply() {} });
const themes = [axis("mode", "dark"), axis("density", "compact")];
let cleanup = () => {};

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function mountCard() {
  document.body.innerHTML = '<main><article id="promo"><h2>Card, title</h2></article></main>';
  const root = document.querySelector<HTMLElement>("#promo")!;
  cleanup = registerInspectableRoot(root, card, { title: "Hello, world", tone: "calm", compact: false, visits: 3 }, () => {});
  return root;
}

describe("design comment context", () => {
  it("names the theme state and the registered component with its props", () => {
    const root = mountCard();
    expect(designContext(root, { themes })).toEqual([
      "Theme: mode=dark, density=compact",
      "Component: PromoCard (examples/react-props/src/card.tsx:19)",
      'Props: title="Hello, world", tone="calm", compact=false, visits=3',
    ]);
    // A heading inside the card names the card that renders it.
    expect(designContext(root.querySelector("h2")!)[0]).toBe("Component: PromoCard (examples/react-props/src/card.tsx:19)");
  });

  it("uses the app's component adapter and leaves out what it cannot vouch for", () => {
    document.body.innerHTML = "<button>Go</button>";
    const button = document.querySelector("button")!;
    const design: DesignSystem = {
      themes: [axis("mode", "light"), { ...axis("broken", "x"), current: () => { throw new Error("no"); } }],
      components: {
        identify: (element) => ({ name: "Button", source: "src/ui/Button.tsx:12", element, props: { variant: "secondary", label: "Next → step", long: "x".repeat(81) } }),
      },
    };
    expect(designContext(button, design)).toEqual([
      "Theme: mode=light",
      "Component: Button (src/ui/Button.tsx:12)",
      'Props: variant="secondary", label="Next \\u2192 step"',
    ]);
    expect(designContext(button, { components: { identify: () => { throw new Error("no"); } } })).toEqual([]);
    expect(designContext(button)).toEqual([]);
  });

  it("puts the context in the first section, after its target, without repeating a component", () => {
    const root = mountCard();
    const context = designContext(root, { themes });
    const style = designProposal(root, new Map([["padding", "24px"]]), () => "16px", undefined, [], context)!;
    expect(style.split("\n").slice(0, 6)).toEqual([
      "Proposed style changes (preview only)",
      "Target: #promo",
      "Theme: mode=dark, density=compact",
      "Component: PromoCard (examples/react-props/src/card.tsx:19)",
      'Props: title="Hello, world", tone="calm", compact=false, visits=3',
      "- padding: 16px → 24px",
    ]);
    const props = "Proposed React prop changes (preview only)\nComponent: PromoCard\nSource: examples/react-props/src/card.tsx:19\n- tone: \"calm\" → \"bold\" [custom value]";
    const body = designProposal(root, undefined, () => undefined, undefined, [props], context)!;
    expect(body.match(/^Component: /gm)).toHaveLength(1);
    expect(body).toContain("Theme: mode=dark, density=compact\nProps: ");
  });

  it("keeps the comment card unchanged, reading the source from the Component line", () => {
    const root = mountCard();
    const body = designProposal(root, new Map([["padding", "24px"]]), () => "16px", undefined, [], designContext(root, { themes }))!;
    const [section] = parseDesignComment(body);
    expect(section).toMatchObject({
      target: "#promo",
      component: "PromoCard",
      source: "examples/react-props/src/card.tsx:19",
      changes: [{ label: "padding", before: "16px", after: "24px" }],
    });
  });

  it("round-trips through the CLI into theme and target.component", () => {
    const root = mountCard();
    const props = "Proposed React prop changes (preview only)\nComponent: PromoCard\nSource: examples/react-props/src/card.tsx:19\n- brandColor: \"var(--color-muted)\" → \"var(--color-brand)\" [color.brand]";
    const body = designProposal(root, new Map([["padding", "24px"]]), () => "16px", undefined, [props], designContext(root, { themes }));
    expect(designEditFromComment(body, "article")).toEqual({
      komo: "design-edit",
      version: 1,
      target: {
        selector: "#promo",
        component: {
          name: "PromoCard",
          source: "examples/react-props/src/card.tsx:19",
          props: { title: "Hello, world", tone: "calm", compact: false, visits: 3 },
        },
      },
      theme: { mode: "dark", density: "compact" },
      changes: [
        { kind: "css", property: "padding", from: "16px", to: "24px" },
        { kind: "prop", name: "brandColor", from: "var(--color-muted)", to: "var(--color-brand)", token: "color.brand" },
      ],
    });
  });
});
