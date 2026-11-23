import { describe, expect, it } from 'vitest';
import type { ProbePrompt, WriteProbe } from '@plot-pm/domain/ports/write-probe';

import { promptsToProbe, run } from '../../src/server/entry/write-probe.js';

/** The fallback prompt alone, as `--start` probes it with no `PLOT_AGENT`. */
const FALLBACK: ProbePrompt[] = [{ file: '/repo/.plot/worker-prompt.sh', charter: null }];

/** A probe whose `check` answers as given and records what it was asked. */
const probeAnswering = (answer: unknown, asked: string[] = [], prompts: (readonly ProbePrompt[])[] = []): WriteProbe =>
  ({
    check: async (command: string, given: readonly ProbePrompt[]) => {
      asked.push(command);
      prompts.push(given);
      return answer;
    },
  }) as unknown as WriteProbe;

/** The prompt entry's `answer`, for a repo where `reviewer` declares `.plot/prompts/reviewer.sh`. */
const answering = (root: string, name: string): string =>
  name === '' ? 'fallback\t.plot/worker-prompt.sh\tno agent named\n' : `declared\t.plot/prompts/${name}.sh\t${name}\n`;

describe('plot-write-probe.mjs', () => {
  it('proceeds and asks with the configured command on an observed yes, printing nothing', async () => {
    const asked: string[] = [];
    let out = '';
    const code = await run(['claude -p'], probeAnswering({ ok: true, value: 'yes' }, asked), FALLBACK, (s) => {
      out += s;
    });
    expect(code).toBe(0);
    expect(asked).toEqual(['claude -p']);
    expect(out).toBe('');
  });

  it('refuses on an observed no, and prints the refusal text prefixed for its shell caller', async () => {
    let out = '';
    const code = await run(['claude -p'], probeAnswering({ ok: true, value: 'no' }), FALLBACK, (s) => {
      out += s;
    });
    expect(code).toBe(1);
    expect(out).toMatch(/^plot-fleetctl: /);
    expect(out).toMatch(/refused every write/);
  });

  it('proceeds on an unanswerable probe, never refuses it as a permission fault', async () => {
    // ABSENT IS NOT FALSE: an unaskable result must read as `proceed`, the same
    // as an observed `yes`.
    const code = await run(['claude -p'], probeAnswering({ ok: false, why: 'unaskable' }), FALLBACK, () => {});
    expect(code).toBe(0);
  });

  it('proceeds on a failed probe call the same way, since nothing was observed', async () => {
    const code = await run(['claude -p'], probeAnswering({ ok: false, why: 'failed' }), FALLBACK, () => {});
    expect(code).toBe(0);
  });

  it('proceeds without probing an empty or none Worker command (#2778)', async () => {
    // plot-fleetctl.sh passes `plot-config.sh get "Worker command" ""` as the
    // one argument, so an unset key arrives as an empty string.
    for (const command of ['', 'none']) {
      const asked: string[] = [];
      let out = '';
      const code = await run([command], probeAnswering({ ok: true, value: 'no' }, asked), FALLBACK, (s) => {
        out += s;
      });
      expect(code).toBe(0);
      expect(asked).toEqual([]);
      expect(out).toBe('');
    }
  });

  it('proceeds on a stale print and prints the template refresh for its shell caller (#2778)', async () => {
    let out = '';
    const reason = 'stale-print: .plot/worker-prompt.sh launches with --permission-mode but its PLOT_PRINT_INVOCATION block does not print it';
    const code = await run(['claude -p'], probeAnswering({ ok: false, why: 'unaskable', reason }), FALLBACK, (s) => {
      out += s;
    });
    expect(code).toBe(0);
    expect(out).toMatch(/^plot-fleetctl: The write probe did not run/);
    expect(out).toContain('skills/plot/templates/worker-prompt.sh');
  });

  it('exits 2 on a missing command argument', async () => {
    expect(await run([], probeAnswering({ ok: true, value: 'yes' }), FALLBACK, () => {})).toBe(2);
  });

  describe('the prompts PLOT_AGENT names', () => {
    it('probes the fallback prompt and the named charter\'s prompt', () => {
      expect(promptsToProbe('/repo', 'reviewer', answering)).toEqual([
        { file: '/repo/.plot/worker-prompt.sh', charter: null },
        { file: '/repo/.plot/prompts/reviewer.sh', charter: 'reviewer' },
      ]);
    });

    it('probes only the fallback prompt where PLOT_AGENT names nothing', () => {
      expect(promptsToProbe('/repo', '', answering)).toEqual([{ file: '/repo/.plot/worker-prompt.sh', charter: null }]);
    });

    it('carries a refused charter as its refusal', () => {
      const refusing = (_root: string, name: string): string =>
        name === '' ? 'fallback\t.plot/worker-prompt.sh\tno agent named\n' : `refused\t\tcharter '${name}' is not valid YAML\n`;
      expect(promptsToProbe('/repo', 'reviewer', refusing)[1]).toEqual({ refused: "charter 'reviewer' is not valid YAML" });
    });

    it('hands both files to the probe and names both in a refusal', async () => {
      const given: (readonly ProbePrompt[])[] = [];
      let out = '';
      const prompts = promptsToProbe('/repo', 'reviewer', answering);
      const code = await run(['claude -p'], probeAnswering({ ok: true, value: 'no' }, [], given), prompts, (s) => {
        out += s;
      });
      expect(code).toBe(1);
      expect(given).toEqual([prompts]);
      expect(out).toContain("plot-fleetctl: probed /repo/.plot/worker-prompt.sh, /repo/.plot/prompts/reviewer.sh (charter 'reviewer')\n");
    });
  });
});
