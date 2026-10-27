import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { copyFile, mkdtemp as mkdtempAsync, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeProbeShell } from '../src/adapters/write-probe/write-probe-shell.js';
import { shellContext } from '../src/adapters/scripts.js';
import { isAnswered } from '../src/port-result.js';
import { runProcess, type ScriptRun } from '../src/adapters/run-script.js';

/** The prompt template Plot ships, which `plot-init` copies to `.plot/worker-prompt.sh`. */
const templatePath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills', 'plot', 'templates', 'worker-prompt.sh');

/** The template as shipped before #2778, whose print omits `--permission-mode`. */
const oldTemplatePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'worker-prompt-before-2778.sh');

/** Launch variables a dispatched worker's own environment carries, blanked so the template reads none. */
const unsetLaunchVars: Record<string, string> = {
  PLOT_HARNESS: '', PLOT_MODEL: '', PLOT_EFFORT: '', PLOT_CAPABILITIES: '',
  PLOT_SESSION_ID: '', PLOT_AGENT_SETTINGS: '', PLOT_BACKGROUND_DENY: '',
};

/** A prompt file with a print block and no launch flag, for tests that stub `run`. */
const MINIMAL_PROMPT = '#!/usr/bin/env bash\nif [ -n "${PLOT_PRINT_INVOCATION:-}" ]; then printf \'%s\\n\' claude; exit 0; fi\nclaude -p "work"\n';

/**
 * A repo root carrying the one file the probe reads: `.plot/worker-prompt.sh`.
 * The probe never executes this file for real in these tests — `run` is
 * stubbed — so only its text matters: it names a print block and no launch flag.
 */
async function repoWithPrompt(text: string = MINIMAL_PROMPT): Promise<string> {
  const root = await mkdtempAsync(join(tmpdir(), 'plot-write-probe-repo-'));
  await mkdir(join(root, '.plot'), { recursive: true });
  await writeFile(join(root, '.plot', 'worker-prompt.sh'), text);
  return root;
}

describe('writeProbeShell — absent is not false', () => {
  it('answers unanswerable where the repo has no prompt file to probe', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-write-probe-norepo-'));
    try {
      const probe = writeProbeShell(shellContext(root));
      const reading = await probe.check('claude -p');
      expect(reading.ok).toBe(false);
      expect(!reading.ok && reading.why).toBe('unaskable');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('answers unanswerable where the invocation print itself fails', async () => {
    const root = await repoWithPrompt();
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (): Promise<ScriptRun> => ({ code: 1, stdout: '', stderr: 'bash: command not found' }),
      });
      const reading = await probe.check('claude -p');
      expect(reading.ok).toBe(false);
      expect(!reading.ok && reading.why).toBe('unaskable');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('answers unanswerable where no harness name was printed', async () => {
    const root = await repoWithPrompt();
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (): Promise<ScriptRun> => ({ code: 0, stdout: '\n\n', stderr: '' }),
      });
      const reading = await probe.check('claude -p');
      expect(reading.ok).toBe(false);
      expect(!reading.ok && reading.why).toBe('unaskable');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('answers unanswerable where the probe run times out, never no', async () => {
    const root = await repoWithPrompt();
    try {
      let call = 0;
      const probe = writeProbeShell(shellContext(root), {
        run: async (): Promise<ScriptRun> => {
          call += 1;
          if (call === 1) return { code: 0, stdout: 'claude\n--settings\n/x.json\n', stderr: '' };
          return { code: 1, stdout: '', stderr: '', interrupted: 'timeout' };
        },
      });
      const reading = await probe.check('claude -p');
      expect(reading.ok).toBe(false);
      expect(!reading.ok && reading.why).toBe('unaskable');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('writeProbeShell — an observed outcome', () => {
  it('answers yes where the marker appears after the probe run', async () => {
    const root = await repoWithPrompt();
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (command, args): Promise<ScriptRun> => {
          if (command === 'bash') return { code: 0, stdout: 'claude\n', stderr: '' };
          // The second call is the harness itself; its `-p` argument carries
          // the marker path this stub writes to, proving the probe passes the
          // SAME path it later checks.
          const promptIndex = args.indexOf('-p');
          const prompt = String(args[promptIndex + 1]);
          const marker = /at (\S+),/.exec(prompt)?.[1];
          if (marker) await writeFile(marker, 'x');
          return { code: 0, stdout: '', stderr: '' };
        },
      });
      const reading = await probe.check('claude -p');
      expect(isAnswered(reading)).toBe(true);
      expect(isAnswered(reading) && reading.value).toBe('yes');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('answers no where the harness exits 0 but never touches the marker', async () => {
    // THE REFUSED-WRITE CASE. A harness bypassPermissions did not reach still
    // exits 0 — it just never ran the tool call — so the marker's absence,
    // not the exit code, is what `no` reads.
    const root = await repoWithPrompt();
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (command): Promise<ScriptRun> => {
          if (command === 'bash') return { code: 0, stdout: 'claude\n', stderr: '' };
          return { code: 0, stdout: '', stderr: '' };
        },
      });
      const reading = await probe.check('claude -p');
      expect(isAnswered(reading)).toBe(true);
      expect(isAnswered(reading) && reading.value).toBe('no');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('answers unanswerable where the harness exits non-zero and leaves no marker', async () => {
    // A non-zero exit also covers an expired login, a usage limit and a server
    // error. None of them observed a refused write.
    const root = await repoWithPrompt();
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (command): Promise<ScriptRun> => {
          if (command === 'bash') return { code: 0, stdout: 'claude\n', stderr: '' };
          return { code: 1, stdout: '', stderr: 'API Error: 529 overloaded' };
        },
      });
      const reading = await probe.check('claude -p');
      expect(isAnswered(reading) && reading.value).toBe('unanswerable');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('answers unanswerable where the harness is not on PATH', async () => {
    // The real `runProcess`, so the spawn failure is the one it reports.
    const root = await repoWithPrompt();
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (command, args, options): Promise<ScriptRun> => {
          if (command === 'bash') return { code: 0, stdout: 'plot-no-such-harness-2778\n', stderr: '' };
          return runProcess(command, args, options);
        },
      });
      const reading = await probe.check('claude -p');
      expect(isAnswered(reading) && reading.value).toBe('unanswerable');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('answers unanswerable where the harness is ended by a signal', async () => {
    const root = await repoWithPrompt();
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (command): Promise<ScriptRun> => {
          if (command === 'bash') return { code: 0, stdout: 'claude\n', stderr: '' };
          return { code: 1, stdout: '', stderr: '', interrupted: 'signal' };
        },
      });
      const reading = await probe.check('claude -p');
      expect(isAnswered(reading) && reading.value).toBe('unanswerable');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('adds no flag of its own to the printed invocation', async () => {
    // The prompt file owns the flags. The probe passes what it printed, then
    // `-p` and its own prompt, and nothing else.
    const root = await repoWithPrompt();
    const seenArgs: string[][] = [];
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (command, args): Promise<ScriptRun> => {
          if (command === 'bash') return { code: 0, stdout: 'claude\n', stderr: '' };
          seenArgs.push([...args]);
          return { code: 0, stdout: '', stderr: '' };
        },
      });
      await probe.check('claude -p');
      expect(seenArgs).toHaveLength(1);
      expect(seenArgs[0]).toHaveLength(2);
      expect(seenArgs[0][0]).toBe('-p');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('forwards exactly the flags the prompt file printed, in order', async () => {
    const root = await repoWithPrompt();
    const seenArgs: string[][] = [];
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (command, args): Promise<ScriptRun> => {
          if (command === 'bash') {
            return { code: 0, stdout: 'claude\n--settings\n/path/settings.json\n--model\nopus\n', stderr: '' };
          }
          seenArgs.push([...args]);
          return { code: 0, stdout: '', stderr: '' };
        },
      });
      await probe.check('claude -p');
      expect(seenArgs[0].slice(0, 4)).toEqual(['--settings', '/path/settings.json', '--model', 'opus']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('writeProbeShell — the shipped prompt template', () => {
  it('runs the harness with --permission-mode bypassPermissions printed by the template (#2778)', async () => {
    // The real template, sourced by a real bash under PLOT_PRINT_INVOCATION=1.
    // Only the harness run is stubbed. Without the permission flag a headless
    // `-p` run cannot approve a Write, and the probe answers `no`.
    const root = await mkdtempAsync(join(tmpdir(), 'plot-write-probe-template-'));
    const seen: { command: string; args: string[] }[] = [];
    try {
      await mkdir(join(root, '.plot'), { recursive: true });
      await copyFile(templatePath, join(root, '.plot', 'worker-prompt.sh'));
      const probe = writeProbeShell(shellContext(root), {
        run: async (command, args, options): Promise<ScriptRun> => {
          if (command === 'bash') {
            return runProcess(command, args, { ...options, env: { ...options?.env, ...unsetLaunchVars } });
          }
          seen.push({ command, args: [...args] });
          return { code: 0, stdout: '', stderr: '' };
        },
      });
      await probe.check('claude -p');
      expect(seen).toHaveLength(1);
      expect(seen[0].command).toBe('claude');
      const at = seen[0].args.indexOf('--permission-mode');
      expect(at).toBeGreaterThanOrEqual(0);
      expect(seen[0].args[at + 1]).toBe('bypassPermissions');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('writeProbeShell — a print that cannot be trusted is not run (#2778)', () => {
  /** Runs the probe over `promptFile` with real bash and a stubbed harness; returns the result and what ran. */
  const probeOver = async (promptFile: string) => {
    const root = await mkdtempAsync(join(tmpdir(), 'plot-write-probe-stale-'));
    const commands: string[] = [];
    try {
      await mkdir(join(root, '.plot'), { recursive: true });
      await copyFile(promptFile, join(root, '.plot', 'worker-prompt.sh'));
      const probe = writeProbeShell(shellContext(root), {
        run: async (command, args, options): Promise<ScriptRun> => {
          commands.push(command);
          if (command === 'bash') {
            return runProcess(command, args, { ...options, env: { ...options?.env, ...unsetLaunchVars } });
          }
          return { code: 0, stdout: '', stderr: '' };
        },
      });
      return { reading: await probe.check('claude -p'), commands };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };

  it('answers unanswerable with a stale-print reason for the template shipped before #2778, and runs no harness', async () => {
    const { reading, commands } = await probeOver(oldTemplatePath);
    expect(reading.ok).toBe(false);
    expect(!reading.ok && reading.why === 'unaskable' && reading.reason).toMatch(/^stale-print: .*--permission-mode/);
    expect(commands).toEqual(['bash']);
  });

  it('runs the harness for the current template', async () => {
    const { reading, commands } = await probeOver(templatePath);
    expect(isAnswered(reading)).toBe(true);
    expect(commands).toEqual(['bash', 'claude']);
  });

  it('never sources a prompt file that has no print block', async () => {
    const root = await repoWithPrompt('#!/usr/bin/env bash\nclaude -p "work" --permission-mode bypassPermissions\n');
    const commands: string[] = [];
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (command): Promise<ScriptRun> => {
          commands.push(command);
          return { code: 0, stdout: 'claude\n', stderr: '' };
        },
      });
      const reading = await probe.check('claude -p');
      expect(!reading.ok && reading.why === 'unaskable' && reading.reason).toMatch(/^stale-print: .*no PLOT_PRINT_INVOCATION block/);
      expect(commands).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('writeProbeShell — the scratch desk is not the claim', () => {
  it('removes the scratch directory it cut, by its own exact path', async () => {
    const root = await repoWithPrompt();
    const cutPaths: string[] = [];
    const removedPaths: string[] = [];
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (command): Promise<ScriptRun> => {
          if (command === 'bash') return { code: 0, stdout: 'claude\n', stderr: '' };
          return { code: 0, stdout: '', stderr: '' };
        },
        mkdtemp: async (prefix: string) => {
          const cut = await mkdtempAsync(prefix);
          cutPaths.push(cut);
          return cut;
        },
        rm: async (path: string, opts) => {
          removedPaths.push(path as string);
          return rm(path, opts);
        },
      });
      await probe.check('claude -p');
      expect(cutPaths).toHaveLength(1);
      expect(removedPaths).toEqual(cutPaths);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes the scratch directory even when the probe run throws', async () => {
    const root = await repoWithPrompt();
    const removedPaths: string[] = [];
    try {
      const probe = writeProbeShell(shellContext(root), {
        run: async (): Promise<ScriptRun> => {
          throw new Error('boom');
        },
        rm: async (path: string, opts) => {
          removedPaths.push(path as string);
          return rm(path, opts);
        },
      });
      await expect(probe.check('claude -p')).rejects.toThrow('boom');
      expect(removedPaths).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
