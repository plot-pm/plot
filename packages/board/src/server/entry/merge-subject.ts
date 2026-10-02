// THROUGH THE NARROW PATH, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { mergeSubjectForms } from '@plot-pm/domain/adapters/host/merge-subjects';
import { mergedBySubject, type MergeSubject } from '@plot-pm/domain/rules/merge-subject';
import { ownerOfRemote } from '@plot-pm/domain/rules/remote-owner';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Which of a plan's refless branches a merge subject proves landed — the rules
 * `mergedBySubject` and `ownerOfRemote` reached without HTTP, for
 * `plot-fleet-scan.sh`.
 *
 * ```
 * plot-merge-subject.mjs pairs   < readings   # the pairs needing an ancestry test
 * plot-merge-subject.mjs proven  < readings   # the proof, given the answers
 * ```
 *
 * **ASKED TWICE PER SCAN, with one reading between the calls.** The age rule
 * needs to know whether a merge is contained in the commit that added the plan
 * file, and that is a git question the domain may not ask. So the first call
 * answers which pairs need the test, the shell runs one
 * `git merge-base --is-ancestor` per pair, and the second call applies the rule
 * to the answers. The decision stays here; the shell only reads git.
 *
 * **ONCE PER SCAN, not once per plan.** The scan walks hundreds of plans on a
 * 5-second pulse, and the batched walks it reads from cost 0.10 s against
 * 5.23 s for the per-plan lookup they replace. Two process starts at ~39 ms
 * each is the whole cost of asking the domain.
 *
 * **Its own bundle for the reason the others give.** `plot-ask.mjs` answers by
 * RUNNING `plot-fleet-scan.sh`, so the scan asking it would be an artifact
 * calling the script that called it. This entry spawns nothing and reads
 * nothing but stdin.
 *
 * ## The stdin format
 *
 * Sections, each opened by a `@` line, so one stream carries a walk of up to
 * 2000 merges and a section per plan without a JSON round trip the shell would
 * need `jq` for:
 *
 * ```
 * @backend <word>                 # as `plot-host.sh backend` answers it
 * @origin <url>                   # the `origin` URL, unparsed
 * @merges                         # then `<hash> <subject>` per line
 * <sha> Merge pull request #12 from acme/bug/flaky
 * @plan <file>                    # the plan's dated file, repository-relative
 * @added <sha>                    # the commit that first added that file, or `-`
 * <branch>                        # then one refless branch per line
 * @ancestry <merge> <added> <yes|no|unknown>   # `proven` only
 * ```
 *
 * A plan whose adding commit is `-` gets no subjects: the walk did not answer
 * for it, and its branches fall through to the host as they do today.
 *
 * ## The output
 *
 * `pairs` writes one tab-separated line per pair the rule matched:
 *
 * ```
 * <plan>\t<branch>\t<merge>\t<added>
 * ```
 *
 * `proven` writes one line per plan, then the detection word:
 *
 * ```
 * proven\t<plan>\t<branch>
 * ignored\t<plan>\t<branch>\t<merge>      # a subject refused for age
 * detect\t<pr-merge|none>
 * ```
 *
 * **Tab-separated**, for the reason `verdicts.ts` gives: the caller is bash
 * inside a loop that already speaks `IFS=$'\t' read`, and JSON there would mean
 * `jq` per line.
 *
 * **The detection word says whether this host's subjects can be read at all** —
 * `pr-merge` where the walk holds a conforming subject, `none` where it holds
 * none, which is a squash-merge estate or a host with no form. The scan turns
 * `none` into its own footer word and adds `truncated` from its own cap, which
 * this bundle cannot see.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The rule answered. */
  ok: 0,
  /** The caller named no verb, or one this does not have. */
  usage: 2,
} as const;

/**
 * One plan's section of the readings.
 */
interface PlanSection {
  /** The plan's dated file, repository-relative, as the scan names it. */
  file: string;
  /**
   * The commit that first added that file, or `null` where the walk did not
   * answer — a renamed chain ending outside the walk, or a failed walk.
   *
   * `null` means NO SUBJECTS for this plan. The age rule cannot be applied
   * without it, and applying no age rule is what let a reused name settle a
   * slice nobody started.
   */
  added: string | null;
  /** The plan's branches that carry no ref — the only ones a subject may prove. */
  branches: string[];
}

/**
 * Everything the readings carry.
 */
interface Readings {
  /** The backend word, which selects the forms. */
  backend: string;
  /** The `origin` URL, unparsed — this entry calls `ownerOfRemote` on it. */
  origin: string;
  /** The merges on the default branch. */
  merges: MergeSubject[];
  /** One section per plan. */
  plans: PlanSection[];
  /**
   * The ancestry answers, keyed `<merge> <added>`.
   *
   * `true` means the merge IS contained in the adding commit, which refuses
   * the subject. A pair with no answer, and an `unknown` answer, both prove
   * nothing: the rule cannot tell a reused name from a current one without it.
   */
  ancestry: Map<string, boolean | null>;
}

/**
 * Parses the sectioned readings.
 *
 * @param stdin - the readings as the scan wrote them.
 * @returns the readings, with unknown lines ignored.
 */
export const parseReadings = (stdin: string): Readings => {
  const out: Readings = {
    backend: '',
    origin: '',
    merges: [],
    plans: [],
    ancestry: new Map(),
  };
  // `merges`, a plan's branches and `ancestry` are all line-per-item sections,
  // so the parser carries which one it is in rather than re-testing every line.
  let section: 'none' | 'merges' | 'branches' = 'none';
  let plan: PlanSection | null = null;
  for (const line of stdin.split('\n')) {
    if (line === '') continue;
    if (line.startsWith('@')) {
      const space = line.indexOf(' ');
      const verb = space === -1 ? line.slice(1) : line.slice(1, space);
      const rest = space === -1 ? '' : line.slice(space + 1);
      switch (verb) {
        case 'backend':
          out.backend = rest;
          section = 'none';
          break;
        case 'origin':
          out.origin = rest;
          section = 'none';
          break;
        case 'merges':
          section = 'merges';
          break;
        case 'plan':
          plan = { file: rest, added: null, branches: [] };
          out.plans.push(plan);
          section = 'branches';
          break;
        case 'added':
          // `-` is the scan's word for a reading it does not have, and it is
          // NOT a commit. Kept as `null` so the age rule refuses rather than
          // testing ancestry against a hash that does not exist.
          if (plan !== null) plan.added = rest === '-' || rest === '' ? null : rest;
          break;
        case 'ancestry': {
          const [merge, added, answer] = rest.split(' ');
          if (merge !== undefined && added !== undefined) {
            out.ancestry.set(
              `${merge} ${added}`,
              answer === 'yes' ? true : answer === 'no' ? false : null,
            );
          }
          break;
        }
        default:
          // An unknown section is ignored rather than refused: a newer scan
          // may write a section this bundle does not read, and the answer it
          // can still give is better than no answer at all.
          section = 'none';
      }
      continue;
    }
    if (section === 'merges') {
      const space = line.indexOf(' ');
      // A merge with no subject proves nothing and is dropped rather than
      // stored with an empty one, which would match a form only if a form were
      // empty.
      if (space > 0) out.merges.push({ sha: line.slice(0, space), subject: line.slice(space + 1) });
      continue;
    }
    if (section === 'branches' && plan !== null) plan.branches.push(line);
  }
  return out;
};

/**
 * One pair the age rule must be asked about.
 */
interface Pair {
  /** The plan whose branch this is. */
  plan: string;
  /** The branch the subject names. */
  branch: string;
  /** The merge commit that names it. */
  merge: string;
  /** The commit that added the plan file. */
  added: string;
}

/**
 * The pairs a subject matched, each needing one ancestry test.
 *
 * KEYED BY PLAN AND BRANCH. One plan's proof must never settle another plan's
 * reused name, so the rule is asked once per plan with that plan's own
 * branches rather than once over a union.
 *
 * @param readings - the parsed readings.
 * @returns one entry per matched pair, in walk order.
 */
export const pairsOf = (readings: Readings): Pair[] => {
  const forms = mergeSubjectForms(readings.backend);
  const owner = ownerOfRemote(readings.origin);
  const out: Pair[] = [];
  for (const plan of readings.plans) {
    // NO ADDING COMMIT, NO SUBJECTS. The age rule is what separates a current
    // name from a reused one, and without the commit it cannot be applied —
    // so the branch goes to the host rather than being proven unaged.
    if (plan.added === null) continue;
    for (const match of mergedBySubject({
      subjects: readings.merges,
      branches: plan.branches,
      forms,
      owner,
    })) {
      out.push({ plan: plan.file, branch: match.branch, merge: match.sha, added: plan.added });
    }
  }
  return out;
};

/**
 * What the rule proved, and what it refused.
 */
interface Proof {
  /** The branches proven, per plan — `<plan>\t<branch>` pairs. */
  proven: Array<{ plan: string; branch: string }>;
  /** The pairs refused because the merge predates the plan. */
  ignored: Array<{ plan: string; branch: string; merge: string }>;
  /** Whether this estate's subjects can be read at all. */
  detect: 'pr-merge' | 'none';
}

/**
 * Applies the age rule to the pairs, given the ancestry answers.
 *
 * **A SUBJECT PROVES A BRANCH ONLY WHEN ITS MERGE IS NOT CONTAINED IN THE
 * COMMIT THAT ADDED THE PLAN FILE.** A later plan may reuse a merged branch
 * name — a reopened ticket does this, and one measured estate holds 87 reused
 * names — and the earlier merge says nothing about work the later plan names.
 *
 * **A branch proven by ANY of its merges is proven.** A name merged twice
 * yields two pairs, and the newer merge is the one that can postdate the plan;
 * refusing the branch because its older merge was refused would lose the
 * current landing.
 *
 * **`unknown` proves nothing.** An ancestry test that could not be run leaves
 * the branch where it was, which is the host's to answer.
 *
 * @param readings - the parsed readings, carrying the ancestry answers.
 * @returns the branches proven per plan, the pairs refused for age, and the
 *   detection word.
 */
export const proofOf = (readings: Readings): Proof => {
  const pairs = pairsOf(readings);
  const proven = new Set<string>();
  const ignored: Proof['ignored'] = [];
  for (const pair of pairs) {
    const contained = readings.ancestry.get(`${pair.merge} ${pair.added}`);
    if (contained === true) {
      ignored.push({ plan: pair.plan, branch: pair.branch, merge: pair.merge });
      continue;
    }
    // `undefined` — no answer given — and `null` — the test could not answer —
    // both prove nothing. Only a definite `not contained` does.
    if (contained === false) proven.add(`${pair.plan}\t${pair.branch}`);
  }
  return {
    proven: [...proven].map((key) => {
      const tab = key.indexOf('\t');
      return { plan: key.slice(0, tab), branch: key.slice(tab + 1) };
    }),
    // REPORTED ONLY WHERE NOTHING ELSE PROVED THE BRANCH. A name merged twice,
    // once before its plan and once after, is proven — and reporting it as
    // ignored as well would count a branch the scan reads as `merged` among the
    // subjects it could not use.
    ignored: ignored.filter((i) => !proven.has(`${i.plan}\t${i.branch}`)),
    detect: detectOf(readings),
  };
};

/**
 * Whether this estate's merge subjects can be read at all.
 *
 * READ FROM THE WALK, not from the backend word. A host with a form whose
 * estate squashes every merge writes no conforming subject, and a footer
 * saying its subjects are readable would be wrong about the one thing the word
 * exists to say.
 *
 * It asks about the FORMS ALONE, with no branch and no owner: the question is
 * whether this host's subjects appear here, not whether any plan's branch
 * landed. A conforming subject naming a branch no plan names still proves the
 * estate writes them.
 *
 * @param readings - the parsed readings.
 * @returns `pr-merge` where a conforming subject was found, `none` otherwise.
 */
const detectOf = (readings: Readings): 'pr-merge' | 'none' => {
  const forms = mergeSubjectForms(readings.backend);
  if (forms.length === 0) return 'none';
  // The branch placeholder matches any non-empty branch name, which is what
  // makes this a question about the FORM. `mergedBySubject` is not reused here:
  // it needs the branch as literal text, and there is no branch to give it.
  for (const form of forms) {
    const body = form
      .replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
      .split('<branch>')
      .join('.+')
      .split('<number>')
      .join('\\d+')
      .split('<owner>')
      .join('[^/]+');
    const pattern = new RegExp(`^${body}$`);
    if (readings.merges.some((m) => pattern.test(m.subject))) return 'pr-merge';
  }
  return 'none';
};

/**
 * Answers the verb.
 *
 * @param argv - the arguments after the script name.
 * @param stdin - the readings.
 * @param write - where the answer goes.
 * @param warn - where a usage refusal goes.
 * @returns the process exit code.
 */
export const run = (
  argv: string[],
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  const verb = argv[0];
  if (verb !== 'pairs' && verb !== 'proven') {
    warn('plot-merge-subject: usage: plot-merge-subject.mjs <pairs|proven> < readings\n');
    return EXIT.usage;
  }
  const readings = parseReadings(stdin);
  if (verb === 'pairs') {
    for (const p of pairsOf(readings)) {
      write(`${p.plan}\t${p.branch}\t${p.merge}\t${p.added}\n`);
    }
    return EXIT.ok;
  }
  const proof = proofOf(readings);
  for (const p of proof.proven) write(`proven\t${p.plan}\t${p.branch}\n`);
  for (const i of proof.ignored) write(`ignored\t${i.plan}\t${i.branch}\t${i.merge}\n`);
  write(`detect\t${proof.detect}\n`);
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
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(process.argv.slice(2), Buffer.concat(chunks).toString('utf8')));
}
