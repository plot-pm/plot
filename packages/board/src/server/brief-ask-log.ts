/**
 * When a branch's brief was ASKED for — read from the log the asker leaves.
 *
 * A leaf module beside {@link ./brief-path.js} and for its reason: three callers
 * would otherwise each carry the path convention, and a fourth spelling of where
 * the log lives is how a reading goes blind to half the asks.
 *
 * **THE READING IS AN AGE AND NEVER A VERDICT.** It answers *when was the ask
 * made* and stops. Whether a writer is still running is a question this
 * deliberately does not ask, and the plan that specified it did so because its
 * own author got it wrong: drafting it, he checked
 * `.plot/brief-a-marker-names-its-writer.log` at 25 and at 40 seconds, found 0
 * bytes with no visible process, and concluded the writer had died. It had not.
 * The log reached 2553 bytes and the brief landed on `origin/main`.
 *
 * So an EMPTY log is an ask like any other. A brief writer takes minutes and
 * writes nothing until it is done, which makes size evidence of nothing at all —
 * the mtime is the fact, and it is the only one read here.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * The two places an ask leaves its log, because there are two askers.
 *
 * **MEASURED 2026-09-13, and the plan did not anticipate it.** The plan names
 * one path — `.plot/brief-<slug>.log`, which is `plot-dispatch.sh:701`'s — and
 * that is the population the operator measured. The board's own asker writes
 * somewhere else entirely: `brief-ask.ts:100` puts `.plot-brief-<slug>.log` at
 * the repository root.
 *
 * They differ in BOTH halves, which is why neither can stand in for the other:
 *
 *   `plot-dispatch.sh`  `.plot/brief-<branch-slug>.log`   keyed on the BRANCH
 *   `brief-ask.ts`      `.plot-brief-<plan-slug>.log`     keyed on the PLAN
 *
 * On this estate the two keys usually coincide, because a slice's branch is
 * named for its plan's slug. They are not the same key by construction, and the
 * DIRECTORY differs unconditionally.
 *
 * Reading only the plan's cited path would leave every brief the board asked for
 * invisible — which inverts the plan's own closing sentence, *"the board now
 * asks for briefs by itself, so the state this renders is the state it
 * creates."* Both are read, and the EARLIEST is reported: the ask is when
 * somebody first asked, and a second asker arriving later did not restart the
 * wait the reader is judging.
 *
 * @param slug - the branch's last path segment, which is also the plan slug
 *               wherever the two agree.
 * @returns Repository-relative paths, in no significant order.
 */
export const briefAskLogPaths = (slug: string): string[] => [
  path.join('.plot', `brief-${slug}.log`),
  `.plot-brief-${slug}.log`,
];

/**
 * When this branch's brief was asked for, as epoch milliseconds — or null.
 *
 * **NULL IS *NOBODY ASKED HERE*, AND IT IS ALSO *I COULD NOT LOOK*.** The two
 * collapse on purpose, and that is the one place this differs from
 * `briefState`'s three-valued answer. There, the third state earns its keep
 * because `missing` is a CLAIM that sends a person to write a file. Here the
 * negative asserts nothing and offers nothing: the row falls back to the
 * sentence it has said all along, which is what this machine can truthfully say
 * either way.
 *
 * **PER-MACHINE, AND THAT IS HONEST.** A brief asked for on another machine
 * leaves no log here, so the row says *nobody has asked* — true of this machine,
 * and the only alternative would be inferring an ask from its absence.
 *
 * The mtime rather than the birthtime: the asker opens the log with `'a'` and
 * writes into it as the session talks, so mtime moves while a writer works.
 * Both answer the reader's question *when was this asked* to within the width of
 * the label, and mtime is the one every filesystem here reports.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param branch - the branch name, with or without its prefix.
 * @returns Epoch milliseconds of the earliest ask, or null where none was found.
 */
export const briefAskedAt = (repoRoot: string, branch: string): number | null => {
  const slug = branch.split('/').pop() ?? branch;
  let earliest: number | null = null;
  for (const rel of briefAskLogPaths(slug)) {
    try {
      // `statSync` rather than `existsSync` + `stat`: one call, and the throw is
      // the absence. A log that exists and will not be stat'd lands in the same
      // catch as one that is not there, which is the collapse the docstring
      // above licenses — neither answer makes a claim.
      const at = fs.statSync(path.join(repoRoot, rel)).mtimeMs;
      if (earliest === null || at < earliest) earliest = at;
    } catch {
      // No log at this path. Not a statement about the other one.
    }
  }
  return earliest;
};
