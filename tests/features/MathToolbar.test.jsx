import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import MathToolbar from '../../src/features/Math/MathToolbar.jsx';

describe('MathToolbar', () => {
  it('renders the header label', () => {
    render(<MathToolbar onInsert={() => {}} katexLoaded={false} />);
    expect(screen.getByText('Equation Tools')).toBeTruthy();
  });

  it('invokes onInsert for structure symbol', () => {
    const onInsert = vi.fn();
    render(<MathToolbar onInsert={onInsert} katexLoaded={false} />);
    const btn = screen.getByTitle('Superscript');
    fireEvent.mouseDown(btn); // component listens onMouseDown
    expect(onInsert).toHaveBeenCalledWith('^{}');
    expect(btn.getAttribute('title')).toBe('Superscript');
    expect(btn.className).toContain('w-10');
  });

  it('switches groups and inserts greek symbol', () => {
    const onInsert = vi.fn();
    render(<MathToolbar onInsert={onInsert} katexLoaded={false} />);
    const greekTab = screen.getByRole('button', { name: 'Greek' });
    fireEvent.click(greekTab);
    const alphaBtn = screen.getByTitle('\\alpha');
    fireEvent.mouseDown(alphaBtn);
    expect(onInsert).toHaveBeenCalledWith('\\alpha');
    expect(alphaBtn.getAttribute('title')).toBe('\\alpha');
    expect(alphaBtn.className).toContain('w-8');
  });

  it('prevents default mouse down on group tabs', () => {
    render(<MathToolbar onInsert={() => {}} katexLoaded={false} />);
    const greekTab = screen.getByRole('button', { name: 'Greek' });
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    greekTab.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('uses wider spacing and matrix button padding in multidim group', () => {
    const onInsert = vi.fn();
    const { container } = render(<MathToolbar onInsert={onInsert} katexLoaded={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Multi dimension' }));

    // gap-2 applies only for multidim
    const symbolRow = container.querySelector('div.flex.flex-wrap');
    expect(symbolRow.className).toContain('gap-2');

    const vectorBtn = screen.getByTitle('Vector');
    fireEvent.mouseDown(vectorBtn);
    expect(onInsert).toHaveBeenCalledWith('\\vec{}');
    expect(vectorBtn.className).toContain('px-3');
  });

  it('renders KaTeX previews when available', () => {
    const onInsert = vi.fn();
    // @ts-ignore
    window.katex = { renderToString: vi.fn(() => '<span data-katex="1">K</span>') };

    const { container } = render(<MathToolbar onInsert={onInsert} katexLoaded={true} />);
    expect(window.katex.renderToString).toHaveBeenCalled();
    expect(container.innerHTML).toContain('data-katex="1"');
  });

  it('falls back to label when KaTeX not loaded', () => {
    const onInsert = vi.fn();
    // @ts-ignore
    delete window.katex;
    render(<MathToolbar onInsert={onInsert} katexLoaded={true} />);
    const btn = screen.getByTitle('Superscript');
    expect(btn.querySelector('span.font-sans.text-xs')).not.toBeNull();
  });
});
