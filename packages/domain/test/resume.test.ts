import { describe, it, expect } from 'vitest';
import {
  resumeAvailability,
  correctionPrompt,
  type ResumeReadings,
} from '../src/rules/resume.js';
import { gateFailures, type DeskReadings } from '../src/rules/gates.js';

const readings = (over: Partial<ResumeReadings> = {}): ResumeReadings => ({
  resumeId: '9f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8',
  transcriptFound: true,
  ...over,
});

describe('resumeAvailability', () => {
  it('hands back the handle when a transcript exists for it', () => {
    const actual = resumeAvailability(readings());
    expect(actual).toEqual({
      available: true,
      resumeId: '9f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8',
    });
  });

  it('is unavailable when the manifest records no handle', () => {
    const actual = resumeAvailability(readings({ resumeId: '' }));
    expect(actual.available).toBe(false);
    expect(actual.available === false && actual.why).toBe('no-id');
  });

  // THE CONFIGURATION PLOT CANNOT CONTROL, and therefore the one most likely to
  // be wrong in the field: the adopting project's `.plot/worker-prompt.sh`
  // invokes its harness without `--session-id`, so the id Plot asserted names no
  // transcript. Resume must report itself UNAVAILABLE rather than silently doing
  // nothing — a supervisor that reported a correction it never delivered would
  // be worse than having no resume path at all.
  it('is unavailable when the id names no transcript', () => {
    const actual = resumeAvailability(readings({ transcriptFound: false }));
    expect(actual.available).toBe(false);
    expect(actual.available === false && actual.why).toBe('no-transcript');
  });

  // The two refusals reach the same verdict from different readings, and a
  // caller that collapsed them would send an operator to fix a config key that
  // is already correct. So the reason must be legible in the text, not only in
  // the tag.
  it('names the missing --session-id rather than only refusing', () => {
    const actual = resumeAvailability(readings({ transcriptFound: false }));
    const detail = actual.available === false ? actual.detail : '';
    expect(detail).toContain('--session-id');
    expect(detail).toContain('worker-prompt.sh');
    expect(detail).toContain('9f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8');

    const noId = resumeAvailability(readings({ resumeId: '' }));
    const noIdDetail = noId.available === false ? noId.detail : '';
    expect(noIdDetail).not.toContain('--session-id');
  });

  // A handle with no transcript is refused BEFORE the id is trusted, and an
  // absent handle is refused before the transcript is consulted at all: a
  // caller with no id has nothing to look a transcript up by.
  it('refuses an absent handle even where a transcript was found', () => {
    const actual = resumeAvailability({ resumeId: '', transcriptFound: true });
    expect(actual.available === false && actual.why).toBe('no-id');
  });
});

describe('correctionPrompt', () => {
  it('is empty when nothing failed', () => {
    expect(correctionPrompt('feature/x', [])).toBe('');
  });

  it('quotes each gate failure verbatim', () => {
    const failures = ['first thing missing', 'second thing missing'];
    const actual = correctionPrompt('feature/x', failures);
    expect(actual).toContain('- first thing missing');
    expect(actual).toContain('- second thing missing');
    expect(actual).toContain('feature/x');
  });

  // A GATE FAILURE MESSAGE IS LEGIBLE AS A PROMPT — checked by reading one, not
  // by asserting a substring. What follows is the real text `gateFailures`
  // produces for a desk that opened no PR and added no changeset, run through
  // the correction. It is asserted whole so a change to either the gates or the
  // framing has to be READ before it can be accepted.
  it('reads as an instruction an agent can act on', () => {
    const desk: DeskReadings = {
      branch: 'feature/an-agent-remembers-its-session',
      merge: 'not-merged',
      changesets: [],
      workspacePackages: ['plot', '@plot-pm/board', '@plot-pm/domain'],
      dirtyPath: '',
      blockedMarker: '',
      planLine: { prs: [], deferred: false, deferredReason: '' },
    };

    const actual = correctionPrompt(desk.branch, gateFailures(desk));

    expect(actual).toBe(
      [
        'Your work on `feature/an-agent-remembers-its-session` did not complete. Each item below is a check that ran over what you left behind, and each names what to do about it:',
        '',
        '- No merged PR for `feature/an-agent-remembers-its-session`. The host holds no PR for this branch that has merged. Push the branch and open a PR to the default branch; if a PR is already open, get it merged.',
        '- No changeset was added for `feature/an-agent-remembers-its-session`. Add one file under `.changeset/` naming the packages this branch changes, with the description FIRST and the `bumps:` block LAST — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note.',
        '- The plan line for `feature/an-agent-remembers-its-session` is not annotated. Append the PR number to it on `main`, in the form `— <what it did> → #<pr>`, so the plan records where the work landed.',
        '',
        'Fix every item, then commit and push. Do not start other work.',
      ].join('\n'),
    );
  });
});
