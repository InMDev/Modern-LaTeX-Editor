import { describe, it, expect, vi } from 'vitest';
import {
  escapeLatex,
  unescapeLatex,
  fetchWithTimeout,
  readJSONSafe,
  latexToHtml,
  htmlToLatex,
  summarizeLatexLog,
  compileWithWasmLatex,
} from '../../src/lib/latex';

// Helper to create a minimal Response-like mock
const makeRes = ({ ok = true, body = '', throwOnText = false } = {}) => ({
  ok,
  async text() {
    if (throwOnText) throw new Error('boom');
    return body;
  },
});

describe('latex helpers', () => {
  it('escapeLatex and unescapeLatex roundtrip core symbols', () => {
    const raw = `\\ { } $ & # % _ ^ ~ text`;
    const esc = escapeLatex(raw);
    // spot-check some escapes (ordering of escapes can affect braces)
    expect(esc).toContain('\\$');
    expect(esc).toContain('\\&');
    expect(esc).toContain('\\#');
    expect(esc).toContain('\\%');
    expect(esc).toContain('\\_');
    expect(esc).toContain('\\textasciicircum{}');
    expect(esc).toContain('\\textasciitilde{}');
    const un = unescapeLatex(esc);
    // Round-trip at least restores braces and punctuation
    expect(un).toContain('{');
    expect(un).toContain('}');
    expect(un).toContain('$');
    expect(un).toContain('&');
    expect(un).toContain('#');
    expect(un).toContain('%');
    expect(un).toContain('_');
  });

  it('unescapeLatex converts escaped dollar signs', () => {
    expect(unescapeLatex('\\$5')).toBe('$5');
  });

  it('readJSONSafe returns parsed JSON when valid', async () => {
    const res = makeRes({ body: JSON.stringify({ ok: true }) });
    const data = await readJSONSafe(res);
    expect(data).toEqual({ ok: true });
  });

  it('readJSONSafe returns null when ok but not JSON', async () => {
    const res = makeRes({ ok: true, body: 'not-json' });
    const data = await readJSONSafe(res);
    expect(data).toBeNull();
  });

  it('readJSONSafe returns error log when not ok and not JSON', async () => {
    const res = makeRes({ ok: false, body: 'Plain text error' });
    const data = await readJSONSafe(res);
    expect(data).toEqual({ status: 'error', log: 'Plain text error' });
  });

  it('readJSONSafe returns error when response cannot be read', async () => {
    const res = makeRes({ throwOnText: true });
    const data = await readJSONSafe(res);
    expect(data).toEqual({ status: 'error', log: 'Network response could not be read.' });
  });

  it('fetchWithTimeout proxies to fetch and passes AbortSignal', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn(async (url, opts) => {
      expect(url).toBe('/ping');
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      return makeRes({ body: 'ok' });
    });
    // @ts-ignore
    global.fetch = fetchMock;
    try {
      const res = await fetchWithTimeout('/ping', { method: 'GET' }, 50);
      const parsed = await res.text();
      expect(parsed).toBe('ok');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('fetchWithTimeout aborts when timeout elapses', async () => {
    const originalFetch = global.fetch;
    vi.useFakeTimers();
    const fetchMock = vi.fn((url, opts) => {
      expect(url).toBe('/slow');
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      return new Promise((resolve) => {
        opts.signal.addEventListener('abort', () => resolve(makeRes({ body: 'aborted' })), { once: true });
      });
    });
    // @ts-ignore
    global.fetch = fetchMock;
    try {
      const p = fetchWithTimeout('/slow', {}, 10);
      await vi.advanceTimersByTimeAsync(20);
      const res = await p;
      expect(await res.text()).toBe('aborted');
    } finally {
      vi.useRealTimers();
      global.fetch = originalFetch;
    }
  });

  it('latexToHtml returns empty string for empty input', () => {
    expect(latexToHtml('')).toBe('');
  });

  it('latexToHtml renders headings and wraps math in placeholders when KaTeX absent', () => {
    // Ensure no KaTeX in window
    // @ts-ignore
    delete window.katex;
    const latex = String.raw`\\documentclass{article}
\\begin{document}
\\section{Demo}
Inline $a+b$ and display: 
\\[ E = mc^2 \\]
\\end{document}`;
    const html = latexToHtml(latex);
    expect(html).toContain('<h1>Demo</h1>');
    // Inline math container
    expect(html).toContain('class="math-inline');
    // Display math container
    expect(html).toContain('class="math-block');
    // data-latex is URL-encoded
    expect(html).toContain('data-latex=');
  });

  it('latexToHtml uses KaTeX when available and falls back on render errors', () => {
    // @ts-ignore
    window.katex = {
      renderToString: vi
        .fn()
        .mockImplementationOnce(() => '<span data-katex="ok">K</span>')
        .mockImplementationOnce(() => {
          throw new Error('bad katex');
        }),
    };

    const latex = `\\begin{document}
\\section{Demo}
Inline $a+b$ and display:
\\[ E = mc^2 \\]
\\end{document}`;

    const html = latexToHtml(latex);
    expect(html).toContain('data-katex="ok"');
    expect(html).toContain('text-red-500');
  });

  it('latexToHtml converts common formatting, lists, images, and protected blocks', () => {
    // Ensure KaTeX absent to cover placeholder branch too.
    // @ts-ignore
    delete window.katex;

    const latex = `\\section{S}
\\textbf{B} \\textit{I} \\underline{U} \\textsf{Sans}
\\tiny tiny \\small small \\large large \\Large XL \\huge huge
\\textcolor{#ff00aa}{C} \\colorbox{blue}{BG}
\\begin{center}Center\\end{center}
\\begin{flushright}Right\\end{flushright}
\\begin{flushleft}Left\\end{flushleft}
\\href{https://example.com}{Link}
\\includegraphics[width=\\linewidth]{/img.png}
\\includegraphics{/img2.png}
\\begin{itemize}\\item One \\item Two \\end{itemize}
\\begin{enumerate}\\item A \\item B \\end{enumerate}
\\begin{itemize}
\\item[$\\square$] Task1 \\item[$\\square$] Task2
\\end{itemize}
\\begin{verbatim}code\\end{verbatim}
Inline $a+b$.
$$E = mc^2$$
Line\\\\break
\\texttt{mono}`;

    const html = latexToHtml(latex);
    expect(html).toContain('<b>B</b>');
    expect(html).toContain('<i>I</i>');
    expect(html).toContain('<u>U</u>');
    expect(html).toContain('font-family: sans-serif');
    expect(html).toContain('font-size: 5pt');
    expect(html).toContain('font-size: 9pt');
    expect(html).toContain('font-size: 12pt');
    expect(html).toContain('font-size: 14.4pt');
    expect(html).toContain('font-size: 20.74pt');
    expect(html).toContain('background-color: blue');
    expect(html).toContain('text-align: center');
    expect(html).toContain('text-align: right');
    expect(html).toContain('text-align: left');
    expect(html).toContain('<a href="https://example.com">Link</a>');
    expect(html).toContain('<img src="/img.png"');
    expect(html).toContain('<img src="/img2.png"');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
    expect(html).toContain('<br/>');
  });

  it('htmlToLatex converts back common structures (roundtrip smoke test)', () => {
    const latex = String.raw`\\documentclass{article}
\\begin{document}
\\section{Title}
Text before.
\\[ a^2 + b^2 = c^2 \\]
Text after.
\\end{document}`;
    const html = latexToHtml(latex);
    const back = htmlToLatex(html);
    expect(back).toContain('\\section{Title}');
    expect(back).toContain('\\[');
    expect(back).toContain('\\]');
  });

  it('htmlToLatex returns empty string for empty input', () => {
    expect(htmlToLatex('')).toBe('');
  });

  it('htmlToLatex converts rich HTML nodes, styles, and math editor blocks', () => {
    const html = [
      '<!--comment-->',
      '<h1>H1</h1>',
      '<h2>H2</h2>',
      '<h3>H3</h3>',
      '<h4>H4</h4>',
      '<p><b>B</b><strong>S</strong><i>I</i><em>E</em><u>U</u></p>',
      '<p><span style="color:#abc;background-color:rgb(1,2,3);font-family:sans-serif;font-size:10px">x</span></p>',
      '<p><span style="color:#A1B2C3">y</span></p>',
      '<p><span style="color:rgb(0,0,0)">k</span></p>',
      '<p><span style="text-align:center;font-size:5pt">c</span></p>',
      '<p><span style="text-align:right;font-size:9pt">r</span></p>',
      '<p><span style="font-size:12pt">L</span><span style="font-size:14.4pt">H</span><span style="font-size:20.74pt">G</span></p>',
      '<div>plain</div>',
      '<a href="https://example.com">Link</a>',
      '<img src="/img.png" />',
      '<ul><li>One</li><li><input type="checkbox" disabled value="on" /> Task</li></ul>',
      '<ol><li>A</li></ol>',
      '<pre>code</pre>',
      '<code>mono</code>',
      '<br/>',
      '<div class="math-inline" data-latex="a%2Bb"><input value="a+b"/></div>',
      '<div class="math-inline" data-latex="x%2By"></div>',
      '<div class="math-inline"></div>',
      '<div class="math-block" data-latex="E%3Dmc%5E2"><textarea>E=mc^2</textarea></div>',
      '<div class="math-block" data-latex="Z%3D1"></div>',
      '<div class="math-block"></div>',
      '<span style="background-color: var(--x)">v</span>',
      '<span style="font-size:12pt">m</span>',
    ].join('');

    const out = htmlToLatex(html);
    expect(out).toContain('\\section{H1}');
    expect(out).toContain('\\subsection{H2}');
    expect(out).toContain('\\subsubsection{H3}');
    expect(out).toContain('\\paragraph{H4}');
    expect(out).toContain('\\textbf{B}');
    expect(out).toContain('\\textit{I}');
    expect(out).toContain('\\underline{U}');
    expect(out).toContain('\\textcolor{#aabbcc}');
    expect(out).toContain('\\colorbox{#010203}');
    expect(out).toContain('\\textcolor{#a1b2c3}');
    expect(out).toContain('\\textcolor{#000000}');
    expect(out).toContain('\\colorbox{var(--x)}');
    expect(out).toContain('\\textsf{');
    expect(out).toContain('\\tiny');
    expect(out).toContain('\\small');
    expect(out).toContain('\\large');
    expect(out).toContain('\\Large');
    expect(out).toContain('\\huge');
    expect(out).toContain('\\begin{center}');
    expect(out).toContain('\\begin{flushright}');
    expect(out).toContain('\\href{https://example.com}{Link}');
    expect(out).toContain('\\includegraphics[width=\\linewidth]{/img.png}');
    expect(out).toContain('\\begin{itemize}');
    expect(out).toContain('\\item[$\\square$]');
    expect(out).toContain('\\begin{enumerate}');
    expect(out).toContain('\\begin{verbatim}');
    expect(out).toContain('\\texttt{mono}');
    expect(out).toContain('$a+b$');
    expect(out).toContain('$x+y$');
    expect(out).toContain('\\[');
    expect(out).toContain('\\]');
  });

  it('summarizeLatexLog extracts first error', () => {
    const log = '! Missing $ inserted.\nl.23 \\end{document}';
    const s = summarizeLatexLog(log);
    expect(s).toContain('Missing $ inserted.');
  });

  it('summarizeLatexLog works without an error context line', () => {
    const s = summarizeLatexLog('! Something bad happened.');
    expect(s).toContain('Something bad happened.');
  });

  it('summarizeLatexLog handles other warnings and generic errors', () => {
    expect(summarizeLatexLog('Overfull \\hbox (badness 10000) in paragraph')).toContain('Overfull');
    expect(summarizeLatexLog('Underfull \\hbox (badness 10000) in paragraph')).toContain('Underfull');
    expect(summarizeLatexLog('Some Error: boom')).toContain('Error');
    expect(summarizeLatexLog('')).toBe('');
  });

  it('summarizeLatexLog returns empty string when no relevant signals exist', () => {
    expect(summarizeLatexLog('Everything is fine.')).toBe('');
  });

  it('compileWithWasmLatex rejects when no engine configured', async () => {
    // @ts-ignore
    delete window.SwiftLaTeX;
    await expect(compileWithWasmLatex('\\documentclass{article}\\begin{document}x\\end{document}')).rejects.toThrow(/No WASM LaTeX engine configured/i);
  });

  it('compileWithWasmLatex uses a global SwiftLaTeX engine', async () => {
    // @ts-ignore
    window.SwiftLaTeX = { compile: vi.fn(async () => new Uint8Array([1, 2, 3])) };
    const blob = await compileWithWasmLatex('\\documentclass{article}\\begin{document}x\\end{document}');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('compileWithWasmLatex accepts base64 output and rejects unsupported output', async () => {
    // @ts-ignore
    window.SwiftLaTeX = { compile: vi.fn(async () => 'AQID') };
    const blob = await compileWithWasmLatex('\\documentclass{article}\\begin{document}x\\end{document}');
    expect(blob.type).toBe('application/pdf');

    // @ts-ignore
    window.SwiftLaTeX = { compile: vi.fn(async () => ({ nope: true })) };
    await expect(compileWithWasmLatex('\\documentclass{article}\\begin{document}x\\end{document}')).rejects.toThrow(/unsupported output format/i);
  });

  it('compileWithWasmLatex supports VITE_WASM_LATEX_MODULE compile API', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_WASM_LATEX_MODULE', '../../tests/fixtures/wasm-compile.js');
    const { compileWithWasmLatex: compile } = await import('../../src/lib/latex');
    const blob = await compile('\\documentclass{article}\\begin{document}x\\end{document}');
    expect(blob.type).toBe('application/pdf');
    vi.unstubAllEnvs();
  });

  it('compileWithWasmLatex supports VITE_WASM_LATEX_MODULE PDFTeX API', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_WASM_LATEX_MODULE', '../../tests/fixtures/wasm-pdftex.js');
    const { compileWithWasmLatex: compile } = await import('../../src/lib/latex');
    const blob = await compile('\\documentclass{article}\\begin{document}x\\end{document}');
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
    vi.unstubAllEnvs();
  });

  it('compileWithWasmLatex surfaces engine issues from configured modules', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_WASM_LATEX_MODULE', '../../tests/fixtures/wasm-no-api.js');
    const { compileWithWasmLatex: compileNoApi } = await import('../../src/lib/latex');
    await expect(compileNoApi('x')).rejects.toThrow(/no compatible api found/i);

    vi.resetModules();
    vi.stubEnv('VITE_WASM_LATEX_MODULE', '../../tests/fixtures/wasm-compile-unsupported.js');
    const { compileWithWasmLatex: compileUnsupported } = await import('../../src/lib/latex');
    await expect(compileUnsupported('x')).rejects.toThrow(/Unsupported WASM engine output format/i);

    vi.resetModules();
    vi.stubEnv('VITE_WASM_LATEX_MODULE', '../../tests/fixtures/wasm-pdftex-unsupported.js');
    const { compileWithWasmLatex: compilePdftexUnsupported } = await import('../../src/lib/latex');
    await expect(compilePdftexUnsupported('x')).rejects.toThrow(/Unsupported WASM engine output format/i);

    vi.resetModules();
    vi.stubEnv('VITE_WASM_LATEX_MODULE', '../../tests/fixtures/wasm-compile-throws.js');
    const { compileWithWasmLatex: compileThrows } = await import('../../src/lib/latex');
    await expect(compileThrows('x')).rejects.toThrow(/Boom from engine/i);

    vi.resetModules();
    vi.stubEnv('VITE_WASM_LATEX_MODULE', '../../tests/fixtures/wasm-compile-throws-string.js');
    const { compileWithWasmLatex: compileThrowsString } = await import('../../src/lib/latex');
    await expect(compileThrowsString('x')).rejects.toBe('Boom string');

    vi.resetModules();
    vi.stubEnv('VITE_WASM_LATEX_MODULE', '../../tests/fixtures/does-not-exist.js');
    const { compileWithWasmLatex: compileMissing } = await import('../../src/lib/latex');
    await expect(compileMissing('x')).rejects.toThrow(/Configured WASM module not found/i);

    vi.unstubAllEnvs();
  });

  it('compileWithWasmLatex handles non-browser environments', async () => {
    const originalWindow = globalThis.window;
    // @ts-ignore
    globalThis.window = undefined;
    try {
      await expect(compileWithWasmLatex('x')).rejects.toThrow(/No WASM LaTeX engine configured/i);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
