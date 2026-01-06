import React, { useState } from 'react';
import { Sigma, ZoomIn, ZoomOut } from 'lucide-react';
import { MATH_GROUPS } from '../../constants/math';

function TooltipIconButton({ icon: Icon, onClick, title }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(e); }}
      title={title}
      aria-label={title}
      className="relative group p-1.5 rounded flex items-center hover:bg-slate-200 transition-colors text-slate-600"
    >
      <Icon size={16} />
      <span className="sr-only">{title}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {title}
      </span>
    </button>
  );
}

export default function MathToolbar({ onInsert, katexLoaded, zoom, onZoomChange }) {
  const [activeGroup, setActiveGroup] = useState('structures');

  return (
    <div className="flex flex-col w-full bg-slate-50 border-b border-slate-200">
      <div className="flex items-center justify-between gap-2 px-2 border-b border-slate-200 bg-white">
        <div className="flex items-center min-w-0">
          <div className="flex items-center gap-2 py-1 px-2 text-xs font-bold text-blue-700 uppercase tracking-wider select-none">
            <Sigma size={14} /> Equation Tools
          </div>
          <div className="h-4 w-px bg-slate-300 mx-2 self-center"></div>
          <div className="flex">
            {Object.entries(MATH_GROUPS).map(([key, group]) => (
              <button
                key={key}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setActiveGroup(key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 ${activeGroup === key ? 'border-blue-500 text-blue-700 bg-blue-50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                {group.label}
              </button>
            ))}
          </div>
        </div>

        {typeof zoom === 'number' && typeof onZoomChange === 'function' && (
          <div className="flex items-center gap-1">
            <TooltipIconButton
              icon={ZoomOut}
              onClick={() => onZoomChange(Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))}
              title="Zoom Out"
            />
            <button
              onMouseDown={(e) => { e.preventDefault(); onZoomChange(1); }}
              title="Reset Zoom"
              aria-label="Reset Zoom"
              className="relative group px-2 py-1.5 rounded text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors tabular-nums"
            >
              {Math.round(zoom * 100)}%
              <span className="sr-only">Reset Zoom</span>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                Reset Zoom
              </span>
            </button>
            <TooltipIconButton
              icon={ZoomIn}
              onClick={() => onZoomChange(Math.min(2, Math.round((zoom + 0.1) * 10) / 10))}
              title="Zoom In"
            />
          </div>
        )}
      </div>

      <div className={`flex flex-wrap ${activeGroup === 'multidim' ? 'gap-2' : 'gap-1'} p-2 items-center`}>
        {MATH_GROUPS[activeGroup].symbols.map((sym, idx) => {
            const isStructure = activeGroup === 'structures' || activeGroup === 'multidim';
            const isMatrix = activeGroup === 'multidim';
            return (
               <button
                 key={idx}
                 onMouseDown={(e) => { e.preventDefault(); onInsert(sym.cmd); }}
                 className={`${isMatrix ? 'px-3' : (isStructure ? 'w-10 px-2' : 'w-8')} relative group h-8 flex items-center justify-center rounded hover:bg-white hover:shadow-sm hover:border hover:border-slate-200 text-slate-700 text-sm transition-all`}
                 title={sym.desc || sym.cmd}
                 aria-label={sym.desc || sym.cmd}
               >
                 {sym.preview && katexLoaded && typeof window !== 'undefined' && window.katex ? (
                   <span className="leading-none" dangerouslySetInnerHTML={{ __html: window.katex.renderToString(sym.preview, { displayMode: false, throwOnError: false }) }} />
                 ) : (
                   sym.char ? sym.char : <span className="font-sans text-xs">{sym.label}</span>
                 )}
                 <span className="sr-only">{sym.desc || sym.cmd}</span>
                 <span
                   role="tooltip"
                   className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                 >
                   {sym.desc || sym.cmd}
                 </span>
               </button>
            )
        })}
      </div>
    </div>
  );
}
