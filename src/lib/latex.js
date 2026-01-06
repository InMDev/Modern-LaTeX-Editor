// LaTeX helpers and WASM compiler integration

// Env flags (evaluated at module load)
const WASM_MODULE = import.meta.env.VITE_WASM_LATEX_MODULE; // optional ESM module id or URL

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

  // PROTECT BLOCKS
  content = content
    .replace(/\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g, (_, c) => protect(`<pre class="bg-slate-100 p-3 rounded font-mono text-sm my-4 border border-slate-200 overflow-x-auto" contenteditable="false">${c}</pre>`))
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
    .replace(/\\texttt\{([\s\S]*?)\}/g, (_, c) => protect(`<code class="bg-slate-100 px-1.5 py-0.5 rounded text-sm font-mono text-pink-600">${c}</code>`));

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
    .replace(/\\textcolor\{([a-zA-Z]+|#[0-9a-fA-F]{6})\}\{([\s\S]*?)\}/g, '<span style="color: $1">$2</span>')
    .replace(/\\colorbox\{([a-zA-Z]+|#[0-9a-fA-F]{6})\}\{([\s\S]*?)\}/g, '<span style="background-color: $1">$2</span>')
    .replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, '<div style="text-align: center">$1</div>')
    .replace(/\\begin\{flushright\}([\s\S]*?)\\end\{flushright\}/g, '<div style="text-align: right">$1</div>')
    .replace(/\\begin\{flushleft\}([\s\S]*?)\\end\{flushleft\}/g, '<div style="text-align: left">$1</div>')
    .replace(/\\href\{([\s\S]*?)\}\{([\s\S]*?)\}/g, '<a href="$1">$2</a>')
    .replace(/\\includegraphics\[.*?\]\{([\s\S]*?)\}/g, '<img src="$1" style="max-width:100%" />')
    .replace(/\\includegraphics\{([\s\S]*?)\}/g, '<img src="$1" style="max-width:100%" />')
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

  const getStyle = (node, prop) => node.style[prop];
  const rgbToHex = (color) => {
    const rgb = color.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!rgb) return color;
    const toHex = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0');
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  };

  const traverse = (node) => {
    if (node.nodeType === 3) {
      return escapeLatex(node.textContent.replace(/\s+/g, ' '));
    }

    if (node.nodeType === 1) {
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
      if (tagName === 'pre') return `\n\\begin{verbatim}\n${node.textContent}\n\\end{verbatim}\n`;
      if (tagName === 'code') return `\\texttt{${node.textContent}}`;

      const childContent = Array.from(node.childNodes).map(traverse).join('');
      const color = getStyle(node, 'color');
      const bg = getStyle(node, 'backgroundColor');
      const align = getStyle(node, 'textAlign');
      const fontSize = getStyle(node, 'fontSize');
      const fontFamily = getStyle(node, 'fontFamily');

      let prefix = ''; let suffix = '';

      if (color && color !== 'inherit' && !color.includes('black')) { prefix += `\\textcolor{${rgbToHex(color)}}{`; suffix = `}${suffix}`; }
      if (bg && bg !== 'inherit' && !bg.includes('rgba(0, 0, 0, 0)')) { prefix += `\\colorbox{${rgbToHex(bg)}}{`; suffix = `}${suffix}`; }
      if (align === 'center') { prefix = `\n\\begin{center}\n${prefix}`; suffix = `${suffix}\n\\end{center}\n`; }
      else if (align === 'right') { prefix = `\n\\begin{flushright}\n${prefix}`; suffix = `${suffix}\n\\end{flushright}\n`; }
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
        case 'img': return prefix + `\\includegraphics[width=\\linewidth]{${node.getAttribute('src')}}` + suffix;
        case 'ul': return prefix + `\n\\begin{itemize}\n${childContent}\\end{itemize}\n` + suffix;
        case 'ol': return prefix + `\n\\begin{enumerate}\n${childContent}\\end{enumerate}\n` + suffix;
        case 'li': 
            const isCheck = node.querySelector('input[type="checkbox"]');
            return `  \\item${isCheck ? '[$\\square$] ' : ' '}${childContent.replace(/^\s*/, '')}\n`;
        case 'br': 
          // Ignore auto-inserted <br> from contentEditable; avoid injecting \\.
          return '';
        case 'div': case 'p': return `\n\n${childContent}\n\n`;
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
  compileWithWasmLatex,
};
