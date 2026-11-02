// Minimal Markdown renderer for model output. It builds DOM nodes with textContent
// and never assigns innerHTML, so text from the model cannot inject markup.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, children: (Node | string)[] = []) => {
  const node = document.createElement(tag);
  node.append(...children);
  return node;
};

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/;

function inline(source: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  let rest = source;
  for (let match = INLINE.exec(rest); match; match = INLINE.exec(rest)) {
    if (match.index) out.push(rest.slice(0, match.index));
    const [token, code, strong, em, link] = match;
    if (code) out.push(el('code', [code.slice(1, -1)]));
    else if (strong) out.push(el('strong', inline(strong.slice(2, -2))));
    else if (em) out.push(el('em', inline(em.slice(1, -1))));
    else if (link) {
      const [, label = '', href = ''] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(link)!;
      if (/^https?:\/\//i.test(href)) {
        const a = el('a', inline(label));
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        out.push(a);
      } else out.push(...inline(label));
    }
    rest = rest.slice(match.index + token.length);
  }
  if (rest) out.push(rest);
  return out;
}

// Model replies often use single newlines as intentional breaks, so keep them as <br>.
const lineBroken = (lines: string[]) =>
  lines.flatMap((line, n) => (n ? [el('br'), ...inline(line)] : inline(line)));

const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

export function renderMarkdown(target: HTMLElement, source: string) {
  const blocks: Node[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const at = (n: number) => lines[n] ?? '';
  let i = 0;
  while (i < lines.length) {
    const line = at(i);
    if (!line.trim()) {
      i++;
    } else if (FENCE.test(line)) {
      const fence = FENCE.exec(line)![1]!;
      const body: string[] = [];
      for (i++; i < lines.length && !at(i).trim().startsWith(fence); i++) body.push(at(i));
      i++;
      blocks.push(el('pre', [el('code', [body.join('\n')])]));
    } else if (HEADING.test(line)) {
      const [, hashes = '', title = ''] = HEADING.exec(line)!;
      // Results sit under the panel's own h2, so shift headings down to h3–h6.
      const level = Math.min(hashes.length + 2, 6) as 3 | 4 | 5 | 6;
      blocks.push(el(`h${level}`, inline(title)));
      i++;
    } else if (RULE.test(line)) {
      blocks.push(el('hr'));
      i++;
    } else if (BULLET.test(line) || ORDERED.test(line)) {
      const pattern = BULLET.test(line) ? BULLET : ORDERED;
      const list = el(pattern === BULLET ? 'ul' : 'ol');
      for (; i < lines.length && pattern.test(at(i)); i++)
        list.append(el('li', inline(pattern.exec(at(i))![1]!)));
      blocks.push(list);
    } else if (line.startsWith('>')) {
      const quote: string[] = [];
      for (; i < lines.length && at(i).startsWith('>'); i++) quote.push(at(i).replace(/^>\s?/, ''));
      blocks.push(el('blockquote', lineBroken(quote)));
    } else {
      const para: string[] = [];
      for (
        ;
        i < lines.length &&
        at(i).trim() &&
        ![FENCE, HEADING, RULE, BULLET, ORDERED].some((re) => re.test(at(i))) &&
        !at(i).startsWith('>');
        i++
      )
        para.push(at(i).trim());
      blocks.push(el('p', lineBroken(para)));
    }
  }
  target.replaceChildren(...blocks);
}
