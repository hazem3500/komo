import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
// @ts-expect-error CLI modules are plain JavaScript.
import { installAgentWorkflow } from "../cli/workflow.mjs";
const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "komo-workflow-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});
it("installs a repeatable default workflow without overwriting project instructions", async () => {
  const cwd = await directory();
  await writeFile(
    join(cwd, "AGENTS.md"),
    "# Project\nKeep these instructions.\n"
  );
  expect((await installAgentWorkflow(cwd)).changed).toBe(true);
  const content = await readFile(join(cwd, "AGENTS.md"), "utf8");
  expect(content).toContain("# Project\nKeep these instructions.");
  expect(content).toContain("palette comments prompt");
  expect(content).toContain("90% or higher");
  expect(content).toContain("keep the thread open");
  expect((await installAgentWorkflow(cwd)).changed).toBe(false);
  expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe(content);
});
it("creates instructions when no AGENTS.md exists and updates only its own block", async () => {
  const cwd = await directory();
  await installAgentWorkflow(cwd);
  const path = join(cwd, "AGENTS.md");
  const content = await readFile(path, "utf8");
  await writeFile(
    path,
    content.replace("90% or higher", "old policy") +
      "\n## Other rules\nKeep me.\n"
  );
  await installAgentWorkflow(cwd);
  const updated = await readFile(path, "utf8");
  expect(updated).toContain("90% or higher");
  expect(updated).not.toContain("old policy");
  expect(updated.endsWith("\n## Other rules\nKeep me.\n")).toBe(true);
});
it("preserves malformed instructions instead of guessing replacement boundaries", async () => {
  const cwd = await directory();
  const content = "# Project\n<!-- komo:workflow:start -->\nUser instructions";
  await writeFile(join(cwd, "AGENTS.md"), content);
  await expect(installAgentWorkflow(cwd)).rejects.toThrow(
    "incomplete or duplicate"
  );
  expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe(content);
});
it("rewrites a block with the markers from before the rename", async () => {
  const cwd = await directory();
  const path = join(cwd, "AGENTS.md");
  await writeFile(path, "# Project\n\n<!-- komo:workflow:start -->\nold policy\n<!-- komo:workflow:end -->\n\nKeep me.\n");
  expect((await installAgentWorkflow(cwd)).changed).toBe(true);
  const content = await readFile(path, "utf8");
  expect(content).not.toContain("komo:workflow");
  expect(content).not.toContain("old policy");
  expect(content).toContain("<!-- palette:workflow:start -->\n## Palette comment workflow");
  expect(content.endsWith("<!-- palette:workflow:end -->\n\nKeep me.\n")).toBe(true);
  expect(content.match(/palette:workflow:start/g)).toHaveLength(1);
});
it("refuses a file with both old and new markers", async () => {
  const cwd = await directory();
  const content = "<!-- komo:workflow:start -->\na\n<!-- komo:workflow:end -->\n<!-- palette:workflow:start -->\nb\n<!-- palette:workflow:end -->\n";
  await writeFile(join(cwd, "AGENTS.md"), content);
  await expect(installAgentWorkflow(cwd)).rejects.toThrow("incomplete or duplicate");
});
