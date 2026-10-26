// THROUGH THE NARROW PATHS, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { releaseChainStep, type ReleaseChainHop, type ReleaseChainStep } from '@plot-pm/domain/rules/release-chain';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Refs } from '@plot-pm/domain/ports/refs';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Section 6 of `plot-reconcile-scan.sh` for a delivered plan whose PR's merge
 * commit is empty or absent from the clone.
 *
 * ```
 * plot-release-chain.mjs resolve <pr> <default-branch> <pr-source> < pr-state-row
 * ```
 *
 * Reads the `plot-host.sh pr-state` row on stdin. Where the PR merged into a
 * non-default branch, it walks that branch's merged PRs onward through the
 * host port, tests containment through the refs port, and asks
 * {@link releaseChainStep} for each step. The scan calls this once per plan
 * that reaches the case, not once per agent per pass.
 *
 * ## The output
 *
 * One line:
 *
 * ```
 * shipped\t<tag> via <destination>
 * unreleased
 * finding\t<finding text, with `\n` escapes for its second line>
 * ```
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The answer is on stdout. */
  ok: 0,
  /** The caller named no verb, or one this does not have. */
  usage: 2,
} as const;

/** What the scan knows about the plan's PR. */
export interface ResolveInput {
  /** The PR number the plan names last. */
  readonly pr: string;
  /** The PR's merge commit, or `''` where the host named none. */
  readonly mergeCommit: string;
  /** When the PR itself merged, ISO-8601, or `''` where the host did not say. */
  readonly mergedAt: string;
  /** The branch the PR merged into, or `''` where the host did not say. */
  readonly base: string;
  /** The repository's default branch. */
  readonly defaultBranch: string;
  /** The scan's PR source: the CLI name `gh` or `bb`, or a status word. */
  readonly prSource: string;
  /** Whether the scan ran `--no-fetch`/`--offline`, skipping `git fetch`. */
  readonly noFetch: boolean;
}

/** The ports a walk reads. */
export interface ResolvePorts {
  readonly host: Pick<Host, 'prMergeDests' | 'lastRefusal'>;
  readonly refs: Pick<Refs, 'contains' | 'tagsContaining'>;
}

const fetchAdvice = (prSource: string, noFetch: boolean): string => {
  if (prSource === 'bb') return 'unreachable: Bitbucket exposes no ref for this merge commit — a fetch cannot bring it';
  if (noFetch) return 're-run without --no-fetch/--offline: this scan skipped git fetch, so a commit a fetch would bring reads as missing';
  return 'inspect: shallow clone, or a destination this remote never held — git fetch --tags origin, then re-run';
};

const inspectPr = (prSource: string, pr: string): string => {
  if (prSource === 'gh') return `gh pr view ${pr} --json state,mergeCommit`;
  if (prSource === 'bb') return `bb pr view ${pr} --json`;
  return `plot-host.sh pr-state ${pr}`;
};

const refusalText = (step: Extract<ReleaseChainStep, { outcome: 'refused' }>): string => {
  if (step.reason === 'host-failed') return `cannot tell (the host did not answer for '${step.branch}')`;
  if (step.reason === 'ambiguous') {
    return `cannot tell (ambiguous at '${step.branch}': ${step.candidates} merged PRs qualify)`;
  }
  return `cannot resolve (${step.reason} at '${step.branch}')`;
};

/**
 * Walks the release chain of one plan's PR and answers the scan's line.
 *
 * @param input - the PR, its merge commit and destination, and the scan's context.
 * @param ports - the host and refs ports the walk reads.
 * @param warn - where a host refusal's own words go.
 * @returns the output line, without its newline.
 */
export const resolveRelease = async (
  input: ResolveInput,
  ports: ResolvePorts,
  warn: (s: string) => void,
): Promise<string> => {
  const { pr, mergeCommit, mergedAt, base, defaultBranch, prSource, noFetch } = input;
  if (mergeCommit === '') {
    return `finding\tdelivered, but PR #${pr} has no merge commit → cannot resolve\\n    inspect: ${inspectPr(prSource, pr)}`;
  }
  if (base === '' || base === defaultBranch) {
    return `finding\tdelivered, PR #${pr} names merge commit ${mergeCommit}, not in this clone → cannot resolve\\n    ${fetchAdvice(prSource, noFetch)}`;
  }
  const into = `delivered, PR #${pr} merged into '${base}' →`;
  const hops: ReleaseChainHop[] = [];
  for (;;) {
    const step = releaseChainStep({
      defaultBranch,
      planCommit: { commit: mergeCommit, mergedAt },
      destination: base,
      hops,
    });
    if (step.outcome === 'refused') return `finding\t${into} ${refusalText(step)}`;
    if (step.outcome === 'resolved') {
      const tags = await ports.refs.tagsContaining(step.mergeCommit);
      if (!tags.ok) {
        return `finding\t${into} cannot tell (merge commit ${step.mergeCommit} on '${defaultBranch}' is not in this clone)\\n    ${fetchAdvice(prSource, noFetch)}`;
      }
      const tag = tags.value[0];
      return tag === undefined ? 'unreleased' : `shipped\t${tag} via ${base}`;
    }
    const merged = await ports.host.prMergeDests(step.branch);
    if (!merged.ok) {
      const said = ports.host.lastRefusal()?.said ?? '';
      warn(`plot-release-chain: pr-merge-dest ${step.branch} failed${said === '' ? '' : `: ${said}`}\n`);
      hops.push({ answered: false });
      continue;
    }
    const candidates = [];
    for (const dest of merged.value) {
      const contains = await ports.refs.contains(step.previous, dest.mergeCommit);
      candidates.push({ ...dest, contains: contains.ok ? contains.value : ('unknown' as const) });
    }
    hops.push({ answered: true, candidates });
  }
};

/**
 * Parses the `pr-state` row.
 *
 * @param stdin - the row as `plot-host.sh pr-state` printed it.
 * @returns the merge commit, its merge time, and the destination, each `''` where absent or unreadable.
 */
export const parseRow = (stdin: string): { mergeCommit: string; mergedAt: string; base: string } => {
  try {
    const row = JSON.parse(stdin) as { mergeCommit?: unknown; mergedAt?: unknown; base?: unknown };
    return {
      mergeCommit: typeof row.mergeCommit === 'string' ? row.mergeCommit : '',
      mergedAt: typeof row.mergedAt === 'string' ? row.mergedAt : '',
      base: typeof row.base === 'string' ? row.base : '',
    };
  } catch {
    return { mergeCommit: '', mergedAt: '', base: '' };
  }
};

/**
 * Answers the verb.
 *
 * @param argv - the arguments after the script name.
 * @param stdin - the `pr-state` row.
 * @param ports - the host and refs ports the walk reads.
 * @param write - where the answer goes.
 * @param warn - where a usage refusal and a host refusal go.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  stdin: string,
  ports: ResolvePorts,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  const [verb, pr, defaultBranch, prSource = '', noFetchArg = ''] = argv;
  if (verb !== 'resolve' || pr === undefined || defaultBranch === undefined) {
    warn(
      'plot-release-chain: usage: plot-release-chain.mjs resolve <pr> <default-branch> <pr-source> <no-fetch: 0|1> < pr-state-row\n',
    );
    return EXIT.usage;
  }
  const noFetch = noFetchArg === '1' || noFetchArg === 'true';
  const line = await resolveRelease({ pr, defaultBranch, prSource, noFetch, ...parseRow(stdin) }, ports, warn);
  write(`${line}\n`);
  return EXIT.ok;
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const context = { repoRoot: process.cwd(), scriptDir };
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const stdin = Buffer.concat(chunks).toString('utf8');
  process.exit(await run(process.argv.slice(2), stdin, { host: hostShell(context), refs: refsGit(context) }));
}
