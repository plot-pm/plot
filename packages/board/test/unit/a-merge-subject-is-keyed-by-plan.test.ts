import { describe, expect, it } from 'vitest';
import { EXIT, pairsOf, parseReadings, proofOf, run } from '../../src/server/entry/merge-subject.js';

/**
 * A MERGE SUBJECT IS KEYED BY PLAN — the bundle's own contract.
 *
 * The rules it calls are tested in `packages/domain`; these test the bundle:
 * the sectioned stdin the scan writes, the two-call protocol the age rule
 * needs, and the per-plan keying that stops one plan's proof settling
 * another's reused name.
 *
 * ## Why the protocol has two calls
 *
 * The age rule asks whether a merge is contained in the commit that added the
 * plan file, which is a git question the domain may not ask. So the first call
 * names the pairs needing a test, the shell runs one `merge-base
 * --is-ancestor` each, and the second call applies the rule to the answers.
 */

/** The readings as the scan writes them, assembled from parts. */
const readings = (parts: {
  backend?: string;
  origin?: string;
  merges?: Array<[string, string]>;
  plans?: Array<{ file: string; added?: string | null; branches: string[] }>;
  ancestry?: Array<[string, string, 'yes' | 'no' | 'unknown']>;
}): string => {
  const lines = [
    `@backend ${parts.backend ?? 'github'}`,
    `@origin ${parts.origin ?? 'https://example.com/acme/repo.git'}`,
    '@merges',
    ...(parts.merges ?? []).map(([sha, subject]) => `${sha} ${subject}`),
  ];
  for (const plan of parts.plans ?? []) {
    lines.push(`@plan ${plan.file}`);
    lines.push(`@added ${plan.added === null ? '-' : plan.added ?? 'add1'}`);
    lines.push(...plan.branches);
  }
  for (const [merge, added, answer] of parts.ancestry ?? []) {
    lines.push(`@ancestry ${merge} ${added} ${answer}`);
  }
  return `${lines.join('\n')}\n`;
};

/** What `run` wrote, as lines. */
const output = (argv: string[], stdin: string): { lines: string[]; code: number } => {
  let out = '';
  const code = run(argv, stdin, (s) => { out += s; }, () => {});
  return { lines: out.split('\n').filter(Boolean), code };
};

const PLAN_A = 'docs/plans/2026-01-01-one.md';
const PLAN_B = 'docs/plans/2026-06-01-two.md';

describe('the sectioned readings', () => {
  it('reads the backend, the origin, the merges and one section per plan', () => {
    const parsed = parseReadings(readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
      plans: [
        { file: PLAN_A, added: 'add1', branches: ['bug/a'] },
        { file: PLAN_B, added: 'add2', branches: ['bug/b', 'bug/c'] },
      ],
    }));
    expect(parsed.backend).toBe('github');
    expect(parsed.origin).toBe('https://example.com/acme/repo.git');
    expect(parsed.merges).toEqual([{ sha: 'm1', subject: 'Merge pull request #1 from acme/bug/a' }]);
    expect(parsed.plans).toEqual([
      { file: PLAN_A, added: 'add1', branches: ['bug/a'] },
      { file: PLAN_B, added: 'add2', branches: ['bug/b', 'bug/c'] },
    ]);
  });

  it('reads a subject holding tabs and spaces whole', () => {
    const parsed = parseReadings(readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/a into main (#2)']],
    }));
    expect(parsed.merges[0].subject).toBe('Merge pull request #1 from acme/bug/a into main (#2)');
  });

  it('reads `-` as no adding commit, never as a commit named "-"', () => {
    const parsed = parseReadings(readings({
      plans: [{ file: PLAN_A, added: null, branches: ['bug/a'] }],
    }));
    expect(parsed.plans[0].added).toBeNull();
  });

  it('drops a merge line carrying no subject', () => {
    // A hash alone proves nothing, and storing it with an empty subject would
    // make it match a form only if a form were empty.
    expect(parseReadings('@merges\nm1\n').merges).toEqual([]);
  });

  it('ignores a section this bundle does not know', () => {
    // A newer scan may write one, and the answer this can still give is better
    // than no answer at all.
    const parsed = parseReadings(
      `@backend github\n@futuresection x\nnoise\n@merges\nm1 Merge pull request #1 from acme/bug/a\n`,
    );
    expect(parsed.backend).toBe('github');
    expect(parsed.merges).toHaveLength(1);
  });

  it('reads the three ancestry answers apart', () => {
    const parsed = parseReadings(readings({
      ancestry: [['m1', 'add1', 'yes'], ['m2', 'add1', 'no'], ['m3', 'add1', 'unknown']],
    }));
    expect(parsed.ancestry.get('m1 add1')).toBe(true);
    expect(parsed.ancestry.get('m2 add1')).toBe(false);
    expect(parsed.ancestry.get('m3 add1')).toBeNull();
  });

  it('reads empty readings as nothing asked', () => {
    const parsed = parseReadings('');
    expect(parsed.plans).toEqual([]);
    expect(parsed.merges).toEqual([]);
  });
});

describe('the pairs needing an ancestry test', () => {
  it('names the plan, the branch, the merge and the adding commit', () => {
    const { lines } = output(['pairs'], readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
    }));
    expect(lines).toEqual([`${PLAN_A}\tbug/a\tm1\tadd1`]);
  });

  it('names a pair per merge when one name was merged twice', () => {
    // The newer merge is the one that can postdate the plan, so both are
    // offered for a test rather than only the first found.
    const { lines } = output(['pairs'], readings({
      merges: [
        ['m1', 'Merge pull request #1 from acme/bug/a'],
        ['m9', 'Merge pull request #9 from acme/bug/a'],
      ],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
    }));
    expect(lines).toEqual([
      `${PLAN_A}\tbug/a\tm1\tadd1`,
      `${PLAN_A}\tbug/a\tm9\tadd1`,
    ]);
  });

  // NO ADDING COMMIT, NO SUBJECTS. The age rule is what separates a current
  // name from a reused one; without the commit it cannot be applied, so the
  // branch goes to the host rather than being proven unaged. A rename chain
  // ending outside the walk is the measured case — 4 of 392 plans here have no
  // `A` entry for their current path.
  it('asks nothing for a plan whose adding commit was not read', () => {
    const { lines } = output(['pairs'], readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
      plans: [{ file: PLAN_A, added: null, branches: ['bug/a'] }],
    }));
    expect(lines).toEqual([]);
  });

  it('asks nothing on a backend with no form', () => {
    const { lines } = output(['pairs'], readings({
      backend: 'gitlab',
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
    }));
    expect(lines).toEqual([]);
  });

  it('refuses a subject naming a fork owner', () => {
    const { lines } = output(['pairs'], readings({
      origin: 'https://example.com/acme/repo.git',
      merges: [['m1', 'Merge pull request #1 from forker/bug/a']],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
    }));
    expect(lines).toEqual([]);
  });

  it('accepts any owner where the origin is a local path', () => {
    // `fleet.test.mjs:845-900` runs against a bare local origin, and this is
    // the reading that keeps its answer.
    const { lines } = output(['pairs'], readings({
      origin: '/srv/git/repo.git',
      merges: [['m1', 'Merge pull request #1 from anyone/bug/a']],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
    }));
    expect(lines).toEqual([`${PLAN_A}\tbug/a\tm1\tadd1`]);
  });
});

describe('the proof, keyed by plan AND branch', () => {
  it('proves a branch whose merge is not contained in the adding commit', () => {
    const { lines } = output(['proven'], readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
      ancestry: [['m1', 'add1', 'no']],
    }));
    expect(lines).toEqual([`proven\t${PLAN_A}\tbug/a`, 'detect\tpr-merge']);
  });

  it('refuses a merge contained in the adding commit, and says why', () => {
    const { lines } = output(['proven'], readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
      ancestry: [['m1', 'add1', 'yes']],
    }));
    expect(lines).toEqual([`ignored\t${PLAN_A}\tbug/a\tm1`, 'detect\tpr-merge']);
  });

  // THE CASE THE AGE RULE EXISTS FOR, measured in round 1: an unstarted reused
  // name read `merged`, its slice read complete, the next slice opened, and
  // the reused slice was never offered.
  it('settles only the earlier plan when a later one reuses its merged name', () => {
    const { lines } = output(['proven'], readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/shared']],
      plans: [
        { file: PLAN_A, added: 'add1', branches: ['bug/shared'] },
        { file: PLAN_B, added: 'add2', branches: ['bug/shared'] },
      ],
      // The merge postdates plan A and predates plan B — which is what a
      // reused name looks like.
      ancestry: [['m1', 'add1', 'no'], ['m1', 'add2', 'yes']],
    }));
    expect(lines).toEqual([
      `proven\t${PLAN_A}\tbug/shared`,
      `ignored\t${PLAN_B}\tbug/shared\tm1`,
      'detect\tpr-merge',
    ]);
  });

  it('proves a name merged twice when either merge postdates the plan', () => {
    // Refusing the branch because its OLDER merge was refused would lose the
    // current landing.
    const { lines } = output(['proven'], readings({
      merges: [
        ['m1', 'Merge pull request #1 from acme/bug/a'],
        ['m9', 'Merge pull request #9 from acme/bug/a'],
      ],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
      ancestry: [['m1', 'add1', 'yes'], ['m9', 'add1', 'no']],
    }));
    // And it is NOT also reported ignored: the scan reads the branch as
    // `merged`, so counting it among the subjects it could not use would make
    // the footer contradict the row.
    expect(lines).toEqual([`proven\t${PLAN_A}\tbug/a`, 'detect\tpr-merge']);
  });

  it('proves nothing on an ancestry answer of unknown', () => {
    const { lines } = output(['proven'], readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
      ancestry: [['m1', 'add1', 'unknown']],
    }));
    expect(lines).toEqual(['detect\tpr-merge']);
  });

  it('proves nothing where no ancestry answer was given', () => {
    const { lines } = output(['proven'], readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
    }));
    expect(lines).toEqual(['detect\tpr-merge']);
  });

  it('proves each plan its own branches', () => {
    const { lines } = output(['proven'], readings({
      merges: [
        ['m1', 'Merge pull request #1 from acme/bug/a'],
        ['m2', 'Merge pull request #2 from acme/bug/b'],
      ],
      plans: [
        { file: PLAN_A, added: 'add1', branches: ['bug/a'] },
        { file: PLAN_B, added: 'add2', branches: ['bug/b'] },
      ],
      ancestry: [['m1', 'add1', 'no'], ['m2', 'add2', 'no']],
    }));
    expect(lines).toEqual([
      `proven\t${PLAN_A}\tbug/a`,
      `proven\t${PLAN_B}\tbug/b`,
      'detect\tpr-merge',
    ]);
  });
});

describe('the detection word', () => {
  // READ FROM THE WALK, not from the backend word. A host with a form whose
  // estate squashes every merge writes no conforming subject.
  it('answers pr-merge where the walk holds a conforming subject', () => {
    expect(proofOf(parseReadings(readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/unasked']],
    }))).detect).toBe('pr-merge');
  });

  it('answers pr-merge for a subject naming a branch no plan names', () => {
    // The question is whether this estate writes them, not whether a plan's
    // branch landed.
    const { lines } = output(['proven'], readings({
      merges: [['m1', 'Merge pull request #1 from acme/some/other']],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
    }));
    expect(lines).toEqual(['detect\tpr-merge']);
  });

  it('answers none where the walk holds no conforming subject', () => {
    expect(proofOf(parseReadings(readings({
      merges: [['m1', "Merge remote-tracking branch 'origin/main'"]],
    }))).detect).toBe('none');
  });

  it('answers none on a backend with no form', () => {
    expect(proofOf(parseReadings(readings({
      backend: 'gitlab',
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
    }))).detect).toBe('none');
  });

  it('answers none on an empty walk', () => {
    expect(proofOf(parseReadings(readings({}))).detect).toBe('none');
  });

  it('reads the other host form on the other backend', () => {
    expect(proofOf(parseReadings(readings({
      backend: 'bitbucket',
      merges: [['m1', 'Merged in bug/a (pull request #4)']],
    }))).detect).toBe('pr-merge');
    // And not the one it does not write.
    expect(proofOf(parseReadings(readings({
      backend: 'bitbucket',
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
    }))).detect).toBe('none');
  });
});

describe('the verb', () => {
  it('refuses a verb it does not have', () => {
    let warned = '';
    const code = run(['nonsense'], '', () => {}, (s) => { warned += s; });
    expect(code).toBe(EXIT.usage);
    expect(warned).toMatch(/usage/);
  });

  it('refuses no verb at all', () => {
    expect(run([], '', () => {}, () => {})).toBe(EXIT.usage);
  });

  it('answers 0 for both verbs', () => {
    const r = readings({ plans: [{ file: PLAN_A, branches: ['bug/a'] }] });
    expect(output(['pairs'], r).code).toBe(EXIT.ok);
    expect(output(['proven'], r).code).toBe(EXIT.ok);
  });
});

describe('pairsOf, called directly', () => {
  // The exported function the scan's second call re-derives from, asserted
  // apart from the wire format so a format change cannot hide a rule change.
  it('answers the pair as a record', () => {
    expect(pairsOf(parseReadings(readings({
      merges: [['m1', 'Merge pull request #1 from acme/bug/a']],
      plans: [{ file: PLAN_A, added: 'add1', branches: ['bug/a'] }],
    })))).toEqual([{ plan: PLAN_A, branch: 'bug/a', merge: 'm1', added: 'add1' }]);
  });
});
