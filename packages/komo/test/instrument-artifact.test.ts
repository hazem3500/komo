import { rm } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp, fixtureApp, outputFiles } from "./instrument-build.js";

// What each build ships. A customer build has the plugin disabled and no review code: it must
// be byte-for-byte the build without the plugin, with no instrumentation runtime, registry or
// component metadata. A preview build carries them, and the test reports what they cost.
let directory: string, app: string;
const builds: Record<"none" | "disabled" | "preview" | "baseline", Map<string, string>> = {} as never;
const warnings: string[] = [];

beforeAll(async () => {
  ({ directory, app } = await fixtureApp(19));
  builds.none = await outputFiles(await buildApp(app, join(directory, "none"), null));
  builds.disabled = await outputFiles(await buildApp(app, join(directory, "disabled"), false));
  // The same review build, with and without instrumentation, isolates what instrumentation adds.
  builds.baseline = await outputFiles(await buildApp(app, join(directory, "baseline"), null, true));
  builds.preview = await outputFiles(await buildApp(app, join(directory, "preview"), true, true, warnings));
}, 120_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const code = (files: Map<string, string>) => [...files].filter(([name]) => name.endsWith(".js")).map(([, text]) => text).join("\n");
const entry = (files: Map<string, string>) => [...files].find(([name]) => /^assets\/index-[\w-]+\.js$/.test(name))![1];
const gzip = (text: string) => gzipSync(text, { level: 9 }).length;

it("leaves a customer build exactly as it is without the plugin", () => {
  expect([...builds.disabled.keys()].sort()).toEqual([...builds.none.keys()].sort());
  for (const [name, text] of builds.none) expect(builds.disabled.get(name), name).toBe(text);
  const shipped = code(builds.disabled);
  for (const marker of ["komo", "palette", "instrumented-components", "typeLabel", "ProjectCard.tsx:", "@fixture/ui\""]) expect(shipped).not.toContain(marker);
});

it("instruments the preview build, with component metadata and the runtime, and reports the cost", () => {
  const shipped = code(builds.preview);
  expect(shipped).toContain("palette.instrumented-components");
  expect(shipped).toContain("src/ProjectCard.tsx:11");
  // Excluded exports are never wrapped: no metadata names them.
  for (const name of ["ThemeProvider", "CheckIcon", "useToggle", "ProjectList"]) expect(shipped).not.toMatch(new RegExp(`name:\\s*["\`]${name}["\`]`));
  expect(warnings.filter((warning) => warning.includes("not instrumented"))).toEqual([]);
  const added = gzip(entry(builds.preview)) - gzip(entry(builds.baseline));
  const customer = gzip(entry(builds.none));
  console.info(`instrumentation adds ${added} B gzip to the preview entry (${gzip(entry(builds.preview))} B); the customer entry is ${customer} B`);
  // Runtime plus metadata for 13 components; the review UI stays in its own lazily loaded chunks.
  expect(added).toBeGreaterThan(0);
  expect(added).toBeLessThan(4000);
});
