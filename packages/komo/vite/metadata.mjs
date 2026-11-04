// Build-time component metadata for @hazem3500/palette/vite: which exports are React components,
// and which of their props Design mode can edit, read from the TypeScript types the app
// already compiles against. Node-only; never part of a browser bundle.
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Attributes every element accepts come from React's and the DOM's own types; they aren't
// a component's design surface.
const PLATFORM = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@types[\\/]react(?:-dom)?|csstype)[\\/]|[\\/]typescript[\\/]lib[\\/]lib\.[^\\/]*\.d\.ts$/;
const STRUCTURAL = /^(key|ref|children|className|style|id|as|asChild|slot|dangerouslySetInnerHTML|suppressHydrationWarning|suppressContentEditableWarning)$|^on[A-Z]|^(data|aria)-|^_|^\$/;
const SECRET = new Set(["password", "passwd", "secret", "token", "auth", "apikey", "credential", "credentials", "cookie", "session", "private"]);
// "authToken" and "api_key" are secret-looking; "author" and "compass" aren't.
const secret = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/api[-_ ]?key/gi, "apikey").toLowerCase().split(/[^a-z0-9]+/).some((word) => SECRET.has(word));
const MAX_VALUES = 64;

/** Exports that are never components to edit: providers, contexts and icons. */
export const defaultExclude = (name) => /(Provider|Context|Icon|Icons)$|^Icon[A-Z]/.test(name);

/**
 * @param {object} options
 * @param {string} options.root App root; relative paths and tsconfig resolve from here.
 * @param {string[]} options.packages Package specifiers whose component exports are instrumented.
 * @param {Array<{ file: string, exports?: string[] }>} options.modules App modules from the allowlist.
 * @param {string} [options.tsconfig] tsconfig path, default `<root>/tsconfig.json`.
 * @param {(name: string, from: string) => boolean} [options.exclude]
 */
export async function collectComponents(options) {
  const { default: ts } = await import("typescript");
  const root = resolve(options.root);
  const tsconfig = options.tsconfig ? resolve(root, options.tsconfig) : ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  let compilerOptions = { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, strict: true, skipLibCheck: true };
  if (tsconfig) {
    const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
    compilerOptions = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfig)).options;
  }
  const exclude = options.exclude ?? defaultExclude;
  const entries = [
    ...options.packages.map((specifier) => ({ kind: "package", specifier, from: specifier })),
    ...options.modules.map((module) => ({ kind: "module", specifier: toImport(resolve(root, module.file), root), file: resolve(root, module.file), exports: module.exports, from: module.file })),
  ];
  // One probe file imports every target, so the checker resolves them as the app does.
  const probe = join(root, `__palette_components_${process.pid}__.ts`);
  const text = entries.map((entry, index) => `import * as m${index} from ${JSON.stringify(entry.specifier)};`).join("\n");
  const host = ts.createCompilerHost({ ...compilerOptions, noEmit: true });
  const getSourceFile = host.getSourceFile.bind(host), fileExists = host.fileExists.bind(host), readFile = host.readFile.bind(host);
  host.getSourceFile = (name, language, ...rest) => name === probe ? ts.createSourceFile(name, text, language, true) : getSourceFile(name, language, ...rest);
  host.fileExists = (name) => name === probe || fileExists(name);
  host.readFile = (name) => name === probe ? text : readFile(name);
  const program = ts.createProgram([probe], { ...compilerOptions, noEmit: true, skipLibCheck: true }, host);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(probe);
  const results = [];
  const skipped = [];
  source.statements.forEach((statement, index) => {
    const entry = entries[index];
    const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (!module) {
      skipped.push({ from: entry.from, reason: "types not found" });
      return;
    }
    const components = [];
    const values = [];
    let hasDefault = false;
    const listed = (name, reason) => { if (entry.exports?.includes(name)) skipped.push({ from: entry.from, name, reason }); };
    for (const symbol of checker.getExportsOfModule(module)) {
      const name = symbol.getName();
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      // Types don't exist at runtime; the proxy re-exports values by name.
      if (!(target.flags & ts.SymbolFlags.Value)) {
        listed(name, "a type, not a component");
        continue;
      }
      if (name === "default") hasDefault = true;
      else values.push(name);
      const display = name === "default" ? defaultName(symbol, target, entry) : name;
      if (entry.exports && !entry.exports.includes(name)) continue;
      if (!display || !/^[A-Z]/.test(display)) {
        listed(name, "not a component name");
        continue;
      }
      if (exclude(display, entry.from)) {
        listed(name, "excluded");
        continue;
      }
      const type = checker.getTypeOfSymbolAtLocation(target, statement);
      const props = componentProps(ts, checker, type, statement);
      if (!props) {
        listed(name, "not a React component");
        continue;
      }
      const editable = editableProps(ts, checker, props, statement);
      if (!editable.length) {
        listed(name, "no editable scalar props");
        continue;
      }
      const declaration = target.valueDeclaration ?? target.declarations?.[0];
      components.push({
        export: name,
        name: display,
        source: entry.kind === "module" ? location(declaration, root) : entry.specifier,
        props: editable,
      });
    }
    for (const name of entry.exports ?? [])
      if (!components.some((component) => component.export === name) && !skipped.some((item) => item.name === name && item.from === entry.from))
        skipped.push({ from: entry.from, name, reason: "not exported" });
    results.push({ ...entry, hasDefault, values, components });
  });
  return { entries: results, skipped };
}

function toImport(file, root) {
  return isAbsolute(file) ? file : resolve(root, file);
}

/** A default export's component name: its declaration's, an `export { X as default }`'s, or the module's file name. */
function defaultName(symbol, target, entry) {
  for (const candidate of [target.getName(), symbol.declarations?.[0]?.propertyName?.text, symbol.declarations?.[0]?.expression?.text, target.valueDeclaration?.name?.text])
    if (typeof candidate === "string" && /^[A-Z]/.test(candidate)) return candidate;
  const file = entry.file ? entry.file.split(/[\\/]/).pop().replace(/\..*$/, "") : "";
  return /^[A-Z]/.test(file) ? file : undefined;
}

function location(declaration, root) {
  if (!declaration) return undefined;
  const file = declaration.getSourceFile();
  const { line } = file.getLineAndCharacterOfPosition(declaration.getStart(file));
  return `${relative(root, file.fileName).split(sep).join("/")}:${line + 1}`;
}

/** The props type of a React component's type, or undefined for anything else. */
function componentProps(ts, checker, type, at) {
  if (type.getProperty("Provider") && type.getProperty("Consumer")) return undefined;
  for (const signature of type.getCallSignatures()) {
    if (signature.parameters.length > 2) continue;
    const returns = checker.typeToString(signature.getReturnType(), at, ts.TypeFormatFlags.NoTruncation);
    if (/\bPromise\b/.test(returns) || !/\b(Element|ReactElement|ReactNode|ReactPortal)\b/.test(returns)) continue;
    const parameter = signature.parameters[0];
    return parameter ? checker.getTypeOfSymbolAtLocation(parameter, at) : undefined;
  }
  for (const signature of type.getConstructSignatures()) {
    const instance = signature.getReturnType();
    const props = instance.getProperty("props");
    if (instance.getProperty("render") && props) return checker.getTypeOfSymbolAtLocation(props, at);
  }
  return undefined;
}

function editableProps(ts, checker, props, at) {
  const result = [];
  for (const symbol of checker.getPropertiesOfType(props)) {
    const name = symbol.getName();
    if (STRUCTURAL.test(name) || secret(name)) continue;
    const declarations = symbol.declarations ?? [];
    if (declarations.length && declarations.every((declaration) => PLATFORM.test(declaration.getSourceFile().fileName))) continue;
    const type = checker.getTypeOfSymbolAtLocation(symbol, at);
    const schema = scalar(ts, checker, type);
    if (!schema) continue;
    result.push({
      name,
      kind: schema.kind,
      ...(schema.values ? { values: schema.values } : {}),
      // A prop whose type admits null or undefined can be left out.
      required: !(symbol.flags & ts.SymbolFlags.Optional) && !schema.nullable,
      typeLabel: checker.typeToString(type, at, ts.TypeFormatFlags.NoTruncation).slice(0, 100),
    });
  }
  return result;
}

/** string, number, boolean or a union of their literals; null and undefined read as unset. */
function scalar(ts, checker, type) {
  const parts = type.flags & ts.TypeFlags.Union ? type.types : [type];
  const kept = parts.filter((part) => !(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)));
  if (!kept.length) return undefined;
  const nullable = kept.length < parts.length;
  const result = scalarKind(ts, kept);
  return result && { ...result, nullable };
}

function scalarKind(ts, kept) {
  if (kept.every((part) => part.flags & ts.TypeFlags.BooleanLiteral) && kept.length === 2) return { kind: "boolean" };
  if (kept.length === 1) {
    const [part] = kept;
    if (part.flags & ts.TypeFlags.String) return { kind: "string" };
    if (part.flags & ts.TypeFlags.Number) return { kind: "number" };
    if (part.flags & ts.TypeFlags.Boolean) return { kind: "boolean" };
  }
  const values = [];
  for (const part of kept) {
    if (part.flags & ts.TypeFlags.StringLiteral || part.flags & ts.TypeFlags.NumberLiteral) values.push(part.value);
    else if (part.flags & ts.TypeFlags.BooleanLiteral) values.push(part.intrinsicName === "true");
    else return undefined;
  }
  return values.length <= MAX_VALUES ? { kind: "enum", values } : undefined;
}
