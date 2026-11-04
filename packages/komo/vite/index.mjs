// @hazem3500/komo/vite: build-time component instrumentation for preview builds.
//
//   import { komoComponents } from "@hazem3500/komo/vite";
//   plugins: [komoComponents({ enabled: process.env.PREVIEW === "1", packages: ["@acme/ui"], components: ["src/cards/Card.tsx#Card"] })]
//
// Off unless `enabled` is true: a disabled plugin has no hooks, so the build is the same as
// without it. Enabled, imports of the listed packages and app modules resolve to generated
// proxies that re-export everything and wrap each eligible component with `instrument()`
// from @hazem3500/komo/react-instrument. Node-only.
import { basename, dirname, extname, resolve } from "node:path";
import { collectComponents, defaultExclude } from "./metadata.mjs";

const PREFIX = "\0komo-components:";
const RUNTIME = "@hazem3500/komo/react-instrument";

/** @param {import("./index.d.ts").KomoComponentsOptions} [options] */
export function komoComponents(options = {}) {
  const name = "komo-components";
  if (options.enabled !== true) return { name };
  const packages = [...new Set(options.packages ?? [])];
  const modules = (options.components ?? []).map((entry) => {
    const [file, exported] = String(entry).split("#");
    return { file, exports: exported ? exported.split(",").map((item) => item.trim()).filter(Boolean) : undefined };
  });
  let root = process.cwd();
  /** @type {Map<string, { code: string }>} proxy id → module */
  const proxies = new Map();
  const byPackage = new Map();
  const byFile = new Map();
  const names = new Set();
  let ready;

  function proxy(entry) {
    const from = JSON.stringify(entry.kind === "package" ? entry.specifier : entry.file);
    const lines = [
      `import * as original from ${from};`,
      `import { instrument } from ${JSON.stringify(RUNTIME)};`,
      `export * from ${from};`,
    ];
    let index = 0;
    for (const component of entry.components) {
      const meta = JSON.stringify({ name: component.name, ...(component.source ? { source: component.source } : {}), props: component.props });
      if (component.export === "default") {
        lines.push(`const component${index} = /*#__PURE__*/ instrument(original.default, ${meta});`, `export default component${index};`);
      } else lines.push(`export const ${component.export} = /*#__PURE__*/ instrument(original.${component.export}, ${meta});`);
      index++;
    }
    if (entry.hasDefault && !entry.components.some((component) => component.export === "default")) lines.push(`export { default } from ${from};`);
    return lines.join("\n") + "\n";
  }

  async function prepare(context) {
    const { entries, skipped } = await collectComponents({ root, packages, modules, tsconfig: options.tsconfig, exclude: options.exclude ?? defaultExclude });
    let count = 0;
    for (const [index, entry] of entries.entries()) {
      if (!entry.components.length) continue;
      const id = `${PREFIX}${index}`;
      proxies.set(id, { code: proxy(entry) });
      count += entry.components.length;
      if (entry.kind === "package") byPackage.set(entry.specifier, id);
      else {
        byFile.set(entry.file, id);
        names.add(basename(entry.file, extname(entry.file)));
        if (basename(entry.file, extname(entry.file)) === "index") names.add(basename(dirname(entry.file)));
      }
    }
    for (const item of skipped) context.warn(`${item.from}${item.name ? `#${item.name}` : ""}: ${item.reason}, not instrumented`);
    if (options.report !== false) context.info?.(`instrumented ${count} component${count === 1 ? "" : "s"} for Design mode`);
  }

  return {
    name,
    enforce: "pre",
    config: () => ({ optimizeDeps: { include: [RUNTIME] } }),
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      ready = prepare(this);
      return ready;
    },
    async resolveId(source, importer, resolveOptions) {
      if (!importer || importer.startsWith(PREFIX) || resolveOptions?.ssr) return null;
      await ready;
      const forPackage = byPackage.get(source);
      if (forPackage) return forPackage;
      if (!byFile.size) return null;
      const last = source.split(/[\\/]/).pop() ?? "";
      if (!names.has(basename(last, extname(last)))) return null;
      const resolved = await this.resolve(source, importer, { ...resolveOptions, skipSelf: true });
      const file = resolved && !resolved.external ? resolve(resolved.id.replace(/[?#].*$/, "")) : undefined;
      if (!file || file === resolve(importer.replace(/[?#].*$/, ""))) return null;
      return byFile.get(file) ?? null;
    },
    load(id) {
      return proxies.get(id)?.code ?? null;
    },
  };
}

export { defaultExclude };
