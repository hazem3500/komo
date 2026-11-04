import { cp, mkdir, mkdtemp, readFile, readdir, symlink } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { build } from "vite";
import { komoComponents, type KomoComponentsOptions } from "../vite/index.mjs";

// Builds test/fixtures/instrument/app with Vite in production mode: minified, production React,
// against the fixture design-system package installed under node_modules like a real one.
const fixtures = resolve("test/fixtures/instrument");

export async function fixtureApp(react: 18 | 19 = 19) {
  const directory = await mkdtemp(join(tmpdir(), "komo-instrument-"));
  const app = join(directory, "app");
  await cp(join(fixtures, "app"), app, { recursive: true });
  await mkdir(join(app, "node_modules/@fixture"), { recursive: true });
  await mkdir(join(app, "node_modules/@types"), { recursive: true });
  await symlink(join(fixtures, "ui"), join(app, "node_modules/@fixture/ui"));
  const require = createRequire(resolve(react === 18 ? "../komo-react18-fixture/package.json" : "package.json"));
  for (const name of ["react", "react-dom"]) await symlink(dirname(require.resolve(`${name}/package.json`)), join(app, "node_modules", name));
  await symlink(resolve("node_modules/@types/react"), join(app, "node_modules/@types/react"));
  return { directory, app };
}

export const instrumentOptions = { packages: ["@fixture/ui"], components: ["src/ProjectCard.tsx#ProjectCard"] } satisfies KomoComponentsOptions;

/** `plugin`: true or false for an enabled or disabled plugin, null for none at all. */
export async function buildApp(app: string, outDir: string, plugin: boolean | null, review = plugin === true, warnings: string[] = []) {
  // Vite builds for NODE_ENV when it is set, and vitest sets it to "test": build for production.
  const environment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try { await build({
    root: app,
    configFile: false,
    logLevel: "silent",
    mode: "production",
    define: { "import.meta.env.VITE_REVIEW": JSON.stringify(review ? "1" : "0") },
    resolve: {
      // The app's React for every import, including the fixture package's.
      alias: [
        { find: "@hazem3500/komo/react-instrument", replacement: resolve("src/react-instrument.ts") },
        { find: /^@hazem3500\/komo$/, replacement: resolve("src/index.ts") },
        { find: /^react(-dom)?(\/.*)?$/, replacement: join(app, "node_modules/react$1$2") },
      ],
    },
    customLogger: { info() {}, warn(message) { warnings.push(message); }, warnOnce(message) { warnings.push(message); }, error(message) { warnings.push(message); }, clearScreen() {}, hasErrorLogged: () => false, hasWarned: false },
    plugins: plugin === null ? [] : [komoComponents({ ...instrumentOptions, enabled: plugin })],
    build: { outDir, emptyOutDir: true, reportCompressedSize: false },
  }); } finally { process.env.NODE_ENV = environment; }
  return outDir;
}

export async function outputFiles(outDir: string) {
  const files = new Map<string, string>();
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.set(path.slice(outDir.length + 1), await readFile(path, "utf8"));
    }
  }
  await walk(outDir);
  return files;
}

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
export async function serve(outDir: string): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = resolve(outDir, `.${path === "/" ? "/index.html" : path}`);
    try {
      if (!file.startsWith(outDir + "/")) throw new Error("outside");
      response.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch {
      response.statusCode = 404;
      response.end();
    }
  }).listen(0);
  await new Promise((done) => server.once("listening", done));
  return { server, origin: `http://localhost:${(server.address() as { port: number }).port}` };
}
