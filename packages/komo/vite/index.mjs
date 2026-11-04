// @hazem3500/palette/vite: build-time component instrumentation for preview builds.
//
//   import { paletteComponents } from "@hazem3500/palette/vite";
//   plugins: [paletteComponents({ enabled: process.env.PREVIEW === "1", packages: ["@acme/ui"], components: ["src/cards/Card.tsx#Card"] })]
//
// Off unless `enabled` is true: a disabled plugin has no hooks, so the build is the same as
// without it. Enabled, imports of the listed packages and app modules resolve to generated
// proxies that re-export everything and wrap each eligible component with `instrument()`
// from @hazem3500/palette/react-instrument. Node-only.
import { resolve } from "node:path";
import { collectComponents, defaultExclude } from "./metadata.mjs";

const PREFIX = "\0palette-components:";
const RUNTIME = "@hazem3500/palette/react-instrument";

/** @param {import("./index.d.ts").PaletteComponentsOptions} [options] */
export function paletteComponents(options = {}) {
  const name = "palette-components";
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
  let ready;

  function proxy(entry) {
    const from = JSON.stringify(entry.kind === "package" ? entry.specifier : entry.file);
    const lines = [
      `import * as original from ${from};`,
      `import { instrument } from ${JSON.stringify(RUNTIME)};`,
      // Named re-exports, not `export *`: the dev server's CommonJS interop can't carry a star.
      ...(entry.values.length ? [`export { ${entry.values.filter((name) => !entry.components.some((component) => component.export === name)).join(", ")} } from ${from};`] : []),
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
      else byFile.set(entry.file, id);
    }
    for (const item of skipped) context.warn(`${item.from}${item.name ? `#${item.name}` : ""}: ${item.reason}, not instrumented`);
    if (options.report !== false) context.info?.(`instrumented ${count} component${count === 1 ? "" : "s"} for Design mode`);
  }

  return {
    name,
    enforce: "pre",
    config: () => ({ optimizeDeps: { include: [RUNTIME, ...packages] } }),
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
      // Any specifier can reach a listed module (relative, aliased, a barrel), so resolve each
      // one from app code; dependencies never import the app.
      if (!byFile.size || /[\\/]node_modules[\\/]/.test(importer)) return null;
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
