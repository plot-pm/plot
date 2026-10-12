import { plangate, planGateHint, type PlanGateRefusal } from '@plot-pm/domain/workflows/dispatch';

/** What `plot-ask.mjs plangate` was told, after flag parsing. */
export interface PlanGateAsk {
  slug: string;
  source: string;
  defaultBranch: string;
  refResolved: boolean;
  allowLocal: boolean;
}

/** The answer: an exit code, and the lines to print on stderr. */
export interface PlanGateAnswer {
  code: 0 | 1 | 2;
  lines: string[];
}

const FLAGS_WITH_VALUE = ['--slug', '--source', '--default-branch'] as const;

/**
 * Parse the flags of `plot-ask.mjs plangate`.
 *
 * @param argv - the arguments after the verb.
 * @returns the ask, or null when a required flag is missing or one is unknown.
 */
export const planGateAskFrom = (argv: readonly string[]): PlanGateAsk | null => {
  const values = new Map<string, string>();
  let refResolved = false;
  let allowLocal = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    if (flag === '--ref-resolved') refResolved = true;
    else if (flag === '--allow-local') allowLocal = true;
    else if ((FLAGS_WITH_VALUE as readonly string[]).includes(flag)) {
      const value = argv[i + 1];
      if (value === undefined) return null;
      values.set(flag, value);
      i += 1;
    } else return null;
  }
  const slug = values.get('--slug');
  const defaultBranch = values.get('--default-branch');
  if (!slug || !defaultBranch) return null;
  return { slug, source: values.get('--source') ?? '', defaultBranch, refResolved, allowLocal };
};

/**
 * Run the dispatch plan gate over the plan-meta JSON the caller read.
 *
 * Exit 0 where the plan may be fanned out, 1 on a refusal with the rule's
 * detail and the next command on stderr. An empty or unparseable document means
 * the plan was not read, which `plangate` refuses as `plan-unreadable`.
 *
 * @param ask - the parsed flags.
 * @param metaJson - the stdin document: one `plot-plan-meta.sh` record, or empty.
 * @returns the exit code and the stderr lines.
 */
export const planGateAnswer = (ask: PlanGateAsk, metaJson: string): PlanGateAnswer => {
  let meta: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(metaJson);
    if (parsed && typeof parsed === 'object') meta = parsed as Record<string, unknown>;
  } catch {
    meta = null;
  }
  const text = (key: string): string => {
    const value = meta?.[key];
    return typeof value === 'string' ? value : '';
  };
  const refusal = plangate(
    {
      inRepository: true,
      slug: ask.slug,
      defaultBranch: ask.defaultBranch,
      candidates: [],
      workerCommand: 'unconfigured',
      gate: {
        refResolved: ask.refResolved,
        // The caller found the plan before it asked; a record that did not
        // parse is an unreadable plan, not a missing one.
        file: meta === null ? ask.source || 'unread' : text('file'),
        parsed: meta !== null,
        phase: text('phase'),
        impl: text('impl'),
        source: ask.source,
      },
    },
    { allowLocal: ask.allowLocal },
  );
  if (!refusal) return { code: 0, lines: [] };
  return {
    code: 1,
    lines: [
      `plot-dispatch: ${refusal.detail}`,
      `  ${planGateHint(refusal.reason as PlanGateRefusal, ask.slug, ask.defaultBranch)}`,
    ],
  };
};
