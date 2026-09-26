import { describe, it, expect } from 'vitest';
import { readingsFrom } from '../../src/server/entry/stack-readings.js';
import { proposeCi, proposeDefaultBranch } from '@plot-pm/domain/rules/stack';

/**
 * THE ENTRY IS AN ADAPTER AND THESE TEST THE ADAPTATION.
 *
 * `proposeCi`'s own answers are asserted in the domain, once. What can only
 * fail here is the translation: which signals a collector looks for, and what
 * an absent field means.
 */
describe('readingsFrom — the CI signals', () => {
  it('names the vendors the collector knows, so the rule need not', () => {
    // THE DOMAIN NAMES NO VENDOR, and CI gates exactly that. A third CI system
    // is one entry added here and no edit to `proposeCi`.
    const signals = readingsFrom({ ci_signals: { jenkinsfile: true, gh_workflows: false } })
      .ciSignals;
    expect(signals?.map((s) => s.proposes)).toEqual(['jenkins', 'github-actions']);
    expect(signals?.map((s) => s.present)).toEqual([true, false]);
  });

  it('reads an absent `ci_signals` as unread rather than as no evidence', () => {
    // MEASURED 2026-09-09: `plot-detect-repo.sh` on main prints no `ci_signals`
    // at all — PR #811 for `the-probe-reads-the-ci-system` merged carrying zero
    // files. So this is the live case, not a hypothetical, and the two readings
    // reach different gaps in the rule: *not read* against *no CI evidence*.
    expect(readingsFrom({}).ciSignals).toBeNull();

    const looked = readingsFrom({ ci_signals: { jenkinsfile: false, gh_workflows: false } })
      .ciSignals;
    expect(looked).not.toBeNull();
    expect(proposeCi(looked ?? []).answer).toBe('silent');
  });

  it('reads a `ci_signals` that is not an object as unread', () => {
    // A collector printing a bare word where an object was specified has not
    // reported signals, and inventing two absent ones on its behalf would be a
    // reading nobody took.
    expect(readingsFrom({ ci_signals: 'both' }).ciSignals).toBeNull();
    expect(readingsFrom({ ci_signals: [] }).ciSignals).toBeNull();
  });

  it('reads a missing signal within the object as absent', () => {
    const signals = readingsFrom({ ci_signals: { jenkinsfile: true } }).ciSignals;
    expect(signals?.find((s) => s.proposes === 'github-actions')?.present).toBe(false);
  });
});

describe('readingsFrom — wave 1\'s default-branch pair', () => {
  it('maps both readings and the `ok` status', () => {
    const r = readingsFrom({
      default_branch: 'main',
      host_default_branch: 'develop',
      host_default_branch_status: 'ok',
    });
    expect(r.localDefaultBranch).toBe('main');
    expect(r.hostDefaultBranch).toBe('develop');
    expect(r.hostDefaultBranchAsked).toBe(true);
  });

  it('maps a report with NO status field to *nobody asked*, never agreement', () => {
    // AN OLDER PROBE, and the case the brief singles out. Without the field both
    // branch readings are `''`, which compare equal — so a mapper defaulting the
    // status to true would report a verified match that was never measured.
    const r = readingsFrom({});
    expect(r.hostDefaultBranchAsked).toBe(false);
    expect(proposeDefaultBranch(r.localDefaultBranch, r.hostDefaultBranch, r.hostDefaultBranchAsked).state)
      .toBe('unverified');
  });

  it('maps `unknown` — and any other word — to *nobody asked*', () => {
    // The probe writes `unknown` for no git host, no adapter, a non-zero exit
    // and an empty answer alike. Only `ok` licenses reading the value beside it.
    for (const status of ['unknown', '', 'OK', 'true', 'yes']) {
      expect(readingsFrom({ host_default_branch_status: status }).hostDefaultBranchAsked)
        .toBe(false);
    }
  });

  it('keeps a host answer that is present but empty out of the comparison', () => {
    // `status: ok` with an empty value is the adapter answering nothing. The rule
    // reads it as unverified rather than as a branch named `''`.
    const r = readingsFrom({
      default_branch: 'main',
      host_default_branch: '',
      host_default_branch_status: 'ok',
    });
    expect(proposeDefaultBranch(r.localDefaultBranch, r.hostDefaultBranch, r.hostDefaultBranchAsked).state)
      .toBe('unverified');
  });

  it('reads a non-string branch field as unread rather than coercing it', () => {
    const r = readingsFrom({ default_branch: 7, host_default_branch: null });
    expect(r.localDefaultBranch).toBe('');
    expect(r.hostDefaultBranch).toBe('');
  });
});
