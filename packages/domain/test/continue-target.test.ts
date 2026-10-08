import { describe, expect, it } from 'vitest';

import { continueTarget, type ContinueTargetReading } from '../src/rules/continue-target.js';
import type { DeskManifest } from '../src/rules/desk-manifest.js';
import type { DeskLoop } from '../src/rules/desk-loop-alive.js';
import type { EndingReading } from '../src/entities/ending.js';

const NO_LOOP: DeskLoop = { kind: 'none' };
const LOOP_ALIVE: DeskLoop = { kind: 'alive', pid: '111', source: '.plot-worker.pid' };
const UNNAMED: DeskManifest = { kind: 'unnamed' };
const NAMED: DeskManifest = { kind: 'named', path: '/repo/.plot/agents/abc.json' };
const SEVERAL: DeskManifest = { kind: 'several', paths: ['/repo/.plot/agents/abc.json', '/repo/.plot/agents/def.json'] };
const ABSENT: EndingReading = { read: 'absent' };
const UNREADABLE: EndingReading = { read: 'unreadable', why: 'not JSON' };

const blocked = (branch: string): EndingReading => ({
  read: 'ended',
  ending: { reason: 'blocked', actor: 'agent', branch, detail: '' },
});

const reading = (overrides: Partial<ContinueTargetReading>): ContinueTargetReading => ({
  branch: 'feature/x',
  manifest: UNNAMED,
  ending: ABSENT,
  question: true,
  loop: NO_LOOP,
  ...overrides,
});

describe('continueTarget', () => {
  it('continues by stamping the manifest that already names the desk', () => {
    const r = reading({ manifest: NAMED });
    expect(continueTarget(r)).toEqual({ kind: 'continue', manifest: 'stamp', path: NAMED.path });
  });

  it('continues by writing a manifest when unnamed but the ending reads blocked for this branch, marker present', () => {
    const r = reading({ manifest: UNNAMED, ending: blocked('feature/x'), question: true });
    expect(continueTarget(r)).toEqual({ kind: 'continue', manifest: 'write' });
  });

  it('refuses no-question when no marker sits in the tree, even with a named manifest', () => {
    const r = reading({ manifest: NAMED, question: false });
    expect(continueTarget(r)).toEqual({ kind: 'refused', reason: 'no-question' });
  });

  it('refuses no-question when the ending reads blocked for this branch but no marker is in the tree', () => {
    const r = reading({ manifest: UNNAMED, ending: blocked('feature/x'), question: false });
    expect(continueTarget(r)).toEqual({ kind: 'refused', reason: 'no-question' });
  });

  it('refuses no-manifest when unnamed and there is no usable ending', () => {
    const r = reading({ manifest: UNNAMED, ending: ABSENT });
    expect(continueTarget(r)).toEqual({ kind: 'refused', reason: 'no-manifest' });
  });

  it('refuses several even when the ending reads blocked for this branch', () => {
    const r = reading({ manifest: SEVERAL, ending: blocked('feature/x') });
    expect(continueTarget(r)).toEqual({ kind: 'refused', reason: 'several' });
  });

  it('refuses loop-alive even when a manifest names the desk', () => {
    const r = reading({ manifest: NAMED, loop: LOOP_ALIVE });
    expect(continueTarget(r)).toEqual({ kind: 'refused', reason: 'loop-alive' });
  });

  it('refuses loop-alive even when the ending would otherwise route a write', () => {
    const r = reading({ manifest: UNNAMED, ending: blocked('feature/x'), loop: LOOP_ALIVE });
    expect(continueTarget(r)).toEqual({ kind: 'refused', reason: 'loop-alive' });
  });

  it('refuses no-manifest when the ending reads blocked for a different branch — wrong-branch ending refused', () => {
    const r = reading({ manifest: UNNAMED, ending: blocked('bug/other-branch') });
    expect(continueTarget(r)).toEqual({ kind: 'refused', reason: 'no-manifest' });
  });

  it('refuses no-manifest when the ending reads a reason other than blocked', () => {
    const r = reading({
      manifest: UNNAMED,
      ending: { read: 'ended', ending: { reason: 'quiet', actor: 'monitor', branch: 'feature/x', detail: '' } },
    });
    expect(continueTarget(r)).toEqual({ kind: 'refused', reason: 'no-manifest' });
  });

  it('refuses no-manifest when the ending is absent — absent is not a fallback', () => {
    const r = reading({ manifest: UNNAMED, ending: ABSENT });
    expect(continueTarget(r)).toEqual({ kind: 'refused', reason: 'no-manifest' });
  });

  it('refuses no-manifest when the ending is unreadable — unreadable is a refusal, not a guess', () => {
    const r = reading({ manifest: UNNAMED, ending: UNREADABLE });
    expect(continueTarget(r)).toEqual({ kind: 'refused', reason: 'no-manifest' });
  });
});
