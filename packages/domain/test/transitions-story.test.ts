import { describe, expect, it } from 'vitest';
import type { Story } from '../src/entities/story.js';
import {
  archiveStory,
  derivedStanding,
  isDecision,
  isRefusal,
  setStoryStatus,
  storyArchivable,
  storyStatusSettable,
  STORY_LIFECYCLE,
} from '../src/transitions/story.js';

/** A story in the status a test needs, with everything else valid. */
const storyWith = (over: Partial<Story> = {}): Story => ({
  slug: 'the-domain-knows-what-plot-knows',
  title: 'The domain knows what Plot knows',
  status: 'active',
  path: 'the-domain-knows-what-plot-knows/STORY-the-domain-knows-what-plot-knows.md',
  created: '2026-09-01',
  updated: '2026-09-04',
  author: 'jwloka',
  archived: null,
  ...over,
});

describe('setStoryStatus decides the write a move calls for', () => {
  it('moves draft to ready, the first edge in the spec graph', () => {
    const result = setStoryStatus(storyWith({ status: 'draft' }), { to: 'ready' });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.status).toBe('ready');
    expect(result.archived).toBeNull();
  });

  it('moves active to in-review, and in-review to done', () => {
    const toReview = setStoryStatus(storyWith({ status: 'active' }), { to: 'in-review' });
    expect(isDecision(toReview)).toBe(true);

    const toDone = setStoryStatus(storyWith({ status: 'in-review' }), {
      to: 'done',
      on: '2026-09-05',
    });
    expect(isDecision(toDone)).toBe(true);
    if (!isDecision(toDone)) return;
    expect(toDone.status).toBe('done');
    expect(toDone.archived).toBe('2026-09-05');
  });

  it('lets a paused story resume, the one edge that goes backwards', () => {
    expect(isDecision(setStoryStatus(storyWith({ status: 'paused' }), { to: 'active' }))).toBe(true);
  });

  it('carries the archive date on a move to done, so the two writes cannot separate', () => {
    const result = setStoryStatus(storyWith({ status: 'active' }), { to: 'done', on: '2026-09-05' });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.archived).toBe('2026-09-05');
  });

  it('carries no archive date on any move that is not to done', () => {
    const result = setStoryStatus(storyWith({ status: 'ready' }), { to: 'active', on: '2026-09-05' });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.archived).toBeNull();
  });
});

describe('setStoryStatus refuses what the lifecycle graph does not admit', () => {
  it('refuses a status the domain does not name', () => {
    const result = setStoryStatus(storyWith(), { to: 'archived' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-unrecognised');
  });

  it('refuses `archived` by name — it is derived, never stored', () => {
    // The seventh value `deriveStoryStatus` returned against a `string` type.
    const result = setStoryStatus(storyWith({ status: 'done', archived: '2026-09-05' }), {
      to: 'archived',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-unrecognised');
  });

  it('refuses a move out of done — the exit from done is the archival', () => {
    const result = setStoryStatus(storyWith({ status: 'done', archived: '2026-09-05' }), {
      to: 'active',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-terminal');
  });

  it('refuses draft straight to active, skipping ready', () => {
    const result = setStoryStatus(storyWith({ status: 'draft' }), { to: 'active' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-unreachable');
    expect(result.detail).toContain('ready');
  });

  it('refuses draft straight to done, the move that cost a person an hour', () => {
    // Measured 2026-09-04: five stories were marked `done` while consolidating
    // the estate, three of them wrongly.
    const result = setStoryStatus(storyWith({ status: 'draft' }), { to: 'done', on: '2026-09-05' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-unreachable');
  });

  it('refuses ready straight to done', () => {
    const result = setStoryStatus(storyWith({ status: 'ready' }), { to: 'done', on: '2026-09-05' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-unreachable');
  });

  it('refuses ready straight to in-review', () => {
    const result = setStoryStatus(storyWith({ status: 'ready' }), { to: 'in-review' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-unreachable');
  });

  it('refuses in-review going back to active — the graph has no such edge', () => {
    const result = setStoryStatus(storyWith({ status: 'in-review' }), { to: 'active' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-unreachable');
  });

  it('refuses in-review going to paused', () => {
    const result = setStoryStatus(storyWith({ status: 'in-review' }), { to: 'paused' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-unreachable');
  });

  it('refuses paused going anywhere but active', () => {
    for (const to of ['draft', 'ready', 'in-review', 'done'] as const) {
      const result = setStoryStatus(storyWith({ status: 'paused' }), { to, on: '2026-09-05' });
      expect(isRefusal(result)).toBe(true);
      if (!isRefusal(result)) continue;
      expect(result.reason).toBe('status-unreachable');
    }
  });

  it('refuses every move back to draft', () => {
    for (const from of ['ready', 'active', 'in-review', 'paused'] as const) {
      const result = setStoryStatus(storyWith({ status: from }), { to: 'draft' });
      expect(isRefusal(result)).toBe(true);
      if (!isRefusal(result)) continue;
      expect(result.reason).toBe('status-unreachable');
    }
  });

  it('refuses a move to the status the story already holds', () => {
    const result = setStoryStatus(storyWith({ status: 'active' }), { to: 'active' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-unchanged');
  });

  it('refuses done with no archive date — the half-archived story the lint reports as S3', () => {
    const result = setStoryStatus(storyWith({ status: 'active' }), { to: 'done' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('archive-date-missing');
  });

  it('refuses done with a blank archive date', () => {
    const result = setStoryStatus(storyWith({ status: 'active' }), { to: 'done', on: '   ' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('archive-date-missing');
  });

  it('refuses an unmet reading, naming it', () => {
    const result = setStoryStatus(storyWith({ status: 'draft' }), {
      to: 'ready',
      preconditions: [{ name: 'file-writable', met: false, detail: 'read-only checkout' }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
    expect(result.detail).toContain('file-writable');
    expect(result.detail).toContain('read-only checkout');
  });

  it('tests the graph before the readings, so a bad move refuses for its own reason', () => {
    const result = setStoryStatus(storyWith({ status: 'draft' }), {
      to: 'done',
      on: '2026-09-05',
      preconditions: [{ name: 'file-writable', met: false }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('status-unreachable');
  });
});

describe('storyStatusSettable answers before anyone moves', () => {
  it('agrees with setStoryStatus on a legal move', () => {
    expect(storyStatusSettable(storyWith({ status: 'draft' }), 'ready')).toBe(true);
  });

  it('agrees with setStoryStatus on an illegal one', () => {
    expect(storyStatusSettable(storyWith({ status: 'draft' }), 'done')).toBe(false);
    expect(storyStatusSettable(storyWith({ status: 'done', archived: '2026-09-05' }), 'active')).toBe(false);
  });

  it('answers about the graph rather than about a missing date', () => {
    // Tested with a placeholder date, the way `releasable` is.
    expect(storyStatusSettable(storyWith({ status: 'active' }), 'done')).toBe(true);
  });
});

describe('archiveStory is the second write, and it refuses to happen alone', () => {
  it('decides the date for a done story carrying none', () => {
    const result = archiveStory(storyWith({ status: 'done' }), { on: '2026-09-05' });
    expect(isDecision(result)).toBe(true);
    if (!isDecision(result)) return;
    expect(result.status).toBe('done');
    expect(result.archived).toBe('2026-09-05');
  });

  it('refuses to archive a story that is not done', () => {
    for (const status of ['draft', 'ready', 'active', 'in-review', 'paused'] as const) {
      const result = archiveStory(storyWith({ status }), { on: '2026-09-05' });
      expect(isRefusal(result)).toBe(true);
      if (!isRefusal(result)) continue;
      expect(result.reason).toBe('archive-not-done');
    }
  });

  it('refuses to overwrite the date a story already closed on', () => {
    const result = archiveStory(storyWith({ status: 'done', archived: '2026-08-01' }), {
      on: '2026-09-05',
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('archive-already');
    expect(result.detail).toContain('2026-08-01');
  });

  it('refuses an archival with no date', () => {
    const result = archiveStory(storyWith({ status: 'done' }), { on: '' });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('archive-date-missing');
  });

  it('refuses an unmet reading', () => {
    const result = archiveStory(storyWith({ status: 'done' }), {
      on: '2026-09-05',
      preconditions: [{ name: 'archived-home-exists', met: false }],
    });
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('precondition-unmet');
  });

  it('storyArchivable agrees with archiveStory', () => {
    expect(storyArchivable(storyWith({ status: 'done' }))).toBe(true);
    expect(storyArchivable(storyWith({ status: 'active' }))).toBe(false);
    expect(storyArchivable(storyWith({ status: 'done', archived: '2026-08-01' }))).toBe(false);
  });
});

describe('archived is derived from plan phases, in one place', () => {
  it('reports archived when every plan released', () => {
    expect(derivedStanding('active', [{ phase: 'released' }, { phase: 'released' }])).toBe(
      'archived',
    );
  });

  it('reports done when every plan delivered or released', () => {
    expect(derivedStanding('active', [{ phase: 'delivered' }, { phase: 'released' }])).toBe('done');
  });

  it('reports active when any plan is approved', () => {
    expect(derivedStanding('draft', [{ phase: 'approved' }, { phase: 'draft' }])).toBe('active');
  });

  it('hands back the declared status when the plans prove nothing', () => {
    expect(derivedStanding('paused', [{ phase: 'draft' }, { phase: 'draft' }])).toBe('paused');
  });

  it('hands back the declared status for a story with no plans', () => {
    // No mechanism can observe what the humans are doing about the knowledge.
    expect(derivedStanding('in-review', [])).toBe('in-review');
  });

  it('reads a phase in any case', () => {
    expect(derivedStanding('draft', [{ phase: 'Released' }])).toBe('archived');
  });

  it('counts an unrecognised phase as not released, which can only hold a story back', () => {
    expect(derivedStanding('active', [{ phase: 'released' }, { phase: 'wat' }])).toBe('active');
  });
});

describe('the vocabulary the file publishes', () => {
  it('names the six in the order the spec draws them', () => {
    expect(STORY_LIFECYCLE).toEqual(['draft', 'ready', 'active', 'in-review', 'paused', 'done']);
  });

  it('does not admit archived among them', () => {
    expect(STORY_LIFECYCLE).not.toContain('archived');
  });
});
