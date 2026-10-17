// Markdown as a dialog shows it, in lines of the dialog's width
import { BOLD, DIM, splitToWidth, Style, wrap } from '../grid';

// Inline Markdown without its marks: **bold**, __bold__ and `code` as plain text
function inline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`]+)`/g, '$1');
}

// Markdown for a dialog (a ticket, the improve agent's proposals, the grader): the status from the
// frontmatter, headings and lines that are all bold in bold, paragraphs and list items joined and wrapped to the
// width again, a line that starts in bold (`**Why:** …`) on a line of its own, code blocks as they are, in pieces
export function markdown(content: string, width: number): [string, Style][] {
  const out: [string, Style][] = [];
  const status = /^---\n[\s\S]*?^status:\s*(\S+)[\s\S]*?^---\n/m.exec(content);
  if (status) out.push([`status: ${status[1]}`, DIM]);
  const text = content.replace(/^---\n[\s\S]*?\n---\n/, '');
  // `indent`: where the text starts, `marker`: the list item's, in front of its first line
  let block: { indent: number; marker: string; text: string } | undefined;
  const flush = () => {
    if (!block) return;
    const { indent, marker } = block;
    const pad = ' '.repeat(indent);
    const first = ' '.repeat(indent - marker.length) + marker; // the marker in front of the first line, aligned with the rest
    wrap(inline(block.text), Math.max(10, width - indent)).forEach((line, i) => out.push([`${i ? pad : first}${line}`, {}]));
    block = undefined;
  };
  let code: number | undefined; // the code block's indent, from its fence
  for (const line of text.split('\n')) {
    const fence = /^(\s*)```/.exec(line);
    if (fence) {
      flush();
      code = code === undefined ? fence[1].length : undefined;
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)]) +(.*)$/.exec(line);
    if (code !== undefined) {
      // Indented by 2, a long line wrapped at its spaces and continued under its own indent
      const [, lead, rest] = /^(\s*)(.*)$/.exec(`  ${line.slice(code)}`)!;
      const room = width - lead.length;
      const pieces = room >= 20 ? wrap(rest, room).map((piece) => lead + piece) : splitToWidth(lead + rest, width);
      for (const piece of pieces) out.push([piece, DIM]);
    } else if (!line.trim()) {
      flush();
      if (out.length && out[out.length - 1][0] !== '') out.push(['', {}]);
    } else if (/^#+ /.test(line) || /^\s*\*\*[^*]+\*\*:?\s*$/.test(line)) {
      flush();
      for (const piece of wrap(inline(line.replace(/^#+ /, '').trim()), width)) out.push([piece, BOLD]);
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flush();
    } else if (item) {
      flush();
      const level = Math.min(Math.floor(item[1].length / 2), 3);
      const marker = /\d/.test(item[2]) ? `${item[2]} ` : '• ';
      block = { indent: level * 2 + marker.length, marker, text: item[3] };
    } else if (block && !/^\s*\*\*/.test(line)) {
      block.text += ` ${line.trim()}`;
    } else {
      flush();
      block = { indent: 0, marker: '', text: line.trim() };
    }
  }
  flush();
  while (out.length && out[out.length - 1][0] === '') out.pop();
  return out;
}
