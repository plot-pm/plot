import { describe, it, expect } from 'vitest';
import {
  unstruckSprintMembers, sprintOfPlan, sprintsListing, memberLineIndex, type SprintFile,
} from '../src/index.js';

/**
 * `unstruckSprintMembers`, `sprintOfPlan`, `sprintsListing` and
 * `memberLineIndex` tested at the domain boundary — fed sprint file content
 * directly, never a path. `sprintOfPlan` is the regression test for
 * `f57425ec0`: deliver ticked a Closed sprint's Deferred line while the plan
 * actually belonged to a different, open sprint.
 */

const SPRINT = (body: string) => `# Sprint: Example

## Status

- **State:** Active
- **Start:** 2026-10-29
- **End:** 2026-11-05
- **Release:** 2.30.0

## Sprint Goal

An example sprint.

${body}
`;

describe('unstruckSprintMembers', () => {
  it('holds a plan slug named on an unstruck tier line', () => {
    const content = SPRINT(`### Should Have

- [ ] [a] Do the thing
`);
    expect(unstruckSprintMembers(content)).toEqual(['a']);
  });

  it('excludes a Deferred, struck, log or untiered line', () => {
    const content = SPRINT(`### Must Have

- [ ] ~~[b]~~ Withdrawn

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

- [ ] [a] Moved out of scope

## Notes

### Scope Changes

- 2026-10-29: Added [c] by Jan Wloka

### Also shipped

- [ ] [d] Landed anyway
`);
    expect(unstruckSprintMembers(content)).toEqual([]);
  });
});

describe('sprintOfPlan — f57425ec0 regression: an open sprint wins over a Closed one', () => {
  // Trimmed from the real texts at f57425ec0^:
  // docs/sprints/2026-W42-bitbucket-jira-and-jenkins-work-with-the-board.md
  // docs/sprints/2026-W43-bugfix-2-28-1.md
  const w42Closed: SprintFile = {
    file: 'docs/sprints/2026-W42-bitbucket-jira-and-jenkins-work-with-the-board.md',
    content: `# Sprint: Bitbucket, Jira and Jenkins work with the board

## Status

- **State:** Closed
- **Actual End:** 2026-10-22
- **Start:** 2026-10-16
- **End:** 2026-10-23
- **Release:** 2.28.0

## Sprint Goal

A project hosted on Bitbucket, tracked in Jira and built on Jenkins works with the board as well as a GitHub project does.

### Must Have

- [x] [bitbucket-parity-and-app-identities] Host connector: Bitbucket parity and App identities (#1848)

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

- [ ] [a] Board hides a green draft slice PR that waits for a person to mark it ready (#2319)
`,
  };

  const bugfix2281Open: SprintFile = {
    file: 'docs/sprints/2026-W43-bugfix-2-28-1.md',
    content: `# Sprint: Bugfix 2.28.1

## Status

- **State:** Planning
- **Start:** YYYY-MM-DD
- **End:** YYYY-MM-DD
- **Release:** 2.28.1

## Sprint Goal

2.28.0 shipped with two Should Haves of W42 deferred.

### Must Have

- [ ] [a] Board hides a green draft slice PR that waits for a person to mark it ready (#2319)

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->
`,
  };

  it('picks the open sprint over the Closed one that lists the same slug', () => {
    expect(sprintOfPlan('a', [w42Closed, bugfix2281Open])).toEqual({
      sprint: 'bugfix-2-28-1',
      file: bugfix2281Open.file,
    });
  });

  it('is order-independent', () => {
    expect(sprintOfPlan('a', [bugfix2281Open, w42Closed])).toEqual({
      sprint: 'bugfix-2-28-1',
      file: bugfix2281Open.file,
    });
  });
});

describe('sprintOfPlan — tiebreaks among open sprints', () => {
  const open = (startDate: string, fileSuffix: string): SprintFile => ({
    file: `docs/sprints/2026-W${fileSuffix}-sprint.md`,
    content: SPRINT(`- **overridden-below**

### Must Have

- [ ] [a] Do the thing
`).replace('- **Start:** 2026-10-29', `- **Start:** ${startDate}`),
  });

  it('the newest open sprint wins', () => {
    const older = open('2026-10-28', '41');
    const newer = open('2026-10-29', '42');
    expect(sprintOfPlan('a', [older, newer])).toEqual({ sprint: 'sprint', file: newer.file });
  });

  it('among sprints with the same newest start, the file name sorting last wins', () => {
    const fileA: SprintFile = {
      file: 'docs/sprints/2026-W41-aaa.md',
      content: SPRINT(`### Must Have

- [ ] [a] Do the thing
`),
    };
    const fileB: SprintFile = {
      file: 'docs/sprints/2026-W41-bbb.md',
      content: SPRINT(`### Must Have

- [ ] [a] Do the thing
`),
    };
    expect(sprintOfPlan('a', [fileA, fileB])).toEqual({ sprint: 'bbb', file: fileB.file });
  });
});

describe('sprintOfPlan — only Closed sprints list it', () => {
  const closed = (startDate: string, fileSuffix: string): SprintFile => ({
    file: `docs/sprints/2026-W${fileSuffix}-sprint.md`,
    content: SPRINT(`### Must Have

- [ ] [a] Do the thing
`).replace('- **State:** Active', '- **State:** Closed').replace('- **Start:** 2026-10-29', `- **Start:** ${startDate}`),
  });

  it('picks the later Start among Closed sprints when none is open', () => {
    const older = closed('2026-10-01', '40');
    const newer = closed('2026-10-15', '41');
    expect(sprintOfPlan('a', [older, newer])).toEqual({ sprint: 'sprint', file: newer.file });
  });
});

describe('sprintOfPlan — no sprint lists the plan', () => {
  it('returns null when the slug sits only on a Deferred line', () => {
    const sprint: SprintFile = {
      file: 'docs/sprints/2026-W41-sprint.md',
      content: SPRINT(`### Must Have

<!-- add items here -->

### Deferred

- [ ] [a] Moved out of scope
`),
    };
    expect(sprintOfPlan('a', [sprint])).toBeNull();
  });
});

describe('sprintsListing', () => {
  it('names every sprint that lists the plan, with its state', () => {
    const closedSprint: SprintFile = {
      file: 'docs/sprints/2026-W41-closed.md',
      content: SPRINT(`### Must Have

- [ ] [a] Do the thing
`).replace('- **State:** Active', '- **State:** Closed'),
    };
    const openSprint: SprintFile = {
      file: 'docs/sprints/2026-W42-open.md',
      content: SPRINT(`### Must Have

- [ ] [a] Do the thing
`),
    };
    expect(sprintsListing('a', [closedSprint, openSprint])).toEqual([
      { sprint: 'closed', file: closedSprint.file, state: 'Closed', start: '2026-10-29' },
      { sprint: 'open', file: openSprint.file, state: 'Active', start: '2026-10-29' },
    ]);
  });

  it('is empty when no sprint lists the plan', () => {
    const sprint: SprintFile = {
      file: 'docs/sprints/2026-W41-sprint.md',
      content: SPRINT('### Must Have\n\n<!-- add items here -->\n'),
    };
    expect(sprintsListing('a', [sprint])).toEqual([]);
  });
});

describe('memberLineIndex', () => {
  it('finds the index of the plan\'s member line under a tier heading', () => {
    const content = SPRINT(`### Must Have

- [ ] [x] not a plan line, just text containing a bracket
- [ ] [a] Do the thing
`);
    const lines = content.split('\n');
    const expectedIndex = lines.findIndex((line) => line.includes('[a] Do the thing'));
    expect(memberLineIndex(content, 'a')).toBe(expectedIndex);
  });

  it('returns -1 when the plan has no member line', () => {
    const content = SPRINT('### Must Have\n\n<!-- add items here -->\n');
    expect(memberLineIndex(content, 'a')).toBe(-1);
  });

  it('returns -1 for a slug that appears only on a Deferred line', () => {
    const content = SPRINT(`### Deferred

- [ ] [a] Moved out of scope
`);
    expect(memberLineIndex(content, 'a')).toBe(-1);
  });
});

describe('a sprint slug is cut by slugOf', () => {
  it('cuts the sprint slug from its file name the same way for both files in the listing', () => {
    const sprint: SprintFile = {
      file: 'docs/sprints/2026-W36-the-board-shows-the-strategic-layer.md',
      content: SPRINT(`### Must Have

- [ ] [a] Do the thing
`),
    };
    expect(sprintOfPlan('a', [sprint])).toEqual({
      sprint: 'the-board-shows-the-strategic-layer',
      file: sprint.file,
    });
  });
});
