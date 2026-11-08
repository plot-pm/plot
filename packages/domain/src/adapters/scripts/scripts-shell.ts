import { spawn } from 'node:child_process';

import type { PortResult } from '../../port-result.js';
import type { HostAnswer, ScriptOptions, Scripts, StartedRun } from '../../ports/scripts.js';
import { EXIT_OK, EXIT_PARTIAL, EXIT_QUOTA, EXIT_SECONDARY, EXIT_UNASKABLE } from '../host-exit.js';
import { killGroup, runProcess, runScript, runScriptSync } from '../run-script.js';
import { processAnswers, withFixedEnv, type FixedAnswers } from '../git-dirs/git-dirs.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** The plan-format contract. */
const PLAN_META = 'plot-plan-meta.sh';

/** The `## Plot Config` reader. */
const CONFIG = 'plot-config.sh';

/** The one connector — every `gh`/`bb` call in Plot goes through it. */
const HOST = 'plot-host.sh';

/** The settings file every fleet agent starts with, and the refusal in front of it. */
const AGENT_SETTINGS = 'plot-agent-settings.sh';

/**
 * The scripts that start agents. They are started without the fixed
 * variables, so an agent never inherits `PLOT_REPO_ROOT` or
 * `PLOT_GIT_COMMON_DIR` from this process's answers.
 */
const AGENT_LAUNCHERS: ReadonlySet<string> = new Set(['plot-dispatch.sh', 'plot-fleetctl.sh']);

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
 * Every script but an agent launcher starts with `PLOT_REPO_ROOT` and
 * `PLOT_GIT_COMMON_DIR` from the held answers, unless the caller or this
 * process already sets them.
 *
 * @param context - where the scripts and the repository are.
 * @param answers - the held answers the scripts read from their environment; this process's own by default.
 * @returns a `Scripts` backed by the shipped helpers.
 */
export const scriptsShell = (context: ShellContext, answers: FixedAnswers = processAnswers): Scripts => {
  const inRepo = { cwd: context.repoRoot };

  /** The options for `script`, with the fixed variables read now (and asked on first use). */
  const withRepo = async (script: string, options: ScriptOptions = {}) =>
    AGENT_LAUNCHERS.has(script)
      ? { ...inRepo, ...options }
      : { ...inRepo, ...options, env: withFixedEnv(await answers.scriptEnv(context.repoRoot), options.env) };

  /** The options for `script`, with the fixed variables this process already holds. Starts no process. */
  const withRepoSync = (script: string, options: ScriptOptions = {}) =>
    AGENT_LAUNCHERS.has(script)
      ? { ...inRepo, ...options }
      : { ...inRepo, ...options, env: withFixedEnv(answers.heldScriptEnv(context.repoRoot), options.env) };

  /** The environment a detached start of `script` gets, or `undefined` for the process's own. */
  const startEnv = (script: string, env: Readonly<Record<string, string>> | undefined, fixed: Record<string, string>) => {
    const extra = AGENT_LAUNCHERS.has(script) ? env : withFixedEnv(fixed, env);
    return extra === undefined || Object.keys(extra).length === 0 ? undefined : extra;
  };

  const ask = async (
    script: string,
    args: readonly string[],
    options?: ScriptOptions,
  ): Promise<PortResult<string>> =>
    runScript('bash', [scriptPath(context, script), ...args], verbatim, await withRepo(script, options));

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
            withRepoSync(PLAN_META, options),
          ),

    config: (key, fallback, options) => ask(CONFIG, ['get', key, fallback], options),

    configSync: (key, fallback, options) =>
      runScriptSync(
        'bash',
        [scriptPath(context, CONFIG), 'get', key, fallback],
        verbatim,
        withRepoSync(CONFIG, options),
      ),

    host: (args, options) => ask(HOST, args, options),

    // THE RAW EXIT CODE TRAVELS, unlike `host` above. This script's 0-with-a-path,
    // 0-with-nothing and 3 are three answers a caller acts on differently, and a
    // PortResult would collapse the two zeroes into one.
    agentSettings: async (options) =>
      runProcess('bash', [scriptPath(context, AGENT_SETTINGS)], await withRepo(AGENT_SETTINGS, options)),


    hostSaid: async (args, options): Promise<HostAnswer> => {
      const run = await runProcess(
        'bash',
        [scriptPath(context, HOST), ...args],
        await withRepo(HOST, options),
      );
      // THE CODE IS READ EXACTLY ONCE, HERE, and what leaves is a word. `4` is
      // the host having no such capability at all, which no caller may retry;
      // every other non-zero exit is an attempt that failed, which some callers
      // should wait before repeating. The sentence travels because that is the
      // only thing separating a rate limit from a DNS blip.
      if (run.code === EXIT_OK) return { answer: 'answered', stdout: run.stdout, stderr: run.stderr };
      const said = run.stderr.trim() || run.stdout.trim() || `plot-host.sh exited ${run.code}`;
      // 7 IS AN INCOMPLETE ANSWER, NOT AN ABSENT ONE, and it is the only code
      // that carries both streams. `bb pr list` has no `all` state, so the
      // Bitbucket arm calls once per state and prints each state's rows as it
      // goes; when a later state fails, the rows already printed are a real
      // partial answer. Reading the code alone discarded them, which is #912 —
      // nine branches labelled as having no PR while two had live ones.
      //
      // A TOTAL FAILURE STILL ARRIVES AS 3, 5 OR 6, so a genuine outage cannot
      // reach this line. The adapter decides which of the two it was; here the
      // only job is to keep the rows alongside the sentence.
      if (run.code === EXIT_PARTIAL) return { answer: 'partial', stdout: run.stdout, said };
      if (run.code === EXIT_UNASKABLE) return { answer: 'unaskable', said };
      if (run.code === EXIT_QUOTA) return { answer: 'failed', said, kind: 'throttled' };
      if (run.code === EXIT_SECONDARY) return { answer: 'failed', said, kind: 'secondary' };
      return { answer: 'failed', said };
    },

    awaited: async (script, args, options) => {
      // THE ASKS WHOSE OUTPUT IS WORTH READING BESIDE A NON-ZERO EXIT.
      // `plot-dispatch.sh` refuses for reasons of its own — a phase gate, an
      // unresolvable `origin/<main>` — and still reports on stdout which
      // branches it claimed; `plot-approve.sh` explains its refusal across
      // several stderr lines. Folding either into a `PortResult` would discard
      // the claim or the reason, so both streams travel with the code.
      // A `.mjs` helper runs under this process's own Node; `bash` cannot run it.
      const interpreter = script.endsWith('.mjs') ? process.execPath : 'bash';
      const run = await runProcess(
        interpreter,
        [scriptPath(context, script), ...args],
        await withRepo(script, options),
      );
      return run.interrupted === undefined
        ? { stdout: run.stdout, stderr: run.stderr, code: run.code }
        : { stdout: run.stdout, stderr: run.stderr, code: run.code, interrupted: run.interrupted };
    },

    start: (script, args, options = {}): StartedRun => {
      const stdio: ('ignore' | number)[] =
        options.log === undefined ? ['ignore', 'ignore', 'ignore'] : ['ignore', options.log, options.log];
      const env = startEnv(script, options.env, answers.heldScriptEnv(context.repoRoot));
      const child = spawn('bash', [scriptPath(context, script), ...args], {
        cwd: context.repoRoot,
        detached: true,
        stdio,
        ...(env ? { env: { ...process.env, ...env } } : {}),
      });
      if (options.onError) child.on('error', options.onError);
      if (options.onExit) child.on('exit', (code, signal) => options.onExit?.(code, signal));
      // A CALLER CHAINED TO THE EXIT KEEPS THE HANDLE. Unreferencing it drops
      // what that caller is waiting for, and the measured shape of that is
      // every delivery landing and nothing ever being reaped.
      if (!(options.keepAlive ?? options.onExit !== undefined)) child.unref();
      // A pid of `undefined` is the spawn having failed before the process
      // existed. `started: false` is the fact a caller needs — logging a start
      // it did not get would report a worker nobody can find.
      return { pid: child.pid ?? 0, started: child.pid !== undefined };
    },

    stream: async (script, args, onLine, options = {}) => {
      const env = startEnv(script, options.env, await answers.scriptEnv(context.repoRoot));
      return new Promise<void>((resolve, reject) => {
        // DETACHED, so the script leads its own process group and a timeout
        // can end the subshells and children it started, not only `bash`.
        const child = spawn('bash', [scriptPath(context, script), ...args], {
          cwd: context.repoRoot,
          detached: true,
          ...(env ? { env: { ...process.env, ...env } } : {}),
        });
        let buffered = '';
        let settled = false;
        const timeoutMs = options.timeoutMs;
        const timer =
          timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                // THE WHOLE GROUP: TERM, then KILL after a grace. Signalling
                // `bash` alone left its subshells and `plot-host.sh` children
                // running under pid 1 (#1084); TERM first lets the script's
                // trap remove its temp paths.
                killGroup(child);
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
      });
    },

    sourced: (script, program, args, options) =>
      runScriptSync(
        'bash',
        ['-c', program, 'bash', scriptPath(context, script), ...args],
        verbatim,
        withRepoSync(script, options),
      ),

    pathOf: (script) => scriptPath(context, script),
  };
};
