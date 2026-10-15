import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { useKomo, useKomoDesignTokens, useKomoInspectable, type InspectableComponent, type InspectableScalar, type KomoDesignToken } from "../../../src/react.js";
import manifest from "../.generated/manifest.json";
import { PromoCard, type PromoCardProps } from "./card.js";

const component = manifest.components[0];
const headlineComponent: InspectableComponent = {
  id: "demo-headline",
  name: "DemoHeadline",
  source: "examples/react-props/src/main.tsx",
  line: 23,
  props: [{ name: "text", kind: "string", required: true, typeLabel: "string" }],
  textProp: "text",
};
const themeTokens: KomoDesignToken[] = [
  { path: "color.brand", cssVariable: "--color-brand", type: "color", properties: ["color", "background-color", "border-color"], impactSelector: '.promo-card[data-tone="bold"]' },
  { path: "spacing.card", cssVariable: "--space-card", type: "dimension", properties: ["padding", "gap"], impactSelector: ".promo-card" },
  { path: "typography.body", cssVariable: "--font-body", type: "fontFamily", properties: ["font-family"], impactSelector: "body, .promo-card" },
  { path: "radius.card", cssVariable: "--radius-card", type: "dimension", properties: ["border-radius"], impactSelector: ".promo-card" },
];

function InlineHeadline({ text, onChange }: { text: string; onChange(next: string): void }) {
  const inspectable = useKomoInspectable({
    component: headlineComponent,
    props: { text },
    onChange(next: Record<string, InspectableScalar>) { if (typeof next.text === "string") onChange(next.text); },
    enabled: true,
  });
  return <h2 {...inspectable}>{text}</h2>;
}

function Demo() {
  const [headline, setHeadline] = useState("Inspect safe props in the flow of a real page.");
  const [props, setProps] = useState<PromoCardProps>({
    title: "A small change, made visible.",
    marker: "only",
    maybe: null,
    tone: "calm",
    compact: false,
    visits: 3,
    brandColor: "var(--color-brand)",
    children: "Edit safe, typed props in Design mode. Unsupported values stay read-only.",
    details: { featured: true },
    onActivate: () => setProps((current) => ({ ...current, visits: current.visits + 1 })),
  });
  useKomo({
    endpoint: "https://oz-box.camel-hake.ts.net:4342",
    project: "komo-landing-demo",
    repo: "tjcages/komo",
    branch: "main",
  });
  useKomoDesignTokens({ tokens: themeTokens, enabled: true });
  const updateProps = (next: Record<string, string | number | boolean | undefined>) =>
    setProps((current) => ({ ...current, ...next }));
  return (
    <main>
      <span className="eyebrow">komo · isolated React inspector</span>
      <InlineHeadline text={headline} onChange={setHeadline} />
      <p className="intro">
        Press D for Design mode, select this heading to try direct text editing, then
        select the card. Each color, spacing, typography, and radius control shows
        the token the card already uses; type a custom value or pick another token,
        or edit a shared theme value to preview it everywhere it applies.
      </p>
      <div className="demo-row">
        <PromoCard
          {...props}
          component={component}
          onPropsChange={updateProps}
        >
          {props.children}
        </PromoCard>
        <aside className="notes">
          <strong>Explicit registration only</strong>
          The build manifest comes from this component’s TypeScript props. Complex
          values, children, and callbacks are listed as read-only. Preview updates
          go through React state. Theme values use an explicit CSS-variable allowlist;
          shared edits are temporary and source files are never rewritten.
        </aside>
      </div>
      <div className="preview-banner">Fixture only · local test database · no production comments or notifications</div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(createElement(Demo));
