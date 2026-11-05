import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EXIT, run } from '../../src/server/entry/start-command.js';

const LOOP = 'plot-worker-loop.sh';
const COMMAND = 'PLOT_UNATTENDED=1 plot-worker-loop.sh';

describe('start-command entry', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'plot-start-entry-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true });
  });

  const ask = (runner: string, env: NodeJS.ProcessEnv = {}) => {
    let out = '';
    const code = run(COMMAND, ['free', LOOP, COMMAND, root, runner], (s) => (out += s), env);
    return { code, out };
  };

  it('exits 3 with the why and the repair when the prompt file is absent', () => {
    const { code, out } = ask('');
    expect(code).toBe(EXIT.refused);
    const lines = out.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('.plot/worker-prompt.sh');
    expect(lines[1]).toContain('plot-install-prompt.sh');
  });

  it('answers run when the prompt file is present', () => {
    mkdirSync(join(root, '.plot'));
    writeFileSync(join(root, '.plot', 'worker-prompt.sh'), '');
    expect(ask('')).toEqual({ code: EXIT.ok, out: `run\t${COMMAND}\n` });
  });

  it('answers run on the sdk runner with no prompt file', () => {
    expect(ask('sdk')).toEqual({ code: EXIT.ok, out: `run\t${COMMAND}\n` });
  });

  it('refuses a declared prompt that is absent, naming the charter', () => {
    mkdirSync(join(root, '.plot', 'charters'), { recursive: true });
    writeFileSync(join(root, '.plot', 'charters', 'x.json'), JSON.stringify({ name: 'x', prompt: '.plot/prompts/x.sh' }));
    mkdirSync(join(root, '.plot'), { recursive: true });
    writeFileSync(join(root, '.plot', 'worker-prompt.sh'), '');
    const { code, out } = ask('', { PLOT_AGENT: 'x' });
    expect(code).toBe(EXIT.refused);
    expect(out).toContain('.plot/prompts/x.sh');
  });

  it('exits 2 when the repo root is missing', () => {
    expect(run(COMMAND, ['free', LOOP, COMMAND], () => {})).toBe(EXIT.usage);
  });
});
