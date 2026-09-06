import { describe, it, expect } from 'vitest';
import {
  parseSprintContent,
  parseStoryContent,
  UNADMITTED_STATE,
} from '../../src/server/board.js';
import {
  SPRINT_PHASES,
  SprintStateSchema,
  StoryStatusSchema,
  STORY_LIFECYCLE,
} from '../../src/contract/schema.js';

/**
 * A state a file states is one the domain admits, or it reads `UNKNOWN`.
 *
 * THE FOUR MEASURED CASES ARE THE FIXTURES. On 2026-09-06 three stories carried
 * `status: archived` and one sprint carried `Phase: Planned`; neither value is
 * in either schema, `plot-story-lint.sh` answered `0 finding(s)` over the three,
 * and the reconcile scan's thirteen sections never asked. A person reading files
 * found all four in one session.
 *
 * The refusal is a READING. `plot-plan-meta.sh:338` is the contract it follows —
 * an admitted list and a fall-through — so nothing downstream is refused and the
 * consumer decides.
 */

const sprintFile = (phase: string): string =>
  `# Sprint: Fixture\n\n## Status\n\n- **Phase:** ${phase}\n- **Release:** 9.9.0\n`;

const storyFile = (status: string): string =>
  `---\ntitle: Fixture\nstatus: ${status}\ncreated: 2026-09-06\nupdated: 2026-09-06\n---\n\n# Fixture\n`;

const story = (status: string) =>
  parseStoryContent(storyFile(status), 'fixture', 'docs/stories/fixture/STORY-fixture.md', '');

describe('a stated sprint phase parses', () => {
  it('refuses `Planned` — the word the W36 sprint carried', () => {
    expect(parseSprintContent(sprintFile('Planned'), '2026-W36-fixture.md')!.phase)
      .toBe(UNADMITTED_STATE);
  });

  it('admits each of the domain\'s four, unchanged', () => {
    for (const phase of SPRINT_PHASES) {
      expect(parseSprintContent(sprintFile(phase), '2026-W36-fixture.md')!.phase).toBe(phase);
    }
  });

  it('reads a file with NO phase as no sprint at all, which is a different answer', () => {
    // `null` says the file is not a sprint — the walk reads every markdown file
    // under `active/`, so that is how a README is skipped. `UNKNOWN` says the
    // file IS a sprint and states something no schema spells.
    expect(parseSprintContent('# Sprint: Fixture\n\n## Status\n\n- **Release:** 9.9.0\n', 'x.md'))
      .toBeNull();
  });
});

describe('a stated story status parses', () => {
  it('refuses `archived` — the word the three stories carried', () => {
    // `archived` is DERIVED, never stored: #707 made it unrepresentable in
    // TypeScript and nobody swept the files, so three of them assert by hand a
    // value the type system has since forbidden.
    expect(story('archived')!.status).toBe(UNADMITTED_STATE);
  });

  it('admits each of the domain\'s six, unchanged', () => {
    for (const status of STORY_LIFECYCLE) {
      expect(story(status)!.status).toBe(status);
    }
  });

  it('reads a story with NO `status:` line as absent, not as wrong', () => {
    const content = '---\ntitle: Fixture\ncreated: 2026-09-06\n---\n\n# Fixture\n';
    expect(parseStoryContent(content, 'fixture', 'p', '')!.status).toBe('');
  });
});

describe('neither parser declares its own list', () => {
  // ASSERTED AS SETS, NOT SEQUENCES. `STORY_LIFECYCLE` carries the six in the
  // order a renderer groups by, which is a separate promise from "these are the
  // admitted values" — pinning the order here would fail on a re-ordering that
  // is not a drift.
  it('the board\'s sprint phases ARE the domain\'s', () => {
    expect(new Set(SPRINT_PHASES)).toEqual(new Set(SprintStateSchema.options));
  });

  it('the board\'s story statuses ARE the domain\'s', () => {
    expect(new Set(STORY_LIFECYCLE)).toEqual(new Set(StoryStatusSchema.options));
  });
});
