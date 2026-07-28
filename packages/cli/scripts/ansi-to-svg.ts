/**
 * Render captured terminal bytes, ANSI escapes included, as an SVG.
 *
 * This exists so documentation images are produced from the CLI's real output
 * rather than hand-drawn: a script captures what the command writes and hands
 * the bytes here unchanged.
 */

export interface CellStyle {
  color?: string;
  dim?: boolean;
  bold?: boolean;
}

interface Cell {
  char: string;
  style: CellStyle;
}

export interface TerminalTheme {
  background: string;
  foreground: string;
  /** ANSI colors 0-7, then the bright variants 8-15. */
  palette: readonly string[];
  fontFamily: string;
  fontSize: number;
  /** Advance width as a fraction of the font size. Monospace fonts are 0.6. */
  advanceRatio: number;
  lineHeight: number;
  padding: number;
  radius: number;
  /** Height reserved for the window chrome above the first row. */
  chromeHeight: number;
}

export const defaultTheme: TerminalTheme = {
  background: "#14161c",
  foreground: "#d6dae4",
  palette: [
    "#262a33",
    "#e06c75",
    "#98c379",
    "#e5c07b",
    "#61afef",
    "#c678dd",
    "#56b6c2",
    "#d6dae4",
    "#4b5263",
    "#ef7a83",
    "#a9d68b",
    "#f0cd8c",
    "#74bcf5",
    "#d492e6",
    "#68c6d1",
    "#f2f4f8",
  ],
  fontFamily: "JetBrains Mono, DejaVu Sans Mono, monospace",
  fontSize: 15,
  advanceRatio: 0.6,
  lineHeight: 22,
  padding: 18,
  radius: 10,
  chromeHeight: 34,
};

const SGR_PATTERN = /^\x1b\[([0-9;]*)m/;
const ERASE_LINE_PATTERN = /^\x1b\[K/;
const OTHER_CSI_PATTERN = /^\x1b\[[0-9;?]*[a-zA-Z]/;

function applySgr(style: CellStyle, parameters: string): CellStyle {
  const codes = parameters === "" ? [0] : parameters.split(";").map(Number);
  let next: CellStyle = { ...style };

  for (let index = 0; index < codes.length; index++) {
    const code = codes[index]!;
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 39) next.color = undefined;
    else if (code >= 30 && code <= 37) next.color = `ansi${code - 30}`;
    else if (code >= 90 && code <= 97) next.color = `ansi${code - 90 + 8}`;
    else if (code === 38) {
      // 38;5;n (256 color) or 38;2;r;g;b (truecolor)
      if (codes[index + 1] === 5) {
        next.color = `x256:${codes[index + 2] ?? 0}`;
        index += 2;
      } else if (codes[index + 1] === 2) {
        const [r, g, b] = [
          codes[index + 2],
          codes[index + 3],
          codes[index + 4],
        ];
        next.color = `rgb(${r ?? 0},${g ?? 0},${b ?? 0})`;
        index += 4;
      }
    }
  }

  return next;
}

/**
 * Turn a byte stream into a grid of styled cells, honouring the cursor motion
 * a progress line depends on: `\r` returns to column zero so later writes
 * overwrite, and `\x1b[K` clears the rest of the line.
 */
export function parseAnsi(input: string): Cell[][] {
  const rows: Cell[][] = [[]];
  let row = 0;
  let column = 0;
  let style: CellStyle = {};

  const currentRow = (): Cell[] => {
    rows[row] ??= [];
    return rows[row]!;
  };

  let rest = input;
  while (rest.length > 0) {
    const sgr = SGR_PATTERN.exec(rest);
    if (sgr) {
      style = applySgr(style, sgr[1]!);
      rest = rest.slice(sgr[0].length);
      continue;
    }
    if (ERASE_LINE_PATTERN.test(rest)) {
      currentRow().length = column;
      rest = rest.slice(3);
      continue;
    }
    const otherCsi = OTHER_CSI_PATTERN.exec(rest);
    if (otherCsi) {
      rest = rest.slice(otherCsi[0].length);
      continue;
    }

    const char = rest[0]!;
    rest = rest.slice(1);

    if (char === "\n") {
      row++;
      column = 0;
      rows[row] ??= [];
      continue;
    }
    if (char === "\r") {
      column = 0;
      continue;
    }
    if (char === "\x1b") continue;

    const cells = currentRow();
    while (cells.length < column) cells.push({ char: " ", style: {} });
    cells[column] = { char, style };
    column++;
  }

  return rows;
}

function resolveColor(color: string | undefined, theme: TerminalTheme): string {
  if (color === undefined) return theme.foreground;
  if (color.startsWith("ansi")) {
    return theme.palette[Number(color.slice(4))] ?? theme.foreground;
  }
  if (color.startsWith("x256:")) {
    const index = Number(color.slice(5));
    if (index < 16) return theme.palette[index] ?? theme.foreground;
    if (index >= 232) {
      const level = 8 + (index - 232) * 10;
      return `rgb(${level},${level},${level})`;
    }
    const value = index - 16;
    const channel = (n: number) => (n === 0 ? 0 : 55 + n * 40);
    return `rgb(${channel(Math.floor(value / 36))},${channel(
      Math.floor(value / 6) % 6,
    )},${channel(value % 6)})`;
  }
  return color;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

interface Run {
  text: string;
  style: CellStyle;
  column: number;
}

function toRuns(cells: Cell[]): Run[] {
  const runs: Run[] = [];
  for (const [column, cell] of cells.entries()) {
    const previous = runs.at(-1);
    if (
      previous !== undefined &&
      previous.style.color === cell.style.color &&
      previous.style.dim === cell.style.dim &&
      previous.style.bold === cell.style.bold &&
      previous.column + previous.text.length === column
    ) {
      previous.text += cell.char;
    } else {
      runs.push({ text: cell.char, style: cell.style, column });
    }
  }
  return runs;
}

export interface RenderOptions {
  /** Window title drawn in the chrome bar. */
  title?: string;
  theme?: Partial<TerminalTheme>;
  /** Pad the grid out to this many columns so several images line up. */
  minColumns?: number;
}

export function renderAnsiToSvg(
  input: string,
  options: RenderOptions = {},
): string {
  const theme: TerminalTheme = { ...defaultTheme, ...options.theme };
  const rows = parseAnsi(input);
  // A trailing newline produces an empty final row that would only add space.
  while (rows.length > 1 && rows.at(-1)!.length === 0) rows.pop();

  const columns = Math.max(
    options.minColumns ?? 0,
    ...rows.map((row) => row.length),
  );
  const charWidth = theme.fontSize * theme.advanceRatio;
  const width = Math.ceil(columns * charWidth + theme.padding * 2);
  const height = Math.ceil(
    theme.chromeHeight + rows.length * theme.lineHeight + theme.padding,
  );

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(
      theme.fontFamily,
    )}" font-size="${theme.fontSize}">`,
  );
  lines.push(
    `<rect width="${width}" height="${height}" rx="${theme.radius}" fill="${theme.background}"/>`,
  );

  for (const [index, color] of ["#ff5f57", "#febc2e", "#28c840"].entries()) {
    lines.push(
      `<circle cx="${theme.padding + index * 18}" cy="17" r="6" fill="${color}"/>`,
    );
  }
  if (options.title !== undefined) {
    lines.push(
      `<text x="${width / 2}" y="22" text-anchor="middle" fill="#8b93a3" font-size="${
        theme.fontSize - 2
      }">${escapeXml(options.title)}</text>`,
    );
  }

  for (const [index, cells] of rows.entries()) {
    const y = theme.chromeHeight + (index + 1) * theme.lineHeight - 6;
    for (const run of toRuns(cells)) {
      if (run.text.trim() === "") continue;
      const fill = resolveColor(run.style.color, theme);
      const opacity = run.style.dim === true ? ' opacity="0.62"' : "";
      const weight = run.style.bold === true ? ' font-weight="700"' : "";
      lines.push(
        `<text xml:space="preserve" x="${(
          theme.padding +
          run.column * charWidth
        ).toFixed(
          2,
        )}" y="${y}" fill="${fill}"${opacity}${weight}>${escapeXml(run.text)}</text>`,
      );
    }
  }

  lines.push("</svg>");
  return lines.join("\n");
}
