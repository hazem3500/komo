import ts from "typescript";
import { relative, sep } from "node:path";

export function generateManifest(sourcePath, root) {
  const tsconfigPath = `${root}/tsconfig.json`;
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram([sourcePath], {
    ...parsed.options,
    rootDir: root,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(sourcePath);
  if (!source) throw new Error(`Could not load ${sourcePath}`);

  function displayType(type, location) {
    return checker.typeToString(type, location, ts.TypeFormatFlags.NoTruncation).slice(0, 100);
  }

  function scalarSchema(type) {
    if (
      type.flags & ts.TypeFlags.Union &&
      type.types.some((item) => item.flags & ts.TypeFlags.Null)
    ) return { kind: "unsupported" };
    const nonNullable = checker.getNonNullableType(type);
    if (nonNullable !== type) return scalarSchema(nonNullable);
    const flags = type.flags;
    if (flags & ts.TypeFlags.StringLiteral) return { kind: "enum", values: [type.value] };
    if (flags & ts.TypeFlags.NumberLiteral) return { kind: "enum", values: [type.value] };
    if (flags & ts.TypeFlags.BooleanLiteral)
      return { kind: "enum", values: [type.intrinsicName === "true"] };
    if (flags & ts.TypeFlags.String) return { kind: "string" };
    if (flags & ts.TypeFlags.Number) return { kind: "number" };
    if (flags & ts.TypeFlags.Boolean) return { kind: "boolean" };
    if (flags & ts.TypeFlags.Union) {
      const values = type.types.map((item) => {
        if (item.flags & ts.TypeFlags.StringLiteral) return item.value;
        if (item.flags & ts.TypeFlags.NumberLiteral) return item.value;
        if (item.flags & ts.TypeFlags.BooleanLiteral)
          return item.intrinsicName === "true";
        return undefined;
      });
      if (values.length && values.every((value) => value !== undefined))
        return { kind: "enum", values };
    }
    return { kind: "unsupported" };
  }

  const components = [];
  function visit(node) {
    const tags = ts.getJSDocTags(node);
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.parameters[0] &&
      tags.some((tag) => tag.tagName.text === "komoInspectable")
    ) {
      const propsTag = tags.find((tag) => tag.tagName.text === "komoProps");
      const propsTypeName = String(propsTag?.comment ?? "").trim();
      const propsDeclaration = source.statements.find(
        (statement) =>
          (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
          statement.name.text === propsTypeName,
      );
      const propsType = propsDeclaration
        ? checker.getTypeAtLocation(propsDeclaration.name)
        : checker.getTypeAtLocation(node.parameters[0]);
      const properties = checker.getPropertiesOfType(propsType).map((symbol) => {
        const declaration = symbol.valueDeclaration ?? node.parameters[0];
        const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
        const schema = scalarSchema(type);
        return {
          name: symbol.getName(),
          kind: schema.kind,
          ...(schema.values ? { values: schema.values } : {}),
          required: !(symbol.flags & ts.SymbolFlags.Optional),
          typeLabel: displayType(type, declaration),
        };
      });
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      components.push({
        id: node.name.text.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
        name: node.name.text,
        source: relative(root, sourcePath).split(sep).join("/"),
        line: line + 1,
        props: properties,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!components.length) throw new Error("No exported @komoInspectable function components found.");
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getNewLine: () => ts.sys.newLine,
    }));
  }
  return { components };
}
