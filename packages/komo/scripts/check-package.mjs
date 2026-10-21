// Exercise the actual shipping artifact, never the workspace's dependency tree.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const source = fileURLToPath(new URL("..", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "komo-packed-"));
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
    ...options,
  });
try {
  const [packed] = JSON.parse(
    run(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", root],
      { cwd: source },
    ),
  );
  // npm 11 publish drops bin paths written as "./file" without failing.
  const { bin } = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  for (const [name, path] of Object.entries(bin)) {
    assert.doesNotMatch(path, /^\.\//, `bin.${name} must not start with ./`);
  }
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(root, packed.filename),
    // react.d.ts imports React's types; a TypeScript consumer has them installed.
    "@types/react@19",
  ]);
  // Browser hosts install komo for the client: no server, database or Workers packages ride along.
  for (const name of ["pg", "@cloudflare/workers-types", "wrangler"]) {
    assert.equal(existsSync(join(root, "node_modules", name)), false, `${name} must not install with komo`);
  }
  const shipped = JSON.parse(await readFile(join(root, "node_modules/@hazem3500/komo/package.json"), "utf8"));
  assert.deepEqual(Object.keys(shipped.dependencies ?? {}), ["emoji-regex"], "runtime dependencies are browser-safe only");
  // A Workers host that imports komo/server has the optional Workers types peer installed.
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `@cloudflare/workers-types@${shipped.peerDependencies["@cloudflare/workers-types"]}`]);
  assert.match(
    await readFile(join(root, "node_modules/@hazem3500/komo/dist/react.js"), "utf8"),
    /^['"]use client['"];?/,
    "React entry must preserve its client boundary after minification",
  );
  // The single-copy shell guard vanishes from a minified production build behind
  // import.meta.env.DEV, and stays in development.
  await writeFile(
    join(root, "shell-host.js"),
    `import { isShell } from '@hazem3500/komo/shell';
    if (import.meta.env.DEV && isShell('example-project')) console.log('shell-branch');
    else console.log('app-branch');`,
  );
  for (const dev of [false, true]) {
    const [output] = (await build({
      entryPoints: [join(root, "shell-host.js")],
      absWorkingDir: root,
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      define: { "import.meta.env.DEV": String(dev) },
      write: false,
    })).outputFiles;
    if (dev) assert.match(output.text, /komo-shell/, "the shell guard runs in development");
    else assert.equal(output.text.trim(), 'console.log("app-branch");', "the shell guard must drop out of production builds");
  }
  await writeFile(
    join(root, "smoke.mjs"),
    `
    import assert from 'node:assert/strict';
    import server from '@hazem3500/komo/server';
    import metadata from '@hazem3500/komo/package.json' with { type: 'json' };
    assert.equal(metadata.name, '@hazem3500/komo');
    assert.ok(import.meta.resolve('@hazem3500/komo/server').endsWith('/dist/server.js'));
    assert.ok(import.meta.resolve('@hazem3500/komo/package.json').endsWith('/komo/package.json'));
    assert.equal(typeof server.scheduled, 'function');
    const health = await server.fetch(new Request('https://example.test/health'), {}, { waitUntil() {} });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    import { initKomo } from '@hazem3500/komo';
    import { defineKomo } from '@hazem3500/komo/setup';
    import { useKomo } from '@hazem3500/komo/react';
    import { createElement } from 'react';
    import { renderToString } from 'react-dom/server';
    const config = {project:'packed-test'};
    initKomo(config).destroy(); defineKomo(config)().destroy();
    function App(){useKomo(config);return createElement('p',null,'ok')}
    if(renderToString(createElement(App)) !== '<p>ok</p>') throw Error('SSR failed');
    const { tailwindTokens, tailwindSpacing } = await import('@hazem3500/komo/adapters/tailwind');
    const { classTheme } = await import('@hazem3500/komo/adapters/class-theme');
    const { discoverCssTokens } = await import('@hazem3500/komo/adapters/css-variables');
    if (typeof discoverCssTokens !== 'function') throw Error('CSS variable adapter failed');
    const { discoverReactComponents } = await import('@hazem3500/komo/adapters/react-fiber');
    if (typeof discoverReactComponents().identify !== 'function') throw Error('React fiber adapter failed');
    initKomo({project:'packed-test', design: { components: discoverReactComponents({ maxProps: 8 }) }}).destroy();
    if (tailwindTokens({tokens: tailwindSpacing({prefix:['p'], steps:[4]})}).list({})[0].value !== '16px') throw Error('Tailwind adapter failed');
    if (classTheme({id:'mode', options:[{id:'light'}]}).id !== 'mode') throw Error('Class theme adapter failed');
  `,
  );
  run(process.execPath, ["smoke.mjs"]);
  run(process.execPath, [
    "--conditions=workerd",
    "--input-type=module",
    "--eval",
    `import assert from 'node:assert/strict';
     assert.match(import.meta.resolve('@hazem3500/komo/server'), /\\/server\\/index\\.ts$/);`,
  ]);
  await writeFile(
    join(root, "consumer.ts"),
    `
    import server, { type ServerEnv } from '@hazem3500/komo/server';
    declare const env: ServerEnv;
    declare const request: Parameters<typeof server.fetch>[0];
    declare const context: Parameters<typeof server.fetch>[2];
    server.fetch(request, env, context);
    import { initKomo, type KomoConfig } from '@hazem3500/komo';
    import { defineKomo } from '@hazem3500/komo/setup';
    import { useKomo } from '@hazem3500/komo/react';
    import { tailwindTokens, tailwindSpacing, type TailwindTable } from '@hazem3500/komo/adapters/tailwind';
    import { classTheme } from '@hazem3500/komo/adapters/class-theme';
    import { discoverCssTokens } from '@hazem3500/komo/adapters/css-variables';
    import { discoverReactComponents } from '@hazem3500/komo/adapters/react-fiber';
    const mode = classTheme({ id: 'mode', options: [{ id: 'light', class: 'light' }, { id: 'dark', class: 'dark' }], colorScheme: true });
    const table: TailwindTable = { tokens: [{ path: 'color.text.primary', type: 'color', class: 'text-primary', properties: ['color'], values: { light: '#000', dark: '#fff' } }, ...tailwindSpacing()] };
    const config: KomoConfig = {project:'packed-test', design: { tokens: tailwindTokens(table, { themes: [mode] }), themes: [mode] }};
    initKomo({project:'packed-test', design: { tokens: discoverCssTokens({ limit: 10 }) }}).destroy();
    initKomo({project:'packed-test', design: { components: discoverReactComponents({ maxProps: 8 }) }}).destroy();
    initKomo(config).destroy(); defineKomo(config)().destroy(); useKomo(config);
  `,
  );
  run(join(source, "node_modules/.bin/tsc"), [
    "--noEmit",
    "--strict",
    "--module",
    "nodenext",
    "--moduleResolution",
    "nodenext",
    "--target",
    "es2022",
    "--lib",
    "es2022,dom,dom.iterable",
    "consumer.ts",
  ]);
  await mkdir(join(root, "bin"));
  // This executable is the only Wrangler runner: no login, provisioning, or deploy occurs.
  await writeFile(
    join(root, "bin/npx"),
    `#!${process.execPath}
    import fs from 'node:fs';
    const args = process.argv.slice(2);
    fs.appendFileSync('commands.jsonl', JSON.stringify(args)+'\\n');
    const path = args[args.indexOf('--config')+1];
    if(args.includes('create')) {
      const config = JSON.parse(fs.readFileSync(path));
      config.d1_databases=[{binding:'DB',database_name:'test',database_id:'test'}];
      fs.writeFileSync(path,JSON.stringify(config));
    }
    if(args.includes('deploy')) console.log('https://packed-test.workers.dev');
  `,
    { mode: 0o755 },
  );
  const cli = join(root, "node_modules/@hazem3500/komo/cli/index.mjs");
  const env = {
    ...process.env,
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
  };
  run(
    process.execPath,
    [
      cli,
      "init",
      "--self-host",
      "--origin",
      "https://example.test",
      "--repo",
      "test/repo",
      "--google-client-id",
      "test",
    ],
    { env },
  );
  run(process.execPath, [cli, "deploy"], { env });
  const commands = (await readFile(join(root, "commands.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(
    commands.filter((args) => args.includes("create")).length,
    1,
    "resume must reuse the database",
  );
  assert.equal(commands.filter((args) => args.includes("deploy")).length, 2);
  assert.equal(
    commands.filter((args) => args.includes("migrations")).length,
    2,
  );
  const migrations = await readdir(
    join(root, "node_modules/@hazem3500/komo/server/migrations"),
  );
  assert.deepEqual(await readdir(join(root, ".komo/migrations")), migrations);
  assert.match(
    await readFile(join(root, "komo.config.js"), "utf8"),
    /packed-test.workers.dev/,
  );
  for (const conditions of [[], ["workerd"]]) {
    await build({
      conditions,
      entryPoints: [join(root, ".komo/index.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      loader: { ".txt": "text" },
      write: false,
    });
  }
  run(join(source, "node_modules/.bin/wrangler"), [
    "deploy",
    "--dry-run",
    "--config",
    join(root, ".komo/wrangler.json"),
  ]);
  console.log(
    `Packed consumer passed: SSR/types, shell guard tree-shaking, Node server/metadata exports, workerd source, self-host init/resume, migrations, server bundles (${packed.entryCount} files).`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
