import { describe, expect, it } from 'vitest';

import { boardTabOf } from '../src/rules/board-tab.js';

describe('boardTabOf', () => {
  it.each([
    ['stories', 'discovery'],
    ['plans', 'planning'],
    ['board', 'planning'],
    ['agents', 'delivery'],
  ])('redirects the legacy value %s to %s', (param, tab) => {
    expect(boardTabOf(param)).toEqual({ tab, redirect: tab });
  });

  it.each(['discovery', 'planning', 'delivery'])('opens the current value %s without a redirect', (param) => {
    expect(boardTabOf(param)).toEqual({ tab: param, redirect: null });
  });

  it('answers planning with no redirect for an absent value', () => {
    expect(boardTabOf(null)).toEqual({ tab: 'planning', redirect: null });
  });

  it('answers planning with no redirect for an unknown value', () => {
    expect(boardTabOf('nonsense')).toEqual({ tab: 'planning', redirect: null });
    expect(boardTabOf('constructor')).toEqual({ tab: 'planning', redirect: null });
  });
});
