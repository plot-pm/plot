// Whether a plan link's click opens the modal, waits for the board, or
// navigates — decided over values, no browser involved.
import { describe, it, expect } from 'vitest';
import { planLinkClick } from '../src/rules/plan-link-click.js';

describe('planLinkClick', () => {
  it('opens when the board is loaded and holds a matching card', () => {
    expect(planLinkClick(true, true)).toBe('open');
  });

  it('navigates when the board is loaded and holds no matching card', () => {
    expect(planLinkClick(true, false)).toBe('navigate');
  });

  it('waits when the board has not loaded, regardless of card presence', () => {
    expect(planLinkClick(false, false)).toBe('wait');
  });

  it('opens even before the board has loaded if a card is already found', () => {
    expect(planLinkClick(false, true)).toBe('open');
  });
});
