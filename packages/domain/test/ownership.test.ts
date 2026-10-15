import { describe, it, expect } from 'vitest';
import {
  ownership, isMine, parsePersonDirectory, ticketSourceOf, type OwnedRow, type Reader, type TicketSource,
} from '../src/index.js';
import { TICKET_SOURCES } from '../src/adapters/tracker/tracker-listers.js';

/**
 * Whose a row is, and whether a filter to the reader's work keeps it.
 *
 * The fixture is #967's estate: four contributors, eleven open PRs, two of them
 * the reader's. A one-person estate cannot tell a filter that works from one
 * that hides nothing.
 */

const reader: Reader = { hostUser: 'jwloka', gitEmail: 'jan.wloka@quatico.com' };

const pr = (author?: string): OwnedRow => ({ kind: 'pr', author });

const estate: readonly OwnedRow[] = [
  pr('jwloka'), pr('jwloka'),
  pr('eins78'), pr('eins78'), pr('eins78'), pr('eins78'),
  pr('maemisegger'), pr('maemisegger'), pr('maemisegger'),
  pr('lklingler'), pr('lklingler'),
];

describe('ownership on #967\'s four-contributor estate', () => {
  it('keeps exactly the reader\'s two of eleven open PRs', () => {
    const kept = estate.filter((row) => isMine(row, reader));
    expect(estate).toHaveLength(11);
    expect(kept).toHaveLength(2);
    expect(kept.every((row) => row.kind === 'pr' && row.author === 'jwloka')).toBe(true);
  });

  it('names the other nine as somebody else\'s, not as unknown', () => {
    const answers = estate.map((row) => ownership(row, reader));
    expect(answers.filter((a) => a === 'mine')).toHaveLength(2);
    expect(answers.filter((a) => a === 'theirs')).toHaveLength(9);
    expect(answers.filter((a) => a === 'unknown')).toHaveLength(0);
  });
});

describe('a row with no determinable owner is shown', () => {
  it('shows a PR when the payload carries no identity', () => {
    expect(ownership(pr('eins78'), {})).toBe('unknown');
    expect(isMine(pr('eins78'), {})).toBe(true);
  });

  it('shows a PR when the reader\'s login is empty, as on Bitbucket', () => {
    const bitbucket: Reader = { hostUser: '', gitEmail: 'jan.wloka@quatico.com' };
    expect(ownership(pr('Michael Aemisegger'), bitbucket)).toBe('unknown');
    expect(isMine(pr('Michael Aemisegger'), bitbucket)).toBe(true);
  });

  it('does not read an empty identity against an empty author as a match', () => {
    expect(ownership(pr(''), { hostUser: '' })).toBe('unknown');
    expect(ownership(pr('  '), { hostUser: ' ' })).toBe('unknown');
  });

  it('shows a PR whose author the host did not answer', () => {
    expect(ownership(pr(''), reader)).toBe('unknown');
    expect(ownership(pr(undefined), reader)).toBe('unknown');
    expect(isMine(pr(undefined), reader)).toBe(true);
  });

  it('shows an agent in state elsewhere, whose desk is not on this machine', () => {
    const row: OwnedRow = { kind: 'agent', identity: 'manifest', state: 'elsewhere' };
    expect(ownership(row, reader)).toBe('unknown');
    expect(isMine(row, reader)).toBe(true);
  });

  it('shows a plan card, an issue row and a bare branch row', () => {
    expect(ownership({ kind: 'other' }, reader)).toBe('unknown');
    expect(isMine({ kind: 'other' }, reader)).toBe(true);
  });
});

describe('the agent row reports the machine\'s own record', () => {
  it('is the reader\'s where this machine declared it and its desk is here', () => {
    for (const state of ['running', 'finished', 'stalled', 'waiting', 'failed', 'ended', 'none']) {
      expect(ownership({ kind: 'agent', identity: 'manifest', state }, reader)).toBe('mine');
    }
  });

  it('is the reader\'s whatever the payload says about the host login', () => {
    expect(ownership({ kind: 'agent', identity: 'manifest', state: 'running' }, {})).toBe('mine');
  });

  it('is unknown for a desk no manifest declared', () => {
    expect(ownership({ kind: 'agent', identity: 'synthesized', state: 'running' }, reader)).toBe('unknown');
  });

  it('is unknown where an older server sent no identity or no state', () => {
    expect(ownership({ kind: 'agent', state: 'running' }, reader)).toBe('unknown');
    expect(ownership({ kind: 'agent', identity: 'manifest' }, reader)).toBe('unknown');
    expect(ownership({ kind: 'agent', identity: 'manifest', state: 'unknown' }, reader)).toBe('unknown');
  });
});

describe('one person, compared through Person', () => {
  it('reads case and surrounding whitespace as one person', () => {
    expect(ownership(pr('JWloka '), { hostUser: 'jwloka' })).toBe('mine');
    expect(ownership(pr('jwloka'), { hostUser: ' JWLOKA' })).toBe('mine');
  });

  it('never matches an email identity against a login author', () => {
    expect(ownership(pr('jan.wloka'), { hostUser: '', gitEmail: 'jan.wloka@quatico.com' })).toBe('unknown');
    expect(ownership(pr('jan.wloka'), { hostUser: 'jan.wloka@quatico.com' })).toBe('unknown');
    expect(ownership(pr('jwloka'), { gitEmail: 'jwloka@quatico.com' })).not.toBe('mine');
  });
});

/**
 * The directory this repository declares in `## Plot Config`. The three
 * spellings are the estate's measured `Assignee:` values: `jwloka` 62,
 * `Jan Wloka` 51, `eins78` 4. The four `eins78` plans were each added by Max
 * Albrecht, so `eins78` is a second person rather than a third spelling.
 */
const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const declared: Reader = { ...reader, directory };
const plan = (assignee?: string): OwnedRow => ({ kind: 'plan', assignee });

describe('a plan is owned by its assignee, resolved through the directory', () => {
  it('reads both of the reader\'s spellings as the reader\'s', () => {
    expect(ownership(plan('jwloka'), declared)).toBe('mine');
    expect(ownership(plan('Jan Wloka'), declared)).toBe('mine');
  });

  it('reads a spelling the directory declares for another person as theirs', () => {
    expect(ownership(plan('eins78'), declared)).toBe('theirs');
    expect(ownership(plan('Max Albrecht'), declared)).toBe('theirs');
    expect(isMine(plan('eins78'), declared)).toBe(false);
  });

  it('keeps the reader\'s 113 plans on the measured estate, and hides the other 4', () => {
    const estatePlans = [
      ...Array.from({ length: 62 }, () => plan('jwloka')),
      ...Array.from({ length: 51 }, () => plan('Jan Wloka')),
      ...Array.from({ length: 4 }, () => plan('eins78')),
    ];
    expect(estatePlans.filter((row) => isMine(row, declared))).toHaveLength(113);
  });

  it('hides none of the reader\'s plans without a directory', () => {
    // WITHOUT A DIRECTORY `Jan Wloka` is undeclared rather than somebody else.
    // An exact-match rule hid 51 of the reader's 113 plans here.
    expect(ownership(plan('Jan Wloka'), reader)).toBe('unknown');
    expect(isMine(plan('Jan Wloka'), reader)).toBe(true);
    expect(ownership(plan('jwloka'), reader)).toBe('mine');
  });

  it('keeps a plan whose assignee spelling the directory does not declare', () => {
    expect(ownership(plan('Someone New'), declared)).toBe('unknown');
    expect(isMine(plan('Someone New'), declared)).toBe(true);
  });

  it('keeps a plan that names nobody', () => {
    expect(ownership(plan(''), declared)).toBe('unknown');
    expect(ownership(plan(undefined), declared)).toBe('unknown');
  });

  it('keeps every plan when the reader has no comparable login', () => {
    expect(ownership(plan('eins78'), { directory })).toBe('unknown');
    expect(ownership(plan('eins78'), { hostUser: 'jan.wloka@quatico.com', directory })).toBe('unknown');
  });
});

describe('a PR author resolves through the same directory', () => {
  it('reads a declared second spelling of the reader as the reader\'s', () => {
    const aliased: Reader = { hostUser: 'jwloka', directory: parsePersonDirectory('jwloka = jwloka-work') };
    expect(ownership(pr('jwloka-work'), aliased)).toBe('mine');
  });

  it('still reads an undeclared author handle as somebody else\'s', () => {
    // A PR author and a login are both host handles, so the PR arm needs no
    // declaration to answer theirs — unlike the plan arm.
    expect(ownership(pr('maemisegger'), declared)).toBe('theirs');
  });
});

describe('isMine keeps what it cannot classify', () => {
  it('answers true for unknown, the permissive default', () => {
    // A LATER CHANGE THAT MAKES UNKNOWN HIDE fails here. Every population the
    // board has no owner for — issues, builds, bare branches — is `other`.
    expect(ownership({ kind: 'other' }, declared)).toBe('unknown');
    expect(isMine({ kind: 'other' }, declared)).toBe(true);
    expect(isMine(plan(''), declared)).toBe(true);
    expect(isMine(pr(''), declared)).toBe(true);
  });
});

describe('ticketSourceOf maps an IssueSource and a resolved backend to a TicketSource', () => {
  it('reads a tracker asking jira as jira', () => {
    expect(ticketSourceOf({ ask: 'tracker', scheme: 'jira' }, 'github', TICKET_SOURCES))
      .toEqual({ service: 'jira', match: 'tracker-account', prefix: 'jira:' });
  });

  it('reads a tracker asking github-issues as github', () => {
    expect(ticketSourceOf({ ask: 'tracker', scheme: 'github-issues' }, 'github', TICKET_SOURCES))
      .toEqual({ service: 'github', match: 'host-login' });
  });

  it('reads a git-host source with a github backend as github', () => {
    expect(ticketSourceOf({ ask: 'git-host' }, 'github', TICKET_SOURCES))
      .toEqual({ service: 'github', match: 'host-login' });
  });

  it('reads a git-host source with a bitbucket backend as bitbucket', () => {
    expect(ticketSourceOf({ ask: 'git-host' }, 'bitbucket', TICKET_SOURCES))
      .toEqual({ service: 'bitbucket', match: 'host-login' });
  });

  it('answers null for a git-host source with an unresolved backend', () => {
    expect(ticketSourceOf({ ask: 'git-host' }, 'gitlab', TICKET_SOURCES)).toBeNull();
    expect(ticketSourceOf({ ask: 'git-host' }, '', TICKET_SOURCES)).toBeNull();
  });

  it('answers null for a tracker scheme no lister describes', () => {
    expect(ticketSourceOf({ ask: 'tracker', scheme: 'youtrack' }, 'github', TICKET_SOURCES)).toBeNull();
    expect(ticketSourceOf({ ask: 'tracker', scheme: 'mute' }, 'github', { listers: [{ scheme: 'mute' }], hosts: [] }))
      .toBeNull();
  });

  it('answers null for a source nobody answers', () => {
    expect(ticketSourceOf({ ask: 'nobody', reason: 'no connector' }, 'github', TICKET_SOURCES)).toBeNull();
  });
});

describe('a ticket is owned by its assignees, resolved by source', () => {
  const github: TicketSource = { service: 'github', match: 'host-login' };
  const jira: TicketSource = { service: 'jira', match: 'tracker-account', prefix: 'jira:' };
  const ticket = (assignees: string[], source: TicketSource | null = github): OwnedRow => ({
    kind: 'ticket',
    assignees,
    source,
  });

  it('reads a GitHub assignee equal to an undeclared reader login as mine', () => {
    expect(ownership(ticket(['jwloka']), reader)).toBe('mine');
  });

  it('reads a second of two assignees equal to the reader as mine', () => {
    expect(ownership(ticket(['maemisegger', 'jwloka']), reader)).toBe('mine');
  });

  it('reads another declared person as theirs', () => {
    expect(ownership(ticket(['eins78']), declared)).toBe('theirs');
    expect(isMine(ticket(['eins78']), declared)).toBe(false);
  });

  it('reads [] as unknown, and isMine keeps it', () => {
    expect(ownership(ticket([]), reader)).toBe('unknown');
    expect(isMine(ticket([]), reader)).toBe(true);
  });

  it('reads a Jira assignee named by a jira: spelling of the reader\'s handle as mine', () => {
    const jiraDirectory = parsePersonDirectory('jwloka = jira:jan.wloka@quatico.com');
    const jiraReader: Reader = { hostUser: 'jwloka', directory: jiraDirectory };
    expect(ownership(ticket(['jan.wloka@quatico.com'], jira), jiraReader)).toBe('mine');
  });

  it('reads a Jira assignee named by a jira: spelling of another handle as theirs', () => {
    const jiraDirectory = parsePersonDirectory(
      'jwloka = jira:jan.wloka@quatico.com; eins78 = jira:max.albrecht@quatico.com',
    );
    const jiraReader: Reader = { hostUser: 'jwloka', directory: jiraDirectory };
    expect(ownership(ticket(['max.albrecht@quatico.com'], jira), jiraReader)).toBe('theirs');
  });

  it('reads a ticket whose source is unresolved as unknown', () => {
    expect(ownership(ticket(['jwloka'], null), reader)).toBe('unknown');
    expect(ownership({ kind: 'ticket', assignees: ['jwloka'] }, reader)).toBe('unknown');
    expect(ownership({ kind: 'ticket', source: github }, reader)).toBe('unknown');
  });

  it('reads a ticket as unknown where the reader has no comparable login', () => {
    expect(ownership(ticket(['jwloka']), { hostUser: '' })).toBe('unknown');
    expect(ownership(ticket(['jan.wloka@quatico.com'], jira), { hostUser: 'jan.wloka@quatico.com' })).toBe('unknown');
  });

  it('skips a blank assignee, and reads only blanks as unknown', () => {
    expect(ownership(ticket(['  ', 'jwloka']), reader)).toBe('mine');
    expect(ownership(ticket(['  ']), reader)).toBe('unknown');
  });

  it('reads a Jira assignee named by no handle as unknown', () => {
    const jiraDirectory = parsePersonDirectory('jwloka = jira:jan.wloka@quatico.com');
    const jiraReader: Reader = { hostUser: 'jwloka', directory: jiraDirectory };
    expect(ownership(ticket(['5b10ac8d82e05b22cc7d4ef5'], jira), jiraReader)).toBe('unknown');
    expect(ownership(ticket(['jan.wloka@quatico.com'], jira), { hostUser: 'jwloka' })).toBe('unknown');
  });
});

const story = (author?: string): OwnedRow => ({ kind: 'story', author });
const planOf = (fields: { assignee?: string; author?: string; approver?: string }): OwnedRow => ({
  kind: 'plan', ...fields,
});

describe('a story is owned by its author, resolved through the directory', () => {
  it('reads both of the reader\'s spellings as mine', () => {
    expect(ownership(story('jwloka'), declared)).toBe('mine');
    expect(ownership(story('Jan Wloka'), declared)).toBe('mine');
  });

  it('reads a spelling the directory declares for another person as theirs', () => {
    expect(ownership(story('Max Albrecht'), declared)).toBe('theirs');
    expect(isMine(story('eins78'), declared)).toBe(false);
  });

  it('reads an absent or empty author as unknown, not theirs', () => {
    expect(ownership(story(undefined), declared)).toBe('unknown');
    expect(ownership(story(''), declared)).toBe('unknown');
    expect(ownership(story('  '), declared)).toBe('unknown');
    expect(isMine(story(), declared)).toBe(true);
  });

  it('reads an undeclared spelling that differs from the login as unknown', () => {
    expect(ownership(story('Someone Else'), declared)).toBe('unknown');
    expect(ownership(story('eins78'), { hostUser: 'jwloka' })).toBe('unknown');
  });

  it('reads every author as unknown where the login is an email', () => {
    expect(ownership(story('jwloka'), { hostUser: 'jan.wloka@quatico.com', directory })).toBe('unknown');
  });
});

describe('a plan is owned by any of its assignee, author and approver', () => {
  it('reads a plan as mine where only the approver names the reader', () => {
    expect(ownership(planOf({ approver: 'Jan Wloka' }), declared)).toBe('mine');
  });

  it('reads a plan as mine where only the author names the reader', () => {
    expect(ownership(planOf({ author: 'jwloka' }), declared)).toBe('mine');
  });

  it('gives mine priority over another person\'s declared spelling', () => {
    expect(ownership(planOf({ assignee: 'eins78', author: 'jwloka' }), declared)).toBe('mine');
    expect(ownership(planOf({ assignee: 'jwloka', approver: 'Max Albrecht' }), declared)).toBe('mine');
  });

  it('reads a plan as theirs where a field names another person and none names the reader', () => {
    expect(ownership(planOf({ author: 'eins78' }), declared)).toBe('theirs');
    expect(ownership(planOf({ assignee: 'Someone Else', approver: 'Max Albrecht' }), declared)).toBe('theirs');
  });

  it('reads a plan whose three fields are empty or absent as unknown', () => {
    expect(ownership(planOf({}), declared)).toBe('unknown');
    expect(ownership(planOf({ assignee: '', author: ' ', approver: undefined }), declared)).toBe('unknown');
  });

  it('reads undeclared spellings alone as unknown', () => {
    expect(ownership(planOf({ author: 'Someone Else', approver: 'Another' }), declared)).toBe('unknown');
  });
});
