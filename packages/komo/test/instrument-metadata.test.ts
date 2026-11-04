import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { collectComponents } from "../vite/metadata.mjs";
import { fixtureApp } from "./instrument-build.js";

// Which exports are components, and which of their props are editable, from the types alone.
let directory: string, result: Awaited<ReturnType<typeof collectComponents>>;
beforeAll(async () => {
  let app: string;
  ({ directory, app } = await fixtureApp(19));
  result = await collectComponents({ root: app, packages: ["@fixture/ui"], modules: [{ file: "src/ProjectCard.tsx", exports: ["ProjectCard", "ProjectList", "Missing", "ProjectCardProps"] }, { file: "src/Summary.view.tsx", exports: ["default"] }] });
}, 60_000);
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

const props = (name: string) => Object.fromEntries(
  result.entries.flatMap((entry) => entry.components).find((component) => component.name === name)!.props.map((prop) => [prop.name, prop]),
);

it("instruments every component export with editable props, and nothing else", () => {
  const ui = result.entries.find((entry) => entry.kind === "package")!;
  expect(ui.components.map((component) => component.export).sort()).toEqual(["Avatar", "Badge", "Button", "Counter", "Pair", "Panel", "Popover", "Tabs", "Tag", "TextField", "default"]);
  // `export { Quote as default }` keeps its component's name.
  expect(ui.components.find((component) => component.export === "default")!.name).toBe("Quote");
  // Every runtime export is re-exported by name; types aren't.
  expect(ui.values).toEqual(expect.arrayContaining(["colors", "cx", "useToggle", "ThemeProvider", "CheckIcon", "Button"]));
  expect(ui.values).not.toContain("ButtonProps");
  // Tokens, helpers and hooks aren't components; providers and icons are excluded by name.
  for (const name of ["colors", "cx", "useToggle", "ThemeProvider", "CheckIcon"]) expect(ui.components.some((component) => component.export === name)).toBe(false);
  expect(ui.components.every((component) => component.source === "@fixture/ui")).toBe(true);
});

it("reads variants, booleans, strings and numbers, and leaves callbacks, nodes, objects and DOM attributes out", () => {
  expect(props("Button")).toMatchObject({
    variant: { kind: "enum", values: ["primary", "secondary", "danger"], required: false },
    size: { kind: "enum", values: ["sm", "md", "lg"], required: false },
    disabled: { kind: "boolean", required: false },
    label: { kind: "string", required: false },
  });
  // From the HTML attributes, callbacks and nodes: none of these are controls.
  for (const name of ["onPress", "icon", "type", "title", "className", "onClick", "aria-label", "form"]) expect(props("Button")).not.toHaveProperty(name);
  expect(Object.keys(props("Button")).sort()).toEqual(["disabled", "label", "size", "variant"]);
  // A required prop that admits null can be left out; "author" isn't secret-looking.
  expect(props("Avatar")).toMatchObject({ src: { kind: "string", required: false }, author: { kind: "string" } });
  expect(props("Counter").step).toMatchObject({ kind: "enum", values: [1, 2, 5] });
  expect(props("Panel").elevation).toMatchObject({ kind: "enum", values: [0, 1, 2] });
  expect(Object.keys(props("TextField")).sort()).toEqual(["invalid", "label", "value"]);
});

it("instruments the allowlisted app component and says why the others aren't", () => {
  expect(props("ProjectCard")).toMatchObject({
    title: { kind: "string", required: true },
    status: { kind: "enum", values: ["on-track", "at-risk", "done"], required: true },
    compact: { kind: "boolean", required: false },
    progress: { kind: "number", required: true },
  });
  expect(props("ProjectCard")).not.toHaveProperty("owner");
  expect(props("ProjectCard")).not.toHaveProperty("onOpen");
  const card = result.entries.find((entry) => entry.kind === "module")!.components[0]!;
  expect(props("Summary")).toMatchObject({ tone: { kind: "enum", values: ["plain", "loud"], required: true } });
  expect(card.source).toBe("src/ProjectCard.tsx:11");
  expect(result.skipped).toEqual([
    { from: "src/ProjectCard.tsx", name: "ProjectList", reason: "no editable scalar props" },
    { from: "src/ProjectCard.tsx", name: "ProjectCardProps", reason: "a type, not a component" },
    { from: "src/ProjectCard.tsx", name: "Missing", reason: "not exported" },
  ]);
});
