import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

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

export default function DropdownMenu({
  label,
  ariaLabel,
  items,
  buttonClassName = '',
  menuClassName = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useOutsidePointerDown(rootRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel || label}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors ${buttonClassName}`}
      >
        {label} <ChevronDown size={14} className="text-slate-500" />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute left-0 top-full z-50 mt-1 min-w-56 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg ${menuClassName}`}
        >
          {items
            .filter(Boolean)
            .map((it, idx) => {
              if (it.type === 'separator') {
                return <div key={`sep-${idx}`} role="separator" className="my-1 h-px bg-slate-100" />;
              }

              const Icon = it.icon;
              const disabled = Boolean(it.disabled);
              return (
                <button
                  key={it.key || idx}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (disabled) return;
                    it.onSelect?.(it);
                    setOpen(false);
                  }}
                  role="menuitem"
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                  className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white"
                >
                  <div className="flex items-start gap-2">
                    {Icon ? (
                      <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center text-slate-500">
                        <Icon size={14} />
                      </span>
                    ) : (
                      <span className="mt-0.5 inline-flex h-4 w-4" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{it.label}</div>
                        {it.hint && <div className="text-[11px] text-slate-400">{it.hint}</div>}
                      </div>
                      {it.subtle && <div className="text-[11px] text-slate-500">{it.subtle}</div>}
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

