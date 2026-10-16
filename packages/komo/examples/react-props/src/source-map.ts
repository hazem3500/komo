// Demo-only: React 19 records where JSX was written as an Error stack of the *bundled* file.
// This decodes the bundle's source map so Design mode shows the original file and line, the
// way a dev server serving unbundled modules would. Real apps usually don't need it.
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decode(mappings: string): Array<Array<[number, number, number, number]>> {
  const lines: Array<Array<[number, number, number, number]>> = [];
  let source = 0, line = 0, column = 0;
  for (const text of mappings.split(";")) {
    let generated = 0;
    const segments: Array<[number, number, number, number]> = [];
    for (const part of text.split(",")) {
      if (!part) continue;
      const values: number[] = [];
      let shift = 0, value = 0;
      for (const char of part) {
        const digit = alphabet.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >> 1) : value >> 1);
          shift = value = 0;
        }
      }
      generated += values[0];
      if (values.length > 3) {
        source += values[1]; line += values[2]; column += values[3];
        segments.push([generated, source, line, column]);
      }
    }
    lines.push(segments);
  }
  return lines;
}

/** A `resolveSource` for the adapter, backed by the bundle's `.map` file. */
export async function sourceResolver(bundle: string) {
  try {
    const map = (await (await fetch(`${bundle}.map`)).json()) as { sources: string[]; mappings: string };
    const lines = decode(map.mappings);
    return (_file: string, line: number, column: number) => {
      const segments = lines[line - 1] ?? [];
      let hit = segments[0];
      for (const segment of segments) if (segment[0] <= column - 1) hit = segment;
      if (!hit) return undefined;
      const path = new URL(map.sources[hit[1]], new URL(`${bundle}.map`, location.href)).pathname.replace(/^\//, "");
      return `${path}:${hit[2] + 1}`;
    };
  } catch {
    return undefined;
  }
}
