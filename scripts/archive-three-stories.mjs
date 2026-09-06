// Runs `archiveStory` over the three stories that assert `status: archived`,
// and writes what it decides.
//
// A SCRIPT RATHER THAN AN EDITOR, and that is the whole point of it. Archiving
// is two writes that must agree — `status: done` and an `archived:` date — and
// `plot-story-lint.sh` S3 reports either alone as a half-archived story. A hand
// edit of the status word would swap one invalid state for three lint findings;
// `transitions/story.ts:324` decides both fields in one act and refuses
// `archive-date-missing` rather than writing half of it.
//
// WHY THE THREE FILES SAY `archived` AT ALL. `archived` is DERIVED, never
// stored: `transitions/story.ts:26` — *"The six are what a person writes;
// `archived` is what the plans say."* #707 made it unrepresentable in
// TypeScript and nobody swept the files, so `2901905b` (2026-09-04) wrote by
// hand a seventh value the type system had already forbidden. Each of the three
// read `status: done` immediately before that commit, and none has ever carried
// an `archived:` line.
//
// SO THE REPAIR IS THE ARCHIVAL THAT COMMIT MEANT TO RECORD. The status returns
// to `done` — the value it held, and the one `archiveStory` requires — and the
// transition supplies the date beside it. `2026-09-04` rather than today,
// because that is the day the knowledge was closed and `archiveStory`'s own
// docblock refuses to overwrite it: *"re-running it over an existing date would
// replace the day the knowledge was closed with today."*
//
// EVERY DECISION IS THE DOMAIN'S. This script measures the file, hands the
// story to the transition, and applies the answer. It decides nothing: a
// refusal is printed with the domain's own words and the file is left alone.
//
// Usage: node scripts/archive-three-stories.mjs [--yes]
//   default is a dry run; --yes writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const apply = process.argv.includes('--yes');

// BUNDLED, NOT IMPORTED, and the reason is one import in the transition.
// `plot-reap.sh:188` imports `rules/reapable.ts` from an absolute path and Node
// strips its types — but every specifier there is `import type`, which erases.
// `transitions/story.ts:1` imports `storyIsDone` as a VALUE from
// `'../entities/story.js'`, a file that does not exist, so Node resolves it and
// fails. esbuild rewrites the specifier; nothing is shipped and the output goes
// to a temp file this script deletes.
// esbuild resolved from the board package, which is the only workspace member
// that depends on it. An absolute specifier rather than a bare one: this script
// sits at the repo root, where `esbuild` is not a dependency, and a bare import
// would resolve only if a hoist happened to put it there.
const esbuild = (await import(
  pathToFileURL(path.join(root, 'packages/board/node_modules/esbuild/lib/main.js')).href
)).default;

const bundle = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'archive-three-')),
  'story.mjs',
);
await esbuild.build({
  entryPoints: [path.join(root, 'packages/domain/src/transitions/story.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
});
const { archiveStory, isRefusal } = await import(pathToFileURL(bundle).href);

/** The day `2901905b` asserted the archival, which is the day it happened. */
const ARCHIVED_ON = '2026-09-04';

/** The three the plan names, and only those. */
const SLUGS = [
  'plot-gates',
  'setup-asks-what-the-repo-already-knows',
  'the-board-is-blank-where-it-matters',
];

/** One frontmatter field's value, or `''`. */
const field = (frontmatter, name) => {
  const m = frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : '';
};

let written = 0;
let refused = 0;

for (const slug of SLUGS) {
  const rel = path.join('docs/stories', slug, `STORY-${slug}.md`);
  const abs = path.join(root, rel);
  const content = fs.readFileSync(abs, 'utf8');
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) {
    console.log(`REFUSED  ${slug} — no frontmatter`);
    refused += 1;
    continue;
  }

  const stated = field(fm[1], 'status');
  const archived = field(fm[1], 'archived');

  // THE STATUS HANDED TO THE TRANSITION IS `done`, and the file is what says
  // so. `archived` is not a `StoryStatus`, so no `Story` value can carry it —
  // the type forbids exactly the word these files wrote. Reading it as `done`
  // is not a guess: `git log -p` shows all three went `active -> done ->
  // archived`, and the archival is what the third edit was reaching for.
  //
  // Any OTHER unadmitted word is refused rather than read this way. One
  // hand-written value the history explains is a repair; a rule that turns
  // every unknown word into `done` is a second way to lose a state.
  if (stated !== 'archived') {
    console.log(`REFUSED  ${slug} — status is '${stated}', expected 'archived'`);
    refused += 1;
    continue;
  }

  const story = {
    slug,
    title: field(fm[1], 'title'),
    status: 'done',
    path: rel,
    created: field(fm[1], 'created'),
    updated: field(fm[1], 'updated'),
    author: field(fm[1], 'author'),
    archived: archived === '' ? null : archived,
  };

  const result = archiveStory(story, { on: ARCHIVED_ON });
  if (isRefusal(result)) {
    console.log(`REFUSED  ${slug} — ${result.reason}: ${result.detail}`);
    refused += 1;
    continue;
  }

  // BOTH FIELDS, FROM THE ONE DECISION. `result.status` and `result.archived`
  // are what the transition decided together; splitting them here would rebuild
  // the half-archived story the transition exists to prevent.
  const next = content.replace(
    /^---\n([\s\S]*?)\n---/,
    (_whole, block) =>
      `---\n${block.replace(/^status:.*$/m, `status: ${result.status}\narchived: ${result.archived}`)}\n---`,
  );

  console.log(`${apply ? 'WROTE   ' : 'would write'}  ${slug} — status: ${result.status}, archived: ${result.archived}`);
  if (apply) fs.writeFileSync(abs, next, 'utf8');
  written += 1;
}

fs.rmSync(path.dirname(bundle), { recursive: true, force: true });

console.log(`archive-three-stories: ${written} decided, ${refused} refused${apply ? '' : ' (dry run — pass --yes to write)'}`);
process.exit(refused === 0 ? 0 : 1);
