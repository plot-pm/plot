import { describe, it, expect } from 'vitest';
import {
  CHARTER_DIRECTORY,
  CHARTER_ENV_VAR,
  CharterSchema,
  FALLBACK_PROMPT,
  RUN_FACTS,
  charterPath,
  charterRefusesRunFacts,
  readCharter,
  resolvePrompt,
  runFactsIn,
} from '../src/index.js';

/**
 * The record that declares an agent, and the one property that keeps it from
 * becoming a second manifest.
 *
 * Measured 2026-09-03: every field of `AgentEntry` (`registry.ts:105`)
 * describes a RUN — `session`, `resumeId`, `attempts`, `branch`, `worktree`,
 * `command`, `startedAt`, `pid`, `previousPid`, `relaunches`, `state` — and
 * none describes an agent. A charter carrying any of them would duplicate the
 * manifest, which is the defect this removes rather than repeats.
 */

/** A charter as JSON, with any field overridden — including an invalid one. */
const charter = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: 'reviewer',
    prompt: '.plot/prompts/reviewer.sh',
    harness: 'claude',
    model: 'opus',
    effort: 'high',
    capabilities: ['review', 'typescript'],
    bounds: { contextCeiling: 0.8, atCeiling: 'finish' },
    ...over,
  });

describe('a charter carries no run fact', () => {
  it.each(RUN_FACTS)('refuses a document carrying %s', (field) => {
    const reading = readCharter('reviewer', charter({ [field]: 'anything' }));

    expect(reading.read).toBe('unreadable');
    if (reading.read !== 'unreadable') throw new Error('unreachable');
    expect(reading.why).toContain(field);
  });

  it('names every run fact it found, not just the first', () => {
    expect(runFactsIn({ name: 'r', pid: '1', branch: 'x', worktree: '/tmp' })).toEqual([
      'branch',
      'worktree',
      'pid',
    ]);
  });

  it('accepts a document that carries none', () => {
    expect(charterRefusesRunFacts(JSON.parse(charter()))).toBe(true);
  });

  it('refuses rather than strips, so no agent runs under a charter it ignores', () => {
    // Stripping would parse — every run fact is an unknown key to the schema —
    // and the launch would succeed under a document saying something the agent
    // never reads. The refusal is what makes that silence impossible.
    const reading = readCharter('reviewer', charter({ branch: 'feature/x' }));
    expect(reading.read).not.toBe('declared');
  });

  it('asks the document, not the parsed charter', () => {
    // By the time a Charter exists the run facts are gone, so the useful
    // question is what was on disk.
    expect(runFactsIn({ name: 'r', prompt: 'p' })).toEqual([]);
    expect(runFactsIn('not an object')).toEqual([]);
    expect(runFactsIn(null)).toEqual([]);
    expect(runFactsIn(['pid'])).toEqual([]);
  });
});

describe('the charter parses', () => {
  it('reads what a person declared', () => {
    const reading = readCharter('reviewer', charter());

    expect(reading).toEqual({
      read: 'declared',
      charter: {
        name: 'reviewer',
        prompt: '.plot/prompts/reviewer.sh',
        harness: 'claude',
        model: 'opus',
        effort: 'high',
        capabilities: ['review', 'typescript'],
        bounds: { contextCeiling: 0.8, contextWindow: 0, atCeiling: 'finish' },
      },
    });
  });

  it('defaults everything but the name and the prompt', () => {
    const parsed = CharterSchema.parse({ name: 'r', prompt: 'p' });

    expect(parsed).toEqual({
      name: 'r',
      prompt: 'p',
      harness: '',
      model: '',
      effort: '',
      capabilities: [],
      bounds: { contextCeiling: 1, contextWindow: 0, atCeiling: 'finish' },
    });
  });

  it('refuses a charter that names no agent', () => {
    expect(readCharter('reviewer', charter({ name: '' })).read).toBe('unreadable');
  });

  it('refuses a charter that names no prompt', () => {
    expect(readCharter('reviewer', charter({ prompt: '' })).read).toBe('unreadable');
  });

  it('refuses an unknown key, because a charter is a person typing', () => {
    expect(readCharter('reviewer', charter({ modle: 'opus' })).read).toBe('unreadable');
  });

  it('refuses a context ceiling outside 0–1', () => {
    expect(readCharter('r', charter({ bounds: { contextCeiling: 80 } })).read).toBe('unreadable');
    expect(readCharter('r', charter({ bounds: { contextCeiling: 0 } })).read).toBe('unreadable');
  });

  it('reads bytes that are not JSON as unreadable, never as absent', () => {
    const reading = readCharter('reviewer', 'not json {');

    expect(reading).toEqual({ read: 'unreadable', name: 'reviewer', why: 'not JSON' });
  });

  it('separates absent from unreadable', () => {
    expect(readCharter('reviewer', null)).toEqual({ read: 'absent', name: 'reviewer' });
  });

  it('reads an unasked charter as unnamed, which is a third absence', () => {
    expect(readCharter('', null)).toEqual({ read: 'unnamed' });
    expect(readCharter('', charter())).toEqual({ read: 'unnamed' });
  });
});

describe('the charter lives beside the manifests, not among them', () => {
  it('is committed, so it sits outside the gitignored .plot/agents/', () => {
    expect(CHARTER_DIRECTORY).toBe('.plot/charters');
    expect(CHARTER_DIRECTORY.startsWith('.plot/agents')).toBe(false);
  });

  it('is named for the agent', () => {
    expect(charterPath('reviewer')).toBe('.plot/charters/reviewer.json');
  });

  it('is asked for by name through one environment variable', () => {
    expect(CHARTER_ENV_VAR).toBe('PLOT_AGENT');
  });
});

describe('the prompt resolves through the declaration', () => {
  it('runs the prompt the charter names', () => {
    const reading = readCharter('reviewer', charter());

    expect(resolvePrompt(reading)).toEqual({
      resolve: 'declared',
      prompt: '.plot/prompts/reviewer.sh',
      charter: 'reviewer',
    });
  });

  it('keeps the repo prompt when no agent is named — the estate today', () => {
    // Zero declarations exist, so this is the path every existing worker takes.
    const resolution = resolvePrompt(readCharter('', null));

    expect(resolution.resolve).toBe('fallback');
    if (resolution.resolve !== 'fallback') throw new Error('unreachable');
    expect(resolution.prompt).toBe('.plot/worker-prompt.sh');
    expect(FALLBACK_PROMPT).toBe('.plot/worker-prompt.sh');
  });

  it('keeps the repo prompt when the named charter is not on this clone', () => {
    const resolution = resolvePrompt(readCharter('reviewer', null));

    expect(resolution.resolve).toBe('fallback');
    if (resolution.resolve !== 'fallback') throw new Error('unreachable');
    expect(resolution.prompt).toBe(FALLBACK_PROMPT);
    expect(resolution.why).toContain('reviewer');
  });

  it('refuses rather than falls back when a charter cannot be believed', () => {
    // The fallback would RUN, successfully, under a prompt nobody asked for.
    const resolution = resolvePrompt(readCharter('reviewer', 'not json {'));

    expect(resolution.resolve).toBe('refused');
    if (resolution.resolve !== 'refused') throw new Error('unreachable');
    expect(resolution.why).toContain('reviewer');
  });

  it('refuses a charter carrying a run fact, rather than running the fallback', () => {
    expect(resolvePrompt(readCharter('reviewer', charter({ pid: '4242' }))).resolve).toBe('refused');
  });
});
