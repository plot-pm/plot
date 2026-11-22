import { describe, expect, it } from 'vitest';

import { liveOnMerge, pulseOmitsPlan } from '../src/rules/pulse-omits-plan.js';

const TYPES = ['docs', 'infra', 'feature', 'bug', 'Docs', ''];

describe('pulseOmitsPlan', () => {
  it.each(['released', 'superseded', 'rejected'])('omits a %s plan of every type', (phase) => {
    for (const type of TYPES) expect(pulseOmitsPlan(phase, type)).toBe(true);
  });

  it.each(['docs', 'infra'])('omits a delivered %s plan', (type) => {
    expect(pulseOmitsPlan('delivered', type)).toBe(true);
  });

  it.each(['feature', 'bug', 'Docs', ''])('keeps a delivered plan of type %j', (type) => {
    expect(pulseOmitsPlan('delivered', type)).toBe(false);
  });

  it('keeps an approved docs plan', () => {
    expect(pulseOmitsPlan('approved', 'docs')).toBe(false);
  });
});

describe('liveOnMerge', () => {
  it.each(['docs', 'infra'])('answers true for %s', (type) => {
    expect(liveOnMerge(type)).toBe(true);
  });

  it.each(['feature', 'bug', 'Docs', 'Infra', ''])('answers false for %j', (type) => {
    expect(liveOnMerge(type)).toBe(false);
  });
});
