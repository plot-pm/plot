/**
 * What each harness prints when it stops on the account's usage limit.
 *
 * **DATA ONLY, AND THAT IS THE DESIGN RATHER THAN A STYLE.** This file exports a
 * constant and holds no function, so every match, every time parse and every
 * comparison stays in `rules/prompt-exit.ts`, where the 100% branch gate
 * applies — `packages/domain/vitest.config.ts:71` covers `src/!(adapters)/**`,
 * so a function written here would be a branch that escapes it. The rule takes
 * the patterns as an argument and imports this nowhere.
 *
 * It is an adapter because a harness's message text is a fact about that
 * harness, the way a host's CLI flags are facts about that host. It is NOT a
 * connector: no account, no credentials, no rate limit and no transport — it
 * reaches nothing at all.
 *
 * **A harness this table does not name supplies no patterns**, and every exit
 * from it reads as it did before the rule existed. Adding one is an entry here.
 *
 * The entries are measured, not guessed. The `claude` line prefix and the five
 * limit names were read from the 2.1.286 binary; the reset shape is the line
 * reported in #1141:
 *
 * ```
 * You've hit your session limit · resets 5:20pm (Europe/Zurich)
 * ```
 *
 * The `dropped` prefix was read from the 2.1.291 binary, which writes this line
 * to stderr and then terminates the turn's background tasks:
 *
 * ```
 * Background tasks still running after 600s; terminating. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.
 * ```
 *
 * A reset shape not yet measured — a weekly reset carrying a date, or a spend
 * cap's month — reads as unreadable and ends the worker with a marker naming
 * the limit, until it is measured and added.
 */

import type { LimitPatterns } from '../../rules/prompt-exit.js';

/**
 * The limit patterns per harness name, keyed as the launch names the harness.
 *
 * `fast limit` and `monthly spend limit` are listed although their reset shapes
 * are unmeasured. A line carrying either IS a limit, so it ends the worker with
 * a marker that names it rather than falling through to the retry path and its
 * false *fix the prompt* marker — which is the defect #1141 reported.
 */
export const HARNESS_LIMIT_LINES: Readonly<Record<string, LimitPatterns>> = {
  claude: {
    prefix: "You've hit your ",
    names: ['session limit', 'weekly limit', 'Opus limit', 'fast limit', 'monthly spend limit'],
    resetSeparator: ' · resets ',
    dropped: 'Background tasks still running after ',
  },
};
