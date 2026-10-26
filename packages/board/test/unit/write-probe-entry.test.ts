import { describe, expect, it } from 'vitest';
import type { WriteProbe } from '@plot-pm/domain/ports/write-probe';

import { run } from '../../src/server/entry/write-probe.js';

/** A probe whose `check` answers as given and records what it was asked. */
const probeAnswering = (answer: unknown, asked: string[] = []): WriteProbe =>
  ({
    check: async (command: string) => {
      asked.push(command);
      return answer;
    },
  }) as unknown as WriteProbe;

describe('plot-write-probe.mjs', () => {
  it('proceeds and asks with the configured command on an observed yes', async () => {
    const asked: string[] = [];
    let out = '';
    const code = await run(['claude -p'], probeAnswering({ ok: true, value: 'yes' }, asked), (s) => {
      out += s;
    });
    expect(code).toBe(0);
    expect(asked).toEqual(['claude -p']);
    expect(out).toBe('proceed\n');
  });

  it('refuses on an observed no, and prints the refusal text', async () => {
    let out = '';
    const code = await run(['claude -p'], probeAnswering({ ok: true, value: 'no' }), (s) => {
      out += s;
    });
    expect(code).toBe(1);
    expect(out).toContain('refuse\n');
    expect(out).toMatch(/refused every write/);
  });

  it('proceeds on an unanswerable probe, never refuses it as a permission fault', async () => {
    // ABSENT IS NOT FALSE: an unaskable result must read as `proceed`, the same
    // as an observed `yes`.
    const code = await run(['claude -p'], probeAnswering({ ok: false, why: 'unaskable' }), () => {});
    expect(code).toBe(0);
  });

  it('proceeds on a failed probe call the same way, since nothing was observed', async () => {
    const code = await run(['claude -p'], probeAnswering({ ok: false, why: 'failed' }), () => {});
    expect(code).toBe(0);
  });

  it('exits 2 on a missing command argument', async () => {
    expect(await run([], probeAnswering({ ok: true, value: 'yes' }), () => {})).toBe(2);
  });
});
