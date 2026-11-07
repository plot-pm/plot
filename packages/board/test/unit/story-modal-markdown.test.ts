import { describe, expect, it } from 'vitest';
import { linkableHref, renderMarkdown } from '../../src/app/components/StoryModal.js';

describe("StoryModal's markdown links", () => {
  it('links an http(s) URL', () => {
    expect(renderMarkdown('[docs](https://example.com/a)')).toContain('<a href="https://example.com/a"');
  });

  it('rewrites a plan link to its board route', () => {
    expect(renderMarkdown('[plan](../../plans/2026-11-06-one-card-grammar.md)')).toContain('href="/plan/one-card-grammar.md"');
  });

  it('refuses a javascript: link and renders its text', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click');
  });

  it('refuses a scheme hidden behind case, whitespace or a control character', () => {
    for (const href of ['JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      expect(linkableHref(href), href).toBe(false);
    }
  });

  it('admits a target with no scheme', () => {
    expect(linkableHref('/story/a')).toBe(true);
    expect(linkableHref('DESIGN-a.md')).toBe(true);
  });

  it('escapes a double quote, so no target leaves its attribute', () => {
    const html = renderMarkdown('[x](https://e.com/" onmouseover="alert(1))');
    expect(html).not.toContain('" onmouseover="');
    expect(html).toContain('&quot;');
  });
});
