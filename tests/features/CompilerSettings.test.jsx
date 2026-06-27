import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import LiveLatexEditor from '../../src/App.jsx';

// Mock getSelection
global.window.getSelection = () => ({
  removeAllRanges: vi.fn(),
  addRange: vi.fn(),
  toString: () => '',
});

// Mock document.execCommand
global.document.execCommand = vi.fn();

// Mock fetch
global.fetch = vi.fn();

describe('CompilerSettings Integration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
  });

  it('renders settings option in File dropdown and opens settings modal', async () => {
    render(<LiveLatexEditor />);
    
    // Open File Dropdown
    const fileMenuButton = screen.getByRole('button', { name: /file/i });
    fireEvent.click(fileMenuButton);

    // Click Settings option
    const settingsOption = screen.getByRole('menuitem', { name: /settings/i });
    fireEvent.click(settingsOption);

    // Expect settings modal to be open
    expect(screen.getByText('Compiler Settings')).toBeTruthy();
    expect(screen.getByText('Compilation Engine')).toBeTruthy();
  });

  it('allows changing compilation mode and saves to localStorage', async () => {
    render(<LiveLatexEditor />);
    
    // Open Settings Modal
    fireEvent.click(screen.getByRole('button', { name: /file/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /settings/i }));

    // Verify default state
    const remoteRadio = screen.getByLabelText(/Remote Server/i);
    const localRadio = screen.getByLabelText(/Local Compiler/i);
    expect(remoteRadio.checked).toBe(true);
    expect(localRadio.checked).toBe(false);

    // Select Local Compiler
    fireEvent.click(localRadio);
    expect(localRadio.checked).toBe(true);
    expect(remoteRadio.checked).toBe(false);

    // Verify localStorage updated
    expect(localStorage.getItem('texure.compilerMode')).toBe('local');

    // Verify helper URL input is rendered
    const urlInput = screen.getByPlaceholderText('http://localhost:5001');
    expect(urlInput).toBeTruthy();
    expect(urlInput.value).toBe('http://localhost:5001');

    // Change helper URL
    fireEvent.change(urlInput, { target: { value: 'http://localhost:8080' } });
    expect(localStorage.getItem('texure.localCompilerUrl')).toBe('http://localhost:8080');

    // Close Modal
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(screen.queryByText('Compiler Settings')).toBeNull();
  });

  it('routes compilation request to local compiler when selected', async () => {
    // Stub local compiler mode in localStorage initially
    localStorage.setItem('texure.compilerMode', 'local');
    localStorage.setItem('texure.localCompilerUrl', 'http://localhost:9999');

    // Mock successful compiler compile response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'success', result: 'AQID', log: 'Compiled successfully.' }),
      text: async () => JSON.stringify({ status: 'success', result: 'AQID', log: 'Compiled successfully.' })
    });

    render(<LiveLatexEditor />);

    // Click Export PDF, which triggers export PDF compilation
    const fileMenuButton = screen.getByRole('button', { name: /file/i });
    fireEvent.click(fileMenuButton);
    const exportOption = screen.getByRole('menuitem', { name: /export pdf/i });
    
    // Create element mock downloads
    const createURLMock = vi.fn(() => 'blob:mock-pdf');
    global.URL.createObjectURL = createURLMock;
    global.URL.revokeObjectURL = vi.fn();

    fireEvent.click(exportOption);

    await waitFor(() => {
      // Should query the configured local compiler URL
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:9999/compile'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' })
        })
      );
    });
  });

  it('displays instructions when local compiler connection fails', async () => {
    localStorage.setItem('texure.compilerMode', 'local');
    localStorage.setItem('texure.localCompilerUrl', 'http://localhost:5001');

    // Mock connection failure (offline)
    global.fetch.mockRejectedValueOnce(new Error('Connection refused'));

    render(<LiveLatexEditor />);

    // Trigger export to check error modal message contents
    const fileMenuButton = screen.getByRole('button', { name: /file/i });
    fireEvent.click(fileMenuButton);
    const exportOption = screen.getByRole('menuitem', { name: /export pdf/i });
    fireEvent.click(exportOption);

    await waitFor(() => {
      expect(screen.getByText('LaTeX Compiler Log')).toBeTruthy();
      expect(screen.getByText(/node scripts\/local-compiler.js/i)).toBeTruthy();
      expect(screen.getByText(/Failed to contact local compiler/i)).toBeTruthy();
    });
  });
});
