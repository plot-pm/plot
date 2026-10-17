/**
 * Asking for a hand-off brief — the spawn auto-dispatch makes when it skips a
 * plan as `no-brief`.
 *
 * **ASK, DO NOT AWAIT.** The caller reports that it asked; it never waits for
 * the brief. `plot-dispatch.sh` states the same distinction for the shell side
 * — *"`brief_asked=N` COUNTS COMMANDS STARTED, NEVER BRIEFS WRITTEN."* A pass
 * that blocked on one `claude -p` session of unknown length would hold every
 * later branch behind it, and the brief has to reach `origin/main` before a
 * claim can happen anyway.
 *
 * A leaf module beside {@link ./brief-path.js} for the same reason that one is
 * one: the spawn is the only impure thing here, and keeping it out of
 * `auto-dispatch.ts` leaves that file's own rule intact — every read and write
 * in `maybeAutoDispatch`, and `planAutoDispatch` pure.
 */
import fs from 'node:fs';
import path from 'node:path';

import { readConfig } from './config-reader.js';
import type { ActOptions } from './action-log.js';
import { startBoardRun } from './board-run.js';
import { recordImplementAgent, releaseImplementLock, takeImplementLock, type ImplementLockDeps } from './implement-run.js';
import { usableCommand } from './usable-command.js';
import { briefPath } from '@plot-pm/fleet/shared/brief-path';

/** The `## Plot Config` key naming the command that writes a brief. */
export const BRIEF_COMMAND_KEY = 'Brief command';

/**
 * The configured brief command, or `''` when there is none to run.
 *
 * **READ FRESH EVERY PASS, never cached at startup**, the rule
 * `readFleetSettings` already follows: a key added while the board runs takes
 * effect on the next pulse rather than on the next restart.
 *
 * `none` answers `''` through {@link usableCommand} — the repo's established
 * spelling for *asked, and we do this by hand*. Running it would spawn `none:
 * command not found` and log that as the reason a brief does not exist.
 *
 * @param opts - the board's options, carrying the repo root and scripts dir.
 * @returns the command as a shell fragment, or `''` when unset or `none`.
 */
export const briefCommand = (opts: ActOptions): string =>
  usableCommand(readConfig(opts, BRIEF_COMMAND_KEY, ''));

/**
 * What the brief writer is told to do.
 *
 * **IT ASKS FOR `/plot-implement`, AND NEVER FOR A BRIEF IN THE AGENT'S OWN
 * WORDS.** `/plot-implement` step 4 owns brief authorship; a prompt describing
 * the brief here would be a second author, and the two would drift. The wording
 * matches `brief_prompt()` in `plot-dispatch.sh` because the two ask the same
 * thing of the same skill.
 *
 * **IT SAYS COMMIT AND PUSH, because the gate reads `origin/<main>`.** A brief
 * left in a working tree is invisible to the gate that asked for it, so the next
 * pass would ask again — writing a file every pulse and never starting a worker.
 *
 * @param slug - the plan slug, as `/plot-implement` takes it.
 * @param branch - the branch whose brief is missing.
 * @param main - the default branch's name, as the pulse reports it.
 * @returns the prompt, as one argument.
 */
export const briefAskPrompt = (slug: string, branch: string, main: string): string =>
  `/plot-implement ${slug} — write the hand-off brief for branch \`${branch}\` at ` +
  `${briefPath(branch)}, then commit and push it to ${main}. The dispatch gate reads ` +
  `that path on origin/${main}, so a brief left uncommitted is invisible to it.`;

/**
 * Where `askForBrief` writes its log for one plan. `brief-ask-log.ts` reads
 * the same path through this function, so the writer and the reader share one
 * spelling.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param slug - the plan slug.
 * @returns the log's absolute path.
 */
export const askForBriefLogPath = (repoRoot: string, slug: string): string =>
  path.join(repoRoot, `.plot-brief-${slug}.log`);

/**
 * Starts the configured brief command for one plan through the `agentRun`
 * port, and returns without waiting for it.
 *
 * **THE COMMAND IS A SHELL FRAGMENT AND THE PROMPT IS AN ARGUMENT.** The
 * configured fragment is the key's value; the prompt is its own argument, so
 * it cannot be read as shell however it is spelt.
 *
 * **NOTHING WAITS ON IT.** The next pulse reads `origin/<main>` for the brief,
 * not this run's outcome, so the run records no state file. It stays in the
 * process group of the process that started it: a board stop ends it, and the
 * next pass asks again.
 *
 * **IT TAKES THE PLAN'S IMPLEMENT LOCK** ({@link takeImplementLock}) before it
 * opens anything, and releases it when the run ends. A brief and an implement
 * for one slug cannot both run, so they cannot both write a brief; a brief that
 * loses the lock logs why and returns `''`.
 *
 * **A start failure is reported and never thrown.** This runs inside the
 * scan's success path, and an unstartable command must not take a pulse down
 * with it — the plan stays `no-brief` and the next pass asks again.
 *
 * @param opts - the board's options; the command runs from the repo root.
 * @param command - the configured fragment, already checked usable.
 * @param slug - the plan slug, for the prompt and the log path.
 * @param prompt - the assembled prompt, passed as one argument.
 * @param lockDeps - the implement lock's test seams.
 * @returns the log path the session writes to, or `''` when the lock is held or the log cannot be opened.
 */
export const askForBrief = (
  opts: ActOptions,
  command: string,
  slug: string,
  prompt: string,
  lockDeps: ImplementLockDeps = {},
): string => {
  const log = askForBriefLogPath(opts.repoRoot, slug);
  const couldNot = (why: string): '' => {
    console.log(`auto-dispatch: could not ask for ${slug}'s brief: ${why}`);
    return '';
  };
  let mine;
  try {
    mine = takeImplementLock(opts.repoRoot, slug, lockDeps);
  } catch (err) {
    return couldNot(err instanceof Error ? err.message : String(err));
  }
  if (mine === null) return couldNot(`an implement or brief run for ${slug} holds its lock`);
  const held = mine;
  const release = (): void => releaseImplementLock(opts.repoRoot, slug, held);
  try {
    fs.appendFileSync(log, '', 'utf8');
  } catch (err) {
    release();
    return couldNot(err instanceof Error ? err.message : String(err));
  }
  void startBoardRun(
    opts,
    {
      role: 'brief',
      fragmentKey: BRIEF_COMMAND_KEY,
      readCfg: (o, key, fallback) => (key === BRIEF_COMMAND_KEY ? command : readConfig(o, key, fallback)),
      tree: opts.repoRoot,
      prompt,
      env: {},
      logFile: log,
      statePath: null,
      onStarted: (pid) => recordImplementAgent(opts.repoRoot, slug, held, { pid, startedAt: Date.now() }),
    },
    (record) => {
      release();
      if (record.code !== 0) console.log(`auto-dispatch: the brief command for ${slug} ended: ${record.line || `code ${record.code}`}`);
    },
  ).then((runner) => {
    // A run this process left to the board calls no end handler.
    if (runner === 'refused') release();
  });
  return log;
};
