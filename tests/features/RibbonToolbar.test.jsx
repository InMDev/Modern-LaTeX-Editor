import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import RibbonToolbar from '../../src/features/Toolbar/RibbonToolbar.jsx';
import { FEATURE_FLAGS } from '../../src/constants/flags';

const baseFlags = Object.fromEntries(Object.keys(FEATURE_FLAGS).map((k) => [k, false]));

describe('RibbonToolbar', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('does not render when topbar disabled', () => {
    const { container } = render(
      <RibbonToolbar ff={baseFlags} enableVisualTopbar={false} isMathActive={false} katexLoaded={false} actions={{}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders font controls and calls actions for size/family', () => {
    const applyFontSizePx = vi.fn();
    const applyFontFamily = vi.fn();
    render(
      <RibbonToolbar
        ff={baseFlags}
        enableVisualTopbar={true}
        isMathActive={false}
        katexLoaded={false}
        actions={{ applyFontSizePx, applyFontFamily, execCmd: vi.fn() }}
      />
    );

    const familySelect = screen.getByRole('combobox', { name: /family/i });
    fireEvent.change(familySelect, { target: { value: 'sans' } });
    expect(applyFontFamily).toHaveBeenCalledWith('sans-serif');

    const sizeInput = screen.getByRole('spinbutton', { name: /font size/i });
    fireEvent.change(sizeInput, { target: { value: '18' } });
    fireEvent.blur(sizeInput);
    expect(applyFontSizePx).toHaveBeenCalledWith(18);

    fireEvent.click(screen.getByTitle('Increase font size (1px)'));
    expect(applyFontSizePx).toHaveBeenCalledWith(19);
  });

  it('wires heading menu selection to execCmd(formatBlock)', () => {
    const ff = { ...baseFlags, showHeading1: true };
    const execCmd = vi.fn();
    render(
      <RibbonToolbar ff={ff} enableVisualTopbar={true} isMathActive={false} katexLoaded={false} actions={{ execCmd }} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Heading Styles' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Heading 1/i }));
    expect(execCmd).toHaveBeenCalledWith('formatBlock', 'H1');
  });

  it('shows equation palette and inserts a symbol', async () => {
    const onInsertMathSymbol = vi.fn();
    render(
      <RibbonToolbar
        ff={baseFlags}
        enableVisualTopbar={true}
        isMathActive={true}
        katexLoaded={false}
        onInsertMathSymbol={onInsertMathSymbol}
        actions={{ execCmd: vi.fn() }}
      />
    );

    expect(await screen.findByText('Equation Tools')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: /group/i }), { target: { value: 'greek' } });
    fireEvent.click(screen.getByTitle('\\alpha'));
    expect(onInsertMathSymbol).toHaveBeenCalledWith('\\alpha');
  });
});
