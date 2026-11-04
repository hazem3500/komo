import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentWorkflow } from "../dist/agent-prompt.js";

// The block's markers. A block from before the rename has komo markers; it is
// found the same way and rewritten with the palette ones.
const markers = [
  ["<!-- palette:workflow:start -->", "<!-- palette:workflow:end -->"],
  ["<!-- komo:workflow:start -->", "<!-- komo:workflow:end -->"],
];
const [start, end] = markers[0];

export async function installAgentWorkflow(cwd) {
  const path = join(cwd, "AGENTS.md");
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const block = `${start}
## Palette comment workflow

Use the project-local palette CLI (for example, npx --no-install palette). Run palette login if a session is needed.

${agentWorkflow}
${end}`;
  const found = markers.filter((pair) => pair.some((marker) => existing.includes(marker)));
  const [from, to] = found[0] ?? markers[0];
  const first = existing.indexOf(from);
  const last = existing.indexOf(to);
  if (
    found.length > 1 ||
    (first === -1) !== (last === -1) ||
    (first !== -1 &&
      (last < first ||
        existing.indexOf(from, first + from.length) !== -1 ||
        existing.indexOf(to, last + to.length) !== -1))
  )
    throw Error(
      "AGENTS.md has an incomplete or duplicate Palette workflow block. Repair its markers before retrying."
    );
  const content =
    first === -1
      ? `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${existing ? "\n" : ""}${block}
`
      : existing.slice(0, first) + block + existing.slice(last + to.length);
  if (content !== existing) await writeFile(path, content);
  return { path, changed: content !== existing };
}
