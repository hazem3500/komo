import { afterEach, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error Native ESM CLI module.
import { packageName, clientModule } from "../cli/config.mjs";

const cli = fileURLToPath(new URL("../cli/index.mjs", import.meta.url));
let directory = "";
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

it("accepts only package specifiers and keeps the default namespace", () => {
  expect(packageName({})).toBe("@hazem3500/palette");
  for (const name of ["@toggl/palette", "palette-wrapper"])
    expect(clientModule({ project: "test" }, { PALETTE_PACKAGE_NAME: name })).toContain(`from '${name}/setup'`);
  for (const name of ["", "../palette", "@scope/../palette", "palette/subpath", "https://example.com/palette", "pkg@1", "name';alert(1)", "a\n", "a".repeat(215)])
    expect(() => packageName({ PALETTE_PACKAGE_NAME: name })).toThrow("PALETTE_PACKAGE_NAME");
});

it("rejects an invalid override before init writes files", async () => {
  directory = await mkdtemp(join(tmpdir(), "palette-package-name-"));
  await expect(promisify(execFile)(process.execPath, [cli, "init", "--node"], {
    cwd: directory, env: { ...process.env, PALETTE_PACKAGE_NAME: "../outside" },
  })).rejects.toMatchObject({ stderr: expect.stringContaining("PALETTE_PACKAGE_NAME") });
  expect(await readdir(directory)).toEqual([]);
});

it("scaffolds and resumes a Worker using only the wrapper package name", async () => {
  directory = await mkdtemp(join(tmpdir(), "palette-wrapper-worker-"));
  await mkdir(join(directory, "node_modules/@toggl/palette"), { recursive: true });
  await writeFile(join(directory, "node_modules/@toggl/palette/package.json"), '{"name":"@toggl/palette"}');
  await mkdir(join(directory, "bin"));
  await writeFile(join(directory, "bin/npx"), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const path = args[args.indexOf('--config') + 1];
if (args.includes('create')) {
  const config = JSON.parse(fs.readFileSync(path));
  config.d1_databases = [{binding:'DB',database_name:'fixture',database_id:'fixture'}];
  fs.writeFileSync(path, JSON.stringify(config));
}
if (args.includes('deploy')) console.log('https://wrapper-fixture.workers.dev');
`, { mode: 0o755 });
  const env = { ...process.env, PALETTE_PACKAGE_NAME: "@toggl/palette", PATH: `${join(directory, "bin")}:${process.env.PATH}` };
  const run = (args: string[]) => promisify(execFile)(process.execPath, [cli, ...args], { cwd: directory, env, timeout: 10000 });
  await run(["init", "--self-host", "--origin", "https://example.test", "--repo", "fixture/repo", "--google-client-id", "fixture"]);
  expect(await readFile(join(directory, ".palette/index.ts"), "utf8")).toBe('export { default } from "@toggl/palette/server";\n');
  expect(await readFile(join(directory, "palette.config.js"), "utf8")).toContain("from '@toggl/palette/setup'");
  await run(["deploy"]);
  expect(await readFile(join(directory, "palette.config.js"), "utf8")).toContain("from '@toggl/palette/setup'");
  const help = await run(["--help"]);
  expect(help.stdout).toContain("PALETTE_PACKAGE_NAME");
});
