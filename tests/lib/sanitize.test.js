import { describe, it, expect } from 'vitest';
import { sanitizeEditorHtml, maybeSanitizeEditorHtml } from '../../src/lib/sanitize';

describe('sanitizeEditorHtml', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeEditorHtml('')).toBe('');
    expect(sanitizeEditorHtml(null)).toBe('');
  });

  it('removes scripts and event handlers', () => {
    const dirty = `<p>Hello</p><script>alert(1)</script><img src="/x" onerror="alert(1)" />`;
    const clean = sanitizeEditorHtml(dirty);
    expect(clean).toContain('<p>Hello</p>');
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onerror\s*=/i);
  });

  it('strips javascript: hrefs and forces safe rel for _blank', () => {
    const dirty = `<a href="javascript:alert(1)" target="_blank">x</a><a href="https://example.com" target="_blank">ok</a>`;
    const clean = sanitizeEditorHtml(dirty);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).toMatch(/href="https:\/\/example\.com"/);
    expect(clean).toMatch(/rel="noopener noreferrer"/);
  });

  it('unwraps unknown tags but removes dangerous ones', () => {
    const dirty = `<foo><b>ok</b></foo><iframe src="https://example.com"></iframe><style>body{}</style>`;
    const clean = sanitizeEditorHtml(dirty);
    expect(clean).toContain('<b>ok</b>');
    expect(clean).not.toMatch(/<foo/i);
    expect(clean).not.toMatch(/<iframe/i);
    expect(clean).not.toMatch(/<style/i);
  });

  it('sanitizes styles and attributes', () => {
    const dirty = `<p id="x" style="color: #abc; position: fixed; background-image:url(javascript:1); font-size: 13px; background-color: <bad>;" contenteditable="true">t</p>`;
    const clean = sanitizeEditorHtml(dirty);
    expect(clean).not.toMatch(/id="x"/);
    expect(clean).toMatch(/contenteditable="false"/);
    expect(clean).toMatch(/color:\s*#abc/i);
    expect(clean).toMatch(/font-size:\s*13px/i);
    expect(clean).not.toMatch(/position:/i);
    expect(clean).not.toMatch(/url\s*\(/i);
    expect(clean).not.toMatch(/<bad>/i);
  });

  it('removes style attribute when nothing is allowed', () => {
    const dirty = `<p style="position: fixed;">x</p>`;
    const clean = sanitizeEditorHtml(dirty);
    expect(clean).toContain('<p>x</p>');
    expect(clean).not.toMatch(/style=/i);
  });

  it('removes empty styles and strips suspicious values from allowed properties', () => {
    const dirty = `<p style="">a</p><span style="max-width:url(javascript:1); color: expression(alert(1));">b</span>`;
    const clean = sanitizeEditorHtml(dirty);
    expect(clean).toContain('<p>a</p>');
    expect(clean).not.toMatch(/style=""/i);
    expect(clean).not.toMatch(/url\s*\(/i);
    expect(clean).not.toMatch(/expression\s*\(/i);
  });

  it('preserves explicit contenteditable="false"', () => {
    const dirty = `<p contenteditable="false">x</p>`;
    const clean = sanitizeEditorHtml(dirty);
    expect(clean).toMatch(/contenteditable="false"/);
  });

  it('filters link and image URLs and normalizes target/rel', () => {
    const dirty = [
      `<a href="data:text/html;base64,AAAA" target="_self" rel="x">bad</a>`,
      `<a href="/ok" target="_blank" rel="x">ok</a>`,
      `<img src="data:text/html;base64,AAAA" alt="x" />`,
      `<img src="data:image/png;base64,iVBORw0KGgo=" alt="ok" />`,
    ].join('');
    const clean = sanitizeEditorHtml(dirty);
    expect(clean).not.toMatch(/data:text\/html/i);
    expect(clean).toMatch(/href="\/ok"/);
    expect(clean).toMatch(/target="_blank"/);
    expect(clean).toMatch(/rel="noopener noreferrer"/);
    expect(clean).toMatch(/data:image\/png/i);
  });

  it('preserves KaTeX layout-critical inline styles', () => {
    const dirty = [
      `<span class="katex">`,
      `  <span class="strut" style="height:0.9475em;vertical-align:-0.2831em;"></span>`,
      `  <span style="top:-2.4169em;margin-left:0em;margin-right:0.05em; background-image:url(javascript:1);"></span>`,
      `  <span class="frac-line" style="border-bottom-width:0.04em;border-style:solid;border-width:0.04em;"></span>`,
      `</span>`,
    ].join('');
    const clean = sanitizeEditorHtml(dirty);
    expect(clean).toMatch(/height:\s*0\.9475em/i);
    expect(clean).toMatch(/vertical-align:\s*-0\.2831em/i);
    expect(clean).toMatch(/top:\s*-2\.4169em/i);
    expect(clean).toMatch(/margin-left:\s*0em/i);
    expect(clean).toMatch(/margin-right:\s*0\.05em/i);
    expect(clean).toMatch(/border-bottom-width:\s*0\.04em/i);
    expect(clean).toMatch(/border-style:\s*solid/i);
    expect(clean).toMatch(/border-width:\s*0\.04em/i);
    expect(clean).not.toMatch(/background-image/i);
    expect(clean).not.toMatch(/url\s*\(/i);
  });
});

describe('maybeSanitizeEditorHtml', () => {
  it('returns empty string for empty input', () => {
    expect(maybeSanitizeEditorHtml('')).toBe('');
  });

  it('returns input when not suspicious', () => {
    const html = '<p>safe</p>';
    expect(maybeSanitizeEditorHtml(html)).toBe(html);
  });

  it('sanitizes when suspicious patterns exist', () => {
    const html = '<p onclick="alert(1)">x</p>';
    const out = maybeSanitizeEditorHtml(html);
    expect(out).not.toMatch(/onclick/i);
  });
});
