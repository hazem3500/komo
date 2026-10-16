import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// React's production builds keep no _debugSource / _debugStack, so the adapter must
// show what is safe (name, props) and no source, and nothing for minified names.
const root = process.cwd();
let directory = "";
let bundle = "";
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "komo-fiber-"));
  bundle = join(directory, "react-fiber.mjs");
  await build({ entryPoints: [resolve(root, "src/adapters/react-fiber.ts")], outfile: bundle, bundle: true, format: "esm", platform: "node" });
});
afterAll(() => rm(directory, { recursive: true, force: true }));

describe.each([
  ["React 19", "package.json", 19],
  ["React 18", "../komo-react18-fixture/package.json", 18],
])("production build with %s", (_label, manifest, major) => {
  it("names the component and props, has no source, and ignores minified names", () => {
    const output = execFileSync(process.execPath, [resolve(root, "test/fixtures/fiber-production.cjs"), bundle, resolve(root, manifest)], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
    });
    const result = JSON.parse(output.trim().split("\n").pop()!);
    expect(result.mode).toBe("production");
    expect(result.version.startsWith(`${major}.`)).toBe(true);
    expect(result.name).toBe("ProdCard");
    expect(result.props).toEqual({ title: "Hi" });
    expect(result.source).toBeUndefined();
    expect(result.fields).toEqual({ title: '"Hi"', token: "[redacted]" });
    expect(result.panel).not.toContain("rendered at");
    expect(result.minified).toBeNull();
  });
});
