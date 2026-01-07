import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Undo,
  Redo,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Indent,
  Outdent,
  Link as LinkIcon,
  Image as ImageIcon,
  Code,
  SquareTerminal,
  FunctionSquare,
  Sigma,
  ZoomIn,
  ZoomOut,
  Minus,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { MATH_GROUPS } from '../../constants/math';

function Tooltip({ children }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}

function IconButton({ icon: Icon, onClick, active, title, className = '' }) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onClick?.(e)}
      title={title}
      aria-label={title}
      className={`relative group rounded p-1.5 text-slate-700 hover:bg-slate-100 transition-colors ${
        active ? 'bg-slate-200 text-blue-800' : ''
      } ${className}`}
    >
      <Icon size={16} />
      <span className="sr-only">{title}</span>
      <Tooltip>{title}</Tooltip>
    </button>
  );
}

function Group({ title, children }) {
  return (
    <div className="flex flex-col justify-between rounded-md border border-slate-200 bg-white px-2 py-2">
      <div className="flex flex-wrap items-center gap-1">{children}</div>
      <div className="mt-1 border-t border-slate-100 pt-1 text-center text-[10px] uppercase tracking-wider text-slate-500 select-none">
        {title}
      </div>
    </div>
  );
}

function useOutsidePointerDown(ref, onOutside) {
  useEffect(() => {
    const onPointerDown = (e) => {
      const el = ref.current;
      if (!el) return;
      if (el.contains(e.target)) return;
      onOutside?.();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [ref, onOutside]);
}

function Menu({ label, items, onChoose, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useOutsidePointerDown(rootRef, () => setOpen(false));

  return (
    <div ref={rootRef} className="relative">
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel || label}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
      >
        {label} <ChevronDown size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-md border border-slate-200 bg-white shadow-lg overflow-hidden"
        >
          {items.map((it) => (
            <button
              key={it.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChoose?.(it);
                setOpen(false);
              }}
              role="menuitem"
              className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            >
              <div className="font-medium">{it.label}</div>
              {it.hint && <div className="text-[11px] text-slate-500">{it.hint}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MathPalette({ katexLoaded, activeGroup, onActiveGroupChange, onInsert }) {
  const groupKeys = useMemo(() => Object.keys(MATH_GROUPS), []);
  const group = MATH_GROUPS[activeGroup] || MATH_GROUPS.structures;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-2 px-2 py-1 text-xs font-bold text-blue-800 uppercase tracking-wider select-none">
            <Sigma size={14} /> Equation Tools
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">Group</span>
            <select
              value={activeGroup}
              onChange={(e) => onActiveGroupChange?.(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {groupKeys.map((key) => (
                <option key={key} value={key}>
                  {MATH_GROUPS[key].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-2 max-h-[140px] overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
        <div className={`flex flex-wrap ${activeGroup === 'multidim' ? 'gap-2' : 'gap-1'} items-center`}>
          {group.symbols.map((sym, idx) => {
            const isStructure = activeGroup === 'structures' || activeGroup === 'multidim';
            const isMatrix = activeGroup === 'multidim';
            const title = sym.desc || sym.cmd || sym.label || sym.char || 'Insert';
            return (
              <button
                key={idx}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onInsert?.(sym.cmd)}
                className={`${
                  isMatrix ? 'px-3' : isStructure ? 'w-10 px-2' : 'w-8'
                } relative group h-8 flex items-center justify-center rounded hover:bg-white hover:shadow-sm hover:border hover:border-slate-200 text-slate-700 text-sm transition-all`}
                title={title}
                aria-label={title}
              >
                {sym.preview && katexLoaded && typeof window !== 'undefined' && window.katex ? (
                  <span
                    className="leading-none"
                    dangerouslySetInnerHTML={{
                      __html: window.katex.renderToString(sym.preview, { displayMode: false, throwOnError: false }),
                    }}
                  />
                ) : sym.char ? (
                  sym.char
                ) : (
                  <span className="font-sans text-xs">{sym.label}</span>
                )}
                <span className="sr-only">{title}</span>
                <Tooltip>{title}</Tooltip>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function RibbonToolbar({
  ff = {},
  enableVisualTopbar,
  isMathActive,
  isInlineCodeActive = false,
  katexLoaded,
  zoom,
  onZoomChange,
  actions,
  onInsertMathSymbol,
}) {
  const TAB_KEY = 'texure.ribbon.activeTab';
  const COLLAPSE_KEY = 'texure.ribbon.collapsed';
  const FONT_SIZE_KEY = 'texure.ribbon.fontSizePx';
  const FONT_FAMILY_KEY = 'texure.ribbon.fontFamily';

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem(TAB_KEY) || 'home';
    } catch {
      return 'home';
    }
  });
  const [fontSizeInput, setFontSizeInput] = useState(() => {
    try {
      const raw = localStorage.getItem(FONT_SIZE_KEY);
      const n = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(n)) return String(Math.max(6, Math.min(96, Math.round(n))));
    } catch {
      /* ignore */
    }
    return '14';
  });
  const [fontFamilyChoice, setFontFamilyChoice] = useState(() => {
    try {
      const v = localStorage.getItem(FONT_FAMILY_KEY);
      if (v === 'sans' || v === 'mono' || v === 'serif') return v;
    } catch {
      /* ignore */
    }
    return 'serif';
  });
  const lastNonContextTabRef = useRef(activeTab === 'equation' ? 'home' : activeTab);
  const [mathGroup, setMathGroup] = useState('structures');

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, activeTab);
    } catch {
      /* ignore */
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      const n = Number(fontSizeInput);
      if (Number.isFinite(n)) localStorage.setItem(FONT_SIZE_KEY, String(n));
    } catch {
      /* ignore */
    }
  }, [fontSizeInput]);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_FAMILY_KEY, fontFamilyChoice);
    } catch {
      /* ignore */
    }
  }, [fontFamilyChoice]);

  useEffect(() => {
    if (activeTab !== 'equation') lastNonContextTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (isMathActive) {
      setCollapsed(false);
      setActiveTab('equation');
      return;
    }
    if (activeTab === 'equation') setActiveTab(lastNonContextTabRef.current || 'home');
  }, [isMathActive]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enableVisualTopbar) return null;

  const canZoom = typeof zoom === 'number' && typeof onZoomChange === 'function';
  const hasParagraphAlign = ff.showAlignLeft || ff.showAlignCenter || ff.showAlignRight || ff.showAlignJustify;
  const hasLists = ff.showUnorderedList || ff.showOrderedList;
  const hasIndent = ff.showIndent || ff.showOutdent;
  const hasTextStyles = ff.showBold || ff.showItalic || ff.showUnderline || ff.showInlineCode;
  const hasHeadings = ff.showTitle || ff.showHeading1 || ff.showHeading2 || ff.showHeading3 || ff.showHeading4;
  const hasInsertEquations = ff.showInlineMath || ff.showDisplayMath;
  const hasInsertCode = ff.showInlineCode || ff.showCodeBlock;
  const hasInsertLayout = ff.showHSpace || ff.showVSpace || ff.showNewPage;
  const hasMedia = ff.showLink || ff.showImage;
  const tabs = [
    { key: 'home', label: 'Home' },
    { key: 'insert', label: 'Insert' },
    { key: 'view', label: 'View' },
    ...(isMathActive ? [{ key: 'equation', label: 'Equation' }] : []),
  ];

  const headingItems = [
    { key: 'p', label: 'Normal', hint: 'Paragraph' },
    ...(ff.showTitle ? [{ key: 'title', label: 'Title', hint: 'Heading 1' }] : []),
    ...(ff.showHeading1 ? [{ key: 'h1', label: 'Heading 1', hint: 'H1' }] : []),
    ...(ff.showHeading2 ? [{ key: 'h2', label: 'Heading 2', hint: 'H2' }] : []),
    ...(ff.showHeading3 ? [{ key: 'h3', label: 'Heading 3', hint: 'H3' }] : []),
    ...(ff.showHeading4 ? [{ key: 'h4', label: 'Heading 4', hint: 'H4' }] : []),
  ];

  const clampFontSizePx = (n) => {
    const num = Math.round(Number(n));
    if (!Number.isFinite(num)) return null;
    return Math.max(6, Math.min(96, num));
  };

  const applyFontSize = (n) => {
    const px = clampFontSizePx(n);
    if (px == null) {
      setFontSizeInput((prev) => String(clampFontSizePx(prev) ?? 14));
      return;
    }
    setFontSizeInput(String(px));
    actions?.applyFontSizePx?.(px);
  };

  const applyFontFamily = (choice) => {
    const c = choice === 'sans' || choice === 'mono' ? choice : 'serif';
    setFontFamilyChoice(c);
    if (c === 'sans') actions?.applyFontFamily?.('sans-serif');
    else if (c === 'mono') actions?.applyFontFamily?.('monospace');
    else actions?.applyFontFamily?.('serif');
  };

  return (
    <div className="w-full border-b border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <div className="flex items-center gap-1">
          {ff.showUndo && <IconButton icon={Undo} onClick={() => actions.execCmd('undo')} title="Undo" />}
          {ff.showRedo && <IconButton icon={Redo} onClick={() => actions.execCmd('redo')} title="Redo" />}
        </div>

        <div role="tablist" aria-label="Ribbon Tabs" className="flex items-center gap-1">
          {tabs.map((t) => {
            const selected = activeTab === t.key;
            const isContext = t.key === 'equation';
            const tabId = `texure-ribbon-tab-${t.key}`;
            const panelId = `texure-ribbon-panel-${t.key}`;
            return (
              <button
                key={t.key}
                role="tab"
                id={tabId}
                aria-selected={selected}
                aria-controls={panelId}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setActiveTab(t.key);
                  if (collapsed) setCollapsed(false);
                }}
                className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                  selected
                    ? isContext
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-white text-slate-900 shadow-sm border border-slate-200'
                    : isContext
                      ? 'text-blue-700 hover:bg-blue-50'
                      : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          {canZoom && (
            <>
              <IconButton
                icon={ZoomOut}
                onClick={() => onZoomChange(Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))}
                title="Zoom Out"
              />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onZoomChange(1)}
                title="Reset Zoom"
                aria-label="Reset Zoom"
                className="relative group rounded px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors tabular-nums"
              >
                {Math.round(zoom * 100)}%
                <span className="sr-only">Reset Zoom</span>
                <Tooltip>Reset Zoom</Tooltip>
              </button>
              <IconButton
                icon={ZoomIn}
                onClick={() => onZoomChange(Math.min(2, Math.round((zoom + 0.1) * 10) / 10))}
                title="Zoom In"
              />
            </>
          )}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setCollapsed((v) => !v)}
            className="rounded p-1.5 text-slate-600 hover:bg-slate-100 transition-colors"
            title={collapsed ? 'Expand Ribbon' : 'Collapse Ribbon'}
            aria-label={collapsed ? 'Expand Ribbon' : 'Collapse Ribbon'}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

	      {!collapsed && (
	        <div className="px-2 pb-2">
	          {activeTab === 'home' && (
	            <div
	              role="tabpanel"
              id="texure-ribbon-panel-home"
              aria-labelledby="texure-ribbon-tab-home"
	              className="flex flex-wrap items-stretch gap-2"
	            >
	              <Group title="Font">
	                <label className="flex items-center gap-2 text-xs text-slate-700">
	                  <span className="text-[11px] uppercase tracking-wider text-slate-500">Family</span>
	                  <select
	                    value={fontFamilyChoice}
	                    onChange={(e) => applyFontFamily(e.target.value)}
	                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
	                  >
	                    <option value="serif">Serif</option>
	                    <option value="sans">Sans</option>
	                    <option value="mono">Monospace</option>
	                  </select>
	                </label>

	                <div className="flex items-center gap-1">
	                  <button
	                    onMouseDown={(e) => e.preventDefault()}
	                    onClick={() => applyFontSize((clampFontSizePx(fontSizeInput) ?? 14) - 1)}
	                    title="Decrease font size (1px)"
	                    aria-label="Decrease font size (1px)"
	                    className="rounded p-1.5 text-slate-700 hover:bg-slate-100 transition-colors"
	                  >
	                    <Minus size={16} />
	                  </button>
	                  <input
	                    type="number"
	                    inputMode="numeric"
	                    min={6}
	                    max={96}
	                    step={1}
	                    value={fontSizeInput}
	                    onChange={(e) => setFontSizeInput(e.target.value)}
	                    onKeyDown={(e) => {
	                      if (e.key !== 'Enter') return;
	                      e.preventDefault();
	                      applyFontSize(fontSizeInput);
	                    }}
	                    onBlur={() => applyFontSize(fontSizeInput)}
	                    className="w-[64px] rounded border border-slate-200 bg-white px-2 py-1 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-200"
	                    aria-label="Font size in pixels"
	                  />
	                  <button
	                    onMouseDown={(e) => e.preventDefault()}
	                    onClick={() => applyFontSize((clampFontSizePx(fontSizeInput) ?? 14) + 1)}
	                    title="Increase font size (1px)"
	                    aria-label="Increase font size (1px)"
	                    className="rounded p-1.5 text-slate-700 hover:bg-slate-100 transition-colors"
	                  >
	                    <Plus size={16} />
	                  </button>
	                  <span className="text-[11px] text-slate-500 select-none">px</span>
	                </div>
	              </Group>

	              {hasTextStyles && (
	                <Group title="Styles">
	                  {ff.showBold && <IconButton icon={Bold} onClick={() => actions.execCmd('bold')} title="Bold" />}
	                  {ff.showItalic && <IconButton icon={Italic} onClick={() => actions.execCmd('italic')} title="Italic" />}
                  {ff.showUnderline && <IconButton icon={Underline} onClick={() => actions.execCmd('underline')} title="Underline" />}
                  {ff.showInlineCode && (
                    <IconButton icon={Code} onClick={() => actions.insertInlineCode?.()} active={isInlineCodeActive} title="Inline Code" />
                  )}
                </Group>
              )}

              {hasHeadings && (
                <Group title="Headings">
                  <Menu
                    label="Styles"
                    ariaLabel="Heading Styles"
                    items={headingItems}
                    onChoose={(it) => {
                      if (it.key === 'p') actions.execCmd('formatBlock', 'P');
                      else if (it.key === 'title') actions.execCmd('formatBlock', 'H1');
                      else actions.execCmd('formatBlock', it.key.toUpperCase());
                    }}
                  />
                </Group>
              )}

              {(hasParagraphAlign || hasLists || hasIndent) && (
                <Group title="Paragraph">
                  {ff.showAlignLeft && <IconButton icon={AlignLeft} onClick={() => actions.execCmd('justifyLeft')} title="Align Left" />}
                  {ff.showAlignCenter && <IconButton icon={AlignCenter} onClick={() => actions.execCmd('justifyCenter')} title="Align Center" />}
                  {ff.showAlignRight && <IconButton icon={AlignRight} onClick={() => actions.execCmd('justifyRight')} title="Align Right" />}
                  {ff.showAlignJustify && <IconButton icon={AlignJustify} onClick={() => actions.execCmd('justifyFull')} title="Justify" />}
                  {hasParagraphAlign && hasLists && <div className="h-5 w-px bg-slate-200 mx-1" />}
                  {ff.showUnorderedList && <IconButton icon={List} onClick={() => actions.execCmd('insertUnorderedList')} title="Bullet List" />}
                  {ff.showOrderedList && <IconButton icon={ListOrdered} onClick={() => actions.execCmd('insertOrderedList')} title="Numbered List" />}
                  {(hasIndent && (hasParagraphAlign || hasLists)) && <div className="h-5 w-px bg-slate-200 mx-1" />}
                  {ff.showIndent && <IconButton icon={Indent} onClick={() => actions.execCmd('indent')} title="Increase Indent" />}
                  {ff.showOutdent && <IconButton icon={Outdent} onClick={() => actions.execCmd('outdent')} title="Decrease Indent" />}
                </Group>
              )}
            </div>
          )}

          {activeTab === 'insert' && (
            <div
              role="tabpanel"
              id="texure-ribbon-panel-insert"
              aria-labelledby="texure-ribbon-tab-insert"
              className="flex flex-wrap items-stretch gap-2"
            >
              {hasInsertEquations && (
                <Group title="Equations">
                  {ff.showInlineMath && (
                    <IconButton
                      icon={Sigma}
                      onClick={() => actions.insertMathElement?.(false)}
                      title="Inline Equation ($...$)"
                    />
                  )}
                  {ff.showDisplayMath && (
                    <IconButton
                      icon={FunctionSquare}
                      onClick={() => actions.insertMathElement?.(true)}
                      title="Display Equation (\\[...\\])"
                    />
                  )}
                </Group>
              )}

              {hasInsertCode && (
                <Group title="Code">
                  {ff.showInlineCode && (
                    <IconButton icon={Code} onClick={() => actions.insertInlineCode?.()} active={isInlineCodeActive} title="Inline Code" />
                  )}
                  {ff.showCodeBlock && <IconButton icon={SquareTerminal} onClick={() => actions.insertCodeBlock?.()} title="Code Block" />}
                </Group>
              )}

              {hasInsertLayout && (
                <Group title="Layout">
                  {ff.showHSpace && (
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => actions.insertHSpace?.()}
                      className="rounded px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                      title="Horizontal Space (\\hspace{...})"
                      aria-label="Horizontal Space (\\hspace{...})"
                    >
                      Horizontal Space
                    </button>
                  )}
                  {ff.showVSpace && (
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => actions.insertVSpace?.()}
                      className="rounded px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                      title="Vertical Space (\\vspace{...})"
                      aria-label="Vertical Space (\\vspace{...})"
                    >
                      Vertical Space
                    </button>
                  )}
                  {ff.showNewPage && (
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => actions.insertNewPage?.()}
                      className="rounded px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                      title="Page Break (\\newpage)"
                      aria-label="Page Break (\\newpage)"
                    >
                      Page Break
                    </button>
                  )}
                </Group>
              )}

              {hasMedia && (
                <Group title="Media">
                  {ff.showLink && <IconButton icon={LinkIcon} onClick={actions.insertLink} title="Link" />}
                  {ff.showImage && <IconButton icon={ImageIcon} onClick={actions.insertImage} title="Image" />}
                </Group>
              )}
            </div>
          )}

          {activeTab === 'view' && (
            <div
              role="tabpanel"
              id="texure-ribbon-panel-view"
              aria-labelledby="texure-ribbon-tab-view"
              className="flex flex-wrap items-stretch gap-2"
            >
              <Group title="Zoom">
                {canZoom ? (
                  <>
                    <IconButton
                      icon={ZoomOut}
                      onClick={() => onZoomChange(Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))}
                      title="Zoom Out"
                    />
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onZoomChange(1)}
                      title="Reset Zoom"
                      aria-label="Reset Zoom"
                      className="relative group rounded px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors tabular-nums"
                    >
                      {Math.round(zoom * 100)}%
                      <span className="sr-only">Reset Zoom</span>
                      <Tooltip>Reset Zoom</Tooltip>
                    </button>
                    <IconButton
                      icon={ZoomIn}
                      onClick={() => onZoomChange(Math.min(2, Math.round((zoom + 0.1) * 10) / 10))}
                      title="Zoom In"
                    />
                  </>
                ) : (
                  <div className="text-xs text-slate-500">Zoom unavailable</div>
                )}
              </Group>
            </div>
          )}

          {activeTab === 'equation' && isMathActive && (
            <div
              role="tabpanel"
              id="texure-ribbon-panel-equation"
              aria-labelledby="texure-ribbon-tab-equation"
              className="flex flex-wrap items-stretch gap-2"
            >
              <div className="w-full rounded-md border border-blue-200 bg-white px-2 py-2">
                <MathPalette
                  katexLoaded={katexLoaded}
                  activeGroup={mathGroup}
                  onActiveGroupChange={setMathGroup}
                  onInsert={onInsertMathSymbol}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
