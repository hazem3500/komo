import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { useKomo } from "../../../src/react.js";
import manifest from "../.generated/manifest.json";
import { PromoCard, type PromoCardProps } from "./card.js";

const component = manifest.components[0];

function Demo() {
  const [props, setProps] = useState<PromoCardProps>({
    title: "A small change, made visible.",
    marker: "only",
    maybe: null,
    tone: "calm",
    compact: false,
    visits: 3,
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
  const updateProps = (next: Record<string, string | number | boolean | undefined>) =>
    setProps((current) => ({ ...current, ...next }));
  return (
    <main>
      <span className="eyebrow">komo · isolated React inspector</span>
      <h1>Inspect safe props in the flow of a real page.</h1>
      <p className="intro">
        Open the bottom brush, select the card, and edit the generated string, number,
        boolean, and enum controls. Change a value, then choose “Comment on element”
        to review the proposed diff before submitting a test comment.
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
          go through React state; source files are never rewritten.
        </aside>
      </div>
      <div className="preview-banner">Fixture only · local test database · no production comments or notifications</div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(createElement(Demo));
