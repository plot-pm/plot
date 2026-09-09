import { describe, it, expect } from 'vitest';
import {
  adoptionReadingsFrom,
  answersFrom,
  decide,
  requestFrom,
  run,
} from '../../src/server/entry/adopt.js';
import { isAdoptionRefusal } from '@plot-pm/domain/rules/adoption';

/**
 * THE ENTRY IS AN ADAPTER AND THESE TEST THE ADAPTATION.
 *
 * `composeAdoption`'s own refusals are asserted in the domain, once. What can
 * only fail here is the translation: a probe's `hub_docs` is one
 * comma-separated string and the rule takes a list, `has_plot_config` arrives as
 * a JSON boolean from one collector and a string from a shell that quoted it,
 * and an answers object written by a person may be missing any field.
 *
 * EVERY ABSENT FIELD IS READ AS *NOTHING WAS FOUND* AND NEVER AS A DEFAULT.
 * That direction is the whole safety property of the one command that writes
 * into a repository Plot does not own: a field this adapter invented would make
 * a repository look answered when nobody answered it.
 */

/** A probe report shaped as `plot-detect-repo.sh` prints one. */
const REPORT = {
  git_host: 'github',
  default_branch: 'main',
  dod_candidates: ['test', 'lint'],
  ticket_prefix: 'ACME',
  ticket_prefix_count: 38,
  subjects_read: 80,
  commit_style_counts: { colon: 0, dash: 0, conventional: 44 },
  existing_systems: '',
  hub_docs: 'CLAUDE.md',
  has_plot_config: false,
  has_settings: false,
  german_words: 0,
};

const request = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    report: REPORT,
    answers: { definitionOfDone: ['test', 'lint'] },
    unattended: false,
    ...over,
  });

describe('adoptionReadingsFrom', () => {
  it('splits the probe’s comma-separated hub docs into a list', () => {
    expect(adoptionReadingsFrom({ hub_docs: 'CLAUDE.md,AGENTS.md' }).hubDocs)
      .toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(adoptionReadingsFrom({ hub_docs: 'CLAUDE.md, AGENTS.md' }).hubDocs)
      .toEqual(['CLAUDE.md', 'AGENTS.md']);
  });

  it('takes a list where a collector already sent one', () => {
    expect(adoptionReadingsFrom({ hub_docs: ['AGENTS.md', 7] }).hubDocs).toEqual(['AGENTS.md']);
  });

  it('reads no hub docs as none, and never as one named “”', () => {
    expect(adoptionReadingsFrom({}).hubDocs).toEqual([]);
    expect(adoptionReadingsFrom({ hub_docs: '' }).hubDocs).toEqual([]);
  });

  it('reads `has_plot_config` in both spellings a collector may print', () => {
    expect(adoptionReadingsFrom({ has_plot_config: true }).hasPlotConfig).toBe(true);
    expect(adoptionReadingsFrom({ has_plot_config: 'true' }).hasPlotConfig).toBe(true);
    expect(adoptionReadingsFrom({ has_plot_config: false }).hasPlotConfig).toBe(false);
    // ABSENT IS FALSE, and that is the safe direction here: it lets adoption
    // proceed to the rule, which then decides on every other reading. Reading an
    // absent field as `true` would refuse a virgin repository as adopted.
    expect(adoptionReadingsFrom({}).hasPlotConfig).toBe(false);
  });

  it('reads an absent `ci_system` as unread rather than as `none`', () => {
    // MEASURED 2026-09-09: `plot-detect-repo.sh` on main prints no `ci_system`
    // at all — PR #811 for `the-probe-reads-the-ci-system` merged carrying zero
    // files. So this is the live case, not a hypothetical, and the two readings
    // reach different gaps in the rule.
    expect(adoptionReadingsFrom({}).ciSystem).toBe('');
    expect(adoptionReadingsFrom({ ci_system: 'none' }).ciSystem).toBe('none');
  });
});

describe('answersFrom', () => {
  it('reads every absent field as not answered', () => {
    expect(answersFrom({})).toEqual({
      hub: '',
      definitionOfDone: [],
      tracker: '',
      trackerUrl: '',
      ci: '',
      worktreeRoot: '',
    });
  });

  it('survives a request whose `answers` is not an object', () => {
    expect(answersFrom(null).definitionOfDone).toEqual([]);
    expect(answersFrom('yes').definitionOfDone).toEqual([]);
  });

  it('drops a Definition of Done entry that is not a gate name', () => {
    expect(answersFrom({ definitionOfDone: ['test', 3, null] }).definitionOfDone)
      .toEqual(['test']);
  });
});

describe('requestFrom', () => {
  it('refuses a request carrying no probe report', () => {
    expect(() => requestFrom('{"answers":{}}')).toThrow(/'report' object/);
    expect(() => requestFrom('{"report":[]}')).toThrow(/'report' object/);
  });

  it('refuses stdin that is not one JSON object', () => {
    expect(() => requestFrom('[]')).toThrow(/one JSON object/);
    expect(() => requestFrom('"a"')).toThrow(/one JSON object/);
  });

  it('takes a proposal the caller already has, rather than recomputing it', () => {
    const proposal = {
      node: { major: 24, floor: 24, supported: true },
      commitStyle: { style: 'arlo-dash' as const, matched: 9, outOf: 9 },
      ticket: { prefix: null, matched: 0, outOf: 9 },
      language: { language: null, germanWords: 0 },
    };
    const parsed = requestFrom(request({ proposal }));
    expect(parsed.proposal).toEqual(proposal);
    const decided = decide(parsed);
    if (isAdoptionRefusal(decided)) throw new Error(decided.detail);
    // The report says `conventional: 44`; the supplied proposal says
    // `arlo-dash`. The supplied one wins, which is what proves it was not
    // recomputed.
    expect(decided.keys.find((k) => k.key === 'Commit style')?.value).toBe('arlo-dash');
  });

  it('recomputes the proposal from the report where the caller sent none', () => {
    const decided = decide(requestFrom(request()));
    if (isAdoptionRefusal(decided)) throw new Error(decided.detail);
    expect(decided.keys.find((k) => k.key === 'Commit style')?.value).toBe('conventional');
  });

  it('reads `unattended` only from an explicit `true`', () => {
    expect(requestFrom(request({ unattended: 'yes' })).unattended).toBe(false);
    expect(requestFrom(request({ unattended: true })).unattended).toBe(true);
  });
});

describe('run', () => {
  it('prints the decision and exits 0', () => {
    let out = '';
    expect(run(request(), (s) => (out += s))).toBe(0);
    const decided = JSON.parse(out);
    expect(decided.outcome).toBe('decided');
    expect(decided.hub).toBe('CLAUDE.md');
    expect(decided.ignoreLine).toBe('.worktrees/');
  });

  it('prints a refusal as JSON too, and exits 1', () => {
    // THE REFUSAL'S JSON IS THE ANSWER, not only the stderr sentence: `unasked`
    // is what an unattended run turns into its `PLOT-UNASKED` lines, and a
    // caller scraping that list out of prose would be re-deriving what the rule
    // already answered.
    let out = '';
    const code = run(
      JSON.stringify({ report: { ...REPORT, has_plot_config: true }, answers: {} }),
      (s) => (out += s),
    );
    expect(code).toBe(1);
    const refused = JSON.parse(out);
    expect(refused.outcome).toBe('refused');
    expect(refused.reason).toBe('already-adopted');
    expect(refused.detail).toContain('CLAUDE.md');
  });

  it('exits 2 on input no operator can act on, and writes nothing', () => {
    let out = '';
    expect(run('not json', (s) => (out += s))).toBe(2);
    expect(out).toBe('');
  });

  it('names the missing answer as PLOT-UNASKED where no person is present', () => {
    let out = '';
    const code = run(
      JSON.stringify({ report: REPORT, answers: {}, unattended: true }),
      (s) => (out += s),
    );
    expect(code).toBe(1);
    const refused = JSON.parse(out);
    expect(refused.detail).toMatch(/^PLOT-UNASKED:/);
    expect(refused.unasked).toEqual(['Which gates make the Definition of Done?']);
  });
});
