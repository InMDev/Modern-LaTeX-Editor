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

  it('unescapeLatex converts escaped braces', () => {
    expect(unescapeLatex('\\}')).toBe('}');
    expect(unescapeLatex('\\{')).toBe('{');
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

  it('latexToHtml handles empty verbatim and lstlisting bodies', () => {
    // @ts-ignore
    delete window.katex;
    expect(latexToHtml('\\begin{verbatim}\\end{verbatim}')).toContain('texure-codeblock');
    expect(latexToHtml('\\begin{lstlisting}\\end{lstlisting}')).toContain('texure-codeblock');
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
	\\textcolor[HTML]{FF00AA}{C} \\colorbox{blue}{BG}
\\begin{center}Center\\end{center}
\\begin{flushright}Right\\end{flushright}
\\begin{flushleft}Left\\end{flushleft}
\\href{https://example.com}{Link}
\\includegraphics[width=\\linewidth]{/img.png}
\\includegraphics{/img2.png}
\\includegraphics{texure-image:abc123}
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
    expect(html).toContain('data-texure-image-id="abc123"');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('texure-codeblock');
    expect(html).toContain('<textarea');
    expect(html).toContain('>code</textarea>');
    expect(html).toContain('<code');
    expect(html).toContain('<br/>');
  });

  it('latexToHtml converts leftskip indentation blocks', () => {
    // @ts-ignore
    delete window.katex;
    const latex = String.raw`\begin{document}
{\leftskip=7.5pt\relax Indented \textbf{B}.\par}
{\leftskip=1pt\relax Pt.\par}
{\leftskip=2em\relax Em.\par}
\end{document}`;
    const html = latexToHtml(latex);
    expect(html).toContain('margin-left: 10px');
    expect(html).toContain('Indented');
    expect(html).toContain('<b>B</b>');
    expect(html).toContain('margin-left: 1.333px');
    expect(html).toContain('Pt.');
    expect(html).toContain('margin-left: 2em');
    expect(html).toContain('Em.');
  });

  it('latexToHtml tolerates invalid leftskip lengths', () => {
    // @ts-ignore
    delete window.katex;
    const huge = `1${'0'.repeat(400)}pt`;
    const latex = `\\begin{document}
{\\leftskip=bad\\relax Bad\\par}
{\\leftskip=${huge}\\relax Huge\\par}
\\end{document}`;
    const html = latexToHtml(latex);
    expect(html).toMatch(/<div>\s*Bad<\/div>/);
    expect(html).toMatch(/<div>\s*Huge<\/div>/);
    expect(html).not.toMatch(/margin-left/i);
  });

  it('latexToHtml syntax-highlights code blocks by language', () => {
    // @ts-ignore
    delete window.katex;
    const latex = String.raw`\\begin{document}
\\begin{lstlisting}[language=JavaScript]
const x = "hi"; // c
x += 1;
42
\\end{lstlisting}
\\end{document}`;
    const html = latexToHtml(latex);
    expect(html).toContain('texure-code-preview');
    expect(html).toContain('texure-tok-keyword');
    expect(html).toContain('texure-tok-string');
    expect(html).toContain('texure-tok-comment');
    expect(html).toContain('texure-tok-number');
    expect(html).toContain('texure-tok-operator');
  });

  it('latexToHtml syntax-highlights multiple languages and aliases', () => {
    // @ts-ignore
    delete window.katex;
    const latex = String.raw`\begin{document}
\begin{minted}{js}const x = 1; // c\end{minted}
\begin{minted}{ts}const y = 2;\end{minted}
\begin{minted}{typescript}const z = 3;\end{minted}
\begin{minted}{python}# c
x = 1\end{minted}
\begin{minted}{bash}echo $HOME # c\end{minted}
\begin{minted}{latex}% c
\alpha\end{minted}
\begin{minted}{html}<div class="x">y</div>\end{minted}
\end{document}`;
    const html = latexToHtml(latex);
    expect(html).toContain('texure-tok-variable');
    expect(html).toContain('texure-tok-tag');
    expect(html).toContain('texure-tok-comment');
    expect(html).toContain('texure-tok-keyword');
  });

  it('latexToHtml supports minted, manual spacing, and page breaks', () => {
    // @ts-ignore
    delete window.katex;
    const latex = String.raw`\\begin{document}
Inline: \\mintinline{python}|print("hi")|

\\begin{minted}[linenos]{javascript}
const x = 1;
\\end{minted}

\\hspace{1em}A\\vspace{12pt}
\\newpage
\\end{document}`;

    const html = latexToHtml(latex);
    expect(html).toContain('data-texure-code-lang="python"');
    expect(html).toContain('texure-codeblock');
    expect(html).toContain('<textarea');
    expect(html).toContain('data-texure-code-lang="javascript"');
    expect(html).toContain('const x = 1;');
    expect(html).toContain('data-texure-latex="\\hspace{1em}"');
    expect(html).toContain('data-texure-latex="\\vspace{12pt}"');
    expect(html).toContain('data-texure-latex="\\newpage"');
  });

  it('latexToHtml supports mintinline brace form', () => {
    // @ts-ignore
    delete window.katex;
    // Intentionally omit other curly braces after the code block so the delimiter-form regex doesn't over-match.
    const html = latexToHtml('\\mintinline{js}{a+b}');
    expect(html).toContain('data-texure-code-lang="js"');
    expect(html).toContain('a+b');
  });

  it('latexToHtml supports lstlisting code blocks', () => {
    // @ts-ignore
    delete window.katex;
    const latex = String.raw`\\begin{document}
\\begin{lstlisting}[language=Python]
print(1)
\\end{lstlisting}
\\end{document}`;
    const html = latexToHtml(latex);
    expect(html).toContain('texure-codeblock');
    expect(html).toContain('data-texure-code-lang="python"');
    expect(html).toContain('print(1)');
  });

  it('latexToHtml normalizes lstlisting language names', () => {
    // @ts-ignore
    delete window.katex;
    const latex = String.raw`\\begin{document}
\\begin{lstlisting}[language=sh]
SHELL
\\end{lstlisting}
\\begin{lstlisting}[language=text]
TEXT
\\end{lstlisting}
\\begin{lstlisting}[language=js]
JS
\\end{lstlisting}
\\begin{lstlisting}[language=json]
JSON
\\end{lstlisting}
\\begin{lstlisting}[language=yml]
YAML
\\end{lstlisting}
\\begin{lstlisting}[language=html]
HTML
\\end{lstlisting}
\\begin{lstlisting}[language=css]
CSS
\\end{lstlisting}
\\begin{lstlisting}[language=tex]
TEX
\\end{lstlisting}
\\begin{lstlisting}[language=c++]
CPP
\\end{lstlisting}
\\begin{lstlisting}[language=c#]
CSHARP
\\end{lstlisting}
\\begin{lstlisting}[language=java]
JAVA
\\end{lstlisting}
\\begin{lstlisting}[language=go]
GO
\\end{lstlisting}
\\begin{lstlisting}[language=rust]
RUST
\\end{lstlisting}
\\begin{lstlisting}[language=c]
C
\\end{lstlisting}
\\begin{lstlisting}[language=unknown]
UNKNOWN
\\end{lstlisting}
\\end{document}`;

    const html = latexToHtml(latex);
    const t = document.createElement('template');
    t.innerHTML = html;
    const blocks = Array.from(t.content.querySelectorAll('.texure-codeblock'));
    const langs = blocks.map((b) => b.getAttribute('data-texure-code-lang'));
    expect(langs).toEqual([
      'bash',
      'text',
      'javascript',
      'json',
      'yaml',
      'html',
      'css',
      'latex',
      'cpp',
      'csharp',
      'java',
      'go',
      'rust',
      'c',
      'text',
    ]);
  });

  it('latexToHtml handles empty minted/mintinline language and code', () => {
    // @ts-ignore
    delete window.katex;

    const minted = latexToHtml('\\begin{minted}{}\\end{minted}');
    expect(minted).toContain('data-texure-code-lang="text"');
    expect(minted).toContain('texure-codeblock');

    const inlineDelim = latexToHtml('\\mintinline{}|x|');
    expect(inlineDelim).toContain('data-texure-code-lang=""');
    expect(inlineDelim).toContain('x');

    const inlineBrace = latexToHtml('\\mintinline{}{}');
    expect(inlineBrace).toContain('data-texure-code-lang=""');
  });

  it('handles empty code blocks and missing widget attrs', () => {
    // @ts-ignore
    delete window.katex;

    const latex = String.raw`\\begin{document}
\\begin{verbatim}\\end{verbatim}
\\begin{minted}{python}\\end{minted}
\\begin{lstlisting}X\\end{lstlisting}
\\end{document}`;
    const html = latexToHtml(latex);
    expect(html).toContain('texure-codeblock');
    expect(html).toContain('data-texure-code-lang="python"');

    const out = htmlToLatex([
      '<div class="texure-codeblock" contenteditable="false"><textarea>Z</textarea></div>',
      '<div class="texure-codeblock" contenteditable="false"><textarea></textarea></div>',
      '<pre><code data-texure-code-lang="js"></code></pre>',
    ].join(''));
    expect(out).toContain('\\begin{lstlisting}\nZ\n\\end{lstlisting}');
    expect(out).toContain('\\begin{lstlisting}[language=JavaScript]');
    expect(out).toContain('\\end{lstlisting}');
  });

  it('latexToHtml drops invalid/empty CSS lengths for hspace placeholders', () => {
    // @ts-ignore
    delete window.katex;

    for (const input of ['\\hspace{nope}', '\\hspace{}']) {
      const html = latexToHtml(input);
      const t = document.createElement('template');
      t.innerHTML = html;
      const span = t.content.querySelector('span[data-texure-latex]');
      expect(span).toBeTruthy();
      expect(span?.getAttribute('data-texure-latex')).toContain('hspace');
      expect(span?.getAttribute('style')).toBeNull();
    }
  });

  it('latexToHtml drops invalid CSS lengths for vspace placeholders', () => {
    // @ts-ignore
    delete window.katex;
    const html = latexToHtml('\\vspace{nope}');
    const tag = html.match(/<div[^>]*data-texure-latex="[^"]*vspace\{nope\}[^"]*"[^>]*>/i)?.[0];
    expect(tag).toBeTruthy();
    expect(tag).not.toMatch(/\sstyle\s*=/i);
  });

  it('latexToHtml drops empty CSS lengths for spacing placeholders', () => {
    // @ts-ignore
    delete window.katex;
    const html = latexToHtml('\\vspace{}');
    const tag = html.match(/<div[^>]*data-texure-latex="[^"]*vspace\{\}[^"]*"[^>]*>/i)?.[0];
    expect(tag).toBeTruthy();
    expect(tag).not.toMatch(/\sstyle\s*=/i);
  });

  it('latexToHtml handles empty includegraphics sources', () => {
    const html = latexToHtml('\\includegraphics{}');
    const t = document.createElement('template');
    t.innerHTML = html;
    const img = t.content.querySelector('img');
    expect(img?.getAttribute('src')).toBe('');
    expect(img?.getAttribute('data-texure-img-width')).toBe('1');
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
      '<p><span style="font-size:7px">s</span><span style="font-size:8px">f</span><span style="font-size:12pt">L</span><span style="font-size:14.4pt">H</span><span style="font-size:17px">M</span><span style="font-size:20.74pt">G</span><span style="font-size:24px">X</span></p>',
      '<div>plain</div>',
      '<a href="https://example.com">Link</a>',
      '<img src="/img.png" />',
      '<img src="blob:https://example.com/1234" data-texure-image-id="abc123" />',
      '<img data-texure-image-id="noSrc" />',
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
    expect(out).toContain('\\textcolor[HTML]{AABBCC}');
    expect(out).toContain('\\colorbox[HTML]{010203}');
    expect(out).toContain('\\textcolor[HTML]{A1B2C3}');
    expect(out).toContain('\\textcolor[HTML]{000000}');
    expect(out).not.toContain('var(--x)');
    expect(out).toContain('\\textsf{');
    // Precise font sizing uses \fontsize{..pt}{..pt}\selectfont (px converted to pt at 96dpi).
    expect(out).toContain('\\fontsize{7.5pt}{9pt}\\selectfont'); // 10px -> 7.5pt
    expect(out).toContain('\\fontsize{5pt}{6pt}\\selectfont'); // 5pt -> 5pt
    expect(out).toContain('\\fontsize{9pt}{10.8pt}\\selectfont'); // 9pt -> 9pt
    expect(out).toContain('\\fontsize{5.25pt}{6.3pt}\\selectfont'); // 7px -> 5.25pt
    expect(out).toContain('\\fontsize{6pt}{7.2pt}\\selectfont'); // 8px -> 6pt
    expect(out).toContain('\\fontsize{12pt}{14.4pt}\\selectfont'); // 12pt -> 12pt
    expect(out).toContain('\\fontsize{14.4pt}{17.28pt}\\selectfont'); // 14.4pt -> 14.4pt
    expect(out).toContain('\\fontsize{12.75pt}{15.3pt}\\selectfont'); // 17px -> 12.75pt
    expect(out).toContain('\\fontsize{20.74pt}{24.888pt}\\selectfont'); // 20.74pt baseline
    expect(out).toContain('\\fontsize{18pt}{21.6pt}\\selectfont'); // 24px -> 18pt
    expect(out).toContain('\\begin{center}');
    expect(out).toContain('\\begin{flushright}');
    expect(out).toContain('\\href{https://example.com}{Link}');
    expect(out).toContain('\\includegraphics[width=\\linewidth]{/img.png}');
    expect(out).toContain('\\includegraphics[width=\\linewidth]{texure-image:abc123}');
    expect(out).toContain('\\includegraphics[width=\\linewidth]{texure-image:noSrc}');
    expect(out).toContain('\\begin{itemize}');
    expect(out).toContain('\\item[$\\square$]');
    expect(out).toContain('\\begin{enumerate}');
    expect(out).toContain('\\begin{lstlisting}');
    expect(out).toContain('\\end{lstlisting}');
    expect(out).toContain('\\texttt{mono}');
    expect(out).toContain('$a+b$');
    expect(out).toContain('$x+y$');
    expect(out).toContain('\\[');
    expect(out).toContain('\\]');
  });

  it('htmlToLatex emits minted for code tags with attached language', () => {
    const html = [
      '<p>Inline <code data-texure-code-lang="python">print(1)</code></p>',
      '<p>Empty <code data-texure-code-lang="js"></code></p>',
      '<pre><code data-texure-code-lang="javascript">const x = 1;</code></pre>',
    ].join('');

    const out = htmlToLatex(html);
    expect(out).toContain('\\texttt{print(1)}');
    expect(out).not.toContain('\\texttt{}');
    expect(out).toContain('\\begin{lstlisting}[language=JavaScript]');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('\\end{lstlisting}');
  });

  it('htmlToLatex always emits \\texttt for inline code', () => {
    const html = '<p><code data-texure-code-lang="js">a|b</code></p>';
    const out = htmlToLatex(html);
    expect(out).toContain('\\texttt{a|b}');
  });

  it('htmlToLatex strips zero-width placeholders from text and code', () => {
    const html = `<p>\u200bX<code>\u200b</code>Y</p>`;
    const out = htmlToLatex(html);
    expect(out).toContain('X');
    expect(out).toContain('Y');
    expect(out).not.toContain('\u200b');
    expect(out).not.toContain('\ufeff');
  });

  it('htmlToLatex keeps inline code isolated from following text (spacer caret)', () => {
    const html = `<p>test <code class="texure-inline-code">test</code>\u200b test</p>`;
    const out = htmlToLatex(html);
    expect(out).toContain('test \\texttt{test} test');
    expect(out).not.toContain('\\texttt{test}test');
  });

  it('htmlToLatex preserves alternating inline code segments on the same line', () => {
    const html = `<p>foo <code class="texure-inline-code">bar</code>\u200b baz <code class="texure-inline-code">qux</code></p>`;
    const out = htmlToLatex(html);
    expect(out).toContain('foo \\texttt{bar} baz \\texttt{qux}');
  });

  it('htmlToLatex converts texure code block widgets to lstlisting', () => {
    const html = [
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="python" data-texure-code="print(1)%0Aprint(2)">',
      '  <select><option value="python" selected>python</option></select>',
      '  <textarea>ignored</textarea>',
      '</div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="text" data-texure-code="x">x</div>',
    ].join('');
    const out = htmlToLatex(html);
    expect(out).toContain('\\begin{lstlisting}[language=Python]');
    expect(out).toContain('print(1)');
    expect(out).toContain('print(2)');
    expect(out).toContain('\\end{lstlisting}');
    expect(out).toContain('\\begin{lstlisting}\n' + 'x' + '\n\\end{lstlisting}');
  });

  it('htmlToLatex maps common code block languages to listings names', () => {
    const html = [
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="typescript" data-texure-code="TS"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="cpp" data-texure-code="CPP"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="csharp" data-texure-code="CSHARP"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="sh" data-texure-code="BASH"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="json" data-texure-code="JSON"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="yaml" data-texure-code="YAML"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="html" data-texure-code="HTML"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="css" data-texure-code="CSS"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="tex" data-texure-code="TEX"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="java" data-texure-code="JAVA"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="go" data-texure-code="GO"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="rust" data-texure-code="RUST"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="c" data-texure-code="C"></div>',
      '<div class="texure-codeblock" contenteditable="false" data-texure-code-lang="unknown" data-texure-code="UNKNOWN"></div>',
    ].join('');
    const out = htmlToLatex(html);
    expect(out).toContain('\\begin{lstlisting}[language=JavaScript]');
    expect(out).toContain('\\begin{lstlisting}[language=C++]');
    expect(out).toContain('\\begin{lstlisting}[language=[Sharp]C]');
    expect(out).toContain('\\begin{lstlisting}[language=bash]');
    expect(out).toContain('\\begin{lstlisting}[language=JSON]');
    expect(out).toContain('\\begin{lstlisting}[language=yaml]');
    expect(out).toContain('\\begin{lstlisting}[language=HTML]');
    expect(out).toContain('\\begin{lstlisting}[language=CSS]');
    expect(out).toContain('\\begin{lstlisting}[language=TeX]');
    expect(out).toContain('\\begin{lstlisting}[language=Java]');
    expect(out).toContain('\\begin{lstlisting}[language=Go]');
    expect(out).toContain('\\begin{lstlisting}[language=Rust]');
    expect(out).toContain('\\begin{lstlisting}[language=C]');
    // unknown: no language option
    expect(out).toContain('\\begin{lstlisting}\nUNKNOWN\n\\end{lstlisting}');
  });

  it('htmlToLatex ignores transparent backgrounds', () => {
    const out = htmlToLatex('<p><span style="background-color: transparent">x</span><span style="background-color: rgba(1,2,3,0)">y</span><span style="background-color: blue">b</span><span style="background-color: color(display-p3 1 0 0)">p</span></p>');
    expect(out).toContain('x');
    expect(out).toContain('y');
    expect(out).toContain('b');
    expect(out).toContain('p');
    expect(out).toContain('\\colorbox{blue}{b}');
    expect(out).not.toContain('\\colorbox{transparent}');
    expect(out).not.toContain('\\colorbox[HTML]{010203}');
    expect(out).not.toContain('display-p3');
  });

  it('htmlToLatex falls back to \\texttt when no safe minted delimiter exists', () => {
    const all = '|!#~@;:+=-_,.?/';
    const html = `<p><code data-texure-code-lang="js">${all}</code></p>`;
    const out = htmlToLatex(html);
    expect(out).toContain('\\texttt{');
    expect(out).toContain('\\#');
    expect(out).toContain('\\_');
  });

  it('htmlToLatex emits a justify environment for justified blocks', () => {
    const out = htmlToLatex('<div style="text-align: justify">Hello</div>');
    expect(out).toContain('\\begin{justify}');
    expect(out).toContain('Hello');
    expect(out).toContain('\\end{justify}');
  });

  it('htmlToLatex converts indented paragraphs to leftskip blocks', () => {
    const out = htmlToLatex([
      '<p style="margin-left: 10px">Hello</p>',
      '<p style="margin-left: 1px">One</p>',
      '<p style="margin-left: 1.5rem">Rem</p>',
      '<p style="margin-left: 2cm">Cm</p>',
      '<p style="padding-left: 8px">Pad</p>',
      '<p style="text-indent: 6px">Indent</p>',
      '<p style="margin-left: 0px">Zero</p>',
      '<p style="margin-right: 1vh">Unsupported</p>',
    ].join(''));
    expect(out).toContain('\\leftskip=');
    expect(out).toContain('Hello');
    expect(out).toContain('\\par');
    expect(out).toContain('{\\leftskip=0.75pt\\relax');
    expect(out).toContain('One');
    expect(out).toContain('{\\leftskip=1.5em\\relax');
    expect(out).toContain('Rem');
    expect(out).toContain('{\\leftskip=2cm\\relax');
    expect(out).toContain('Cm');
    expect(out).toContain('{\\leftskip=6pt\\relax');
    expect(out).toContain('Pad');
    expect(out).toContain('{\\leftskip=4.5pt\\relax');
    expect(out).toContain('Indent');
    expect(out).toContain('Zero');
    expect(out).toContain('Unsupported');
  });

  it('htmlToLatex preserves image width and angle attributes in includegraphics options', () => {
    const html = [
      '<img src="/img.png" data-texure-img-width="1" data-texure-img-angle="0" />',
      '<img src="/img2.png" data-texure-img-width="0.5" data-texure-img-angle="90" />',
    ].join('');
    const out = htmlToLatex(html);
    expect(out).toContain('\\includegraphics[width=\\linewidth]{/img.png}');
    expect(out).toContain('\\includegraphics[width=0.5\\linewidth,angle=90]{/img2.png}');
  });

  it('latexToHtml emits texure image attrs when includegraphics specifies width/angle', () => {
    const latex = '\\begin{document}\n' +
      '\\includegraphics[width=0.5\\linewidth,angle=90]{texure-image:abc123}\n' +
      '\\end{document}';
    const html = latexToHtml(latex);
    expect(html).toContain('data-texure-image-id="abc123"');
    expect(html).toContain('data-texure-img-width="0.5"');
    expect(html).toContain('data-texure-img-angle="90"');
  });

  it('latexToHtml handles includegraphics edge cases for attrs and escaping', () => {
    const latex = [
      '\\includegraphics[width=\\linewidth]{texure-image:one}',
      '\\includegraphics[angle=90]{texure-image:abc}',
      '\\includegraphics[angle=abc]{texure-image:def}',
      '\\includegraphics[]{texure-image:empty}',
      '\\includegraphics[width=\\linewidth,angle=45]{/img.png}',
      '\\includegraphics[]{/img.png}',
      '\\includegraphics[width=\\linewidth,,angle=0]{/img.png}',
      '\\includegraphics[width=\\linewidth]{}',
      '\\includegraphics[width=50px,angle=abc]{/img\"q.png}',
      '\\includegraphics{/img\"plain.png}',
    ].join('\n');

    const html = latexToHtml(latex);
    const t = document.createElement('template');
    t.innerHTML = html;
    const imgs = Array.from(t.content.querySelectorAll('img'));

    const texOne = imgs.find((img) => img.getAttribute('data-texure-image-id') === 'one');
    expect(texOne?.getAttribute('data-texure-img-width')).toBe('1');

    const texAngle = imgs.find((img) => img.getAttribute('data-texure-image-id') === 'abc');
    expect(texAngle?.getAttribute('data-texure-img-angle')).toBe('90');
    expect(texAngle?.getAttribute('data-texure-img-width')).toBeNull();

    const texInvalidAngle = imgs.find((img) => img.getAttribute('data-texure-image-id') === 'def');
    expect(texInvalidAngle?.getAttribute('data-texure-img-angle')).toBeNull();
    expect(texInvalidAngle?.getAttribute('data-texure-img-width')).toBeNull();

    const texEmptyOpts = imgs.find((img) => img.getAttribute('data-texure-image-id') === 'empty');
    expect(texEmptyOpts?.getAttribute('data-texure-img-angle')).toBeNull();
    expect(texEmptyOpts?.getAttribute('data-texure-img-width')).toBeNull();

    const optImg = imgs.find((img) => img.getAttribute('src') === '/img"q.png');
    expect(optImg).toBeTruthy();
    expect(optImg?.getAttribute('data-texure-img-width')).toBeNull();
    expect(optImg?.getAttribute('data-texure-img-angle')).toBeNull();

    const angled = imgs.find((img) => img.getAttribute('src') === '/img.png' && img.getAttribute('data-texure-img-angle') === '45');
    expect(angled).toBeTruthy();
    expect(angled?.getAttribute('data-texure-img-width')).toBe('1');

    const emptyOpts = imgs.find((img) => img.getAttribute('src') === '/img.png' && !img.hasAttribute('data-texure-img-width') && !img.hasAttribute('data-texure-img-angle'));
    expect(emptyOpts).toBeTruthy();

    const doubleComma = imgs.find((img) => img.getAttribute('src') === '/img.png' && img.getAttribute('data-texure-img-angle') === '0');
    expect(doubleComma).toBeTruthy();
    expect(doubleComma?.getAttribute('data-texure-img-width')).toBe('1');

    const emptySrc = imgs.find((img) => img.getAttribute('src') === '');
    expect(emptySrc).toBeTruthy();
    expect(emptySrc?.getAttribute('data-texure-img-width')).toBe('1');

    const plainImg = imgs.find((img) => img.getAttribute('src') === '/img"plain.png');
    expect(plainImg).toBeTruthy();
    expect(plainImg?.getAttribute('data-texure-img-width')).toBe('1');
  });

  it('htmlToLatex roundtrips manual spacing placeholders', () => {
    const html = [
      '<p>A<span data-texure-latex="\\hspace{1em}" contenteditable="false">&nbsp;</span>B</p>',
      '<div data-texure-latex="\\vspace{12pt}" contenteditable="false"></div>',
      '<div data-texure-latex="\\newpage" contenteditable="false">\\newpage</div>',
    ].join('');
    const out = htmlToLatex(html);
    expect(out).toContain('\\hspace{1em}');
    expect(out).toContain('\\vspace{12pt}');
    expect(out).toContain('\\newpage');
    expect(out).not.toContain('\\\\hspace{1em}');
    expect(out).not.toContain('\\\\vspace{12pt}');
    expect(out).not.toContain('\\\\newpage');
  });

  it('htmlToLatex normalizes legacy double-escaped texure placeholders', () => {
    const html = [
      '<p>A<span data-texure-latex="\\\\hspace{1em}" contenteditable="false">&nbsp;</span>B</p>',
      '<div data-texure-latex="\\\\vspace{12pt}" contenteditable="false"></div>',
      '<div data-texure-latex="\\\\newpage" contenteditable="false">\\\\newpage</div>',
    ].join('');
    const out = htmlToLatex(html);
    expect(out).toContain('\\hspace{1em}');
    expect(out).toContain('\\vspace{12pt}');
    expect(out).toContain('\\newpage');
    expect(out).not.toContain('\\\\hspace{1em}');
    expect(out).not.toContain('\\\\vspace{12pt}');
    expect(out).not.toContain('\\\\newpage');
  });

  it('latexToHtml and htmlToLatex support blockquote/quote indentation', () => {
    const latex = String.raw`\\begin{document}
\\begin{quote}
Indented
\\end{quote}
\\end{document}`;
    const html = latexToHtml(latex);
    expect(html).toContain('<blockquote>');
    const back = htmlToLatex(html);
    expect(back).toContain('\\begin{quote}');
    expect(back).toContain('Indented');
    expect(back).toContain('\\end{quote}');
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
