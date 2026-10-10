import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { useKomo, useKomoDesignTokens, type KomoDesignToken } from "../../../src/react.js";
import manifest from "../.generated/manifest.json";
import { PromoCard, type PromoCardProps } from "./card.js";

const component = manifest.components[0];
const themeTokens: KomoDesignToken[] = [
  { path: "color.brand", cssVariable: "--color-brand", type: "color", properties: ["color", "background-color", "border-color"], impactSelector: '.promo-card[data-tone="bold"]' },
  { path: "spacing.card", cssVariable: "--space-card", type: "dimension", properties: ["padding", "gap"], impactSelector: ".promo-card" },
  { path: "typography.body", cssVariable: "--font-body", type: "fontFamily", properties: ["font-family"], impactSelector: "body, .promo-card" },
  { path: "radius.card", cssVariable: "--radius-card", type: "dimension", properties: ["border-radius"], impactSelector: ".promo-card" },
];

function Demo() {
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
      <h1>Inspect safe props in the flow of a real page.</h1>
      <p className="intro">
        Open the bottom brush, select the card, and try registered color, spacing,
        typography, and radius tokens. Choose “Use token on element” for a local
        reference, or explicitly preview a shared theme change and its affected scope.
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
