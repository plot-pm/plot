// THROUGH THE NARROW PATHS, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { releaseChainStep, type ReleaseChainHop, type ReleaseChainStep } from '@plot-pm/domain/rules/release-chain';
import { releasePr, releaseTag, type ReleasePrRow, type ReleaseTagPrRow } from '@plot-pm/domain/rules/release-tag';
import { branchClaims } from '@plot-pm/domain/rules/cross-repo-reference';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { PlanStore } from '@plot-pm/domain/ports/plan-store';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

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

/** The ports a plan's release resolution reads — `releasePr`/`releaseTag`'s readings, plus {@link resolveRelease}'s walk for the cases the direct tag lookup cannot tell apart from a shallow clone. */
export interface ReleasePorts {
  readonly planStore: Pick<PlanStore, 'readPlan' | 'readText'>;
  readonly host: Pick<Host, 'prState'> & ResolvePorts['host'];
  readonly refs: Pick<Refs, 'tagsContaining'> & ResolvePorts['refs'];
}

/**
 * Resolves section 6's question for one delivered plan — `releasePr` then
 * `releaseTag`, read the same way `--release` reads them, instead of the
 * shell's own `last_pr="${prs##*,}"`.
 *
 * Every non-deferred local PR {@link releasePr} names is asked for its merge
 * commit and `mergedAt`; a plan with no local PR to ask about never reaches
 * {@link Host.prState} at all — `all-foreign` and `none` both answer for free.
 * Where ANY of those PRs carries no merge commit, the walk
 * {@link resolveRelease} already owns (a PR merged into a non-default branch,
 * or a Bitbucket merge commit no ref ever carried) answers instead — the
 * direct tag lookup cannot tell those two cases apart from a shallow clone,
 * and the walk already names each one correctly. That check precedes every
 * tag lookup, the order `runRelease` reads these in: a tag found for the
 * last-merged PR must not answer for a plan whose sibling PR is unresolved.
 *
 * `none` is the caller's to report, not to skip: {@link releasePr} answers it
 * for a plan whose every PR is deferred and for a non-deferred branch naming
 * none, and `/plot-release` refuses both. It is not `unreleased`.
 *
 * @param input - the plan file to read, the repository's default branch, the scan's PR source, and whether it skipped `git fetch`.
 * @param ports - the plan store, host and refs ports this reads.
 * @param warn - where a host refusal's own words go, same as {@link resolveRelease}.
 * @returns the output line, without its newline — `shipped\t...`, `unreleased`, `all-foreign\t...`, `none`, or `finding\t...`.
 */
export const resolvePlanRelease = async (
  input: { readonly planFile: string; readonly defaultBranch: string; readonly prSource: string; readonly noFetch: boolean },
  ports: ReleasePorts,
  warn: (s: string) => void,
): Promise<string> => {
  const { planFile, defaultBranch, prSource, noFetch } = input;
  const parsed = await ports.planStore.readPlan(planFile);
  const text = await ports.planStore.readText(planFile);
  const deferredBranches = new Set(
    parsed.ok ? parsed.value.slices.flatMap((slice) => slice.branches).filter((b) => b.deferred).map((b) => b.branch) : [],
  );
  const prRows: readonly ReleasePrRow[] =
    text.ok && text.value !== null
      ? branchClaims(text.value).map((claim) => ({ reference: claim.reference, deferred: deferredBranches.has(claim.branch) }))
      : [];
  const prResult = releasePr(prRows);

  if (prResult.outcome === 'none') return 'none';
  if (prResult.outcome === 'all-foreign') return `all-foreign\t${prResult.repos.join(',')}`;

  const prs = await Promise.all(
    prResult.numbers.map(async (number) => {
      const state = await ports.host.prState(number);
      const pr = state.ok ? state.value : null;
      return {
        number,
        mergeCommit: pr?.mergeCommit ?? '',
        mergedAt: pr?.mergedAt ?? '',
        base: pr?.base ?? '',
      };
    }),
  );

  const lastPr = prs.reduce((latest, pr) => (pr.mergedAt > latest.mergedAt ? pr : latest));

  // EVERY PR IS CHECKED FOR A MERGE COMMIT BEFORE ANY TAG IS LOOKED UP, the
  // order `runRelease` reads these in (deliver.ts: `prs.find(mergeCommit ===
  // '')` precedes every `tagsContaining`). Asking for a tag first lets the
  // weaker answer win: `unreleased` is reportable as "nothing wrong yet",
  // while an unanswered merge commit is "cannot tell", and a plan whose
  // sibling PR the host could not answer for would read as the former.
  // `tagsContaining('')` is also not a question git can answer — `git tag
  // --contains ''` exits non-zero, and the resulting `[]` is
  // indistinguishable from "a real commit no tag contains".
  const noCommit = prs.find((pr) => pr.mergeCommit === '');
  if (noCommit !== undefined) {
    // THE DIRECT PATH, kept exactly where it always lived — a merge commit
    // already in this clone resolves its tag with no host call beyond the
    // `prState` reads above, which `releasePr`'s local outcome already needs.
    // The walk is handed the PR THAT CARRIES NO COMMIT, not whichever merged
    // last: a reader sent to verify a PR number must be sent to the one the
    // host could not answer for.
    return resolveRelease(
      { pr: String(noCommit.number), mergeCommit: '', mergedAt: noCommit.mergedAt, base: noCommit.base, defaultBranch, prSource, noFetch },
      ports,
      warn,
    );
  }
  const lastTags = await ports.refs.tagsContaining(lastPr.mergeCommit);
  if (!lastTags.ok) {
    return resolveRelease(
      { pr: String(lastPr.number), mergeCommit: lastPr.mergeCommit, mergedAt: lastPr.mergedAt, base: lastPr.base, defaultBranch, prSource, noFetch },
      ports,
      warn,
    );
  }
  const firstTag = lastTags.value[0];
  if (firstTag === undefined) return 'unreleased';

  const prRowsForTag: ReleaseTagPrRow[] = await Promise.all(
    prs.map(async (pr) => {
      if (pr.number === lastPr.number) return { ...pr, containingTags: lastTags.value };
      const tags = await ports.refs.tagsContaining(pr.mergeCommit);
      return { ...pr, containingTags: tags.ok ? tags.value : [] };
    }),
  );

  const resolved = releaseTag({ prs: prRowsForTag, wantedVersion: firstTag });
  if (resolved.outcome === 'resolved') return `shipped\t${resolved.tag}`;
  return `finding\tdelivered, ${resolved.detail}`;
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

const USAGE =
  'plot-release-chain: usage: plot-release-chain.mjs resolve <pr> <default-branch> <pr-source> <no-fetch: 0|1> < pr-state-row\n' +
  '                 or: plot-release-chain.mjs release <plan-file> <default-branch> <pr-source> <no-fetch: 0|1>\n';

/**
 * Answers the verb.
 *
 * @param argv - the arguments after the script name.
 * @param stdin - the `pr-state` row, read only by `resolve`.
 * @param ports - the host, refs and plan-store ports either verb reads.
 * @param write - where the answer goes.
 * @param warn - where a usage refusal and a host refusal go.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  stdin: string,
  ports: ReleasePorts,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  const [verb, target, defaultBranch, prSource = '', noFetchArg = ''] = argv;
  if (target === undefined || defaultBranch === undefined || (verb !== 'resolve' && verb !== 'release')) {
    warn(USAGE);
    return EXIT.usage;
  }
  const noFetch = noFetchArg === '1' || noFetchArg === 'true';
  const line =
    verb === 'resolve'
      ? await resolveRelease({ pr: target, defaultBranch, prSource, noFetch, ...parseRow(stdin) }, ports, warn)
      : await resolvePlanRelease({ planFile: target, defaultBranch, prSource, noFetch }, ports, warn);
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
  // Read only for `resolve` — `release` takes a plan file on argv and never
  // reads stdin, so a caller that does not redirect it (unlike `resolve`'s
  // `<<<"$pr_state_row"`) must not block this process waiting for EOF.
  let stdin = '';
  if (process.argv[2] === 'resolve') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    stdin = Buffer.concat(chunks).toString('utf8');
  }
  void endEntry(
    await run(process.argv.slice(2), stdin, {
      host: hostShell(context),
      refs: refsGit(context),
      planStore: planStoreShell(context),
    }),
  );
}
