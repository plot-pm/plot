import { spawn } from 'node:child_process';

import type { PortResult } from '../../port-result.js';
import type { HostAnswer, ScriptOptions, Scripts, StartedRun } from '../../ports/scripts.js';
import { runProcess, runScript, runScriptSync } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** The plan-format contract. */
const PLAN_META = 'plot-plan-meta.sh';

/** The `## Plot Config` reader. */
const CONFIG = 'plot-config.sh';

/** The one connector — every `gh`/`bb` call in Plot goes through it. */
const HOST = 'plot-host.sh';

/** The fan-out. */
const DISPATCH = 'plot-dispatch.sh';

/** Stdout verbatim, because the scripts ARE the contracts and a parse here would be a second one. */
const verbatim = (stdout: string): string => stdout;

/**
 * Invokes Plot's helper scripts, and is the ONLY place that does.
 *
 * Every operation resolves the script's path from the context and maps its exit
 * code through `runScript`, so nothing above this file holds a filename or reads
 * a number. `plot-host.sh` is why the second property matters: it answers exit 4
 * for *this host has no such capability at all* and exit 1 or 3 for *this
 * attempt failed*, and a caller that re-reads the code collapses a permanent
 * configuration fact into a transient incident.
 *
 * It answers stdout verbatim rather than a shape. The scripts are the plan-format
 * and host contracts; a second parse here would be a second spelling of them, and
 * the callers that read those payloads already validate against schemas of their
 * own.
 *
 * @param context - where the scripts and the repository are.
 * @returns a `Scripts` backed by the shipped helpers.
 */
export const scriptsShell = (context: ShellContext): Scripts => {
  const inRepo = { cwd: context.repoRoot };
  const withRepo = (options: ScriptOptions = {}) => ({ ...inRepo, ...options });

  const ask = (
    script: string,
    args: readonly string[],
    options?: ScriptOptions,
  ): Promise<PortResult<string>> =>
    runScript('bash', [scriptPath(context, script), ...args], verbatim, withRepo(options));

  return {
    planMeta: (files, options) =>
      files.length === 0
        ? Promise.resolve<PortResult<string>>({ ok: true, value: '' })
        : ask(PLAN_META, files, options),

    planMetaSync: (files, options) =>
      files.length === 0
        ? { ok: true, value: '' }
        : runScriptSync(
            'bash',
            [scriptPath(context, PLAN_META), ...files],
            verbatim,
            withRepo(options),
          ),

    config: (key, fallback, options) => ask(CONFIG, ['get', key, fallback], options),

    configSync: (key, fallback, options) =>
      runScriptSync(
        'bash',
        [scriptPath(context, CONFIG), 'get', key, fallback],
        verbatim,
        withRepo(options),
      ),

    host: (args, options) => ask(HOST, args, options),

    hostSaid: async (args, options): Promise<HostAnswer> => {
      const run = await runProcess(
        'bash',
        [scriptPath(context, HOST), ...args],
        withRepo(options),
      );
      // THE CODE IS READ EXACTLY ONCE, HERE, and what leaves is a word. `4` is
      // the host having no such capability at all, which no caller may retry;
      // every other non-zero exit is an attempt that failed, which some callers
      // should wait before repeating. The sentence travels because that is the
      // only thing separating a rate limit from a DNS blip.
      if (run.code === 0) return { answer: 'answered', stdout: run.stdout };
      const said = run.stderr.trim() || run.stdout.trim() || `plot-host.sh exited ${run.code}`;
      return run.code === 4 ? { answer: 'unaskable', said } : { answer: 'failed', said };
    },

    dispatch: async (args, options) => {
      // THE ONE ASK WHOSE STDOUT IS WORTH READING BESIDE A NON-ZERO EXIT.
      // `plot-dispatch.sh` refuses for reasons of its own — a phase gate, an
      // unresolvable `origin/<main>` — and still reports on stdout which
      // branches it claimed. Folding that into a `PortResult` would discard
      // either the claim or the reason, so both travel with the code.
      const run = await runProcess(
        'bash',
        [scriptPath(context, DISPATCH), ...args],
        withRepo(options),
      );
      return { stdout: run.stdout, stderr: run.stderr, code: run.code };
    },

    start: (script, args, options = {}): StartedRun => {
      const stdio: ('ignore' | number)[] =
        options.log === undefined ? ['ignore', 'ignore', 'ignore'] : ['ignore', options.log, options.log];
      const child = spawn('bash', [scriptPath(context, script), ...args], {
        cwd: context.repoRoot,
        detached: true,
        stdio,
      });
      if (options.onError) child.on('error', options.onError);
      if (options.onExit) child.on('exit', (code) => options.onExit?.(code));
      child.unref();
      // A pid of `undefined` is the spawn having failed before the process
      // existed. `started: false` is the fact a caller needs — logging a start
      // it did not get would report a worker nobody can find.
      return { pid: child.pid ?? 0, started: child.pid !== undefined };
    },

    stream: (script, args, onLine, options = {}) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn('bash', [scriptPath(context, script), ...args], {
          cwd: context.repoRoot,
          ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
        });
        let buffered = '';
        let settled = false;
        const timeoutMs = options.timeoutMs;
        const timer =
          timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                // SIGKILL rather than SIGTERM: these are bash scripts that
                // spawn git, and a TERM one of them traps would leave this
                // promise pending past the timeout it exists to enforce.
                child.kill('SIGKILL');
                if (!settled) {
                  settled = true;
                  reject(new Error(`timed out after ${timeoutMs}ms`));
                }
              }, timeoutMs);
        const done = () => {
          if (timer !== undefined) clearTimeout(timer);
        };
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          buffered += chunk;
          // The LAST fragment is kept for the next chunk rather than parsed: a
          // chunk boundary falls wherever the OS put it, and handing every
          // piece onward would deliver half a JSON object as a line.
          let newline: number;
          while ((newline = buffered.indexOf('\n')) !== -1) {
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            if (line.trim()) onLine(line);
          }
        });
        // stderr is drained either way. An unread pipe fills and the child
        // blocks writing to it, which presents as a scan that stopped.
        child.stderr.setEncoding('utf8');
        let errorBuffer = '';
        child.stderr.on('data', (chunk: string) => {
          if (!options.onErrorLine) return;
          errorBuffer += chunk;
          let newline: number;
          while ((newline = errorBuffer.indexOf('\n')) !== -1) {
            const line = errorBuffer.slice(0, newline);
            errorBuffer = errorBuffer.slice(newline + 1);
            if (line.trim()) options.onErrorLine(line);
          }
        });
        child.on('error', (error) => {
          done();
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
        child.on('close', (code) => {
          done();
          if (settled) return;
          settled = true;
          if (buffered.trim()) onLine(buffered);
          if (code === 0) resolve();
          else reject(new Error(`exited ${code}`));
        });
      }),

    pathOf: (script) => scriptPath(context, script),
  };
};
