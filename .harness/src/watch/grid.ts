// A character grid that `flows watch` draws into, then prints as one frame.
// Colour means two things only: run = running, you = needs you. The rest is text, muted or line.
// The colours are the Zühlke theme's, softened: the 75% tones on dark terminals, the full ones on light.

export interface Style {
  fg?: 'text' | 'muted' | 'line' | 'run' | 'you';
  bg?: 'you' | 'raised' | 'selected';
  bold?: boolean;
}

interface Cell extends Style {
  ch: string;
}

export const RUN: Style = { fg: 'run', bold: true };
export const YOU: Style = { fg: 'you', bold: true };
export const DIM: Style = { fg: 'muted' };
export const LINE: Style = { fg: 'line' };
export const BOLD: Style = { bold: true };

export type Theme = 'dark' | 'light';

// text stays the terminal's own colour, so it's readable even if the theme is guessed wrong
const PALETTES: Record<Theme, Record<Exclude<Style['fg'], 'text' | undefined> | NonNullable<Style['bg']> | 'youTint', string>> = {
  dark: { muted: '#8C8C8C', line: '#3A3A3A', run: '#40B3D9', you: '#B284B5', youTint: '#2B2430', raised: '#252427', selected: '#332E37' },
  light: { muted: '#8C8C8C', line: '#E2E2E2', run: '#0099CC', you: '#985B9C', youTint: '#F6F0F6', raised: '#FBFAFB', selected: '#EFE7F0' },
};

export class Grid {
  cells: Cell[][];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: ' ' })));
  }

  // Keeps the background that's already there unless the style sets one, so text can sit on a tinted row
  put(x: number, y: number, ch: string, style: Style = {}): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[y][x] = { ch, fg: style.fg, bold: style.bold, bg: style.bg ?? this.cells[y][x].bg };
  }

  // Writes the text, cut off at maxWidth (and the grid's edge). Returns the column after it.
  text(x: number, y: number, text: string, style: Style = {}, maxWidth = this.width - x): number {
    const chars = [...text];
    const shown = chars.length > maxWidth ? [...chars.slice(0, Math.max(0, maxWidth - 1)), '…'] : chars;
    shown.forEach((ch, i) => this.put(x + i, y, ch, style));
    return x + shown.length;
  }

  fill(x: number, y: number, width: number, height: number, style: Style): void {
    for (let j = y; j < y + height; j++) for (let i = x; i < x + width; i++) this.put(i, j, ' ', style);
  }

  // Always thin and rounded. `heavy` is kept for the callers: a colour shows the emphasis instead.
  box(x: number, y: number, width: number, height: number, style: Style = LINE, _heavy = false): void {
    const s = { fg: style.fg ?? 'line', bg: style.bg };
    for (let i = x + 1; i < x + width - 1; i++) {
      this.put(i, y, '─', s);
      this.put(i, y + height - 1, '─', s);
    }
    for (let j = y + 1; j < y + height - 1; j++) {
      this.put(x, j, '│', s);
      this.put(x + width - 1, j, '│', s);
    }
    this.put(x, y, '╭', s);
    this.put(x + width - 1, y, '╮', s);
    this.put(x, y + height - 1, '╰', s);
    this.put(x + width - 1, y + height - 1, '╯', s);
  }

  // The frame with 24-bit colours, for the terminal
  ansi(theme: Theme): string {
    const palette = PALETTES[theme];
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(';');
    return this.cells
      .map((row) => {
        let out = '';
        let last = '';
        for (const cell of row) {
          const codes: string[] = [];
          if (cell.bold) codes.push('1');
          if (cell.fg && cell.fg !== 'text') codes.push(`38;2;${rgb(palette[cell.fg])}`);
          if (cell.bg) codes.push(`48;2;${rgb(palette[cell.bg === 'you' ? 'youTint' : cell.bg])}`);
          const sgr = codes.length ? `\x1b[${codes.join(';')}m` : '';
          if (sgr !== last) {
            out += `\x1b[0m${sgr}`;
            last = sgr;
          }
          out += cell.ch;
        }
        return out + '\x1b[0m';
      })
      .join('\r\n');
  }

  // The frame as plain text, for `flows watch --once` and the tests
  plain(): string {
    return this.cells.map((row) => row.map((cell) => cell.ch).join('').trimEnd()).join('\n');
  }
}

// Splits text into lines of at most `width` characters, at spaces where it can
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line && (line + ' ' + word).length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
      while (line.length > width) {
        lines.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    lines.push(line);
  }
  return lines;
}

// A line in pieces of the width, exactly as it is: the agents' output has code, where spaces matter
export function splitToWidth(line: string, width: number): string[] {
  const chars = [...line];
  const pieces: string[] = [];
  for (let i = 0; i < chars.length; i += width) pieces.push(chars.slice(i, i + width).join(''));
  return pieces.length ? pieces : [''];
}
