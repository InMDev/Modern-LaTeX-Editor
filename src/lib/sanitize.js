const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'span',
  'div',
  'p',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'pre',
  'code',
  'br',
  'input',
  'textarea',
  // MathML (KaTeX accessibility tree) — keep these to avoid mangling output
  'math',
  'mrow',
  'mi',
  'mo',
  'mn',
  'mfrac',
  'msqrt',
  'mroot',
  'mstyle',
  'mspace',
  'mtd',
  'mtable',
  'mtr',
  'msup',
  'msub',
  'msubsup',
  'munderover',
  'munder',
  'mover',
  'mfenced',
  'semantics',
  'annotation',
  'mpadded',
  'menclose',
  'mglyph',
  'merror',
  'mlabeledtr',
]);

const GLOBAL_ATTRS = new Set(['class', 'style', 'contenteditable', 'data-latex', 'title', 'aria-hidden', 'role']);

const TAG_ATTRS = {
  a: new Set(['href', 'target', 'rel', ...GLOBAL_ATTRS]),
  img: new Set(['src', 'alt', ...GLOBAL_ATTRS]),
  input: new Set(['type', 'disabled', 'value', ...GLOBAL_ATTRS]),
  textarea: new Set(['value', ...GLOBAL_ATTRS]),
  // Allow a conservative set of MathML attributes used by KaTeX
  math: new Set(['xmlns', 'display', 'overflow', ...GLOBAL_ATTRS]),
  mrow: new Set(['displaystyle', 'scriptlevel', ...GLOBAL_ATTRS]),
  mi: new Set(['mathvariant', 'mathsize', ...GLOBAL_ATTRS]),
  mo: new Set(['stretchy', 'fence', 'separator', 'lspace', 'rspace', 'accent', ...GLOBAL_ATTRS]),
  mn: new Set([...GLOBAL_ATTRS]),
  mfrac: new Set(['linethickness', ...GLOBAL_ATTRS]),
  msqrt: new Set([...GLOBAL_ATTRS]),
  mroot: new Set([...GLOBAL_ATTRS]),
  mstyle: new Set(['displaystyle', 'scriptlevel', 'mathvariant', 'mathsize', ...GLOBAL_ATTRS]),
  mspace: new Set(['width', 'height', 'depth', ...GLOBAL_ATTRS]),
  mtd: new Set(['rowspan', 'columnspan', ...GLOBAL_ATTRS]),
  mtable: new Set(['rowspacing', 'columnspacing', ...GLOBAL_ATTRS]),
  mtr: new Set([...GLOBAL_ATTRS]),
  msup: new Set([...GLOBAL_ATTRS]),
  msub: new Set([...GLOBAL_ATTRS]),
  msubsup: new Set([...GLOBAL_ATTRS]),
  munderover: new Set([...GLOBAL_ATTRS]),
  munder: new Set([...GLOBAL_ATTRS]),
  mover: new Set([...GLOBAL_ATTRS]),
  mfenced: new Set(['open', 'close', 'separators', ...GLOBAL_ATTRS]),
  semantics: new Set([...GLOBAL_ATTRS]),
  annotation: new Set(['encoding', ...GLOBAL_ATTRS]),
};

const BASE_ALLOWED_STYLES = new Set([
  'color',
  'background-color',
  'text-align',
  'font-family',
  'font-size',
  'max-width',
]);

// KaTeX relies on a small set of inline styles for vertical layout (fractions, scripts, radicals).
// We allow these only for nodes inside a `.katex` subtree.
const KATEX_ALLOWED_STYLES = new Set([
  ...BASE_ALLOWED_STYLES,
  'height',
  'width',
  'min-width',
  'vertical-align',
  'top',
  'bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-bottom',
  'padding-left',
  'border-bottom-width',
  'border-width',
  'border-style',
]);

const KATEX_LENGTH_PROPS = new Set([
  'height',
  'width',
  'min-width',
  'vertical-align',
  'top',
  'bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-bottom',
  'padding-left',
  'border-bottom-width',
  'border-width',
]);

const SAFE_URL_RE = /^(https?:|mailto:|tel:|#|\/|\.{1,2}\/)/i;
const SAFE_IMG_SRC_RE = /^(https?:|\/|\.{1,2}\/|data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);)/i;

const SAFE_LENGTH_RE = /^-?(?:\d+|\d*\.\d+)(?:em|ex|mu|pt|px|rem|%)$/i;
const SAFE_ZERO_RE = /^-?0(?:\.0+)?$/;
const isSafeLength = (value) => SAFE_ZERO_RE.test(value) || SAFE_LENGTH_RE.test(value);

const sanitizeStyle = (styleText, { allowKatex = false } = {}) => {
  if (!styleText) return '';
  const allowedStyles = allowKatex ? KATEX_ALLOWED_STYLES : BASE_ALLOWED_STYLES;
  const out = [];
  for (const part of styleText.split(';')) {
    const [rawProp, ...rawValParts] = part.split(':');
    const prop = (rawProp || '').trim().toLowerCase();
    const value = rawValParts.join(':').trim();
    if (!prop || !value) continue;
    if (!allowedStyles.has(prop)) continue;
    if (/[<>]/.test(value)) continue;
    if (/url\s*\(|expression\s*\(/i.test(value)) continue;

    if (allowKatex) {
      if (KATEX_LENGTH_PROPS.has(prop) && !isSafeLength(value)) continue;
      if (prop === 'border-style' && value.toLowerCase() !== 'solid') continue;
    }

    out.push(`${prop}: ${value}`);
  }
  return out.join('; ');
};

const isSafeHref = (href) => typeof href === 'string' && SAFE_URL_RE.test(href.trim());
const isSafeImgSrc = (src) => typeof src === 'string' && SAFE_IMG_SRC_RE.test(src.trim());

const unwrapElement = (el) => {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
};

export const sanitizeEditorHtml = (html) => {
  if (!html) return '';
  const template = document.createElement('template');
  template.innerHTML = html;

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const toProcess = [];
  let cur = walker.nextNode();
  while (cur) {
    toProcess.push(cur);
    cur = walker.nextNode();
  }

  for (const el of toProcess) {
    const tag = el.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      // Drop outright-dangerous tags; unwrap unknown tags.
      if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object') {
        el.remove();
      } else {
        unwrapElement(el);
      }
      continue;
    }

    // Strip event handlers + unknown attrs.
    const allowedAttrs = TAG_ATTRS[tag] || GLOBAL_ATTRS;
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (!allowedAttrs.has(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href' && !isSafeHref(value)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'src' && !isSafeImgSrc(value)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style') {
        const allowKatex = !!(el.closest?.('.katex'));
        const sanitized = sanitizeStyle(value, { allowKatex });
        if (sanitized) el.setAttribute('style', sanitized);
        else el.removeAttribute('style');
        continue;
      }
      if (name === 'target') {
        // Only allow safe browsing contexts.
        if (value !== '_blank') el.removeAttribute('target');
        continue;
      }
      if (name === 'rel') {
        // Normalize rel to safe defaults when target is _blank.
        // (If target isn't _blank, rel isn't needed.)
        continue;
      }
      if (name === 'contenteditable') {
        // Only allow explicit false; never allow true on inner nodes.
        if (String(value).toLowerCase() !== 'false') el.setAttribute('contenteditable', 'false');
        continue;
      }
    }

    if (tag === 'a' && el.getAttribute('target') === '_blank') {
      el.setAttribute('rel', 'noopener noreferrer');
    } else if (tag === 'a') {
      el.removeAttribute('rel');
    }
  }

  return template.innerHTML;
};

const SUSPICIOUS_RE = /<\s*script|on\w+\s*=|javascript:|data:text\/html|<\s*iframe|<\s*object/i;

export const maybeSanitizeEditorHtml = (html) => {
  if (!html) return '';
  if (!SUSPICIOUS_RE.test(html)) return html;
  return sanitizeEditorHtml(html);
};
