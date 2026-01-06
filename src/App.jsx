import React, { useState, useEffect, useRef } from 'react';
import { DEFAULT_LATEX } from './constants/math';
import { ENABLE_VISUAL_TOPBAR, FEATURE_FLAGS } from './constants/flags';
import { 
  FileText, Code, Bold, Italic, Underline, List, ListOrdered, 
  Heading1, Heading2, Download, Type, NotebookPen,
  Undo, Redo, Palette, Highlighter, Link as LinkIcon, Image as ImageIcon,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Indent, Outdent, CheckSquare, Minus, Plus,
  ChevronDown, Sigma, Terminal, SquareTerminal, 
  Calculator, ArrowRight, X, Divide, ChevronRight,
  Superscript, Subscript, FunctionSquare
} from 'lucide-react';
import MathToolbar from './features/Math/MathToolbar';
import EditorToolbar from './features/Toolbar/EditorToolbar';
import {
  escapeLatex,
  unescapeLatex,
  fetchWithTimeout,
  readJSONSafe,
  latexToHtml,
  htmlToLatex,
  summarizeLatexLog,
  compileWithWasmLatex,
} from './lib/latex';
import { sanitizeEditorHtml, maybeSanitizeEditorHtml } from './lib/sanitize';

// --- ENV FLAGS ---
// Enable when the env var is the string 'true'.
const ENABLE_RTEX = import.meta.env.VITE_ENABLE_RTEX === 'true';
const USE_WASM_LATEX = import.meta.env.VITE_USE_WASM_LATEX === 'true';

export default function LiveLatexEditor() {
  const [latexCode, setLatexCode] = useState(DEFAULT_LATEX);
  const [htmlContent, setHtmlContent] = useState("");
  const [activeTab, setActiveTab] = useState('both'); 
  const visualEditorRef = useRef(null);
  const lastSource = useRef(null); 
  const [katexLoaded, setKatexLoaded] = useState(false);
  const [katexLoadError, setKatexLoadError] = useState('');
  const [isMathActive, setIsMathActive] = useState(false);
  const [activeMathInput, setActiveMathInput] = useState(null);
  const [visualZoom, setVisualZoom] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logText, setLogText] = useState('');
  const [compileStatus, setCompileStatus] = useState('idle'); // idle | checking | success | error
  const [compileSummary, setCompileSummary] = useState('');
  const lintTimer = useRef(null);
  const lintReqId = useRef(0);
  const katexLinkRef = useRef(null);
  const katexScriptRef = useRef(null);
  const katexLinkInserted = useRef(false);
  const katexScriptInserted = useRef(false);

  const focusMathInput = (el) => {
    if (!el) return;
    try {
      el.focus();
      const len = (el.value || '').length;
      if (typeof el.setSelectionRange === 'function') el.setSelectionRange(len, len);
      else if (typeof el.selectionStart === 'number') el.selectionStart = el.selectionEnd = len;
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && window.katex) {
      setKatexLoaded(true);
      return;
    }

    // Avoid duplicate injection (HMR / remount)
    katexLinkInserted.current = false;
    katexScriptInserted.current = false;

    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
    // Prefer CDN first for reliability (local path only when assets are shipped)
    const cssCandidates = [
      'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
      'https://unpkg.com/katex@0.16.9/dist/katex.min.css',
      `${base}katex/katex.min.css`,
    ];
    const jsCandidates = [
      'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js',
      'https://unpkg.com/katex@0.16.9/dist/katex.min.js',
      `${base}katex/katex.min.js`,
    ];

    const loadCssWithFallback = (linkEl, urls) => {
      return new Promise((resolve, reject) => {
        let idx = 0;
        const tryNext = () => {
          if (idx >= urls.length) {
            reject(new Error('All KaTeX CSS sources failed to load.'));
            return;
          }
          const url = urls[idx++];
          linkEl.href = url;
        };
        const onLoad = () => resolve();
        const onError = () => tryNext();
        linkEl.addEventListener('load', onLoad, { once: true });
        linkEl.addEventListener('error', onError);
        tryNext();
      });
    };

    const loadScriptWithFallback = (scriptEl, urls) => {
      return new Promise((resolve, reject) => {
        let idx = 0;
        const tryNext = () => {
          if (idx >= urls.length) {
            reject(new Error('All KaTeX JS sources failed to load.'));
            return;
          }
          const url = urls[idx++];
          scriptEl.src = url;
        };
        const onLoad = () => resolve();
        const onError = () => tryNext();
        scriptEl.addEventListener('load', onLoad, { once: true });
        scriptEl.addEventListener('error', onError);
        tryNext();
      });
    };

    const existingLink = document.querySelector('link[data-katex-loader="true"]');
    if (existingLink) {
      // @ts-ignore
      katexLinkRef.current = existingLink;
    } else {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset.katexLoader = 'true';
      katexLinkRef.current = link;
      document.head.appendChild(link);
      katexLinkInserted.current = true;
    }

    const existingScript = document.querySelector('script[data-katex-loader="true"]');
    if (existingScript) {
      // @ts-ignore
      katexScriptRef.current = existingScript;
      // If it already loaded, window.katex should exist by now; otherwise wait.
      const checkLoaded = () => {
        if (typeof window !== 'undefined' && window.katex) setKatexLoaded(true);
      };
      existingScript.addEventListener('load', checkLoaded, { once: true });
      checkLoaded();
    } else {
      const script = document.createElement("script");
      script.dataset.katexLoader = 'true';
      script.defer = true;
      katexScriptRef.current = script;
      document.head.appendChild(script);
      katexScriptInserted.current = true;
    }

    let canceled = false;
    (async () => {
      try {
        setKatexLoadError('');
        if (katexLinkRef.current) await loadCssWithFallback(katexLinkRef.current, cssCandidates);
        if (katexScriptRef.current) await loadScriptWithFallback(katexScriptRef.current, jsCandidates);
        if (!canceled) setKatexLoaded(typeof window !== 'undefined' && !!window.katex);
      } catch (e) {
        console.warn('Failed to load KaTeX', e);
        if (!canceled) {
          setKatexLoaded(false);
          setKatexLoadError('Math rendering unavailable (KaTeX failed to load).');
        }
      }
    })();

    return () => {
      canceled = true;
      // Remove only what we added (best-effort).
      try {
        if (katexScriptInserted.current) katexScriptRef.current?.remove?.();
      } catch { /* ignore */ }
      try {
        if (katexLinkInserted.current) katexLinkRef.current?.remove?.();
      } catch { /* ignore */ }
      katexScriptRef.current = null;
      katexLinkRef.current = null;
    };
  }, []);

  // Initial (and KaTeX-ready) render
  useEffect(() => {
    setHtmlContent(sanitizeEditorHtml(latexToHtml(latexCode)));
  }, [katexLoaded]);

  // Sync: LaTeX -> Visual
  useEffect(() => {
    if (activeTab === 'visual') return;
    if (lastSource.current === 'visual') {
        lastSource.current = null; 
        return;
    }
    const newHtml = sanitizeEditorHtml(latexToHtml(latexCode));
    if (visualEditorRef.current && visualEditorRef.current.innerHTML !== newHtml) {
        setHtmlContent(newHtml);
        if (activeTab !== 'visual') {
            visualEditorRef.current.innerHTML = newHtml;
        }
    }
  }, [latexCode, activeTab, katexLoaded]);

  // Sync: Visual -> LaTeX
  const handleVisualInput = () => {
    if (!visualEditorRef.current) return;
    lastSource.current = 'visual'; 
    const currentHtml = visualEditorRef.current.innerHTML;
    const isEditingMath = !!visualEditorRef.current.querySelector('.math-inline input, .math-block textarea');
    const maybeClean = maybeSanitizeEditorHtml(currentHtml);
    // Avoid clobbering dynamically-attached listeners (math input, confirm button, live preview)
    // by rewriting innerHTML while a math element is being edited.
    if (!isEditingMath && maybeClean !== currentHtml) {
      visualEditorRef.current.innerHTML = maybeClean;
    }
    const bodyContent = htmlToLatex(maybeClean);
    const preambleMatch = latexCode.match(/([\s\S]*?\\begin{document})/);
    const endMatch = latexCode.match(/(\\end{document}[\s\S]*)/);
    const preamble = preambleMatch ? preambleMatch[1] : "\\documentclass{article}\n\\begin{document}";
    const end = endMatch ? endMatch[1] : "\\end{document}";
    setLatexCode(`${preamble}\n\n${bodyContent}\n\n${end}`);
  };

  const handleVisualPaste = (e) => {
    try {
      const insertHtmlAtSelection = (html) => {
        const sel = window.getSelection?.();
        if (!sel || sel.rangeCount === 0) return false;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        const frag = tpl.content;
        const last = frag.lastChild;
        range.insertNode(frag);
        if (last) {
          range.setStartAfter(last);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        return true;
      };

      const insertTextAtSelection = (text) => {
        const sel = window.getSelection?.();
        if (!sel || sel.rangeCount === 0) return false;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      };

      const html = e.clipboardData?.getData('text/html');
      const text = e.clipboardData?.getData('text/plain');
      if (!html && !text) return;
      e.preventDefault();
      if (html) {
        const sanitized = sanitizeEditorHtml(html);
        if (!insertHtmlAtSelection(sanitized)) {
          document.execCommand('insertHTML', false, sanitized);
        }
      } else if (text) {
        if (!insertTextAtSelection(text)) {
          document.execCommand('insertText', false, text);
        }
      }
      handleVisualInput();
    } catch (err) {
      console.warn('Paste sanitize failed', err);
    }
  };

  const execCmd = (command, value = null) => {
    document.execCommand(command, false, value);
    if (visualEditorRef.current) visualEditorRef.current.focus();
    handleVisualInput();
  };

  // --- EDITOR HANDLERS ---
  
  useEffect(() => {
    const editor = visualEditorRef.current;
    if (!editor) return;

    const handleClick = (e) => {
      const mathEl = e.target.closest('.math-inline, .math-block');
      if (mathEl) {
        setIsMathActive(true);
        const existingInput = mathEl.querySelector('textarea, input');
        if (!existingInput) {
            editMathElement(mathEl);
        } else {
            setActiveMathInput(existingInput);
            focusMathInput(existingInput);
        }
      } else {
        setIsMathActive(false);
        setActiveMathInput(null);
      }
    };

    editor.addEventListener('click', handleClick);
    return () => editor.removeEventListener('click', handleClick);
  }, [katexLoaded]); 

	  const editMathElement = (el) => {
	        const isBlock = el.classList.contains('math-block');
	        const latex = decodeURIComponent(el.getAttribute('data-latex') || "");
	        
	        const input = document.createElement(isBlock ? 'textarea' : 'input');
	        input.value = latex;
	        input.placeholder = '(eq)';
	        input.className = isBlock 
	          ? "w-full p-2 border-2 border-blue-500 rounded bg-slate-50 font-mono text-sm shadow-inner" 
	          : "px-2 border-2 border-blue-500 rounded bg-slate-50 font-mono text-sm inline-block shadow-inner mx-1";
        
        if (isBlock) { input.style.minHeight = "40px"; } 
        else { 
          input.style.minWidth = "120px";
          input.style.width = Math.max(latex.length * 12, 160) + "px";
        }
    
        input.onclick = (e) => e.stopPropagation();
      // Live preview controls
      let preview = null;
      let destroyPreview = null;
      let updatePreview = null;
      const createPreview = () => {
        const div = document.createElement('div');
        div.style.position = 'fixed';
        div.style.zIndex = '9999';
        div.style.pointerEvents = 'none';
        div.style.background = 'white';
        div.style.border = '1px solid rgb(226 232 240)';
        div.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)';
        div.style.borderRadius = '8px';
        div.style.padding = isBlock ? '10px 12px' : '6px 8px';
        div.style.maxWidth = '80vw';

        const renderContent = () => {
          let html = '';
          try {
            if (window.katex) {
              const val = input.value || (isBlock ? '\\quad' : '\\,');
              html = window.katex.renderToString(val, { displayMode: isBlock, throwOnError: false });
            } else {
              const val = input.value || '';
              html = isBlock ? `\\[${val}\\]` : `$${val}$`;
            }
          } catch (err) {
            html = '<span style="color:#dc2626">Error</span>';
          }
          div.innerHTML = html;
        };

        const position = () => {
          const r = input.getBoundingClientRect();
          const gap = 8;
          const top = Math.max(8, r.top - (div.offsetHeight || 0) - gap);
          const left = Math.max(8, Math.min(window.innerWidth - 8 - (div.offsetWidth || 0), r.left));
          div.style.top = `${top}px`;
          div.style.left = `${left}px`;
        };

        updatePreview = () => { renderContent(); position(); };
        renderContent();
        document.body.appendChild(div);
        requestAnimationFrame(position);

        const onScroll = () => position();
        const onResize = () => position();
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);

        destroyPreview = () => {
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onResize);
          if (div && div.parentNode) div.parentNode.removeChild(div);
          preview = null;
          updatePreview = null;
        };

        preview = div;
      };

      input.oninput = () => {
        if (!isBlock) input.style.width = Math.max(input.value.length * 12, 160) + "px";
         handleVisualInput();
         if (updatePreview) updatePreview();
      };
        
        const commit = () => {
            const newLatex = input.value;
            let rendered = "";
            try {
                if (window.katex) {
                    rendered = window.katex.renderToString(newLatex, { displayMode: isBlock, throwOnError: false });
                } else {
                    rendered = isBlock ? `\\[${newLatex}\\]` : `$${newLatex}$`;
                }
            } catch(err) { rendered = `<span class="text-red-500">Err</span>`; }
            
            el.setAttribute('data-latex', encodeURIComponent(newLatex));
            el.innerHTML = rendered;
            handleVisualInput();
            setActiveMathInput(null);
        if (destroyPreview) destroyPreview();
        };
    
        input.onblur = commit;
        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                input.blur();
            }
        };
    
        el.innerHTML = '';
        el.appendChild(input);

	        // Optional confirm checkmark button next to input
	        const confirmBtn = document.createElement('button');
	        confirmBtn.type = 'button';
	        confirmBtn.title = 'Confirm equation';
	        confirmBtn.className = isBlock
	          ? 'mt-2 inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700'
	          : 'ml-1 inline-flex items-center justify-center w-6 h-6 text-xs rounded bg-blue-600 text-white hover:bg-blue-700';
	        confirmBtn.textContent = '✓';
	        confirmBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
	        confirmBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); commit(); };
	        el.appendChild(confirmBtn);

        // Create floating live preview hovering above
        createPreview();

	        focusMathInput(input);
	        setActiveMathInput(input);
	        if (updatePreview) updatePreview();
	  };

  const insertMathSymbol = (cmd) => {
    if (activeMathInput) {
        const start = activeMathInput.selectionStart;
        const end = activeMathInput.selectionEnd;
        const val = activeMathInput.value;
        const newVal = val.substring(0, start) + cmd + val.substring(end);
        
        activeMathInput.value = newVal;
        activeMathInput.focus();

        // SMART CURSOR POSITIONING
        // If the command contains {}, place cursor inside the first brace.
        // e.g. \frac{}{} -> place cursor between first {}
        const firstBraceIndex = cmd.indexOf("{}");
        if (firstBraceIndex !== -1) {
             // Position is start + offset + 1 (to be inside the brace)
             activeMathInput.selectionStart = activeMathInput.selectionEnd = start + firstBraceIndex + 1;
        } else {
             // Default: end of inserted string
             activeMathInput.selectionStart = activeMathInput.selectionEnd = start + cmd.length;
        }
        
        const event = new Event('input', { bubbles: true });
        activeMathInput.dispatchEvent(event);
    } else {
        insertMathElement(false, cmd);
    }
  };

  const insertMathElement = (isBlock, initialContent = '') => {
    const id = "math-temp-" + Date.now();
    const tag = isBlock ? 'div' : 'span';
    const cls = isBlock ? 'math-block not-prose my-4 text-center cursor-pointer hover:bg-blue-50 transition-colors rounded py-2' : 'math-inline not-prose px-1 cursor-pointer hover:bg-blue-50 transition-colors rounded';
    const content = initialContent || (isBlock ? '(eq)' : '(eq)');
    
    const html = `<${tag} id="${id}" class="${cls}" contenteditable="false" data-latex="${encodeURIComponent(initialContent)}">${content}</${tag}>${isBlock ? '<p><br></p>' : '&nbsp;'}`;
    execCmd("insertHTML", html);

    setTimeout(() => {
        const el = document.getElementById(id);
        if (el) {
            el.removeAttribute('id');
            el.click(); 
        }
    }, 10);
  };

  // Standard Inserts
  const insertLink = () => {
    const url = prompt("Enter link URL:", "https://");
    if (url) execCmd("createLink", url);
  };

  const insertImage = () => {
    const url = prompt("Enter image URL:", "https://placehold.co/600x400");
    if (url) execCmd("insertImage", url);
  };

  // Parse LaTeX log to a short human-friendly summary
  const summarizeLatexLog = (log) => {
    if (!log) return '';
    // Common LaTeX error lines start with '!'
    const lines = log.split(/\r?\n/);
    const bangIdx = lines.findIndex(l => l.trim().startsWith('!'));
    if (bangIdx !== -1) {
      const err = lines[bangIdx].replace(/^!\s*/, '');
      // Try to capture following context line(s)
      const ctx = lines[bangIdx + 1] || '';
      // Extract line number like 'l.23'
      const lnMatch = ctx.match(/l\.(\d+)/);
      const ln = lnMatch ? ` at line ${lnMatch[1]}` : '';
      return `${err}${ln}`.trim();
    }
    // Fallbacks
    const overfull = lines.find(l => l.includes('Overfull'));
    if (overfull) return overfull.trim();
    const underfull = lines.find(l => l.includes('Underfull'));
    if (underfull) return underfull.trim();
    const genericErr = lines.find(l => /error/i.test(l));
    if (genericErr) return genericErr.trim();
    return '';
  };

  // Compile LaTeX for diagnostics (background)
  const compileForDiagnostics = async (code, currentId) => {
    // Prefer WASM in-browser diagnostics if enabled
    if (USE_WASM_LATEX) {
      try {
        const blob = await compileWithWasmLatex(code);
        if (currentId !== lintReqId.current) return;
        if (blob && blob.size > 0) {
          setCompileStatus('success');
          setCompileSummary('Compiled successfully');
          setLogText('Compiled successfully (in-browser WASM).');
          return;
        }
        // If no blob, fall through to other methods
      } catch (e) {
        if (currentId !== lintReqId.current) return;
        setCompileStatus('error');
        setCompileSummary('Compilation failed');
        setLogText(`WASM compiler error. ${String(e?.message || e)}`);
        return;
      }
    }

    if (!ENABLE_RTEX) {
      setCompileStatus('idle');
      setCompileSummary('Diagnostics unavailable');
      setLogText('Compiler diagnostics are disabled or unavailable. Enable VITE_USE_WASM_LATEX or VITE_ENABLE_RTEX.');
      return;
    }
    try {
      const r = await fetchWithTimeout('/api/rtex/api/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, format: 'pdf' })
      }, 12000);
      const data = await readJSONSafe(r);
      if (currentId !== lintReqId.current) return; // stale response

      if (r.ok && data?.status === 'success') {
        setCompileStatus('success');
        setCompileSummary('Compiled successfully');
        setLogText('Compiled successfully. No errors reported by the compiler.');
      } else {
        setCompileStatus('error');
        const log = data?.log || data?.error || data?.message || (typeof data === 'string' ? data : '') || 'Compiler did not return details.';
        const summary = summarizeLatexLog(log) || 'Compilation failed';
        setCompileSummary(summary);
        setLogText(log || 'Unknown error.');
      }
    } catch (e) {
      if (currentId !== lintReqId.current) return;
      setCompileStatus('error');
      setCompileSummary('Failed to contact compiler');
      setLogText(`Failed to retrieve compiler log.\n\n${String(e)}`);
    }
  };

  // Debounced background diagnostics whenever LaTeX changes
  useEffect(() => {
    if (lintTimer.current) clearTimeout(lintTimer.current);
    lintTimer.current = setTimeout(() => {
      const id = ++lintReqId.current;
      setCompileStatus('checking');
      setCompileSummary('Checking…');
      compileForDiagnostics(latexCode, id);
    }, 900); // debounce ~0.9s

    return () => {
      if (lintTimer.current) clearTimeout(lintTimer.current);
    };
  }, [latexCode]);

  // Compile LaTeX remotely and show compiler diagnostics/log
  const showCompileLog = async () => {
    setLogOpen(true);
    // If we already have a log from background checking, don't recompile.
    if (!logText) {
      setLogLoading(true);
      const id = ++lintReqId.current;
      await compileForDiagnostics(latexCode, id);
      setLogLoading(false);
    }
  };

  // Export LaTeX to PDF via online compiler services
  const exportAsPDF = async () => {
    if (exporting) return;
    setExporting(true);

    // 1) Generate filename primarily from \title, fallback to 'document'
    const titleMatch = latexCode.match(/\\title\{([^}]*)\}/);
    let filename = ((titleMatch?.[1] || 'document').trim().replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60) || 'document') + '.pdf';

    const triggerDownload = (blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    };

    // ATTEMPT 0: In-browser WASM engine (optional, if enabled)
    if (USE_WASM_LATEX) {
      try {
        const blob = await compileWithWasmLatex(latexCode);
        if (blob && blob.size > 0) {
          triggerDownload(blob);
          setExporting(false);
          return;
        }
        // If no blob when WASM is required, stop here on Pages.
        alert('WASM LaTeX engine did not return a PDF. Ensure a browser LaTeX engine is configured.');
        setExporting(false);
        return;
      } catch (e) {
        console.warn('WASM LaTeX compile failed', e);
        // On static hosting (GitHub Pages), do not fall back to /api services that don’t exist.
        alert('Export failed: No in-browser LaTeX engine configured.');
        setExporting(false);
        return;
      }
    }

    // ATTEMPT 1: latexonline.cc via proxy
    let latexonlineErrorLog = null;
    try {
      const res = await fetchWithTimeout(`/api/latexonline/compile?text=${encodeURIComponent(latexCode)}`, { method: 'GET' }, 15000);
      if (res.ok && res.headers.get('content-type')?.includes('pdf')) {
        const blob = await res.blob();
        triggerDownload(blob);
        setExporting(false);
        return;
      }
      try {
        latexonlineErrorLog = await res.text();
      } catch (_) { /* ignore */ }
      console.warn('LatexOnline failed, switching to fallback...', latexonlineErrorLog ? latexonlineErrorLog.slice(0, 400) : '');
    } catch (e) {
      console.warn('LatexOnline network error', e);
    }

    // ATTEMPT 2: rtex.probably.rocks via proxy (only if enabled)
    try {
      if (ENABLE_RTEX) {
        const r = await fetchWithTimeout('/api/rtex/api/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: latexCode, format: 'pdf' })
        }, 20000);
        const data = await readJSONSafe(r);

        if (data?.status === 'success' && data?.result) {
          const byteChars = atob(data.result);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          triggerDownload(blob);
        } else {
          setCompileStatus('error');
          const log = data?.log || data?.error || data?.message || 'Unknown compilation error';
          setCompileSummary('Compilation failed');
          setLogText(log);
          setLogOpen(true);
          alert('Compilation failed. Check the logs for details.');
        }
      } else {
        // RTeX disabled: surface LatexOnline failure details instead of generic message
        setCompileStatus('error');
        setCompileSummary('Compilation failed');
        setLogText(latexonlineErrorLog || 'latexonline.cc failed and fallback compiler (RTeX) is disabled. Enable VITE_ENABLE_RTEX or configure in-browser WASM.');
        setLogOpen(true);
        alert('Export failed. Check the logs for details.');
        return;
      }
    } catch (e) {
      console.error(e);
      alert('Export failed: Could not reach compiler services.');
    } finally {
      setExporting(false);
    }
  };

  // Feature flag visibility for toolbar groups/buttons
  const ff = FEATURE_FLAGS || {};
  const showUndoRedo = (ff.showUndo || ff.showRedo) && ENABLE_VISUAL_TOPBAR;
  const showHeadings = (ff.showHeading1 || ff.showHeading2 || ff.showHeading3 || ff.showHeading4 || ff.showTitle) && ENABLE_VISUAL_TOPBAR;
  const showTextStyles = (ff.showBold || ff.showItalic || ff.showUnderline) && ENABLE_VISUAL_TOPBAR;
  const showAlignment = (ff.showAlignLeft || ff.showAlignCenter || ff.showAlignRight || ff.showAlignJustify) && ENABLE_VISUAL_TOPBAR;
  const showCodeMath = (ff.showInlineCode || ff.showCodeBlock || ff.showInlineMath || ff.showDisplayMath) && ENABLE_VISUAL_TOPBAR;
  const showLists = (ff.showUnorderedList || ff.showOrderedList) && ENABLE_VISUAL_TOPBAR;
  const showIndentation = (ff.showIndent || ff.showOutdent) && ENABLE_VISUAL_TOPBAR;
  const showLinksMedia = (ff.showLink || ff.showImage) && ENABLE_VISUAL_TOPBAR;

  return (
    <React.Fragment>
    <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-800">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-2 bg-white border-b border-slate-200 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-1.5 rounded-lg text-white">
            <NotebookPen size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Modern LaTex</h1>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          {['latex', 'both', 'visual'].map(mode => (
            <button 
              key={mode}
              onClick={() => setActiveTab(mode)}
              className={`px-3 py-1 text-xs uppercase font-bold tracking-wide rounded-md transition-all ${activeTab === mode ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {mode}
            </button>
          ))}
        </div>

        
        <div className="flex items-center gap-2">
          <button
            onClick={showCompileLog}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-md hover:bg-slate-200 transition-colors text-xs font-medium border border-slate-200"
            title={compileStatus === 'error' ? (compileSummary || 'Compiler error') : (compileStatus === 'checking' ? 'Checking…' : (compileSummary || 'Show LaTeX compiler log'))}
          >
            <span className={`w-2 h-2 rounded-full ${compileStatus === 'checking' ? 'bg-amber-400 animate-pulse' : compileStatus === 'error' ? 'bg-red-500' : compileStatus === 'success' ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
            <FileText size={14} /> Logs
          </button>

        <button
          onClick={exportAsPDF}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={exporting}
          title={exporting ? 'Compiling…' : 'Export LaTeX to PDF'}
        >
          <Download size={14} /> {exporting ? 'Compiling…' : 'Export PDF'}
        </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* LEFT: LaTeX */}
        {(activeTab === 'latex' || activeTab === 'both') && (
          <div className={`flex flex-col border-r border-slate-200 ${activeTab === 'both' ? 'w-1/2' : 'w-full'} bg-slate-900`}>
            <div className="flex items-center justify-between px-4 py-1.5 bg-slate-800 border-b border-slate-700 text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
              <span className="flex items-center gap-2"><Code size={12}/> Source</span>
            </div>
            <textarea
              className="flex-1 w-full h-full p-4 font-mono text-sm bg-slate-900 text-slate-300 resize-none focus:outline-none leading-relaxed"
              value={latexCode}
              onChange={(e) => {
                lastSource.current = 'latex'; // Mark source
                setLatexCode(e.target.value);
              }}
              spellCheck="false"
            />
          </div>
        )}

        {/* RIGHT: Visual */}
        {(activeTab === 'visual' || activeTab === 'both') && (
          <div className={`flex flex-col ${activeTab === 'both' ? 'w-1/2' : 'w-full'} bg-white`}>
            
            {/* Context Aware Toolbar */}
            {isMathActive ? (
              <MathToolbar
                onInsert={insertMathSymbol}
                katexLoaded={katexLoaded}
                zoom={visualZoom}
                onZoomChange={setVisualZoom}
              />
            ) : (
              <EditorToolbar
                ff={ff}
                enableVisualTopbar={ENABLE_VISUAL_TOPBAR}
                isMathActive={isMathActive}
                katexLoaded={katexLoaded}
                zoom={visualZoom}
                onZoomChange={setVisualZoom}
                actions={{ execCmd, insertLink, insertImage, insertMathElement }}
              />
            )}

            {/* Document Surface */}
            <div className="flex-1 overflow-y-auto bg-slate-100 p-8">
              <div className="flex justify-center">
                <div
                  className="
                    latex-page outline-none
                    prose prose-slate max-w-none
                    prose-h1:text-3xl prose-h1:font-bold prose-h1:mt-6 prose-h1:mb-4
                    prose-h2:text-2xl prose-h2:font-semibold prose-h2:mt-5 prose-h2:mb-3
                    prose-h3:text-xl prose-h3:font-medium prose-h3:mt-4 prose-h3:mb-2
                    prose-p:my-2 prose-ul:my-2 prose-ol:my-2
                    prose-a:text-blue-600 prose-a:underline
                    prose-img:rounded-md
                    prose-pre:bg-slate-100 prose-pre:text-slate-800 prose-pre:border prose-pre:border-slate-200
                    latex-render-visual-editor
                  "
                  contentEditable
                  ref={visualEditorRef}
                  onInput={handleVisualInput}
                  onPaste={handleVisualPaste}
                  style={{ outline: 'none', transform: `scale(${visualZoom})`, transformOrigin: 'top center' }}
                  dangerouslySetInnerHTML={{ __html: htmlContent }}
                />
              </div>
              {!katexLoaded && katexLoadError && (
                <div className="mt-3 max-w-[900px] mx-auto text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  {katexLoadError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    {logOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-[90vw] max-w-3xl max-h-[80vh] bg-white rounded-lg shadow-xl border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-700">LaTeX Compiler Log</div>
            <button
              className="p-1 rounded hover:bg-slate-100"
              onClick={() => setLogOpen(false)}
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="p-3 overflow-auto">
            {logLoading ? (
              <div className="text-xs text-slate-500">Fetching log…</div>
            ) : (
              <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words bg-slate-50 border border-slate-200 rounded p-3 text-slate-800">
{logText}
              </pre>
            )}
          </div>
          <div className="px-4 py-2 border-t border-slate-200 flex justify-end">
            <button
              className="px-3 py-1.5 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
              onClick={() => setLogOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )}
    </React.Fragment>
  );
}

export {
  escapeLatex,
  unescapeLatex,
  latexToHtml,
  htmlToLatex,
  readJSONSafe,
  summarizeLatexLog,
  fetchWithTimeout,
  compileWithWasmLatex,
};
