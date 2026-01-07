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
  Superscript, Subscript, FunctionSquare, FileUp, Save, ImagePlus, RotateCw
} from 'lucide-react';
import RibbonToolbar from './features/Toolbar/RibbonToolbar';
import {
  escapeLatex,
  unescapeLatex,
  fetchWithTimeout,
  readJSONSafe,
  latexToHtml,
  htmlToLatex,
  summarizeLatexLog,
  isWasmLatexEngineConfigured,
  compileWithWasmLatex,
} from './lib/latex';
import { sanitizeEditorHtml, maybeSanitizeEditorHtml } from './lib/sanitize';
import { putImageFile, getImageRecord } from './lib/idb';
import { inferRequiredPackages, ensureUsePackagesInPreamble } from './lib/preamble';
import { pickTexFile, readFileText, writeFileText, isOpenFilePickerSupported } from './lib/fsAccess';

// --- ENV FLAGS ---
// Enable when the env var is the string 'true'.
const ENABLE_RTEX = import.meta.env.VITE_ENABLE_RTEX === 'true';
const USE_WASM_LATEX = import.meta.env.VITE_USE_WASM_LATEX === 'true';

export default function LiveLatexEditor() {
  const [latexCode, setLatexCode] = useState(DEFAULT_LATEX);
  const [htmlContent, setHtmlContent] = useState("");
  const [activeTab, setActiveTab] = useState('both'); 
  const visualEditorRef = useRef(null);
  const visualScrollRef = useRef(null);
  const lastSource = useRef(null); 
  const texureImageUrlCache = useRef(new Map());
  const savedSelectionRef = useRef(null);
  const inlineCodeArmedRef = useRef(false);
  const [isInlineCodeActive, setIsInlineCodeActive] = useState(false);
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
  const [activeFileHandle, setActiveFileHandle] = useState(null);
  const [activeFilePath, setActiveFilePath] = useState('');
  const [saving, setSaving] = useState(false);
  const [imageImportOpen, setImageImportOpen] = useState(false);
  const [imageImportUrl, setImageImportUrl] = useState('');
  const [imageImportBusy, setImageImportBusy] = useState(false);
  const [codeInsertOpen, setCodeInsertOpen] = useState(false);
  const [codeInsertMode, setCodeInsertMode] = useState('inline'); // inline | block
  const [codeInsertLang, setCodeInsertLang] = useState('text');
  const [codeInsertText, setCodeInsertText] = useState('');
  const [spacingInsertOpen, setSpacingInsertOpen] = useState(false);
  const [spacingInsertMode, setSpacingInsertMode] = useState('hspace'); // hspace | vspace
  const [spacingInsertLen, setSpacingInsertLen] = useState('1em');
  const [selectedImageKey, setSelectedImageKey] = useState('');
  const selectedImageElRef = useRef(null);
  const pendingImageDragCleanupRef = useRef(null);
  const [imageOverlayTick, setImageOverlayTick] = useState(0);
  const [imageOverlayRect, setImageOverlayRect] = useState(null);
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
    return () => {
      try {
        for (const url of texureImageUrlCache.current.values()) {
          try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        }
        texureImageUrlCache.current.clear();
      } catch { /* ignore */ }
    };
  }, []);

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

  useEffect(() => {
    if (activeTab === 'latex') clearImageSelection();
  }, [activeTab]);

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
  const handleVisualInput = (e) => {
    if (!visualEditorRef.current) return;
    lastSource.current = 'visual'; 
    cleanupEmptyInlineCode();
    syncInlineCodeActive();

    const autoGrowCodeTextarea = (textarea) => {
      if (!textarea || !textarea.style) return;
      try {
        textarea.style.height = 'auto';
        textarea.style.overflowY = 'hidden';
        const min = 120;
        const next = Math.max(min, textarea.scrollHeight || min);
        textarea.style.height = `${next}px`;
      } catch { /* ignore */ }
    };

    const highlightCodeHtml = (lang, code) => {
      const rawLang = String(lang || '').trim().toLowerCase() || 'text';
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
      if (normalizedLang === 'html') patterns.push({ type: 'tag', re: /<\/?[A-Za-z][^>]*>/y });

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
      } else {
        patterns.push({ type: 'string', re: /"(?:\\.|[^"\\])*"/y });
        patterns.push({ type: 'string', re: /'(?:\\.|[^'\\])*'/y });
      }

      patterns.push({ type: 'number', re: /\b\d+(?:\.\d+)?\b/y });
      if (normalizedLang === 'bash') patterns.push({ type: 'variable', re: /\$[A-Za-z_][A-Za-z0-9_]*/y });
      if (normalizedLang === 'latex') patterns.push({ type: 'keyword', re: /\\[A-Za-z@]+/y });

      const kw = (normalizedLang === 'typescript' ? 'javascript' : normalizedLang) === 'javascript'
        ? [
            'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case',
            'break', 'continue', 'class', 'extends', 'new', 'try', 'catch', 'finally', 'throw', 'import',
            'from', 'export', 'default', 'async', 'await', 'typeof', 'instanceof', 'true', 'false', 'null',
            'undefined',
          ]
        : normalizedLang === 'python'
          ? [
              'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'class', 'import',
              'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'pass', 'True', 'False',
              'None', 'async', 'await',
            ]
          : normalizedLang === 'json'
            ? ['true', 'false', 'null']
            : normalizedLang === 'bash'
              ? ['if', 'then', 'fi', 'for', 'in', 'do', 'done', 'case', 'esac', 'while', 'until', 'function']
              : null;

      if (kw && kw.length) {
        patterns.push({
          type: 'keyword',
          re: new RegExp(`\\b(?:${kw.map((k) => k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')).join('|')})\\b`, 'y'),
        });
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

    const updateCodeBlockPreview = (codeBlock) => {
      if (!codeBlock) return;
      const lang = (codeBlock.getAttribute('data-texure-code-lang') || 'text').trim();
      const encoded = codeBlock.getAttribute('data-texure-code') || '';
      const textarea = codeBlock.querySelector('textarea');
      const code = encoded ? decodeURIComponent(encoded) : (textarea?.value || textarea?.textContent || '');
      const codeEl = codeBlock.querySelector('.texure-code-preview code');
      if (codeEl) codeEl.innerHTML = highlightCodeHtml(lang, code);
    };

    try {
      const target = e?.target;
      if (target && target.tagName) {
        const tag = target.tagName.toLowerCase();
        if ((tag === 'textarea' || tag === 'select') && target.closest) {
          const codeBlock = target.closest('.texure-codeblock');
          if (codeBlock) {
            if (tag === 'textarea') {
              autoGrowCodeTextarea(target);
              const text = String(target.value || '');
              codeBlock.setAttribute('data-texure-code', encodeURIComponent(text));
              updateCodeBlockPreview(codeBlock);
            } else if (tag === 'select') {
              codeBlock.setAttribute('data-texure-code-lang', String(target.value || 'text'));
              updateCodeBlockPreview(codeBlock);
            }
          }
        }
      }
    } catch { /* ignore */ }
    const currentHtml = visualEditorRef.current.innerHTML;
    const isEditingMath = !!visualEditorRef.current.querySelector('.math-inline input, .math-block textarea');
    const isEditingCode = !!visualEditorRef.current.querySelector('.texure-codeblock textarea');
    const maybeClean = maybeSanitizeEditorHtml(currentHtml);
    // Avoid clobbering dynamically-attached listeners (math input, confirm button, live preview)
    // by rewriting innerHTML while a math element is being edited.
    if (!isEditingMath && !isEditingCode && maybeClean !== currentHtml) {
      visualEditorRef.current.innerHTML = maybeClean;
    }
    const bodyContent = htmlToLatex(maybeClean);
    const preambleMatch = latexCode.match(/([\s\S]*?\\begin{document})/);
    const endMatch = latexCode.match(/(\\end{document}[\s\S]*)/);
    const preamble = preambleMatch ? preambleMatch[1] : "\\documentclass{article}\n\\begin{document}";
    const end = endMatch ? endMatch[1] : "\\end{document}";
    const requiredPkgs = inferRequiredPackages(bodyContent);
    const managedPreamble = ensureUsePackagesInPreamble(preamble, requiredPkgs);
    setLatexCode(`${managedPreamble}\n\n${bodyContent}\n\n${end}`);
  };

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

  const handleVisualScroll = (e) => {
    const target = e?.target;
    if (!target || !target.tagName) return;
    const tag = target.tagName.toLowerCase();
    if (tag !== 'textarea' || !target.closest) return;
    const codeBlock = target.closest('.texure-codeblock');
    if (!codeBlock) return;
    const pre = codeBlock.querySelector('.texure-code-preview');
    if (!pre) return;
    try {
      pre.scrollTop = target.scrollTop;
      pre.scrollLeft = target.scrollLeft;
    } catch { /* ignore */ }
  };

  const handleVisualKeyDown = (e) => {
    try {
      if (!e || !e.key) return;
      const target = e.target;

      // Notion-like shortcut: Cmd/Ctrl+E toggles inline code.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === 'e') {
        e.preventDefault();
        toggleInlineCodeMark();
        syncInlineCodeActive();
        return;
      }

      // If inline-code is armed and user types a printable key, create code on the fly.
      if (
        inlineCodeArmedRef.current &&
        e.key &&
        e.key.length === 1 &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        ensureVisualEditorSelection();
        const sel = window.getSelection?.();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const codeEl = document.createElement('code');
          codeEl.className = 'texure-inline-code';
          const textNode = document.createTextNode(e.key);
          codeEl.appendChild(textNode);
          range.insertNode(codeEl);

          const r = document.createRange();
          r.setStart(textNode, textNode.length);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          inlineCodeArmedRef.current = false;
          handleVisualInput();
          syncInlineCodeActive();
        }
        return;
      }

      // Inline code: behave like other marks (Enter exits; removing last char clears the mark).
      if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete') {
        // Don't interfere with real inputs/textareas (math editor, code block editor).
        if (target && target.tagName) {
          const tag = target.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        }

        if (e.key === 'Enter') inlineCodeArmedRef.current = false;

        const codeEl = getInlineCodeAtSelection();
        if (codeEl) {
          const caret = getCaretTextOffsetWithin(codeEl);
          const total = caret?.total ?? stripZeroWidth(codeEl.textContent || '').length;

          if ((e.key === 'Backspace' || e.key === 'Delete') && total === 0) {
            e.preventDefault();
            unwrapEmptyInlineCode(codeEl);
            handleVisualInput();
            syncInlineCodeActive();
            return;
          }

          // When at the end of inline code, Enter should exit the code mark.
          if (e.key === 'Enter' && caret && caret.before === caret.total) {
            e.preventDefault();
            try {
              const sel = window.getSelection?.();
              if (sel) {
                const r = document.createRange();
                r.setStartAfter(codeEl);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
              }
            } catch { /* ignore */ }
            execCmd('insertParagraph');
            syncInlineCodeActive();
            return;
          }
        }
      }

      if (e.key !== 'Tab') return;
      if (target && target.tagName && target.tagName.toLowerCase() === 'textarea' && target.closest) {
        const codeBlock = target.closest('.texure-codeblock');
        if (codeBlock) {
          e.preventDefault();
          const textarea = target;
          const value = String(textarea.value || '');
          const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : value.length;
          const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : value.length;

          if (e.shiftKey) {
            const before = value.slice(0, start);
            const lineStart = before.lastIndexOf('\n') + 1;
            const hasTab = value.slice(lineStart, lineStart + 1) === '\t';
            const hasSpaces = value.slice(lineStart, lineStart + 2) === '  ';
            if (hasTab || hasSpaces) {
              const removeLen = hasTab ? 1 : 2;
              textarea.value = value.slice(0, lineStart) + value.slice(lineStart + removeLen);
              const delta = start - lineStart >= removeLen ? removeLen : 0;
              textarea.selectionStart = Math.max(lineStart, start - delta);
              textarea.selectionEnd = Math.max(lineStart, end - delta);
            }
          } else {
            textarea.value = value.slice(0, start) + '\t' + value.slice(end);
            textarea.selectionStart = textarea.selectionEnd = start + 1;
          }

          codeBlock.setAttribute('data-texure-code', encodeURIComponent(String(textarea.value || '')));
          try {
            const pre = codeBlock.querySelector('.texure-code-preview');
            if (pre) {
              pre.scrollTop = textarea.scrollTop;
              pre.scrollLeft = textarea.scrollLeft;
            }
          } catch { /* ignore */ }
          handleVisualInput({ target: textarea });
          return;
        }
      }

      // If focus is inside an actual input/textarea (math editor), let Tab behave normally.
      if (target && target.tagName) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      }

      e.preventDefault();
      applyVisualIndentDelta(e.shiftKey ? -24 : 24);
    } catch { /* ignore */ }
  };

  const applyVisualIndentDelta = (deltaPx) => {
    try {
      const root = visualEditorRef.current;
      if (!root) return false;
      const sel = window.getSelection?.();
      if (!sel || !sel.anchorNode) return false;
      let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      if (!el || !el.closest) return false;

      const block = el.closest('p, div, li, h1, h2, h3, h4, blockquote');
      if (!block || !root.contains(block)) return false;
      // Never indent the editor root itself; that shifts the entire page.
      if (block === root) return false;
      if (block.closest('.texure-codeblock') || block.closest('.math-inline') || block.closest('.math-block')) return false;

      const stepPx = 24;
      const cur = parseFloat(block.style.marginLeft || '0') || 0;
      const next = Math.max(0, Math.min(720, cur + (Number(deltaPx) || 0)));
      if (next > 0.1) block.style.marginLeft = `${next}px`;
      else block.style.removeProperty('margin-left');
      handleVisualInput();
      return true;
    } catch {
      return false;
    }
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

  const stripZeroWidth = (text) => String(text || '').replace(/[\u200B\uFEFF]/g, '');

  const isSelectionInsideVisualEditor = () => {
    const root = visualEditorRef.current;
    const sel = window.getSelection?.();
    if (!root || !sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const node = container?.nodeType === 1 ? container : container?.parentNode;
    return !!node && root.contains(node);
  };

  const getInlineCodeAtSelection = () => {
    try {
      const sel = window.getSelection?.();
      const node = sel?.anchorNode;
      if (!node) return null;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const codeEl = el?.closest?.('code.texure-inline-code');
      if (!codeEl) return null;
      if (codeEl.closest('pre') || codeEl.closest('.texure-codeblock')) return null;
      return codeEl;
    } catch {
      return null;
    }
  };

  const getCaretTextOffsetWithin = (containerEl) => {
    try {
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return null;
      const r = range.cloneRange();
      r.setStart(containerEl, 0);
      const before = stripZeroWidth(r.toString());
      const total = stripZeroWidth(containerEl.textContent || '');
      return { before: before.length, total: total.length };
    } catch {
      return null;
    }
  };

  const unwrapEmptyInlineCode = (codeEl) => {
    try {
      if (!codeEl) return false;
      const txt = stripZeroWidth(codeEl.textContent || '');
      if (txt.length !== 0) return false;
      const placeholder = document.createTextNode('\u200b');
      codeEl.replaceWith(placeholder);
      try {
        const sel = window.getSelection?.();
        if (sel) {
          const r = document.createRange();
          r.setStart(placeholder, 1);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      } catch { /* ignore */ }
      return true;
    } catch {
      return false;
    }
  };

  const cleanupEmptyInlineCode = () => {
    try {
      const root = visualEditorRef.current;
      if (!root) return;
      const active = getInlineCodeAtSelection();
      const codes = Array.from(root.querySelectorAll('code.texure-inline-code'));
      for (const codeEl of codes) {
        if (codeEl.closest('pre') || codeEl.closest('.texure-codeblock')) continue;
        const txt = stripZeroWidth(codeEl.textContent || '');
        if (txt.length !== 0) continue;
        if (active === codeEl) unwrapEmptyInlineCode(codeEl);
        else codeEl.remove();
      }
    } catch { /* ignore */ }
  };

  const isCaretAfterInlineCode = () => {
    try {
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return false;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return false;
      const { startContainer, startOffset } = range;
      const isInlineCodeEl = (n) => !!(n && n.nodeType === 1 && n.matches && n.matches('code.texure-inline-code'));
      if (startContainer.nodeType === 3) {
        const content = stripZeroWidth(startContainer.textContent || '');
        // If we're in a spacer node (only zero-width chars), don't block toggling.
        if (!content) return false;
        // If caret is inside a text node, consider the previous sibling.
        const prev = startContainer.previousSibling || startContainer.parentNode?.childNodes?.[Array.from(startContainer.parentNode.childNodes).indexOf(startContainer) - 1];
        if (isInlineCodeEl(prev)) return true;
        if (startOffset !== 0) return false;
      }
      if (startContainer.nodeType === 1) {
        const idx = Math.max(0, startOffset - 1);
        const prev = startContainer.childNodes[idx];
        if (isInlineCodeEl(prev)) return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const syncInlineCodeActive = () => {
    try {
      const active = !!getInlineCodeAtSelection() || !!inlineCodeArmedRef.current;
      setIsInlineCodeActive(active);
    } catch { /* ignore */ }
  };

  const ensureVisualEditorSelection = () => {
    const root = visualEditorRef.current;
    if (!root) return false;
    if (isSelectionInsideVisualEditor()) return true;
    try {
      root.focus();
      const r = document.createRange();
      r.selectNodeContents(root);
      r.collapse(false);
      const sel = window.getSelection?.();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    } catch {
      return false;
    }
  };

  const saveEditorSelection = () => {
    try {
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return;
      if (!isSelectionInsideVisualEditor()) return;
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
    } catch { /* ignore */ }
  };

  const restoreEditorSelection = () => {
    try {
      if (visualEditorRef.current) visualEditorRef.current.focus();
      const range = savedSelectionRef.current;
      const sel = window.getSelection?.();
      if (!sel) return;
      if (range) {
        const root = visualEditorRef.current;
        const container = range.commonAncestorContainer;
        const node = container?.nodeType === 1 ? container : container?.parentNode;
        if (!root || (node && root.contains(node))) {
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
      }
      ensureVisualEditorSelection();
    } catch { /* ignore */ }
  };

  const escapeHtml = (text) => {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const toggleInlineCodeMark = () => {
    try {
      ensureVisualEditorSelection();
      const sel = window.getSelection?.();
      if (!sel) return;

      const selectedText = stripZeroWidth(sel.toString?.() || '');
      const codeEl = getInlineCodeAtSelection();
      const adjacentInlineCode = !selectedText && !codeEl && isCaretAfterInlineCode();

      if (codeEl && selectedText) {
        const caret = getCaretTextOffsetWithin(codeEl);
        const text = codeEl.textContent || '';
        const tn = document.createTextNode(text);
        codeEl.replaceWith(tn);
        try {
          const r = document.createRange();
          const offset = Math.max(0, Math.min(tn.length, caret?.before ?? tn.length));
          r.setStart(tn, offset);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        } catch { /* ignore */ }
        inlineCodeArmedRef.current = false;
        handleVisualInput();
        syncInlineCodeActive();
        return;
      }

      if (selectedText) {
        inlineCodeArmedRef.current = false;
        execCmd('insertHTML', `<code class="texure-inline-code">${escapeHtml(selectedText)}</code>`);
        syncInlineCodeActive();
        return;
      }

      if (codeEl) {
        // If caret is inside existing inline code, exit the mark without stripping previous formatting.
        try {
          const spacer = document.createTextNode('\u200b');
          codeEl.parentNode?.insertBefore(spacer, codeEl.nextSibling);
          const r = document.createRange();
          r.setStart(spacer, 1);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        } catch { /* ignore */ }
        inlineCodeArmedRef.current = false;
        syncInlineCodeActive();
        return;
      }

      inlineCodeArmedRef.current = !inlineCodeArmedRef.current;
      syncInlineCodeActive();
    } catch { /* ignore */ }
  };

  const handleVisualBeforeInput = (e) => {
    try {
      if (!inlineCodeArmedRef.current) return;

      const target = e?.target;
      if (target && target.tagName) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      }

      // If we're already inside inline code, let the browser handle typing normally.
      if (getInlineCodeAtSelection()) return;

      if (!isSelectionInsideVisualEditor()) return;
      if (!ensureVisualEditorSelection()) return;

      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return;

      if (e.inputType === 'insertFromPaste') {
        const text = e.dataTransfer?.getData?.('text/plain');
        const plain = typeof text === 'string' ? text.replace(/\r?\n/g, ' ') : '';
        if (!plain) return;
        e.preventDefault();
        range.deleteContents();
        const codeEl = document.createElement('code');
        codeEl.className = 'texure-inline-code';
        const textNode = document.createTextNode(plain);
        codeEl.appendChild(textNode);
        range.insertNode(codeEl);
        const r = document.createRange();
        r.setStart(textNode, textNode.length);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        handleVisualInput();
        syncInlineCodeActive();
        return;
      }

      if (e.inputType !== 'insertText' && e.inputType !== 'insertCompositionText') return;
      const data = typeof e.data === 'string' ? e.data : '';
      if (!data) return;
      if (data === '\n') return;

      e.preventDefault();
      range.deleteContents();
      const codeEl = document.createElement('code');
      codeEl.className = 'texure-inline-code';
      const textNode = document.createTextNode(data);
      codeEl.appendChild(textNode);
      range.insertNode(codeEl);

      const r = document.createRange();
      r.setStart(textNode, textNode.length);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      handleVisualInput();
      syncInlineCodeActive();
    } catch { /* ignore */ }
  };

  const toSafeCssLength = (raw) => {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (/^-?(?:\d+|\d*\.\d+)(?:em|ex|pt|px|rem|%|cm|mm|in)$/i.test(s)) return s;
    return null;
  };

  const handleVisualPaste = (e) => {
    try {
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
    if (command === 'indent') {
      applyVisualIndentDelta(24);
      if (visualEditorRef.current) visualEditorRef.current.focus();
      return;
    }
    if (command === 'outdent') {
      applyVisualIndentDelta(-24);
      if (visualEditorRef.current) visualEditorRef.current.focus();
      return;
    }
    document.execCommand(command, false, value);
    if (visualEditorRef.current) visualEditorRef.current.focus();
    handleVisualInput();
  };

  const resolveTexureImages = async () => {
    const root = visualEditorRef.current;
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll('img[data-texure-image-id]'));
    if (!imgs.length) return;

    for (const img of imgs) {
      const id = img.getAttribute('data-texure-image-id');
      if (!id) continue;
      let url = texureImageUrlCache.current.get(id);
      if (!url) {
        try {
          const rec = await getImageRecord(id);
          const blob = rec?.blob;
          if (!blob) continue;
          url = URL.createObjectURL(blob);
          texureImageUrlCache.current.set(id, url);
        } catch {
          continue;
        }
      }
      if (img.getAttribute('src') !== url) img.setAttribute('src', url);
      try { img.draggable = false; } catch { /* ignore */ }
    }
  };

  const applyImageTransformToDom = (img) => {
    if (!img) return;
    const widthFracRaw = img.getAttribute('data-texure-img-width');
    const angleRaw = img.getAttribute('data-texure-img-angle');
    const xRaw = img.getAttribute('data-texure-img-x');
    const yRaw = img.getAttribute('data-texure-img-y');

    const widthFrac = widthFracRaw != null ? Number(widthFracRaw) : NaN;
    const angleDeg = angleRaw != null ? Number(angleRaw) : NaN;
    const x = xRaw != null ? Number(xRaw) : NaN;
    const y = yRaw != null ? Number(yRaw) : NaN;

    // Defaults
    if (!Number.isFinite(widthFrac) || widthFrac <= 0) img.setAttribute('data-texure-img-width', '1');
    if (!Number.isFinite(angleDeg)) img.setAttribute('data-texure-img-angle', '0');
    if (!Number.isFinite(x)) img.setAttribute('data-texure-img-x', '0');
    if (!Number.isFinite(y)) img.setAttribute('data-texure-img-y', '0');

    const widthFrac2 = Number(img.getAttribute('data-texure-img-width') || '1');
    const angleDeg2 = Number(img.getAttribute('data-texure-img-angle') || '0');
    const x2 = Number(img.getAttribute('data-texure-img-x') || '0');
    const y2 = Number(img.getAttribute('data-texure-img-y') || '0');

    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.width = `${Math.max(0.05, Math.min(2, widthFrac2)) * 100}%`;
    img.style.transformOrigin = 'center center';
    const parts = [];
    if (x2 || y2) parts.push(`translate(${x2}px, ${y2}px)`);
    if (angleDeg2) parts.push(`rotate(${angleDeg2}deg)`);
    img.style.transform = parts.join(' ');
  };

  const clearImageSelection = () => {
    selectedImageElRef.current = null;
    setSelectedImageKey('');
    setImageOverlayRect(null);
    setImageOverlayTick((t) => t + 1);
  };

  const imageKeyForEl = (img) => {
    if (!img) return '';
    const id = img.getAttribute?.('data-texure-image-id');
    if (id) return `id:${id}`;
    const src = img.getAttribute?.('src') || '';
    return src ? `src:${src}` : '';
  };

  const selectImage = (img) => {
    if (!img) return;
    selectedImageElRef.current = img;
    setSelectedImageKey(imageKeyForEl(img));
    applyImageTransformToDom(img);
    setImageOverlayTick((t) => t + 1);
  };

  const updateImageOverlay = () => {
    const img = selectedImageElRef.current;
    if (!img || !document.contains(img)) {
      if (selectedImageElRef.current) clearImageSelection();
      return;
    }
    const rect = img.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      setImageOverlayRect(null);
      return;
    }
    setImageOverlayRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  };

  useEffect(() => {
    updateImageOverlay();
    const onUpdate = () => updateImageOverlay();
    window.addEventListener('resize', onUpdate);
    const scrollEl = visualScrollRef.current;
    if (scrollEl) scrollEl.addEventListener('scroll', onUpdate, { passive: true });
    return () => {
      window.removeEventListener('resize', onUpdate);
      if (scrollEl) scrollEl.removeEventListener('scroll', onUpdate);
    };
  }, [imageOverlayTick, activeTab, visualZoom, katexLoaded]);

  useEffect(() => {
    const root = visualEditorRef.current;
    if (!root) return;
    const textareas = Array.from(root.querySelectorAll('.texure-codeblock textarea'));
    for (const ta of textareas) {
      try {
        ta.style.height = 'auto';
        ta.style.overflowY = 'hidden';
        ta.style.height = `${Math.max(120, ta.scrollHeight || 120)}px`;
      } catch { /* ignore */ }
    }
  }, [htmlContent, activeTab]);

  const imageTransformRef = useRef(null);

  const startImageTransform = (mode, e, { resizeDir = 'se' } = {}) => {
    const img = selectedImageElRef.current;
    if (!img) return;
    e?.preventDefault?.();
    e?.stopPropagation?.();

    applyImageTransformToDom(img);
    const rect = img.getBoundingClientRect();
    const page = img.closest?.('.latex-page');
    const pageRect = page?.getBoundingClientRect?.() || rect;

    const startWidthFrac = Number(img.getAttribute('data-texure-img-width') || '1') || 1;
    const startAngle = Number(img.getAttribute('data-texure-img-angle') || '0') || 0;
    const startX = Number(img.getAttribute('data-texure-img-x') || '0') || 0;
    const startY = Number(img.getAttribute('data-texure-img-y') || '0') || 0;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const startPointerAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

    imageTransformRef.current = {
      mode,
      resizeDir,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRectW: rect.width,
      pageW: pageRect.width || rect.width || 1,
      startWidthFrac,
      startAngle,
      startX,
      startY,
      centerX,
      centerY,
      startPointerAngle,
      didChange: false,
    };

    const onMove = (ev) => {
      const st = imageTransformRef.current;
      const img2 = selectedImageElRef.current;
      if (!st || !img2) return;
      ev.preventDefault();

      const dx = ev.clientX - st.startClientX;
      const dy = ev.clientY - st.startClientY;

      if (st.mode === 'move') {
        const nx = Math.round(st.startX + dx);
        const ny = Math.round(st.startY + dy);
        if (nx !== st.startX || ny !== st.startY) st.didChange = true;
        img2.setAttribute('data-texure-img-x', String(nx));
        img2.setAttribute('data-texure-img-y', String(ny));
        applyImageTransformToDom(img2);
        updateImageOverlay();
        return;
      }

      if (st.mode === 'resize') {
        const dir = st.resizeDir;
        const sign = dir.includes('w') ? -1 : 1;
        const newW = Math.max(40, st.startRectW + sign * dx);
        const newFrac = Math.max(0.05, Math.min(2, newW / (st.pageW || 1)));
        if (Math.abs(newFrac - st.startWidthFrac) > 1e-6) st.didChange = true;
        img2.setAttribute('data-texure-img-width', String(Math.round(newFrac * 1000) / 1000));
        applyImageTransformToDom(img2);
        updateImageOverlay();
        return;
      }

      if (st.mode === 'rotate') {
        const cur = Math.atan2(ev.clientY - st.centerY, ev.clientX - st.centerX);
        const delta = (cur - st.startPointerAngle) * (180 / Math.PI);
        const ang = Math.round((st.startAngle + delta) * 10) / 10;
        if (Math.abs(ang - st.startAngle) > 1e-6) st.didChange = true;
        img2.setAttribute('data-texure-img-angle', String(ang));
        applyImageTransformToDom(img2);
        updateImageOverlay();
      }
    };

    const onUp = (ev) => {
      try { ev?.preventDefault?.(); } catch { /* ignore */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const didChange = !!imageTransformRef.current?.didChange;
      imageTransformRef.current = null;
      if (didChange) handleVisualInput();
      updateImageOverlay();
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
  };

  useEffect(() => {
    resolveTexureImages();
    const root = visualEditorRef.current;
    if (!root) return;
    for (const img of Array.from(root.querySelectorAll('img'))) {
      applyImageTransformToDom(img);
    }
  }, [htmlContent, activeTab, katexLoaded]);

  useEffect(() => {
    if (!selectedImageKey) return;
    const root = visualEditorRef.current;
    if (!root) return;
    const cur = selectedImageElRef.current;
    if (cur && document.contains(cur)) {
      updateImageOverlay();
      return;
    }
    const [kind, rest] = selectedImageKey.split(':');
    let found = null;
    if (kind === 'id') {
      found = root.querySelector(`img[data-texure-image-id="${(rest || '').replace(/"/g, '\\"')}"]`);
    } else if (kind === 'src') {
      const want = rest || '';
      found = Array.from(root.querySelectorAll('img')).find((img) => (img.getAttribute('src') || '') === want) || null;
    }
    if (found) {
      selectedImageElRef.current = found;
      applyImageTransformToDom(found);
      setImageOverlayTick((t) => t + 1);
      updateImageOverlay();
    }
  }, [htmlContent, selectedImageKey]);

  const insertTexureImagesFromFiles = async (files) => {
    const imageFiles = Array.from(files || []).filter((f) => f && String(f.type || '').startsWith('image/'));
    if (!imageFiles.length) return;

    for (const file of imageFiles) {
      const { id } = await putImageFile(file);
      const url = URL.createObjectURL(file);
      texureImageUrlCache.current.set(id, url);
      const alt = String(file.name || '').replace(/"/g, '&quot;');
      const html = `<img src="${url}" data-texure-image-id="${id}" data-texure-img-width="1" data-texure-img-angle="0" data-texure-img-x="0" data-texure-img-y="0" alt="${alt}" style="max-width:100%" />`;
      if (!insertHtmlAtSelection(`${html}<p><br></p>`)) {
        document.execCommand('insertHTML', false, `${html}<p><br></p>`);
      }
    }
    handleVisualInput();
    resolveTexureImages();
  };

  const handleVisualDragOver = (e) => {
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes('Files')) e.preventDefault();
  };

  const handleVisualDrop = async (e) => {
    try {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const hasImages = Array.from(files).some((f) => String(f.type || '').startsWith('image/'));
      if (!hasImages) return;
      e.preventDefault();
      await insertTexureImagesFromFiles(files);
    } catch (err) {
      console.warn('Drop handling failed', err);
    }
  };

  // --- EDITOR HANDLERS ---
  
  useEffect(() => {
    const editor = visualEditorRef.current;
    if (!editor) return;

    const handleClick = (e) => {
      const mathEl = e.target.closest('.math-inline, .math-block');
      if (mathEl) {
        clearImageSelection();
        setIsMathActive(true);
        const existingInput = mathEl.querySelector('textarea, input');
        if (!existingInput) {
            editMathElement(mathEl);
        } else {
            setActiveMathInput(existingInput);
            focusMathInput(existingInput);
        }
      } else {
        const imgEl = e.target.closest('img');
        if (imgEl && editor.contains(imgEl)) {
          setIsMathActive(false);
          setActiveMathInput(null);
          selectImage(imgEl);
          updateImageOverlay();
          return;
        }
        clearImageSelection();
        setIsMathActive(false);
        setActiveMathInput(null);
      }
    };

    const handlePointerDown = (e) => {
      const mathEl = e.target.closest('.math-inline, .math-block');
      if (mathEl) return;
      const imgEl = e.target.closest('img');
      if (!imgEl || !editor.contains(imgEl)) return;
      selectImage(imgEl);
      updateImageOverlay();

      // Only begin dragging if the pointer actually moves (so a click doesn't "commit" and lose selection).
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const pointerId = e.pointerId;
      // Cancel any previous pending drag listener.
      pendingImageDragCleanupRef.current?.();
      const pending = { startClientX, startClientY, pointerId, startEvent: e };

      const onMove = (ev) => {
        if (ev.pointerId !== pending.pointerId) return;
        const dx = ev.clientX - pending.startClientX;
        const dy = ev.clientY - pending.startClientY;
        if (Math.hypot(dx, dy) < 3) return;
        const startEvent = pending.startEvent;
        cleanup();
        startImageTransform('move', startEvent);
      };

      const onUp = (ev) => {
        if (ev.pointerId !== pending.pointerId) return;
        cleanup();
        updateImageOverlay();
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (pendingImageDragCleanupRef.current === cleanup) pendingImageDragCleanupRef.current = null;
      };
      pendingImageDragCleanupRef.current = cleanup;

      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp, { passive: false });
    };

    editor.addEventListener('click', handleClick);
    editor.addEventListener('pointerdown', handlePointerDown);
    return () => {
      pendingImageDragCleanupRef.current?.();
      editor.removeEventListener('click', handleClick);
      editor.removeEventListener('pointerdown', handlePointerDown);
    };
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
  const openCodeInsert = (mode) => {
    saveEditorSelection();
    const selected = window.getSelection?.()?.toString?.() || '';
    if (mode === 'block') {
      restoreEditorSelection();
      const id = "code-temp-" + Date.now();
      const safeLang = escapeHtml('text');
      const code = String(selected || '');
      const encoded = encodeURIComponent(code);
      const langs = [
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
      const options = langs.map((l) => `<option value="${escapeHtml(l)}"${l === 'text' ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
      const block = [
        `<div id="${id}" class="texure-codeblock not-prose my-4 border border-slate-200 rounded-lg overflow-hidden bg-slate-50" contenteditable="false" data-texure-code-lang="${safeLang}" data-texure-code="${encoded}">`,
        `  <div class="flex items-center gap-2 px-2 py-1 bg-white border-b border-slate-200">`,
        `    <select class="texure-code-lang text-xs font-medium text-slate-700 px-2 py-1 rounded border border-slate-200 bg-white">`,
        `      ${options}`,
        `    </select>`,
        `    <span class="text-[11px] text-slate-500">Code</span>`,
        `  </div>`,
        `  <div class="relative">`,
        `    <pre class="texure-code-preview absolute inset-0 m-0 p-3 overflow-auto font-mono text-sm leading-5 whitespace-pre text-slate-800 pointer-events-none select-none" aria-hidden="true"><code class="whitespace-pre">${escapeHtml(code)}</code></pre>`,
        `    <textarea class="texure-code-input relative z-10 w-full min-h-[120px] p-3 font-mono text-sm leading-5 bg-transparent text-transparent caret-slate-800 focus:outline-none resize-none overflow-auto" spellcheck="false">${escapeHtml(code)}</textarea>`,
        `  </div>`,
        `</div><p><br></p>`,
      ].join('\n');

      execCmd('insertHTML', block);
      setTimeout(() => {
        const el = document.getElementById(id);
        if (!el) return;
        el.removeAttribute('id');
        const textarea = el.querySelector('textarea');
        if (textarea) {
          textarea.focus();
          textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        }
        handleVisualInput({ target: textarea || el });
      }, 10);
      return;
    }

    // Inline code (Cmd/Ctrl+E): behaves like a mark (no empty placeholder).
    if (mode === 'inline') {
      restoreEditorSelection();
      toggleInlineCodeMark();
      return;
    }

    setCodeInsertMode(mode);
    setCodeInsertText(selected);
    setCodeInsertLang('text');
    setCodeInsertOpen(true);
  };

  const confirmCodeInsert = () => {
    restoreEditorSelection();
    const lang = (codeInsertLang || 'text').trim();
    const code = String(codeInsertText || '');
    const safeLang = escapeHtml(lang);
    const safeCode = escapeHtml(code);

    if (codeInsertMode === 'inline') {
      if (!code) return setCodeInsertOpen(false);
      execCmd(
        'insertHTML',
        `<code class="texure-inline-code" data-texure-code-lang="${safeLang}">${safeCode}</code>`
      );
      setCodeInsertOpen(false);
      return;
    }

    // block
    const block = `<pre class="bg-slate-100 p-3 rounded font-mono text-sm my-4 border border-slate-200 overflow-x-auto"><code data-texure-code-lang="${safeLang}">${safeCode}</code></pre><p><br></p>`;
    execCmd('insertHTML', block);
    setCodeInsertOpen(false);
  };

  const openSpacingInsert = (mode) => {
    saveEditorSelection();
    setSpacingInsertMode(mode);
    setSpacingInsertLen('1em');
    setSpacingInsertOpen(true);
  };

  const confirmSpacingInsert = () => {
    restoreEditorSelection();
    const rawLen = String(spacingInsertLen || '').trim();
    if (!rawLen) return;
    const cmd = spacingInsertMode === 'vspace' ? `\\vspace{${rawLen}}` : `\\hspace{${rawLen}}`;
    const safeCmd = escapeHtml(cmd);
    const cssLen = toSafeCssLength(rawLen);
    const styleAttr = cssLen ? ` style="${spacingInsertMode === 'vspace' ? 'height' : 'width'}: ${escapeHtml(cssLen)}"` : '';

    if (spacingInsertMode === 'vspace') {
      execCmd(
        'insertHTML',
        `<div class="my-2 bg-slate-200/40 border border-dashed border-slate-400 rounded-sm w-full" contenteditable="false" data-texure-latex="${safeCmd}" title="${safeCmd}"${styleAttr}></div>`
      );
    } else {
      execCmd(
        'insertHTML',
        `<span class="inline-block align-baseline bg-slate-200/70 border border-dashed border-slate-400 rounded-sm" contenteditable="false" data-texure-latex="${safeCmd}" title="${safeCmd}"${styleAttr}>&nbsp;</span>`
      );
    }
    setSpacingInsertOpen(false);
  };

  const insertNewPage = () => {
    saveEditorSelection();
    restoreEditorSelection();
    const cmd = '\\newpage';
    const safeCmd = escapeHtml(cmd);
    execCmd(
      'insertHTML',
      `<div class="my-6 border-t border-dashed border-slate-400 text-[10px] text-slate-500 text-center" contenteditable="false" data-texure-latex="${safeCmd}" title="${safeCmd}">${safeCmd}</div>`
    );
  };

  const insertLink = () => {
    const url = prompt("Enter link URL:", "https://");
    if (url) execCmd("createLink", url);
  };

  const pickLocalFiles = ({ accept = '', multiple = false } = {}) => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.onchange = () => resolve(Array.from(input.files || []));
      input.click();
    });
  };

  const insertImage = async () => {
    saveEditorSelection();
    setImageImportOpen(true);
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

  const openFile = async () => {
    try {
      if (!isOpenFilePickerSupported()) {
        // Fallback: can open a file but cannot keep a writable handle.
        const files = await pickLocalFiles({ accept: '.tex,.txt,text/plain', multiple: false });
        const f = files?.[0];
        if (!f) return;
        const text = await f.text();
        setLatexCode(text);
        setActiveFileHandle(null);
        setActiveFilePath(f.name || '');
        return;
      }
      const handle = await pickTexFile();
      if (!handle) return;
      const text = await readFileText(handle);
      setLatexCode(text);
      setActiveFileHandle(handle);
      setActiveFilePath(handle.name || '');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.warn('Open file failed', e);
      alert(`Open file failed.\n\n${String(e?.message || e)}`);
    }
  };

  const saveCurrentFile = async () => {
    if (!activeFileHandle) {
      try {
        const name = (activeFilePath || 'document.tex').replace(/[\\/:*?"<>|]+/g, '_');
        const blob = new Blob([latexCode], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
      } catch (e) {
        alert(`Save is unavailable in this browser/context.\n\n${String(e?.message || e)}`);
      }
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      await writeFileText(activeFileHandle, latexCode);
    } catch (e) {
      console.warn('Save failed', e);
      alert(`Save failed.\n\n${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  // Export LaTeX to PDF via online compiler services
  const exportAsPDF = async () => {
    if (exporting) return;
    setExporting(true);

    const escapeHtmlText = (text) => {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const exportViaBrowserPrint = ({ html, title }) => {
      try {
        const win = window.open('', '_blank');
        if (!win) {
          // Pop-up blocked: fall back to printing the current page.
          window.print();
          return;
        }

        const stylesheetLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
          .map((l) => l.href)
          .filter(Boolean)
          .map((href) => `<link rel="stylesheet" href="${href}">`)
          .join('\n');

        const doc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <base href="${escapeHtmlText(document.baseURI)}" />
    <title>${escapeHtmlText(title || 'document')}</title>
    ${stylesheetLinks}
    <style>
      body { margin: 0; background: white; }
      .texure-print-shell { min-height: 100vh; background: rgb(241 245 249); padding: 32px; }
      @media print {
        .texure-print-shell { background: white !important; padding: 0 !important; }
        .latex-page { box-shadow: none !important; border: none !important; }
      }
    </style>
  </head>
  <body>
    <div class="texure-print-shell">
      <div class="flex justify-center">
        <div class="latex-page outline-none prose prose-slate max-w-none prose-h1:text-3xl prose-h1:font-bold prose-h1:mt-6 prose-h1:mb-4 prose-h2:text-2xl prose-h2:font-semibold prose-h2:mt-5 prose-h2:mb-3 prose-h3:text-xl prose-h3:font-medium prose-h3:mt-4 prose-h3:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-a:text-blue-600 prose-a:underline prose-img:rounded-md prose-pre:bg-slate-100 prose-pre:text-slate-800 prose-pre:border prose-pre:border-slate-200 latex-render-visual-editor">
          ${html || ''}
        </div>
      </div>
    </div>
    <script>
      window.onload = () => {
        setTimeout(() => {
          try { window.focus(); } catch (e) {}
          try { window.print(); } catch (e) {}
        }, 150);
      };
      window.onafterprint = () => {
        try { window.close(); } catch (e) {}
      };
    </script>
  </body>
</html>`;

        win.document.open();
        win.document.write(doc);
        win.document.close();
      } catch (e) {
        console.warn('Print fallback failed', e);
        try {
          window.print();
        } catch (_) { /* ignore */ }
      }
    };

    const normalizeLatexForExport = (input) => {
      let out = String(input || '');

      // Avoid xcolor errors when "transparent" is accidentally used as a color name.
      out = out.replace(/\\colorbox\{transparent\}\{([^}]*)\}/gi, '$1');
      out = out.replace(/\\textcolor\{transparent\}\{([^}]*)\}/gi, '$1');

      // Convert minted to listings to avoid pygmentize/shell-escape requirements on remote compilers.
      out = out.replace(/\\begin\{minted\}(?:\[[^\]]*\])?\{([^}]*)\}([\s\S]*?)\\end\{minted\}/g, (_, lang, body) => {
        const code = String(body || '').replace(/^\n/, '').replace(/\n$/, '');
        const safeLang = String(lang || '').trim();
        const opt = safeLang ? `[language=${safeLang}]` : '';
        return `\\begin{lstlisting}${opt}\n${code}\n\\end{lstlisting}`;
      });
      out = out.replace(/\\mintinline(?:\[[^\]]*\])?\{([^}]*)\}([^\s])([\s\S]*?)\2/g, (_, _lang, _delim, code) => {
        return `\\texttt{${escapeLatex(String(code || ''))}}`;
      });
      out = out.replace(/\\mintinline(?:\[[^\]]*\])?\{([^}]*)\}\{([\s\S]*?)\}/g, (_, _lang, code) => {
        return `\\texttt{${escapeLatex(String(code || ''))}}`;
      });
      out = out.replace(/^\s*\\usepackage(?:\[[^\]]*\])?\{minted\}\s*$/gmi, '');

      if (/\\begin\{lstlisting\}/.test(out) && !/\\usepackage(?:\[[^\]]*\])?\{listings\}/.test(out)) {
        const insertPoint = out.indexOf('\\begin{document}');
        if (insertPoint !== -1) {
          out = out.slice(0, insertPoint) + '\\usepackage{listings}\n' + out.slice(insertPoint);
        }
      }

      return out;
    };

    const exportLatex = normalizeLatexForExport(latexCode);

    // 1) Generate filename primarily from \title, fallback to 'document'
    const titleMatch = exportLatex.match(/\\title\{([^}]*)\}/);
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
      // GitHub Pages is static: if no engine is configured, use print-to-PDF fallback.
      if (!isWasmLatexEngineConfigured()) {
        setLogText('No in-browser LaTeX engine configured. Using browser print-to-PDF fallback instead.');
        exportViaBrowserPrint({ html: htmlContent, title: filename.replace(/\.pdf$/i, '') });
        setExporting(false);
        return;
      }
      try {
        const blob = await compileWithWasmLatex(exportLatex);
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
        const msg = String(e?.message || e || '');
        if (/no wasm latex engine configured|configured wasm module not found/i.test(msg)) {
          setLogText(`${msg}\n\nUsing browser print-to-PDF fallback instead.`);
          exportViaBrowserPrint({ html: htmlContent, title: filename.replace(/\.pdf$/i, '') });
          setExporting(false);
          return;
        }
        // On static hosting (GitHub Pages), do not fall back to /api services that don’t exist.
        setCompileStatus('error');
        setCompileSummary('Compilation failed');
        setLogText(msg || 'WASM LaTeX compile failed.');
        alert('Export failed. Check the logs for details.');
        setExporting(false);
        return;
      }
    }

    // ATTEMPT 1: latexonline.cc via proxy
    let latexonlineErrorLog = null;
    try {
      const res = await fetchWithTimeout(`/api/latexonline/compile?text=${encodeURIComponent(exportLatex)}`, { method: 'GET' }, 15000);
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
          body: JSON.stringify({ code: exportLatex, format: 'pdf' })
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
            onClick={openFile}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-md hover:bg-slate-200 transition-colors text-xs font-medium border border-slate-200"
            title="Open .tex/.txt file"
          >
            <FileUp size={14} /> Open File
          </button>

          <button
            onClick={saveCurrentFile}
            disabled={saving}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-md hover:bg-slate-200 transition-colors text-xs font-medium border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
            title={activeFileHandle ? (activeFilePath ? `Save ${activeFilePath}` : 'Save') : 'Download .tex'}
          >
            <Save size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>

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
            <RibbonToolbar
              ff={ff}
              enableVisualTopbar={ENABLE_VISUAL_TOPBAR}
              isMathActive={isMathActive}
              isInlineCodeActive={isInlineCodeActive}
              katexLoaded={katexLoaded}
              zoom={visualZoom}
              onZoomChange={setVisualZoom}
              onInsertMathSymbol={insertMathSymbol}
              actions={{
                execCmd,
                insertLink,
                insertImage,
                insertMathElement,
                insertInlineCode: () => openCodeInsert('inline'),
                insertCodeBlock: () => openCodeInsert('block'),
                insertHSpace: () => openSpacingInsert('hspace'),
                insertVSpace: () => openSpacingInsert('vspace'),
                insertNewPage,
              }}
            />

            {/* Document Surface */}
            <div ref={visualScrollRef} className="flex-1 overflow-y-auto bg-slate-100 p-8">
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
                  onBeforeInput={handleVisualBeforeInput}
                  onInput={handleVisualInput}
                  onKeyDown={handleVisualKeyDown}
                  onKeyUp={syncInlineCodeActive}
                  onMouseUp={syncInlineCodeActive}
                  onScroll={handleVisualScroll}
                  onPaste={handleVisualPaste}
                  onDragOver={handleVisualDragOver}
                  onDrop={handleVisualDrop}
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
    {imageOverlayRect && (
      <div
        className="fixed z-40 pointer-events-none"
        style={{
          left: imageOverlayRect.left,
          top: imageOverlayRect.top,
          width: imageOverlayRect.width,
          height: imageOverlayRect.height,
        }}
      >
        <div className="absolute inset-0 rounded border-2 border-blue-500/70" />

        {/* Resize handles */}
        {[
          ['nw', { left: -6, top: -6, cursor: 'nwse-resize' }],
          ['ne', { right: -6, top: -6, cursor: 'nesw-resize' }],
          ['sw', { left: -6, bottom: -6, cursor: 'nesw-resize' }],
          ['se', { right: -6, bottom: -6, cursor: 'nwse-resize' }],
        ].map(([dir, pos]) => (
          <button
            key={dir}
            className="absolute h-3 w-3 rounded-full bg-white border border-blue-500 shadow-sm pointer-events-auto"
            style={pos}
            onPointerDown={(e) => startImageTransform('resize', e, { resizeDir: dir })}
            title="Resize"
          />
        ))}

        {/* Rotate handle */}
        <button
          className="absolute left-1/2 -top-8 -translate-x-1/2 h-7 w-7 rounded-full bg-white border border-blue-500 shadow-sm pointer-events-auto flex items-center justify-center"
          onPointerDown={(e) => startImageTransform('rotate', e)}
          title="Rotate"
        >
          <RotateCw size={14} className="text-slate-700" />
        </button>

        {/* Reset / Close */}
        <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex gap-2 pointer-events-auto">
          <button
            className="px-2 py-1 rounded bg-white border border-slate-200 shadow-sm text-[11px] text-slate-700 hover:bg-slate-50"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const img = selectedImageElRef.current;
              if (!img) return;
              img.setAttribute('data-texure-img-width', '1');
              img.setAttribute('data-texure-img-angle', '0');
              img.setAttribute('data-texure-img-x', '0');
              img.setAttribute('data-texure-img-y', '0');
              applyImageTransformToDom(img);
              handleVisualInput();
              updateImageOverlay();
            }}
          >
            Reset
          </button>
          <button
            className="px-2 py-1 rounded bg-white border border-slate-200 shadow-sm text-[11px] text-slate-700 hover:bg-slate-50"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => clearImageSelection()}
          >
            Done
          </button>
        </div>
      </div>
    )}
    {imageImportOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-[92vw] max-w-xl bg-white rounded-lg shadow-xl border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <ImagePlus size={16} /> Insert Image
            </div>
            <button
              className="p-1 rounded hover:bg-slate-100"
              onClick={() => { if (!imageImportBusy) setImageImportOpen(false); }}
              title="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-4 flex flex-col gap-3">
            <button
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm font-medium text-slate-800"
              disabled={imageImportBusy}
              onClick={async () => {
                setImageImportBusy(true);
                try {
                  restoreEditorSelection();
                  const files = await pickLocalFiles({ accept: 'image/*', multiple: true });
                  await insertTexureImagesFromFiles(files);
                  setImageImportOpen(false);
                } finally {
                  setImageImportBusy(false);
                }
              }}
            >
              <ImageIcon size={16} /> Choose image file(s)
            </button>

            <div className="text-xs text-slate-500 text-center">or</div>

            <div className="flex gap-2">
              <input
                value={imageImportUrl}
                onChange={(e) => setImageImportUrl(e.target.value)}
                placeholder="Paste image URL (https://...)"
                className="flex-1 px-3 py-2 text-sm rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200"
                disabled={imageImportBusy}
              />
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={imageImportBusy || !imageImportUrl.trim()}
                onClick={() => {
                  const url = imageImportUrl.trim();
                  if (!url) return;
                  restoreEditorSelection();
                  execCmd('insertImage', url);
                  setImageImportUrl('');
                  setImageImportOpen(false);
                }}
              >
                Insert
              </button>
            </div>

            <div className="text-[11px] text-slate-500">
              Tip: you can also drag & drop images directly onto the page.
            </div>
          </div>
        </div>
      </div>
    )}
    {codeInsertOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-[92vw] max-w-xl bg-white rounded-lg shadow-xl border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <SquareTerminal size={16} /> {codeInsertMode === 'inline' ? 'Insert Inline Code' : 'Insert Code Block'}
            </div>
            <button
              className="p-1 rounded hover:bg-slate-100"
              onClick={() => setCodeInsertOpen(false)}
              title="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-4 flex flex-col gap-3">
            <label className="text-xs font-medium text-slate-600">Language</label>
            <select
              className="px-3 py-2 text-sm rounded border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              value={codeInsertLang}
              onChange={(e) => setCodeInsertLang(e.target.value)}
            >
              {[
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
              ].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>

            {codeInsertMode === 'inline' ? (
              <>
                <label className="text-xs font-medium text-slate-600">Code</label>
                <input
                  value={codeInsertText}
                  onChange={(e) => setCodeInsertText(e.target.value)}
                  placeholder="e.g. const x = 1"
                  className="px-3 py-2 text-sm rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200 font-mono"
                />
              </>
            ) : (
              <>
                <label className="text-xs font-medium text-slate-600">Code</label>
                <textarea
                  value={codeInsertText}
                  onChange={(e) => setCodeInsertText(e.target.value)}
                  placeholder="Paste code here..."
                  className="min-h-[160px] px-3 py-2 text-sm rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200 font-mono"
                />
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                className="px-3 py-2 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-sm"
                onClick={() => setCodeInsertOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!String(codeInsertText || '').trim()}
                onClick={confirmCodeInsert}
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    {spacingInsertOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-[92vw] max-w-md bg-white rounded-lg shadow-xl border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Minus size={16} /> {spacingInsertMode === 'vspace' ? 'Insert Vertical Space' : 'Insert Horizontal Space'}
            </div>
            <button
              className="p-1 rounded hover:bg-slate-100"
              onClick={() => setSpacingInsertOpen(false)}
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <label className="text-xs font-medium text-slate-600">Length</label>
            <input
              value={spacingInsertLen}
              onChange={(e) => setSpacingInsertLen(e.target.value)}
              placeholder="e.g. 1em, 12pt, 0.5cm"
              className="px-3 py-2 text-sm rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200 font-mono"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                className="px-3 py-2 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-sm"
                onClick={() => setSpacingInsertOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!String(spacingInsertLen || '').trim()}
                onClick={confirmSpacingInsert}
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
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
