// Small syntax highlighter for code snippets. Like markdown.ts, it builds DOM nodes with
// textContent only, so highlighted text can never become markup.
//
// observeCode() colours every <pre> (and any element with data-lang) now and whenever the
// app later changes its text, so callers keep setting textContent as before.
import './highlight.css';

type Lang = 'ts' | 'json' | 'shell' | 'python';
type Rule = [kind: string, pattern: RegExp];

const words = (list: string) => new Set(list.split(' '));
const TS_KEYWORDS = words(
  'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in instanceof interface keyof let namespace new of private protected public readonly return satisfies set static super switch throw try type typeof var void while with yield',
);
const PY_KEYWORDS = words(
  'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
);
const SHELL_KEYWORDS = words(
  'if then else elif fi for in do done while case esac function export set cd echo npm npx node git pnpm yarn',
);
const LITERALS = words('true false null undefined this NaN Infinity True False None');

const STRING = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y;
const NUMBER = /-?\b(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?)\b/iy;
const WORD = /[A-Za-z_$][\w$]*/y;

const RULES: Record<Lang, Rule[]> = {
  ts: [
    ['comment', /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
    ['string', /`(?:\\[\s\S]|[^`\\])*`/y],
    ['string', STRING],
    ['number', NUMBER],
  ],
  json: [
    ['property', /"(?:\\.|[^"\\\n])*"(?=\s*:)/y],
    ['string', STRING],
    ['number', NUMBER],
  ],
  shell: [
    ['comment', /(?:^|(?<=\s))#[^\n]*/y],
    ['string', STRING],
    ['variable', /\$\{?[\w:]+\}?/y],
    ['property', /(?<=\s)--?[A-Za-z][\w-]*/y],
    ['number', NUMBER],
  ],
  python: [
    ['comment', /#[^\n]*/y],
    ['string', /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/y],
    ['string', STRING],
    ['number', NUMBER],
  ],
};

const KEYWORDS: Record<Lang, Set<string>> = {
  ts: TS_KEYWORDS,
  json: new Set(),
  shell: SHELL_KEYWORDS,
  python: PY_KEYWORDS,
};

const ALIASES: Record<string, Lang> = {
  ts: 'ts',
  tsx: 'ts',
  typescript: 'ts',
  js: 'ts',
  jsx: 'ts',
  javascript: 'ts',
  mjs: 'ts',
  json: 'json',
  jsonc: 'json',
  sh: 'shell',
  bash: 'shell',
  shell: 'shell',
  zsh: 'shell',
  console: 'shell',
  powershell: 'shell',
  ps1: 'shell',
  pwsh: 'shell',
  py: 'python',
  python: 'python',
};

function span(kind: string, value: string) {
  const node = document.createElement('span');
  node.className = `tok-${kind}`;
  node.textContent = value;
  return node;
}

export function highlight(source: string, lang: Lang): (Node | string)[] {
  const out: (Node | string)[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push(plain);
    plain = '';
  };
  const push = (kind: string, value: string) => {
    flush();
    out.push(span(kind, value));
  };
  let i = 0;
  scan: while (i < source.length) {
    for (const [kind, pattern] of RULES[lang]) {
      pattern.lastIndex = i;
      const match = pattern.exec(source);
      if (match?.[0]) {
        push(kind, match[0]);
        i += match[0].length;
        continue scan;
      }
    }
    WORD.lastIndex = i;
    const word = lang === 'json' ? null : WORD.exec(source)?.[0];
    if (word && (i === 0 || !/[\w$]/.test(source[i - 1] ?? ''))) {
      const next = source.slice(i + word.length).match(/^\s*(.)/)?.[1];
      // After a dot, words like `type` or `set` are property names, not keywords.
      if (source[i - 1] === '.') plain += word;
      else if (KEYWORDS[lang].has(word)) push('keyword', word);
      else if (LITERALS.has(word)) push('literal', word);
      else if (next === '(') push('function', word);
      else if (lang === 'ts' && /^[A-Z]/.test(word)) push('type', word);
      else plain += word;
      i += word.length;
      continue;
    }
    if (lang === 'json' && /^(?:true|false|null)\b/.test(source.slice(i))) {
      const literal = /^(?:true|false|null)/.exec(source.slice(i))![0];
      push('literal', literal);
      i += literal.length;
      continue;
    }
    plain += source[i];
    i++;
  }
  flush();
  return out;
}

const CODE_LIKE = /[;{}]|=>|\b(?:const|let|import|export|function|await|def|class)\b|^\s*[$>] /m;

function detect(element: HTMLElement, text: string): Lang | undefined {
  const named =
    element.dataset.lang ??
    element.closest<HTMLElement>('[data-lang]')?.dataset.lang ??
    /\blanguage-([\w+-]+)/.exec(element.className)?.[1];
  if (named) return ALIASES[named.toLowerCase()];
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not JSON; fall through to the code check.
    }
  }
  return CODE_LIKE.test(text) ? 'ts' : undefined;
}

const highlighted = new WeakMap<HTMLElement, string>();

function apply(element: HTMLElement) {
  const text = element.textContent ?? '';
  const onlyText = [...element.childNodes].every((node) => node.nodeType === Node.TEXT_NODE);
  // Skip text we already coloured, and leave hand-written markup alone.
  if (!onlyText && (highlighted.get(element) === text || !highlighted.has(element))) return;
  highlighted.set(element, text);
  const lang = detect(element, text);
  const parts = lang ? highlight(text, lang) : [];
  // Only touch the DOM when something gets coloured: rewriting a plain text node would
  // trigger the observer again and loop forever.
  if (parts.some((part) => typeof part !== 'string')) element.replaceChildren(...parts);
}

function scan(root: ParentNode) {
  for (const element of root.querySelectorAll<HTMLElement>('pre, [data-lang]')) {
    if (element.dataset.lang === 'none') continue;
    const code = element.querySelector<HTMLElement>(':scope > code');
    apply(element.tagName === 'PRE' && code && element.childElementCount === 1 ? code : element);
  }
}

export function observeCode(root: HTMLElement = document.body) {
  scan(root);
  // Our own replaceChildren triggers one more pass, which finds nothing new and stops.
  new MutationObserver(() => scan(root)).observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}
