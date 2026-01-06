import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import EditorToolbar from '../../src/features/Toolbar/EditorToolbar.jsx';

const baseFlags = {
  showUndo: false,
  showRedo: false,
  showHeading1: false,
  showHeading2: false,
  showHeading3: false,
  showHeading4: false,
  showTitle: false,
  showBold: false,
  showItalic: false,
  showUnderline: false,
  showAlignLeft: false,
  showAlignCenter: false,
  showAlignRight: false,
  showAlignJustify: false,
  showInlineCode: false,
  showCodeBlock: false,
  showInlineMath: false,
  showDisplayMath: false,
  showUnorderedList: false,
  showOrderedList: false,
  showIndent: false,
  showOutdent: false,
  showLink: false,
  showImage: false,
};

const allFlags = Object.fromEntries(Object.keys(baseFlags).map((k) => [k, true]));

describe('EditorToolbar', () => {
  it('does not render when topbar disabled', () => {
    const { container } = render(
      <EditorToolbar ff={baseFlags} enableVisualTopbar={false} isMathActive={false} katexLoaded={false} actions={{}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an empty toolbar when no feature flags enabled', () => {
    const { container } = render(
      <EditorToolbar ff={baseFlags} enableVisualTopbar={true} isMathActive={false} katexLoaded={false} actions={{ execCmd: vi.fn() }} />
    );
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('invokes execCmd for Bold', () => {
    const ff = { ...baseFlags, showBold: true };
    const execCmd = vi.fn();
    render(
      <EditorToolbar ff={ff} enableVisualTopbar={true} isMathActive={false} katexLoaded={false} actions={{ execCmd }} />
    );
    const btn = screen.getByTitle('Bold');
    fireEvent.mouseDown(btn);
    expect(execCmd).toHaveBeenCalledWith('bold');
  });

  it('invokes insertMathElement for inline math', () => {
    const ff = { ...baseFlags, showInlineMath: true };
    const insertMathElement = vi.fn();
    render(
      <EditorToolbar ff={ff} enableVisualTopbar={true} isMathActive={false} katexLoaded={false} actions={{ insertMathElement, execCmd: vi.fn() }} />
    );
    const btn = screen.getByTitle('Inline Math ($...$)');
    fireEvent.mouseDown(btn);
    expect(insertMathElement).toHaveBeenCalledWith(false);
  });

  it('applies active styling to math buttons when math is active', () => {
    const ff = { ...baseFlags, showInlineMath: true };
    const insertMathElement = vi.fn();
    render(
      <EditorToolbar ff={ff} enableVisualTopbar={true} isMathActive={true} katexLoaded={false} actions={{ insertMathElement, execCmd: vi.fn() }} />
    );
    const btn = screen.getByTitle('Inline Math ($...$)');
    expect(btn.className).toContain('bg-slate-300');
    fireEvent.mouseDown(btn);
    expect(insertMathElement).toHaveBeenCalledWith(false);
  });

  it('renders all enabled sections and wires actions', () => {
    const execCmd = vi.fn();
    const insertMathElement = vi.fn();
    const insertLink = vi.fn();
    const insertImage = vi.fn();

    const { container } = render(
      <EditorToolbar
        ff={allFlags}
        enableVisualTopbar={true}
        isMathActive={false}
        katexLoaded={false}
        actions={{ execCmd, insertMathElement, insertLink, insertImage }}
      />
    );

    const clickByTitle = (title) => fireEvent.mouseDown(screen.getByTitle(title));

    clickByTitle('Undo');
    clickByTitle('Redo');
    clickByTitle('Title (H1)');
    clickByTitle('Heading 1');
    clickByTitle('Heading 2');
    clickByTitle('Heading 3');
    clickByTitle('Heading 4');
    clickByTitle('Bold');
    clickByTitle('Italic');
    clickByTitle('Underline');
    clickByTitle('Align Left');
    clickByTitle('Align Center');
    clickByTitle('Align Right');
    clickByTitle('Justify');
    clickByTitle('Inline Code');
    clickByTitle('Code Block');
    clickByTitle('Inline Math ($...$)');
    clickByTitle('Display Math (\\[...\\])');
    clickByTitle('Bullet List');
    clickByTitle('Numbered List');
    clickByTitle('Increase Indent');
    clickByTitle('Decrease Indent');
    clickByTitle('Link');
    clickByTitle('Image');

    expect(execCmd).toHaveBeenCalledWith('undo');
    expect(execCmd).toHaveBeenCalledWith('redo');
    expect(execCmd).toHaveBeenCalledWith('formatBlock', 'H1');
    expect(execCmd).toHaveBeenCalledWith('formatBlock', 'H2');
    expect(execCmd).toHaveBeenCalledWith('formatBlock', 'H3');
    expect(execCmd).toHaveBeenCalledWith('formatBlock', 'H4');
    expect(execCmd).toHaveBeenCalledWith('bold');
    expect(execCmd).toHaveBeenCalledWith('italic');
    expect(execCmd).toHaveBeenCalledWith('underline');
    expect(execCmd).toHaveBeenCalledWith('justifyLeft');
    expect(execCmd).toHaveBeenCalledWith('justifyCenter');
    expect(execCmd).toHaveBeenCalledWith('justifyRight');
    expect(execCmd).toHaveBeenCalledWith('justifyFull');
    expect(execCmd).toHaveBeenCalledWith('insertUnorderedList');
    expect(execCmd).toHaveBeenCalledWith('insertOrderedList');
    expect(execCmd).toHaveBeenCalledWith('indent');
    expect(execCmd).toHaveBeenCalledWith('outdent');
    expect(execCmd.mock.calls.length).toBe(18);

    expect(insertMathElement).toHaveBeenCalledWith(false);
    expect(insertMathElement).toHaveBeenCalledWith(true);
    expect(insertLink).toHaveBeenCalledTimes(1);
    expect(insertImage).toHaveBeenCalledTimes(1);

    expect(container.querySelectorAll('div.h-4.w-px').length).toBe(7);
  });

  it('does not render dividers when no later groups are visible', () => {
    const scenarios = [
      { showUndo: true },
      { showHeading1: true },
      { showBold: true },
      { showAlignLeft: true },
      { showInlineMath: true },
      { showUnorderedList: true },
      { showIndent: true },
    ];

    for (const partial of scenarios) {
      const ff = { ...baseFlags, ...partial };
      const { container, unmount } = render(
        <EditorToolbar ff={ff} enableVisualTopbar={true} isMathActive={false} katexLoaded={false} actions={{ execCmd: vi.fn(), insertMathElement: vi.fn(), insertLink: vi.fn(), insertImage: vi.fn() }} />
      );
      expect(container.querySelectorAll('div.h-4.w-px').length).toBe(0);
      unmount();
    }
  });
});
