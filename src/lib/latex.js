// LaTeX helpers and WASM compiler integration

// Env flags (evaluated at module load)
const WASM_MODULE = import.meta.env.VITE_WASM_LATEX_MODULE; // optional ESM module id or URL

const escapeHtml = (text) => {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const toSafeCssLength = (raw) => {
  const s = String(raw).trim();
  if (!s) return null;
  // Keep a conservative subset that maps cleanly between LaTeX and CSS.
  if (/^-?(?:\d+|\d*\.\d+)(?:em|ex|pt|px|rem|%|cm|mm|in)$/i.test(s)) return s;
  return null;
};

const TEXURE_CODE_LANGS = [
  'text',
  'javascript',
  'typescript',
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'bash',
  'json',
  'yaml',
  'html',
  'css',
  'latex',
];

const highlightCodeHtml = (lang, code) => {
  const rawLang = String(lang).trim().toLowerCase();
  const normalizedLang = rawLang === 'ts' ? 'typescript' : rawLang === 'js' ? 'javascript' : rawLang;
  const src = String(code || '');
  if (!src) return '';

  const wrap = (type, text) => {
    const safe = escapeHtml(text);
    if (!type) return safe;
    const base = 'texure-tok';
    const cls =
      type === 'comment'
        ? `${base} texure-tok-comment text-slate-500 italic`
        : type === 'string'
          ? `${base} texure-tok-string text-emerald-700`
          : type === 'keyword'
            ? `${base} texure-tok-keyword text-purple-700`
            : type === 'number'
              ? `${base} texure-tok-number text-amber-700`
              : type === 'variable'
                ? `${base} texure-tok-variable text-sky-700`
                : type === 'tag'
                  ? `${base} texure-tok-tag text-rose-700`
                  : `${base} texure-tok-${type} text-slate-700`;
    return `<span class="${cls}">${safe}</span>`;
  };

  const jsLike = new Set(['javascript', 'typescript', 'java', 'c', 'cpp', 'csharp', 'go', 'rust']);
  const hashComment = new Set(['python', 'bash', 'yaml']);

  const patterns = [];
  patterns.push({ type: null, re: /\s+/y });

  if (normalizedLang === 'html') {
    patterns.push({ type: 'tag', re: /<\/?[A-Za-z][^>]*>/y });
  }

  if (jsLike.has(normalizedLang) || normalizedLang === 'css') {
    patterns.push({ type: 'comment', re: /\/\/[^\n]*/y });
    patterns.push({ type: 'comment', re: /\/\*[\s\S]*?\*\//y });
  } else if (hashComment.has(normalizedLang)) {
    patterns.push({ type: 'comment', re: /#[^\n]*/y });
  } else if (normalizedLang === 'latex') {
    patterns.push({ type: 'comment', re: /%[^\n]*/y });
  }

  if (normalizedLang === 'javascript' || normalizedLang === 'typescript') {
    patterns.push({ type: 'string', re: /`(?:\\[\s\S]|[^`\\])*`/y });
    patterns.push({ type: 'string', re: /"(?:\\.|[^"\\])*"/y });
    patterns.push({ type: 'string', re: /'(?:\\.|[^'\\])*'/y });
  } else if (normalizedLang === 'python') {
    patterns.push({ type: 'string', re: /'''[\s\S]*?'''/y });
    patterns.push({ type: 'string', re: /"""[\s\S]*?"""/y });
    patterns.push({ type: 'string', re: /"(?:\\.|[^"\\])*"/y });
    patterns.push({ type: 'string', re: /'(?:\\.|[^'\\])*'/y });
  } else if (normalizedLang === 'json') {
    patterns.push({ type: 'string', re: /"(?:\\.|[^"\\])*"/y });
  } else {
    patterns.push({ type: 'string', re: /"(?:\\.|[^"\\])*"/y });
    patterns.push({ type: 'string', re: /'(?:\\.|[^'\\])*'/y });
  }

  patterns.push({ type: 'number', re: /\b\d+(?:\.\d+)?\b/y });

  if (normalizedLang === 'bash') {
    patterns.push({ type: 'variable', re: /\$[A-Za-z_][A-Za-z0-9_]*/y });
  }
  if (normalizedLang === 'latex') {
    patterns.push({ type: 'keyword', re: /\\[A-Za-z@]+/y });
  }

  const keywordSets = {
    javascript: [
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case',
      'break', 'continue', 'class', 'extends', 'new', 'try', 'catch', 'finally', 'throw', 'import',
      'from', 'export', 'default', 'async', 'await', 'typeof', 'instanceof', 'true', 'false', 'null',
      'undefined',
    ],
    python: [
      'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'class', 'import',
      'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'pass', 'True', 'False',
      'None', 'async', 'await',
    ],
    json: ['true', 'false', 'null'],
    bash: ['if', 'then', 'fi', 'for', 'in', 'do', 'done', 'case', 'esac', 'while', 'until', 'function'],
  };

  const kw = keywordSets[normalizedLang] || (normalizedLang === 'typescript' ? keywordSets.javascript : null);
  if (kw && kw.length) {
    patterns.push({ type: 'keyword', re: new RegExp(`\\b(?:${kw.map((k) => k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')).join('|')})\\b`, 'y') });
  }

  // Basic operators (covered by the fallback styling branch in `wrap`).
  if (jsLike.has(normalizedLang) || normalizedLang === 'python' || normalizedLang === 'bash') {
    patterns.push({ type: 'operator', re: /[=<>!:+\-*\/]+/y });
  }

  let i = 0;
  let out = '';
  while (i < src.length) {
    let matched = false;
    for (const p of patterns) {
      p.re.lastIndex = i;
      const m = p.re.exec(src);
      if (!m) continue;
      out += wrap(p.type, m[0]);
      i = p.re.lastIndex;
      matched = true;
      break;
    }
    if (!matched) {
      out += escapeHtml(src[i]);
      i += 1;
    }
  }
  return out;
};

const buildCodeBlockHtml = (lang, code) => {
  const langId = String(lang || '').trim() || 'text';
  const safeLang = escapeHtml(langId);
  const codeText = String(code || '');
  const encoded = encodeURIComponent(codeText);
  const highlighted = highlightCodeHtml(langId, codeText);

  const options = TEXURE_CODE_LANGS.map((l) => {
    const selected = l === safeLang ? ' selected' : '';
    return `<option value="${escapeHtml(l)}"${selected}>${escapeHtml(l)}</option>`;
  }).join('');

  return [
    `<div class="texure-codeblock not-prose my-4 border border-slate-200 rounded-lg overflow-hidden bg-slate-50" contenteditable="false" data-texure-code-lang="${safeLang}" data-texure-code="${encoded}">`,
    `  <div class="flex items-center gap-2 px-2 py-1 bg-white border-b border-slate-200">`,
    `    <select class="texure-code-lang text-xs font-medium text-slate-700 px-2 py-1 rounded border border-slate-200 bg-white">`,
    `      ${options}`,
    `    </select>`,
    `    <span class="text-[11px] text-slate-500">Code</span>`,
    `  </div>`,
    `  <div class="relative">`,
    `    <pre class="texure-code-preview absolute inset-0 m-0 p-3 overflow-auto font-mono text-sm leading-5 whitespace-pre text-slate-800 pointer-events-none select-none" aria-hidden="true"><code class="whitespace-pre">${highlighted}</code></pre>`,
    `    <textarea class="texure-code-input relative z-10 w-full min-h-[120px] p-3 font-mono text-sm leading-5 bg-transparent text-transparent caret-slate-800 focus:outline-none resize-none overflow-auto" spellcheck="false">${escapeHtml(codeText)}</textarea>`,
    `  </div>`,
    `</div>`,
  ].join('\n');
};

const escapeLatex = (text) => {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
};

const unescapeLatex = (text) => {
  return text
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\\$/g, '$')
    .replace(/\\&/g, '&')
    .replace(/\\#/g, '#')
    .replace(/\\%/g, '%')
    .replace(/\\_/g, '_')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\textasciitilde\{\}/g, '~');
};

// Small fetch helper with timeout
const fetchWithTimeout = (url, options = {}, timeoutMs = 10000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const opts = { ...options, signal: controller.signal };
  return fetch(url, opts).finally(() => clearTimeout(id));
};

// Safe JSON reader that forces text read on failure
const readJSONSafe = async (res) => {
  try {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      if (!res.ok) {
        return { status: 'error', log: text };
      }
      return null;
    }
  } catch (e) {
    return { status: 'error', log: 'Network response could not be read.' };
  }
};

const latexToHtml = (latex) => {
  if (!latex) return "";
  let bodyMatch = latex.match(/\\begin{document}([\s\S]*?)\\end{document}/);
  let content = bodyMatch ? bodyMatch[1] : latex;

  const TEXURE_IMAGE_PREFIX = 'texure-image:';
  const TRANSPARENT_GIF =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

  const renderMath = (math, displayMode) => {
    if (typeof window !== 'undefined' && window.katex) {
      try {
        return window.katex.renderToString(math, { displayMode: displayMode, throwOnError: false });
      } catch (e) { return `<span class="text-red-500">Error</span>`; }
    }
    return displayMode ? `<div class="math-placeholder">\\[${math}\\]</div>` : `<span class="math-placeholder">$${math}$</span>`;
  };

  const protectedBlocks = [];
  const protect = (str) => { protectedBlocks.push(str); return `__PROTECTED_BLOCK_${protectedBlocks.length - 1}__`; };

  const latexLengthToCssLength = (raw) => {
    const fmt = (num) => {
      const s = String(Math.round(num * 1000) / 1000);
      return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
    };
    const s = String(raw).trim();
    const m = s.match(/^(-?(?:\d+|\d*\.\d+))\s*(pt|px|em|ex|cm|mm|in)\s*$/i);
    if (!m) return null;
    const num = Number(m[1]);
    if (!Number.isFinite(num)) return null;
    const unit = m[2].toLowerCase();
    if (unit === 'pt') {
      const px = num * (4 / 3); // 1pt ≈ 1.333px
      return `${fmt(px)}px`;
    }
    return `${fmt(num)}${unit}`;
  };

  // Images: store local images in the document as `texure-image:<id>` placeholders.

  // PROTECT BLOCKS
  content = content
    // Indentation blocks: emitted as `{\\leftskip=<len>\\relax ... \\par}` from the visual editor.
    .replace(/\{\\leftskip\s*=\s*([^}]+?)\\relax([\s\S]*?)\\par\}/g, (_, len, inner) => {
      const cssLen = latexLengthToCssLength(len);
      const style = cssLen ? ` style="margin-left: ${escapeHtml(cssLen)}"` : '';
      const innerHtml = latexToHtml(inner);
      return protect(`<div${style}>${innerHtml}</div>`);
    })
    .replace(/\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g, (_, c) => {
      const code = String(c || '').replace(/^\n/, '').replace(/\n$/, '');
      return protect(buildCodeBlockHtml('text', code));
    })
    .replace(/\\begin\{minted\}(?:\[[^\]]*\])?\{([^}]*)\}([\s\S]*?)\\end\{minted\}/g, (_, lang, c) => {
      const code = String(c || '').replace(/^\n/, '').replace(/\n$/, '');
      return protect(buildCodeBlockHtml(lang, code));
    })
    .replace(/\\begin\{lstlisting\}(?:\[([^\]]*)\])?([\s\S]*?)\\end\{lstlisting\}/g, (_, optText, c) => {
      const opts = String(optText || '');
      const langMatch = opts.match(/(?:^|,)\s*language\s*=\s*([^,\]]+)\s*(?:,|$)/i);
      const rawLang = (langMatch?.[1] || 'text').trim();
      const normalized = (() => {
        const l = rawLang.toLowerCase();
        if (!l || l === 'text') return 'text';
        if (l === 'javascript' || l === 'js') return 'javascript';
        if (l === 'python' || l === 'py') return 'python';
        if (l === 'bash' || l === 'sh' || l === 'shell') return 'bash';
        if (l === 'json') return 'json';
        if (l === 'yaml' || l === 'yml') return 'yaml';
        if (l === 'html') return 'html';
        if (l === 'css') return 'css';
        if (l === 'tex' || l === 'latex') return 'latex';
        if (l.includes('c++') || l === 'cpp') return 'cpp';
        if (l.includes('sharp') || l === 'c#' || l === 'csharp') return 'csharp';
        if (l === 'java') return 'java';
        if (l === 'go') return 'go';
        if (l === 'rust') return 'rust';
        if (l === 'c') return 'c';
        return 'text';
      })();
      const code = String(c || '').replace(/^\n/, '').replace(/\n$/, '');
      return protect(buildCodeBlockHtml(normalized, code));
    })
    // Inline minted (delimiter form): \mintinline{lang}|code|
    .replace(/\\mintinline(?:\[[^\]]*\])?\{([^}]*)\}([^\s])([\s\S]*?)\2/g, (_, lang, delim, c) => {
      const safeLang = escapeHtml(String(lang || '').trim());
      return protect(`<code class="texure-inline-code" data-texure-code-lang="${safeLang}">${escapeHtml(c)}</code>`);
    })
    // Inline minted (brace form): \mintinline{lang}{code} (best-effort)
    .replace(/\\mintinline(?:\[[^\]]*\])?\{([^}]*)\}\{([\s\S]*?)\}/g, (_, lang, c) => {
      const safeLang = escapeHtml(String(lang || '').trim());
      return protect(`<code class="texure-inline-code" data-texure-code-lang="${safeLang}">${escapeHtml(c)}</code>`);
    })
    // Checkbox task lists: protect before inline-math handling so the `$\\square$` marker isn't converted into a math placeholder.
    .replace(/\\begin\{itemize\}\s*\\item\[\$\\square\$\]([\s\S]*?)\\end\{itemize\}/g, (_, i) => {
      const list = `<ul style="list-style-type: none;">${i
        .split('\\item[$\\square$]')
        .join('</li><li><input type="checkbox" disabled> ')
        .replace(/^<\/li>/, '')}</li></ul>`;
      return protect(list);
    })
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => {
      return protect(`<div class="math-block not-prose my-4 text-center cursor-pointer hover:bg-blue-50 transition-colors rounded py-2" contenteditable="false" data-latex="${encodeURIComponent(m)}">${renderMath(m, true)}</div>`);
    })
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => {
      return protect(`<div class="math-block not-prose my-4 text-center cursor-pointer hover:bg-blue-50 transition-colors rounded py-2" contenteditable="false" data-latex="${encodeURIComponent(m)}">${renderMath(m, true)}</div>`);
    })
    .replace(/(?<!\\)\$([^$]+?)\$/g, (_, m) => {
      return protect(`<span class="math-inline not-prose px-1 cursor-pointer hover:bg-blue-50 transition-colors rounded" contenteditable="false" data-latex="${encodeURIComponent(m)}">${renderMath(m, false)}</span>`);
    })
    .replace(/\\texttt\{([\s\S]*?)\}/g, (_, c) => {
      const txt = String(c ?? '');
      if (!txt.replace(/[\u200B\uFEFF]/g, '').trim()) return '';
      return protect(`<code class="texure-inline-code">${escapeHtml(txt)}</code>`);
    })
    // Manual spacing / pagination
    .replace(/\\hspace\*?\{([^}]*)\}/g, (_, len) => {
      const raw = String(len || '').trim();
      const cssLen = toSafeCssLength(raw);
      const style = cssLen ? ` style="width: ${escapeHtml(cssLen)}"` : '';
      const title = escapeHtml(`\\hspace{${raw}}`);
      const latexCmd = escapeHtml(`\\hspace{${raw}}`);
      return protect(`<span class="inline-block align-baseline bg-slate-200/70 border border-dashed border-slate-400 rounded-sm" contenteditable="false" data-texure-latex="${latexCmd}" title="${title}"${style}>&nbsp;</span>`);
    })
    .replace(/\\vspace\*?\{([^}]*)\}/g, (_, len) => {
      const raw = String(len || '').trim();
      const cssLen = toSafeCssLength(raw);
      const style = cssLen ? ` style="height: ${escapeHtml(cssLen)}"` : '';
      const title = escapeHtml(`\\vspace{${raw}}`);
      const latexCmd = escapeHtml(`\\vspace{${raw}}`);
      return protect(`<div class="my-2 bg-slate-200/40 border border-dashed border-slate-400 rounded-sm w-full" contenteditable="false" data-texure-latex="${latexCmd}" title="${title}"${style}></div>`);
    })
    .replace(/\\newpage\b/g, () => {
      const latexCmd = escapeHtml(`\\newpage`);
      return protect(`<div class="my-6 border-t border-dashed border-slate-400 text-[10px] text-slate-500 text-center" contenteditable="false" data-texure-latex="${latexCmd}" title="\\newpage">\\newpage</div>`);
    });

  // FORMATTING
  content = content
    .replace(/\\section\s*\{([\s\S]*?)\}/g, '<h1>$1</h1>')
    .replace(/\\subsection\s*\{([\s\S]*?)\}/g, '<h2>$1</h2>')
    .replace(/\\subsubsection\s*\{([\s\S]*?)\}/g, '<h3>$1</h3>')
    .replace(/\\textbf\{([\s\S]*?)\}/g, '<b>$1</b>')
    .replace(/\\textit\{([\s\S]*?)\}/g, '<i>$1</i>')
    .replace(/\\underline\{([\s\S]*?)\}/g, '<u>$1</u>')
    .replace(/\\textsf\{([\s\S]*?)\}/g, '<span style="font-family: sans-serif">$1</span>')
    // Roughly match default LaTeX font sizes (article 10pt)
    .replace(/\\tiny\s+([\s\S]*?)(?=\\|\n|$)/g, '<span style="font-size: 5pt">$1</span>')
    .replace(/\\scriptsize\s+([\s\S]*?)(?=\\|\n|$)/g, '<span style="font-size: 7pt">$1</span>')
    .replace(/\\footnotesize\s+([\s\S]*?)(?=\\|\n|$)/g, '<span style="font-size: 8pt">$1</span>')
    .replace(/\\small\s+([\s\S]*?)(?=\\|\n|$)/g, '<span style="font-size: 9pt">$1</span>')
    .replace(/\\normalsize\s+([\s\S]*?)(?=\\|\n|$)/g, '<span style="font-size: 10pt">$1</span>')
    .replace(/\\large\s+([\s\S]*?)(?=\\|\n|$)/g, '<span style="font-size: 12pt">$1</span>')
    .replace(/\\Large\s+([\s\S]*?)(?=\\|\n|$)/g, '<span style="font-size: 14.4pt">$1</span>')
    .replace(/\\LARGE\s+([\s\S]*?)(?=\\|\n|$)/g, '<span style="font-size: 17.28pt">$1</span>')
    .replace(/\\huge\s+([\s\S]*?)(?=\\|\n|$)/g, '<span style="font-size: 20.74pt">$1</span>')
    .replace(/\\Huge\s+([\s\S]*?)(?=\\|\n|$)/g, '<span style="font-size: 24.88pt">$1</span>')
    .replace(/\\textcolor\[(HTML)\]\{([0-9a-fA-F]{6})\}\{([\s\S]*?)\}/g, '<span style="color: #$2">$3</span>')
    .replace(/\\colorbox\[(HTML)\]\{([0-9a-fA-F]{6})\}\{([\s\S]*?)\}/g, '<span style="background-color: #$2">$3</span>')
    .replace(/\\textcolor\{([a-zA-Z]+|#[0-9a-fA-F]{6})\}\{([\s\S]*?)\}/g, '<span style="color: $1">$2</span>')
    .replace(/\\colorbox\{([a-zA-Z]+|#[0-9a-fA-F]{6})\}\{([\s\S]*?)\}/g, '<span style="background-color: $1">$2</span>')
    .replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, '<div style="text-align: center">$1</div>')
    .replace(/\\begin\{flushright\}([\s\S]*?)\\end\{flushright\}/g, '<div style="text-align: right">$1</div>')
    .replace(/\\begin\{flushleft\}([\s\S]*?)\\end\{flushleft\}/g, '<div style="text-align: left">$1</div>')
    .replace(/\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g, '<blockquote>$1</blockquote>')
    .replace(/\\begin\{quotation\}([\s\S]*?)\\end\{quotation\}/g, '<blockquote>$1</blockquote>')
    .replace(/\\begin\{justify\}([\s\S]*?)\\end\{justify\}/g, '<div style="text-align: justify">$1</div>')
    .replace(/\\justify\{([\s\S]*?)\}/g, '<div style="text-align: justify">$1</div>')
    .replace(/\\href\{([\s\S]*?)\}\{([\s\S]*?)\}/g, '<a href="$1">$2</a>')
    .replace(/\\includegraphics\[((?:[^\]]|\](?!\{))*)\]\{([\s\S]*?)\}/g, (_, optsText, src) => {
      const opts = String(optsText || '');
      const parsed = (() => {
        const out = {};
        for (const part of opts.split(',')) {
          const [k, ...rest] = part.split('=');
          const key = (k || '').trim().toLowerCase();
          const val = rest.join('=').trim();
          if (!key) continue;
          out[key] = val;
        }
        return out;
      })();

      let widthFrac = null;
      const w = String(parsed.width || '').trim();
      if (w) {
        const m = w.match(/^(\d+(?:\.\d+)?)?\s*\\linewidth$/);
        if (m) widthFrac = m[1] ? Number(m[1]) : 1;
      }

      const angleDeg = parsed.angle ? Number(parsed.angle) : null;
      const raw = String(src || '').trim();
      if (raw.startsWith(TEXURE_IMAGE_PREFIX)) {
        const id = raw.slice(TEXURE_IMAGE_PREFIX.length).trim();
        const safeId = id.replace(/"/g, '&quot;');
        const attrs = [
          `data-texure-image-id="${safeId}"`,
          widthFrac != null && Number.isFinite(widthFrac) ? `data-texure-img-width="${String(widthFrac)}"` : '',
          angleDeg != null && Number.isFinite(angleDeg) ? `data-texure-img-angle="${String(angleDeg)}"` : '',
        ].filter(Boolean).join(' ');
        return `<img src="${TRANSPARENT_GIF}" ${attrs} alt="" style="max-width:100%" />`;
      }
      const safeSrc = raw.replace(/"/g, '&quot;');
      const attrs = [
        widthFrac != null && Number.isFinite(widthFrac) ? `data-texure-img-width="${String(widthFrac)}"` : '',
        angleDeg != null && Number.isFinite(angleDeg) ? `data-texure-img-angle="${String(angleDeg)}"` : '',
      ].filter(Boolean).join(' ');
      return `<img src="${safeSrc}" ${attrs} style="max-width:100%" />`;
    })
    .replace(/\\includegraphics\{([\s\S]*?)\}/g, (_, src) => {
      const raw = String(src || '').trim();
      if (raw.startsWith(TEXURE_IMAGE_PREFIX)) {
        const id = raw.slice(TEXURE_IMAGE_PREFIX.length).trim();
        const safeId = id.replace(/"/g, '&quot;');
        return `<img src="${TRANSPARENT_GIF}" data-texure-image-id="${safeId}" data-texure-img-width="1" alt="" style="max-width:100%" />`;
      }
      const safeSrc = raw.replace(/"/g, '&quot;');
      return `<img src="${safeSrc}" data-texure-img-width="1" style="max-width:100%" />`;
    })
    .replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_, i) => `<ul>${i.split('\\item').filter(t=>t.trim()).map(t=>`<li>${t.trim()}</li>`).join('')}</ul>`)
    .replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, (_, i) => `<ol>${i.split('\\item').filter(t=>t.trim()).map(t=>`<li>${t.trim()}</li>`).join('')}</ol>`);

  // SPACING FIX
  content = content
    .replace(/\\\\/g, '<br/>')
    // Do NOT convert plain newlines to <br/>; keep them as spacing only
    .replace(/\n/g, ' ');

  content = unescapeLatex(content);
  content = content.replace(/__PROTECTED_BLOCK_(\d+)__/g, (_, i) => protectedBlocks[i]);
  return content;
};

const htmlToLatex = (html) => {
  if (!html) return "";
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  const stripZeroWidth = (text) => String(text || '').replace(/[\u200B\uFEFF]/g, '');

  const normalizeTexureLatex = (cmd) => {
    const s = String(cmd);
    // Historical bug: some placeholders stored commands like `\\newpage` (double slash).
    // Normalize the common texure placeholders back to a single leading backslash.
    if (/^\\\\(hspace|vspace|newpage)\b/.test(s)) return s.slice(1);
    return s;
  };

  const getStyle = (node, prop) => node.style[prop];

  const cssLengthToLatexLength = (raw) => {
    const fmt = (num) => {
      const s = String(Math.round(num * 1000) / 1000);
      return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
    };
    const s = String(raw || '').trim().toLowerCase();
    const m = s.match(/^(-?(?:\d+|\d*\.\d+))\s*(px|pt|em|rem|cm|mm|in)\s*$/i);
    if (!m) return null;
    const num = Number(m[1]);
    if (!Number.isFinite(num) || Math.abs(num) < 1e-9) return null;
    const unit = m[2].toLowerCase();
    if (unit === 'px') {
      const pt = num * 0.75; // 1px ≈ 0.75pt
      return `${fmt(pt)}pt`;
    }
    if (unit === 'rem') return `${fmt(num)}em`;
    return `${fmt(num)}${unit}`;
  };

  const toListingsLanguage = (rawLang) => {
    const l = String(rawLang || '').trim().toLowerCase();
    if (!l || l === 'text' || l === 'plain' || l === 'plaintext') return null;
    if (l === 'js' || l === 'javascript') return 'JavaScript';
    if (l === 'ts' || l === 'typescript') return 'JavaScript';
    if (l === 'py' || l === 'python') return 'Python';
    if (l === 'c++' || l === 'cpp') return 'C++';
    if (l === 'c#' || l === 'csharp') return '[Sharp]C';
    if (l === 'bash' || l === 'sh' || l === 'shell') return 'bash';
    if (l === 'json') return 'JSON';
    if (l === 'yaml' || l === 'yml') return 'yaml';
    if (l === 'html') return 'HTML';
    if (l === 'css') return 'CSS';
    if (l === 'latex' || l === 'tex') return 'TeX';
    if (l === 'java') return 'Java';
    if (l === 'go') return 'Go';
    if (l === 'rust') return 'Rust';
    if (l === 'c') return 'C';
    return null;
  };
  const rgbToHex = (color) => {
    if (!color) return null;
    const c = color.trim();
    const lc = c.toLowerCase();
    if (lc === 'transparent' || lc === 'inherit' || lc === 'initial' || lc === 'unset') return null;
    if (/^var\s*\(/i.test(c)) return null;
    if (/^[a-z]+$/i.test(c)) return c;

    const rgb = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+)\s*)?\)$/i);
    if (!rgb) return null;
    const alpha = rgb[4] != null ? Number(rgb[4]) : 1;
    if (!Number.isFinite(alpha) || alpha <= 0) return null;
    const toHex = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0');
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  };

  const toXcolorSpec = (raw) => {
    const c = String(raw || '').trim();
    if (!c) return null;
    if (c.startsWith('#') && /^[0-9a-fA-F]{6}$/.test(c.slice(1))) {
      return { model: 'HTML', value: c.slice(1).toUpperCase() };
    }
    if (/^[a-zA-Z]+$/.test(c)) return { model: null, value: c };
    return null;
  };

  const xcolorWrap = (cmd, spec) => {
    if (!spec) return null;
    if (spec.model) return `\\${cmd}[${spec.model}]{${spec.value}}{`;
    return `\\${cmd}{${spec.value}}{`;
  };

  const isNotionInlineCodeStyle = (node) => {
    if (!node || !node.style) return false;
    const bgHex = rgbToHex(getStyle(node, 'backgroundColor'));
    const cHex = rgbToHex(getStyle(node, 'color'));
    if (bgHex === '#878378' && (!cHex || cHex === '#eb5757')) return true;
    if (cHex === '#eb5757' && (!bgHex || bgHex === '#878378')) return true;
    return false;
  };

  const traverse = (node) => {
    if (node.nodeType === 3) {
      const text = stripZeroWidth(node.textContent).replace(/\s+/g, ' ');
      return escapeLatex(text);
    }

    if (node.nodeType === 1) {
      const texureLatex = node.getAttribute('data-texure-latex');
      if (texureLatex) {
        const cmd = normalizeTexureLatex(texureLatex);
        const tag = node.tagName.toLowerCase();
        if (tag === 'div' || tag === 'p' || tag === 'pre') return `\n${cmd}\n`;
        return cmd;
      }

      if (node.classList.contains('texure-codeblock')) {
        const lang = (node.getAttribute('data-texure-code-lang') || 'text').trim();
        const encoded = node.getAttribute('data-texure-code') || '';
        const textarea = node.querySelector('textarea');
        const code = encoded ? decodeURIComponent(encoded) : (textarea?.value || textarea?.textContent || '');
        const safeCode = String(code || '').replace(/^\n/, '').replace(/\n$/, '');
        const langOpt = toListingsLanguage(lang);
        const opt = langOpt ? `[language=${langOpt}]` : '';
        return `\n\\begin{lstlisting}${opt}\n${safeCode}\n\\end{lstlisting}\n`;
      }

      if (node.classList.contains('math-block')) {
        const input = node.querySelector('textarea');
        const latex = input ? input.value : decodeURIComponent(node.getAttribute('data-latex') || "");
        return `\n\\[\n${latex}\n\\]\n`;
      }
      if (node.classList.contains('math-inline')) {
        const input = node.querySelector('input');
        const latex = input ? input.value : decodeURIComponent(node.getAttribute('data-latex') || "");
        return `$${latex}$`;
      }

      const tagName = node.tagName.toLowerCase();
      if (tagName === 'pre') {
        const codeEl = node.querySelector('code');
        const lang = (codeEl?.getAttribute?.('data-texure-code-lang') || node.getAttribute?.('data-texure-code-lang') || '').trim();
        const code = (codeEl ? codeEl.textContent : node.textContent) || '';
        const safeCode = String(code || '').replace(/^\n/, '').replace(/\n$/, '');
        const listingLang = toListingsLanguage(lang);
        const opt = listingLang ? `[language=${listingLang}]` : '';
        return `\n\\begin{lstlisting}${opt}\n${safeCode}\n\\end{lstlisting}\n`;
      }

      if (tagName === 'code' || node.classList.contains('texure-inline-code') || isNotionInlineCodeStyle(node)) {
        // Inline code: always use texttt (no minted/listings shell-escape).
        const code = stripZeroWidth(node.textContent || '');
        if (!code.trim()) return '';
        return `\\texttt{${escapeLatex(code)}}`;
      }

      const childContent = Array.from(node.childNodes).map(traverse).join('');
      if (
        tagName === 'span' &&
        !stripZeroWidth(node.textContent || '').trim() &&
        !String(childContent || '').replace(/\s+/g, '')
      ) return '';
      const color = getStyle(node, 'color');
      const bg = getStyle(node, 'backgroundColor');
      const align = getStyle(node, 'textAlign');
      const fontSize = getStyle(node, 'fontSize');
      const fontFamily = getStyle(node, 'fontFamily');
      const marginLeft = getStyle(node, 'marginLeft');
      const marginRight = getStyle(node, 'marginRight');
      const paddingLeft = getStyle(node, 'paddingLeft');
      const paddingRight = getStyle(node, 'paddingRight');
      const textIndent = getStyle(node, 'textIndent');

      let prefix = ''; let suffix = '';

      const cHex = rgbToHex(color);
      const bgHex = rgbToHex(bg);
      const cSpec = toXcolorSpec(cHex);
      const bgSpec = toXcolorSpec(bgHex);
      if (cSpec && !String(cSpec.value || '').toLowerCase().includes('black')) {
        const wrap = xcolorWrap('textcolor', cSpec);
        if (wrap) { prefix += wrap; suffix = `}${suffix}`; }
      }
      if (bgSpec) {
        const wrap = xcolorWrap('colorbox', bgSpec);
        if (wrap) { prefix += wrap; suffix = `}${suffix}`; }
      }
      if (align === 'center') { prefix = `\n\\begin{center}\n${prefix}`; suffix = `${suffix}\n\\end{center}\n`; }
      else if (align === 'right') { prefix = `\n\\begin{flushright}\n${prefix}`; suffix = `${suffix}\n\\end{flushright}\n`; }
      else if (align === 'justify') { prefix = `\n\\begin{justify}\n${prefix}`; suffix = `${suffix}\n\\end{justify}\n`; }
      if (fontFamily && fontFamily.includes('sans')) { prefix += `\\textsf{`; suffix = `}${suffix}`; }
      if (fontSize) {
          const s = parseInt(fontSize);
          if (s <= 6) prefix += `\\tiny `;
          else if (s <= 7) prefix += `\\scriptsize `;
          else if (s <= 8) prefix += `\\footnotesize `;
          else if (s <= 9) prefix += `\\small `;
          else if (s >= 24) prefix += `\\Huge `;
          else if (s >= 20) prefix += `\\huge `;
          else if (s >= 17) prefix += `\\LARGE `;
          else if (s >= 14) prefix += `\\Large `;
          else if (s >= 12) prefix += `\\large `;
          else prefix += `\\normalsize `;
      }

      switch (tagName) {
        case 'h1': return prefix + `\n\\section{${childContent}}\n` + suffix;
        case 'h2': return prefix + `\n\\subsection{${childContent}}\n` + suffix;
        case 'h3': return prefix + `\n\\subsubsection{${childContent}}\n` + suffix;
        case 'h4': return prefix + `\n\\paragraph{${childContent}}\n` + suffix;
        case 'b': case 'strong': return prefix + `\\textbf{${childContent}}` + suffix;
        case 'i': case 'em': return prefix + `\\textit{${childContent}}` + suffix;
        case 'u': return prefix + `\\underline{${childContent}}` + suffix;
        case 'a': return prefix + `\\href{${node.getAttribute('href')}}{${childContent}}` + suffix;
        case 'img': {
          const texureId = node.getAttribute('data-texure-image-id');
          const src = node.getAttribute('src') || '';
          const ref = texureId ? `texure-image:${texureId}` : src;
          const widthAttr = node.getAttribute('data-texure-img-width');
          const angleAttr = node.getAttribute('data-texure-img-angle');
          const opts = [];
          const widthFrac = widthAttr != null ? Number(widthAttr) : NaN;
          if (Number.isFinite(widthFrac) && widthFrac > 0) {
            if (Math.abs(widthFrac - 1) < 1e-6) opts.push('width=\\linewidth');
            else opts.push(`width=${String(widthFrac)}\\linewidth`);
          } else {
            opts.push('width=\\linewidth');
          }
	          const angleDeg = angleAttr != null ? Number(angleAttr) : NaN;
	          if (Number.isFinite(angleDeg) && Math.abs(angleDeg) > 1e-6) opts.push(`angle=${String(angleDeg)}`);
	          const optText = `[${opts.join(',')}]`;
	          return prefix + `\\includegraphics${optText}{${ref}}` + suffix;
	        }
        case 'ul': return prefix + `\n\\begin{itemize}\n${childContent}\\end{itemize}\n` + suffix;
        case 'ol': return prefix + `\n\\begin{enumerate}\n${childContent}\\end{enumerate}\n` + suffix;
        case 'li': 
            const isCheck = node.querySelector('input[type="checkbox"]');
            return `  \\item${isCheck ? '[$\\square$] ' : ' '}${childContent.replace(/^\s*/, '')}\n`;
        case 'br': 
          // Ignore auto-inserted <br> from contentEditable; avoid injecting \\.
          return '';
        case 'blockquote': {
          return `\n\\begin{quote}\n${prefix}${childContent}${suffix}\n\\end{quote}\n`;
        }
        case 'div':
        case 'p': {
          const hasIndentStyle = !!(marginLeft || marginRight || paddingLeft || paddingRight || textIndent);
          if (hasIndentStyle) {
            const len = cssLengthToLatexLength(marginLeft || paddingLeft || textIndent);
            if (len) {
              return `\n{\\leftskip=${len}\\relax\n${prefix}${childContent}${suffix}\n\\par}\n`;
            }
          }
          return prefix + `\n\n${childContent}\n\n` + suffix;
        }
        default: return prefix + childContent + suffix;
      }
    }
    return "";
  };
  return Array.from(tempDiv.childNodes).map(traverse).join('').replace(/\n{3,}/g, '\n\n').trim();
};

// Parse LaTeX log to a short human-friendly summary
const summarizeLatexLog = (log) => {
  if (!log) return '';
  const lines = log.split(/\r?\n/);
  const bangIdx = lines.findIndex(l => l.trim().startsWith('!'));
  if (bangIdx !== -1) {
    const err = lines[bangIdx].replace(/^!\s*/, '');
    const ctx = lines[bangIdx + 1] || '';
    const lnMatch = ctx.match(/l\.(\d+)/);
    const ln = lnMatch ? ` at line ${lnMatch[1]}` : '';
    return `${err}${ln}`.trim();
  }
  const overfull = lines.find(l => l.includes('Overfull'));
  if (overfull) return overfull.trim();
  const underfull = lines.find(l => l.includes('Underfull'));
  if (underfull) return underfull.trim();
  const genericErr = lines.find(l => /error/i.test(l));
  if (genericErr) return genericErr.trim();
  return '';
};

// Lazy-load and compile LaTeX to PDF in-browser using a WASM engine
const isWasmLatexEngineConfigured = () => {
  if (WASM_MODULE) return true;
  const g = typeof window !== 'undefined' ? window : {};
  return !!(g.SwiftLaTeX && typeof g.SwiftLaTeX.compile === 'function');
};

const compileWithWasmLatex = async (latex) => {
  const toBlob = (bytesOrBase64) => {
    if (bytesOrBase64 instanceof Uint8Array || Array.isArray(bytesOrBase64)) {
      return new Blob([bytesOrBase64], { type: 'application/pdf' });
    }
    if (typeof bytesOrBase64 === 'string') {
      const bin = atob(bytesOrBase64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'application/pdf' });
    }
    return null;
  };

  if (WASM_MODULE) {
    try {
      const mod = await import(/* @vite-ignore */ WASM_MODULE);
      if (mod?.PDFTeX?.new) {
        const pdftex = await mod.PDFTeX.new();
        const out = await pdftex.compile(latex);
        const blob = toBlob(out);
        if (!blob) throw new Error('Unsupported WASM engine output format');
        return blob;
      }
      if (typeof mod?.compile === 'function') {
        const out = await mod.compile(latex);
        const blob = toBlob(out);
        if (!blob) throw new Error('Unsupported WASM engine output format');
        return blob;
      }
      throw new Error('WASM module loaded, but no compatible API found');
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (/Cannot find module|Cannot resolve|Failed to resolve|not found/i.test(msg)) {
        throw new Error('Configured WASM module not found. Check VITE_WASM_LATEX_MODULE or install the engine.');
      }
      throw e;
    }
  }

  const g = typeof window !== 'undefined' ? window : {};
  if (g.SwiftLaTeX && typeof g.SwiftLaTeX.compile === 'function') {
    const out = await g.SwiftLaTeX.compile(latex);
    const blob = toBlob(out);
    if (!blob) throw new Error('SwiftLaTeX returned unsupported output format');
    return blob;
  }

  throw new Error('No WASM LaTeX engine configured. Set VITE_WASM_LATEX_MODULE to an importable module or load a global engine and enable VITE_USE_WASM_LATEX.');
};

export {
  escapeLatex,
  unescapeLatex,
  fetchWithTimeout,
  readJSONSafe,
  latexToHtml,
  htmlToLatex,
  summarizeLatexLog,
  isWasmLatexEngineConfigured,
  compileWithWasmLatex,
};
