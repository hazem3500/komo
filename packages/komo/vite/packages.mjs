// Package lookups for @hazem3500/palette/vite: subpath globs, and components a package compares
// by element type. Node-only.
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

/** "@scope/ds/button" → "@scope/ds"; "ds/x" → "ds". */
export const packageName = (specifier) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

/** The directory of an installed package, looked up from the app root like Node does. */
export function packageDirectory(name, root) {
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * `@scope/ds/*` becomes every subpath the package's `exports` map lists (`@scope/ds/button`, …),
 * with the root entry when there is one. Pattern exports (`./*`) can't be listed and are reported.
 */
export async function expandPackages(list, root) {
  const specifiers = [], warnings = [];
  for (const entry of list) {
    if (!entry.endsWith("/*")) {
      specifiers.push(entry);
      continue;
    }
    const name = entry.slice(0, -2), dir = packageDirectory(name, root);
    if (!dir) {
      warnings.push(`${entry}: package not found`);
      continue;
    }
    const exports = JSON.parse(await readFile(join(dir, "package.json"), "utf8")).exports;
    const keys = exports && typeof exports === "object" && Object.keys(exports).some((key) => key.startsWith(".")) ? Object.keys(exports) : ["."];
    for (const key of keys) {
      if (key.includes("*")) warnings.push(`${entry}: "${key}" is a pattern export; list its subpaths explicitly`);
      else if (key === "./package.json" || /\.(css|json)$/.test(key)) continue;
      else specifiers.push(key === "." ? name : `${name}${key.slice(1)}`);
    }
  }
  return { specifiers: [...new Set(specifiers)], warnings };
}

const SCRIPT = /\.(m|c)?js$/;
const LIMIT = 4_000_000;
// `x.type === Footer`, `Footer !== child.type`, `type === Footer` after destructuring.
const TYPE_LEFT = /\.type\s*[!=]==?\s*([A-Za-z_$][\w$]*)/g;
const TYPE_RIGHT = /([A-Za-z_$][\w$]*)\s*[!=]==?\s*[\w$\])?.]*\.type\b/g;

/**
 * Names a package compares against an element's type in its own runtime code, with the first file
 * that does. Instrumenting such a component would make the comparison fail for the app's elements.
 * Minified packages rename their locals, so this finds what the shipped code still spells out.
 */
export async function typeComparedNames(dir) {
  const found = new Map();
  let read = 0;
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (SCRIPT.test(entry.name) && !entry.name.endsWith(".map")) {
        const size = (await stat(file)).size;
        if ((read += size) > LIMIT) return;
        const code = await readFile(file, "utf8");
        for (const pattern of [TYPE_LEFT, TYPE_RIGHT])
          for (const match of code.matchAll(pattern))
            if (/^[A-Z]/.test(match[1]) && !found.has(match[1])) found.set(match[1], relative(dir, file).split(sep).join("/"));
      }
    }
  }
  await walk(dir);
  return found;
}
