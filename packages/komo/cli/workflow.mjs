import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentWorkflow } from "../dist/agent-prompt.js";

const start = "<!-- komo:workflow:start -->";
const end = "<!-- komo:workflow:end -->";

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
  const first = existing.indexOf(start);
  const last = existing.indexOf(end);
  if (
    (first === -1) !== (last === -1) ||
    (first !== -1 &&
      (last < first ||
        existing.indexOf(start, first + start.length) !== -1 ||
        existing.indexOf(end, last + end.length) !== -1))
  )
    throw Error(
      "AGENTS.md has an incomplete or duplicate Palette workflow block. Repair its markers before retrying."
    );
  const content =
    first === -1
      ? `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${existing ? "\n" : ""}${block}
`
      : existing.slice(0, first) + block + existing.slice(last + end.length);
  if (content !== existing) await writeFile(path, content);
  return { path, changed: content !== existing };
}
