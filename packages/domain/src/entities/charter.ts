import { z } from 'zod';

/**
 * The directory an agent charter is read from, relative to the repo root.
 *
 * A SIBLING OF `.plot/agents/`, NOT A FILE IN IT. `.plot/agents/` is
 * gitignored: it holds one manifest per dispatched worker, each carrying a pid
 * and an absolute worktree path, and the ignore entry states that a checked-in
 * manifest is "either meaningless or — worse — a pid that matches some
 * unrelated process". A charter is the opposite lifetime — written by a person,
 * true in every clone, and outliving every run — so it is committed, and it
 * cannot be committed from inside an ignored directory.
 */
export const CHARTER_DIRECTORY = '.plot/charters';

/**
 * The extension a charter file carries.
 */
export const CHARTER_EXTENSION = '.json';

/**
 * The environment variable naming which charter an agent runs under.
 *
 * Empty or unset means no charter, which is the estate today: every existing
 * worker keeps `.plot/worker-prompt.sh`.
 */
export const CHARTER_ENV_VAR = 'PLOT_AGENT';

/**
 * The fields a charter refuses to carry.
 *
 * Every one is a RUN fact — true of one dispatch and false of the next — and
 * every one is already the manifest's. A charter carrying them would be a
 * second record of one run, which is the duplication `registry.ts:105` is.
 */
export const RUN_FACTS: readonly string[] = [
  'session',
  'resumeId',
  'attempts',
  'branch',
  'worktree',
  'command',
  'startedAt',
  'pid',
  'previousPid',
  'relaunches',
  'state',
];

/**
 * What an agent may spend before it should be handed nothing further.
 *
 * A CEILING, A WINDOW AND A RESPONSE, never a reading. `contextCeiling` is the
 * fraction of the context window past which the agent is spent, expressed 0–1;
 * `contextWindow` is the size that fraction is taken of, in tokens; `atCeiling`
 * is what happens there. `finish` completes the slice in hand and takes no next
 * one; `end` stops the agent.
 *
 * **THE WINDOW IS DECLARED BECAUSE NOTHING MEASURES IT.** Measured 2026-09-04
 * on a real session: a transcript turn's `usage` carries `input_tokens`,
 * `cache_read_input_tokens`, `cache_creation_input_tokens` and `output_tokens`,
 * and the line names `"model":"claude-opus-5"` — but no key anywhere in the
 * file matches `window` or `limit`. So the numerator is measurable and the
 * denominator is not, and a verdict needs both.
 *
 * A TABLE FROM MODEL NAME TO WINDOW SIZE WAS THE OTHER OPTION AND IS REFUSED,
 * for the reason this plan already gives for not inferring a capability from
 * plan text: a guess that is usually right produces a fleet whose wrong answers
 * cannot be explained. It would also be wrong in the direction that matters
 * here — `claude-opus-5` names no window, and this repo runs it at both 200k
 * and 1M, so the same model string spends against two denominators five times
 * apart. A declaration is a fact a person wrote.
 *
 * `0` IS THE DEFAULT AND MEANS UNSTATED, so an agent whose charter names no
 * window reads `unknown` rather than being measured against a number nobody
 * chose. That is the estate today.
 */
export const CharterBoundsSchema = z.object({
  contextCeiling: z.number().gt(0).lte(1).default(1),
  contextWindow: z.number().int().gte(0).default(0),
  atCeiling: z.enum(['finish', 'end']).default('finish'),
});

/**
 * A charter's wire form.
 *
 * `name` and `prompt` are required: a charter nobody can name cannot be asked
 * for, and one naming no prompt declares nothing a consumer can act on. The
 * rest describe the agent and default to unstated.
 *
 * `.strict()` — an unknown key is REFUSED rather than dropped. The opposite
 * choice is right for {@link DeclarationSchema}, where a newer agent writing a
 * field an older parse does not know is not a malformed report. A charter is
 * written by a person and read by the loop that launches on it, so an unknown
 * key is a typo whose cost is an agent silently running under a charter that
 * says something other than what was meant. This is also what makes
 * {@link charterRefusesRunFacts} enforceable: a schema that drops `pid` would
 * accept the exact document the charter exists to refuse.
 */
export const CharterSchema = z
  .object({
    name: z.string().min(1),
    prompt: z.string().min(1),
    harness: z.string().default(''),
    model: z.string().default(''),
    effort: z.string().default(''),
    capabilities: z.array(z.string()).default([]),
    // THE INNER DEFAULTS ARE SPELT OUT, not left to `.default({})`. Zod applies
    // an object default as a whole value rather than parsing it, so `{}` lands
    // as `{}` and a charter that states no bounds gets no ceiling at all.
    bounds: CharterBoundsSchema.default({
      contextCeiling: 1,
      contextWindow: 0,
      atCeiling: 'finish',
    }),
  })
  .strict();

/**
 * What a person declared one agent to be.
 *
 * Identity: the name it carries, which is what {@link CHARTER_ENV_VAR} holds
 * and what the file is named for. Declared rather than derived — a matcher
 * reading a plan could guess a capability, and a guess that is usually right
 * produces a fleet whose wrong answers cannot be explained.
 *
 * Capability and bounds only. It carries no run fact; see {@link RUN_FACTS}.
 */
export interface Charter {
  /** The agent's name — the identity, and the file's stem. */
  name: string;
  /** The prompt file this agent runs, relative to the repo root. */
  prompt: string;
  /** The harness that runs it; `''` when unstated. */
  harness: string;
  /** The model it runs on; `''` when unstated. */
  model: string;
  /** The reasoning effort it asks for; `''` when unstated. */
  effort: string;
  /** What it can do; empty when it named none. */
  capabilities: readonly string[];
  /** What it may spend. */
  bounds: CharterBounds;
}

/** What an agent may spend. */
export interface CharterBounds {
  /** The fraction of the context window past which it is spent, 0–1. */
  contextCeiling: number;
  /** The window that fraction is taken of, in tokens; `0` when unstated. */
  contextWindow: number;
  /** What happens at the ceiling. */
  atCeiling: 'finish' | 'end';
}

/**
 * The outcome of asking for one agent's charter.
 *
 * FOUR OUTCOMES, AND THE LAST TWO ARE NOT ONE, for the reason
 * {@link DeclarationReading} gives: `absent` is no charter, which is the estate
 * today and means the fallback prompt is correct; `unreadable` is a file that
 * exists and does not parse, which is a person's typo and must not be answered
 * with a silent fallback. `unnamed` is a third absence and a different one —
 * nothing asked for a charter, so no file was looked for at all.
 */
export type CharterReading =
  | { read: 'declared'; charter: Charter }
  | { read: 'unnamed' }
  | { read: 'absent'; name: string }
  | { read: 'unreadable'; name: string; why: string };

/**
 * Whether a document carries any field a charter refuses.
 *
 * Asked of the PARSED JSON rather than of a {@link Charter}: by the time a
 * charter exists the run facts are gone, so the interesting question is whether
 * the document on disk had them.
 *
 * @param json - the parsed document, of any shape.
 * @returns the run facts it carries, in {@link RUN_FACTS} order; empty when it
 *   carries none.
 */
export const runFactsIn = (json: unknown): readonly string[] => {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return [];
  const keys = new Set(Object.keys(json as Record<string, unknown>));
  return RUN_FACTS.filter((field) => keys.has(field));
};

/**
 * Whether a document declares an agent without describing a run.
 *
 * @param json - the parsed document, of any shape.
 * @returns true when it carries no field named in {@link RUN_FACTS}.
 */
export const charterRefusesRunFacts = (json: unknown): boolean => runFactsIn(json).length === 0;

/**
 * Reads a charter from the text of one file.
 *
 * Takes the text rather than a path: the domain does not touch the disk, so the
 * caller decides what it read and this decides what it means. `null` is how a
 * caller says the file was not there.
 *
 * A document carrying a run fact is `unreadable` rather than parsed-and-
 * stripped. Stripping would accept a charter that says `branch` and run an
 * agent that never reads it, which is the silent half of the duplication being
 * removed.
 *
 * @param name - the agent name that was asked for.
 * @param text - the file's contents, or null when there is no file.
 * @returns what was declared, or why it could not be read.
 */
export const readCharter = (name: string, text: string | null): CharterReading => {
  if (name === '') return { read: 'unnamed' };
  if (text === null) return { read: 'absent', name };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { read: 'unreadable', name, why: 'not JSON' };
  }

  const carried = runFactsIn(json);
  if (carried.length > 0) {
    return {
      read: 'unreadable',
      name,
      why: `carries run facts a charter refuses: ${carried.join(', ')}`,
    };
  }

  const parsed = CharterSchema.safeParse(json);
  if (!parsed.success) {
    return {
      read: 'unreadable',
      name,
      why: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    };
  }

  return { read: 'declared', charter: { ...parsed.data } };
};

/**
 * The path a named agent's charter is read from.
 *
 * @param name - the agent name.
 * @returns the repo-root-relative path.
 */
export const charterPath = (name: string): string =>
  `${CHARTER_DIRECTORY}/${name}${CHARTER_EXTENSION}`;
