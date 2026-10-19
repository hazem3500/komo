import "../../../src/adapters/react-preview.js";
import { createElement, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { useKomo, useKomoDesignTokens, useKomoInspectable, type InspectableComponent, type InspectableScalar, type KomoDesignToken } from "../../../src/react.js";
import type { DesignToken, ThemeAxis, TokenAdapter, TokenUsage } from "../../../src/types.js";
import { discoverCssTokens } from "../../../src/adapters/css-variables.js";
import { discoverReactComponents } from "../../../src/adapters/react-fiber.js";
import { sourceResolver } from "./source-map.js";
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
  { path: "typography.title", cssVariable: "--font-weight-title", type: "fontWeight", properties: ["font-weight"], impactSelector: ".promo-card h2" },
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

// ?tokens=classes plugs in a class-based token adapter, as a Tailwind app would:
// each token is a utility class, so the page has no CSS variable to read.
const utilityTokens: DesignToken[] = [
  { path: "color.text.primary", type: "color", value: "#1f1f1f", properties: ["color"], group: "Text", label: "Primary", ref: "tk-text-primary", description: "Body copy and headings" },
  { path: "color.text.secondary", type: "color", value: "#6b6b6b", properties: ["color"], group: "Text", label: "Secondary", ref: "tk-text-secondary" },
  { path: "color.text.accent", type: "color", value: "#7c3aed", properties: ["color"], group: "Text", ref: "tk-text-accent", states: ["hover"] },
  { path: "color.bg.surface", type: "color", value: "#ffffff", properties: ["background-color"], group: "Background", label: "Surface", ref: "tk-bg-surface" },
  { path: "color.bg.interactive", type: "color", value: "#f4f0ff", properties: ["background-color"], group: "Background", label: "Interactive", ref: "tk-bg-interactive", states: ["hover", "active", "disabled"] },
  { path: "color.bg.accent-soft", type: "color", value: "rgba(124, 58, 237, 0.16)", properties: ["background-color"], group: "Background", label: "Accent soft", ref: "tk-bg-accent-soft", description: "Translucent tint over any surface" },
  { path: "space.xs", type: "dimension", value: "4px", properties: ["padding", "gap"], group: "Spacing", ref: "tk-p-xs" },
  { path: "space.sm", type: "dimension", value: "8px", properties: ["padding", "gap"], group: "Spacing", ref: "tk-p-sm" },
  { path: "space.md", type: "dimension", value: "16px", properties: ["padding", "gap"], group: "Spacing", ref: "tk-p-md" },
  { path: "space.lg", type: "dimension", value: "24px", properties: ["padding", "gap"], group: "Spacing", ref: "tk-p-lg" },
  { path: "space.xl", type: "dimension", value: "40px", properties: ["padding", "gap"], group: "Spacing", ref: "tk-p-xl" },
  { path: "radius.sm", type: "dimension", value: "4px", properties: ["border-radius"], group: "Radius", ref: "tk-rounded-sm" },
  { path: "radius.lg", type: "dimension", value: "12px", properties: ["border-radius"], group: "Radius", ref: "tk-rounded-lg" },
  { path: "type.body", type: "typography", value: "400 14px/1.5 system-ui, sans-serif", properties: ["font-size"], group: "Type", label: "Body", ref: "tk-type-body" },
  { path: "type.title", type: "typography", value: "600 20px/1.3 Georgia, serif", properties: ["font-size"], group: "Type", label: "Title", ref: "tk-type-title", description: "Card and section titles" },
  { path: "font.weight.regular", type: "fontWeight", value: "400", properties: ["font-weight"], group: "Weight", ref: "tk-font-regular" },
  { path: "font.weight.semibold", type: "fontWeight", value: "600", properties: ["font-weight"], group: "Weight", ref: "tk-font-semibold" },
  { path: "font.family.serif", type: "fontFamily", value: "Georgia, serif", properties: ["font-family"], group: "Family", label: "Serif", ref: "tk-font-serif" },
  { path: "shadow.card", type: "shadow", value: "0 1px 2px #0000001f, 0 4px 12px #00000029", properties: ["box-shadow"], group: "Elevation", label: "Card", ref: "tk-shadow-card" },
  { path: "motion.fast", type: "duration", value: "150ms", properties: ["transition-duration"], group: "Motion", label: "Fast", ref: "tk-duration-fast" },
];
// Dark values for ?theme: list() answers per theme, and the classes follow [data-mode=dark].
const darkValues: Record<string, string> = {
  "color.text.primary": "#f1efeb", "color.text.secondary": "#a8a49d", "color.text.accent": "#c4b5fd",
  "color.bg.surface": "#1c1b1a", "color.bg.interactive": "#2e2546", "color.bg.accent-soft": "rgba(196, 181, 253, 0.2)",
};
const utilityCss = ".tk-text-primary{color:#1f1f1f}.tk-text-secondary{color:#6b6b6b}.tk-text-accent{color:#7c3aed}.tk-text-accent:hover{color:#5b21b6}" +
  ".tk-bg-surface{background-color:#fff}.tk-bg-interactive{background-color:#f4f0ff}.tk-bg-accent-soft{background-color:rgba(124,58,237,.16)}" +
  ".tk-p-xs{padding:4px}.tk-p-sm{padding:8px}.tk-p-md{padding:16px}.tk-p-lg{padding:24px}.tk-p-xl{padding:40px}.tk-rounded-sm{border-radius:4px}.tk-rounded-lg{border-radius:12px}" +
  ".tk-type-body{font:400 14px/1.5 system-ui,sans-serif}.tk-type-title{font:600 20px/1.3 Georgia,serif}.tk-font-regular{font-weight:400}.tk-font-semibold{font-weight:600}.tk-font-serif{font-family:Georgia,serif}" +
  "[data-mode=dark] .tk-text-primary{color:#f1efeb}[data-mode=dark] .tk-text-secondary{color:#a8a49d}[data-mode=dark] .tk-text-accent{color:#c4b5fd}" +
  "[data-mode=dark] .tk-bg-surface{background-color:#1c1b1a}[data-mode=dark] .tk-bg-interactive{background-color:#2e2546}[data-mode=dark] .tk-bg-accent-soft{background-color:rgba(196,181,253,.2)}";
const prefixes: Record<string, string> = {
  color: "tk-text-", "background-color": "tk-bg-", padding: "tk-p-", "border-radius": "tk-rounded-",
  "font-size": "tk-type-", "font-weight": "tk-font-", "font-family": "tk-font-",
};
// font-weight and font-family share the tk-font- prefix, so a property only owns its own tokens.
const owns = (property: string, ref: string) => ref.startsWith(prefixes[property]) && utilityTokens.some((token) => token.ref === ref && token.properties?.includes(property));
const classTokens: TokenAdapter = {
  id: "example-classes",
  list: (theme) => theme?.mode === "dark"
    ? utilityTokens.map((token) => ({ ...token, value: darkValues[token.path] ?? token.value }))
    : utilityTokens,
  resolve(element) {
    const usage: Record<string, TokenUsage> = {};
    for (const [property, prefix] of Object.entries(prefixes)) {
      const token = utilityTokens.find((item) => item.ref!.startsWith(prefix) && item.properties?.includes(property) && element.classList.contains(item.ref!));
      usage[property] = token ? { path: token.path } : { offToken: getComputedStyle(element).getPropertyValue(property) };
    }
    return usage;
  },
  preview(element, property, token) {
    const previous = [...element.classList].find((name) => owns(property, name));
    if (previous) element.classList.remove(previous);
    element.classList.add(token.ref!);
    return () => {
      element.classList.remove(token.ref!);
      if (previous) element.classList.add(previous);
    };
  },
  describe(element, property, from, to) {
    const previous = "path" in from ? utilityTokens.find((item) => item.path === from.path)?.ref : undefined;
    return previous ? `Replace class "${previous}" with "${to.ref}"` : `Add class "${to.ref}" for ${property}`;
  },
};

// ?shell renders an app-shell layout whose root is sized with viewport units, as
// many apps do (Tailwind "flex h-screen w-screen"). ?sidebar=frame starts in Frame.
const query = new URLSearchParams(location.search);
const appShell = query.has("shell");
const sidebar = query.get("sidebar") === "frame" ? "background" : undefined;
const classAdapter = query.get("tokens") === "classes";
// ?tokens=css discovers the stylesheet's custom properties instead of the registered allowlist.
const cssAdapter = query.get("tokens") === "css" ? discoverCssTokens() : null;
// ?theme adds a light/dark axis: Design mode shows a switcher for it, and comments
// name the theme they were made in.
// ?components=react discovers components; ?edit enables renderer-backed runtime previews.
// React 18 records the JSX call site on the fiber; React 19 records an Error stack.
// ?components=badge renders the same component with no adapter, to show discovery is off by default.
const fiberAdapter = query.get("components") === "react"
  ? discoverReactComponents({
      edit: query.has("edit"),
      resolveSource: query.get("react") === "18"
        ? (file, line) => `${file.replace(/^.*?(examples\/)/, "$1").replace(/^\//, "")}:${line}`
        : await sourceResolver(document.querySelector<HTMLScriptElement>("script[data-bundle]")?.dataset.bundle ?? "./.generated/react-props.js"),
    })
  : null;
const themes: ThemeAxis[] | undefined = query.has("theme") ? [{
  id: "mode",
  options: [{ id: "light" }, { id: "dark" }],
  current: () => document.documentElement.dataset.mode ?? "light",
  apply(id) { document.documentElement.dataset.mode = id; },
}] : undefined;

// ?portal opens a modal portalled to body, as most dialog libraries do,
// and mounts a toast a second later; Frame view should scale both with the page.
function BodyPortals() {
  const [open, setOpen] = useState(true);
  const [toast, setToast] = useState(false);
  useEffect(() => void setTimeout(() => setToast(true), 1000), []);
  return (
    <>
      {open && createPortal(<div className="portal-overlay" onClick={() => setOpen(false)} />, document.body)}
      {open && createPortal(
        <div className="portal-dialog" role="dialog" aria-label="Portal dialog">
          <h2>Body-level dialog</h2>
          <p>Rendered into body, outside the page root.</p>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </div>,
        document.body,
      )}
      {toast && createPortal(<div className="portal-toast" role="status">Toast mounted later</div>, document.body)}
    </>
  );
}

// Not registered with useKomoInspectable: Design mode finds it, read-only, only through the fiber adapter.
function TeamBadge({ team, seats, active, tags, owner, icon, authToken, onOpen }: {
  team: string; seats: number; active: boolean; tags: string[]; owner: { name: string; role: string };
  icon: ReturnType<typeof createElement>; authToken: string; onOpen(): void;
}) {
  return (
    <aside className="team-badge" data-token={authToken ? "set" : "none"}>
      <span aria-hidden>{icon}</span>
      <div>
        <strong>{team}</strong>
        <small>{owner.name} · {seats} seats · {active ? "active" : "paused"} · {tags.join(", ")}</small>
      </div>
      <button type="button" onClick={onOpen}>Open</button>
    </aside>
  );
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
    children: "Edit safe, typed props in Design mode. Callbacks and opaque values stay outside the editor.",
    details: { featured: true },
    onActivate: () => setProps((current) => ({ ...current, visits: current.visits + 1 })),
  });
  useKomo({
    endpoint: "https://oz-box.camel-hake.ts.net:4342",
    project: "komo-landing-demo",
    repo: "tjcages/komo",
    branch: "main",
    ...(sidebar ? { sidebar } : {}),
    // Portals make body children ambiguous, so name the page root, as portal-heavy apps do.
    ...(query.has("portal") ? { pageRoot: document.getElementById("root")! } : {}),
    ...(classAdapter || cssAdapter || themes || fiberAdapter ? { design: { ...(classAdapter ? { tokens: classTokens } : cssAdapter ? { tokens: cssAdapter } : {}), ...(themes ? { themes } : {}), ...(fiberAdapter ? { components: fiberAdapter } : {}) } } : {}),
  });
  useKomoDesignTokens({ tokens: themeTokens, enabled: true });
  const updateProps = (next: Record<string, string | number | boolean | undefined>) =>
    setProps((current) => ({ ...current, ...next }));
  const page = (
    <main>
      <span className="eyebrow">komo · isolated React inspector</span>
      <InlineHeadline text={headline} onChange={setHeadline} />
      <p className="intro">
        Press D for Design mode, select this heading to try direct text editing, then
        select the card. Each color, spacing, typography, and radius control shows
        the token the card already uses; type a custom value or pick another token,
        or edit a shared theme value to preview it everywhere it applies.
      </p>
      {(fiberAdapter || query.get("components") === "badge") && (
        <TeamBadge
          team="Design systems"
          seats={12}
          active
          tags={["tokens", "motion", "a11y", "docs", "review", "release", "support"]}
          owner={{ name: "Rin", role: "lead" }}
          icon={<b>★</b>}
          authToken="demo-secret-not-shown"
          onOpen={() => {}}
        />
      )}
      {classAdapter && (
        <>
          <style>{utilityCss}</style>
          <p className="tk-text-secondary tk-p-sm" style={{ fontSize: 13 }}>
            Class tokens: this note uses tk-text-secondary and tk-p-sm. Select it to swap them.
          </p>
          <p className="tk-p-md" style={{ fontSize: 13, color: "light-dark(#1f1f1f, #ecebe6)" }}>
            Off-token: this note's color is set inline, not from a token.
          </p>
          <p className="tk-text-secondary tk-rounded-sm tk-font-regular" style={{ fontSize: 13, padding: 16, backgroundColor: "rgb(244, 240, 255)" }}>
            Matching values: this note's padding and fill are set inline to 16px and rgb(244, 240, 255), the same as space.md and Interactive.
          </p>
        </>
      )}
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
          values, children, and callbacks are omitted from the editor. Preview updates
          go through React state. Theme values use an explicit CSS-variable allowlist;
          shared edits are temporary and source files are never rewritten.
        </aside>
      </div>
      {query.has("portal") && <BodyPortals />}
      <div className="preview-banner">Fixture only · local test database · no production comments or notifications</div>
    </main>
  );
  if (!appShell) return page;
  return (
    <div className="app-shell" style={{ display: "flex", width: "100vw", height: "100vh" }}>
      <nav className="app-nav" style={{ width: 220, flex: "none", padding: 20, borderRight: "1px solid #0001", background: "#ecebe6" }}>
        <strong>App shell</strong>
        <p style={{ fontSize: 13, color: "#666" }}>Root sized with 100vw × 100vh; the page scrolls inside.</p>
      </nav>
      <div className="app-content" style={{ flex: 1, overflow: "auto" }}>{page}</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(createElement(Demo));
