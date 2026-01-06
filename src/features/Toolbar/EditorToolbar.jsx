import React from 'react';
import {
  Undo, Redo, Heading1, Heading2, Heading3, Heading4, Type, Bold, Italic, Underline,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Code, SquareTerminal,
  FunctionSquare, List, ListOrdered, Indent, Outdent, Link as LinkIcon, Image as ImageIcon,
  ZoomIn, ZoomOut
} from 'lucide-react';

function ToolbarButton({ icon: Icon, onClick, active, title }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(e); }}
      title={title}
      aria-label={title}
      className={`relative group p-1.5 rounded flex items-center gap-0.5 hover:bg-slate-200 transition-colors ${active ? 'bg-slate-300 text-blue-700' : 'text-slate-600'}`}
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

function ToolbarDivider() {
  return <div className="h-4 w-px bg-slate-300 mx-1.5 self-center"></div>;
}

// Minimal plain radical icon to replace SquareRadical
function Radical({ size = 16, color = 'currentColor', ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 12l3 7 5-18h10" />
    </svg>
  );
}

export default function EditorToolbar({
  ff,
  enableVisualTopbar,
  isMathActive,
  katexLoaded,
  zoom,
  onZoomChange,
  actions,
}) {
  if (!enableVisualTopbar) return null;

  const showUndoRedo = (ff.showUndo || ff.showRedo) && enableVisualTopbar;
  const showHeadings = (ff.showHeading1 || ff.showHeading2 || ff.showHeading3 || ff.showHeading4 || ff.showTitle) && enableVisualTopbar;
  const showTextStyles = (ff.showBold || ff.showItalic || ff.showUnderline) && enableVisualTopbar;
  const showAlignment = (ff.showAlignLeft || ff.showAlignCenter || ff.showAlignRight || ff.showAlignJustify) && enableVisualTopbar;
  const showCodeMath = (ff.showInlineCode || ff.showCodeBlock || ff.showInlineMath || ff.showDisplayMath) && enableVisualTopbar;
  const showLists = (ff.showUnorderedList || ff.showOrderedList) && enableVisualTopbar;
  const showIndentation = (ff.showIndent || ff.showOutdent) && enableVisualTopbar;
  const showLinksMedia = (ff.showLink || ff.showImage) && enableVisualTopbar;

  return (
    <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-slate-200 bg-slate-50">
      <div className="flex flex-wrap items-center gap-y-1">
        {showUndoRedo && (
          <>
            {ff.showUndo && <ToolbarButton icon={Undo} onClick={() => actions.execCmd('undo')} title="Undo" />}
            {ff.showRedo && <ToolbarButton icon={Redo} onClick={() => actions.execCmd('redo')} title="Redo" />}
            {(showHeadings || showTextStyles || showCodeMath || showLists || showIndentation || showLinksMedia) && <ToolbarDivider />}
          </>
        )}

        {showHeadings && (
          <>
            {ff.showTitle && <ToolbarButton icon={Type} onClick={() => actions.execCmd('formatBlock', 'H1')} title="Title (H1)" />}
            {ff.showHeading1 && <ToolbarButton icon={Heading1} onClick={() => actions.execCmd('formatBlock', 'H1')} title="Heading 1" />}
            {ff.showHeading2 && <ToolbarButton icon={Heading2} onClick={() => actions.execCmd('formatBlock', 'H2')} title="Heading 2" />}
            {ff.showHeading3 && <ToolbarButton icon={Heading3} onClick={() => actions.execCmd('formatBlock', 'H3')} title="Heading 3" />}
            {ff.showHeading4 && <ToolbarButton icon={Heading4} onClick={() => actions.execCmd('formatBlock', 'H4')} title="Heading 4" />}
            {(showTextStyles || showAlignment || showCodeMath || showLists || showIndentation || showLinksMedia) && <ToolbarDivider />}
          </>
        )}

        {showTextStyles && (
          <>
            {ff.showBold && <ToolbarButton icon={Bold} onClick={() => actions.execCmd('bold')} title="Bold" />}
            {ff.showItalic && <ToolbarButton icon={Italic} onClick={() => actions.execCmd('italic')} title="Italic" />}
            {ff.showUnderline && <ToolbarButton icon={Underline} onClick={() => actions.execCmd('underline')} title="Underline" />}
            {(showAlignment || showCodeMath || showLists || showIndentation || showLinksMedia) && <ToolbarDivider />}
          </>
        )}

        {showAlignment && (
          <>
            {ff.showAlignLeft && <ToolbarButton icon={AlignLeft} onClick={() => actions.execCmd('justifyLeft')} title="Align Left" />}
            {ff.showAlignCenter && <ToolbarButton icon={AlignCenter} onClick={() => actions.execCmd('justifyCenter')} title="Align Center" />}
            {ff.showAlignRight && <ToolbarButton icon={AlignRight} onClick={() => actions.execCmd('justifyRight')} title="Align Right" />}
            {ff.showAlignJustify && <ToolbarButton icon={AlignJustify} onClick={() => actions.execCmd('justifyFull')} title="Justify" />}
            {(showCodeMath || showLists || showIndentation || showLinksMedia) && <ToolbarDivider />}
          </>
        )}

        {showCodeMath && (
          <>
            {ff.showInlineCode && <ToolbarButton icon={Code} onClick={() => {}} title="Inline Code" />}
            {ff.showCodeBlock && <ToolbarButton icon={SquareTerminal} onClick={() => {}} title="Code Block" />}
            {ff.showInlineMath && <ToolbarButton icon={Radical} onClick={() => actions.insertMathElement(false)} active={isMathActive} title="Inline Math ($...$)" />}
            {ff.showDisplayMath && <ToolbarButton icon={FunctionSquare} onClick={() => actions.insertMathElement(true)} active={isMathActive} title="Display Math (\[...\])" />}
            {(showLists || showIndentation || showLinksMedia) && <ToolbarDivider />}
          </>
        )}

        {showLists && (
          <>
            {ff.showUnorderedList && <ToolbarButton icon={List} onClick={() => actions.execCmd('insertUnorderedList')} title="Bullet List" />}
            {ff.showOrderedList && <ToolbarButton icon={ListOrdered} onClick={() => actions.execCmd('insertOrderedList')} title="Numbered List" />}
            {(showIndentation || showLinksMedia) && <ToolbarDivider />}
          </>
        )}

        {showIndentation && (
          <>
            {ff.showIndent && <ToolbarButton icon={Indent} onClick={() => actions.execCmd('indent')} title="Increase Indent" />}
            {ff.showOutdent && <ToolbarButton icon={Outdent} onClick={() => actions.execCmd('outdent')} title="Decrease Indent" />}
            {showLinksMedia && <ToolbarDivider />}
          </>
        )}

        {showLinksMedia && (
          <>
            {ff.showLink && <ToolbarButton icon={LinkIcon} onClick={actions.insertLink} title="Link" />}
            {ff.showImage && <ToolbarButton icon={ImageIcon} onClick={actions.insertImage} title="Image" />}
          </>
        )}
      </div>

      {typeof zoom === 'number' && typeof onZoomChange === 'function' && (
        <div className="flex items-center gap-1">
          <ToolbarButton
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
          <ToolbarButton
            icon={ZoomIn}
            onClick={() => onZoomChange(Math.min(2, Math.round((zoom + 0.1) * 10) / 10))}
            title="Zoom In"
          />
        </div>
      )}
    </div>
  );
}
