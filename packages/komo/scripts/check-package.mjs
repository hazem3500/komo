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
  ]);
  assert.match(
    await readFile(join(root, "node_modules/@hazem3500/komo/dist/react.js"), "utf8"),
    /^['"]use client['"];?/,
    "React entry must preserve its client boundary after minification",
  );
  await writeFile(
    join(root, "smoke.mjs"),
    `
    import { initKomo } from '@hazem3500/komo';
    import { defineKomo } from '@hazem3500/komo/setup';
    import { useKomo } from '@hazem3500/komo/react';
    import { createElement } from 'react';
    import { renderToString } from 'react-dom/server';
    const config = {project:'packed-test'};
    initKomo(config).destroy(); defineKomo(config)().destroy();
    function App(){useKomo(config);return createElement('p',null,'ok')}
    if(renderToString(createElement(App)) !== '<p>ok</p>') throw Error('SSR failed');
  `,
  );
  run(process.execPath, ["smoke.mjs"]);
  await writeFile(
    join(root, "consumer.ts"),
    `
    import { initKomo, type KomoConfig } from '@hazem3500/komo';
    import { defineKomo } from '@hazem3500/komo/setup';
    import { useKomo } from '@hazem3500/komo/react';
    const config: KomoConfig = {project:'packed-test'};
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
  await build({
    entryPoints: [join(root, ".komo/index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    loader: { ".txt": "text" },
    write: false,
  });
  console.log(
    `Packed consumer passed: SSR/types, self-host init/resume, migrations, server bundle (${packed.entryCount} files).`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
