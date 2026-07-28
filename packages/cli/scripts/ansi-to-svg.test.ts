import { describe, expect, test } from "bun:test";
import { parseAnsi, renderAnsiToSvg } from "./ansi-to-svg";

function textOf(rows: ReturnType<typeof parseAnsi>): string[] {
  return rows.map((row) => row.map((cell) => cell.char).join(""));
}

describe("parseAnsi", () => {
  test("splits plain output into rows", () => {
    expect(textOf(parseAnsi("one\ntwo\n"))).toEqual(["one", "two", ""]);
  });

  test("a carriage return overwrites the current line", () => {
    expect(textOf(parseAnsi("bin 40%\rbin 100%"))).toEqual(["bin 100%"]);
  });

  test("an erase-line escape clears the rest of the row", () => {
    expect(textOf(parseAnsi("channel 90%\r\x1b[Kbin 5%"))).toEqual(["bin 5%"]);
  });

  test("carries style across characters until it is reset", () => {
    const [row] = parseAnsi("\x1b[2mdim\x1b[22mlit");

    expect(row?.slice(0, 3).every((cell) => cell.style.dim === true)).toBe(
      true,
    );
    expect(row?.slice(3).every((cell) => cell.style.dim !== true)).toBe(true);
  });

  test("reads a foreground color", () => {
    expect(parseAnsi("\x1b[31mx")[0]?.[0]?.style.color).toBe("ansi1");
  });

  test("ignores cursor escapes it does not model", () => {
    expect(textOf(parseAnsi("a\x1b[2Ab"))).toEqual(["ab"]);
  });
});

describe("renderAnsiToSvg", () => {
  test("emits an svg sized to the widest row", () => {
    const svg = renderAnsiToSvg("hello\nhi\n");

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("hello");
    expect(svg).toContain("hi");
  });

  test("escapes markup in program output", () => {
    expect(renderAnsiToSvg("<tag> & more")).toContain("&lt;tag&gt; &amp; more");
  });

  test("renders dim text with reduced opacity", () => {
    expect(renderAnsiToSvg("\x1b[2mdim\x1b[22m")).toContain('opacity="0.62"');
  });

  test("drops the empty row a trailing newline leaves behind", () => {
    const withNewline = renderAnsiToSvg("one\n");
    const withoutNewline = renderAnsiToSvg("one");

    expect(withNewline).toBe(withoutNewline);
  });
});
