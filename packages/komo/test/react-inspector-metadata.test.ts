import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateManifest } from "../examples/react-props/metadata.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixture = resolve(root, "examples/react-props/src/card.tsx");

describe("React inspector TypeScript manifest", () => {
  it("extracts only the explicit props type and marks complex values read-only", () => {
    const manifest = generateManifest(fixture, root);
    const component = manifest.components[0];
    expect(component.name).toBe("PromoCard");
    expect(component.source).toBe("examples/react-props/src/card.tsx");
    expect(component.props.map((prop) => [prop.name, prop.kind, prop.required])).toEqual([
      ["title", "string", true],
      ["marker", "enum", true],
      ["maybe", "unsupported", true],
      ["tone", "enum", true],
      ["compact", "boolean", false],
      ["visits", "number", true],
      ["children", "unsupported", true],
      ["details", "unsupported", true],
      ["onActivate", "unsupported", true],
    ]);
    expect(component.props.find((prop) => prop.name === "marker")?.values).toEqual(["only"]);
    expect(component.props.find((prop) => prop.name === "tone")?.values).toEqual(["calm", "bold", "quiet"]);
  });
});
