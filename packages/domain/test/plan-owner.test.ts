import { describe, expect, it } from 'vitest';
import { parsePersonDirectory } from '../src/entities/person.js';
import { planOwner } from '../src/rules/plan-owner.js';

const people = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');

describe('the Owner of a plan row', () => {
  it('reads the approver as its People handle where no sprint names the plan', () => {
    expect(planOwner({ approver: 'Jan Wloka', author: 'Max Albrecht' }, people)).toBe('jwloka');
  });

  it('reads the author where the plan has no approval record', () => {
    expect(planOwner({ approver: '', author: 'Max Albrecht' }, people)).toBe('eins78');
  });

  it('prefers the sprint Owner to the approver and the author', () => {
    expect(planOwner({ sprintOwner: 'eins78', approver: 'Jan Wloka', author: 'Jan Wloka' }, people)).toBe('eins78');
  });

  it('prefers the plan Assignee to the sprint Owner', () => {
    expect(planOwner({ assignee: 'Max Albrecht', sprintOwner: 'jwloka', approver: 'Jan Wloka' }, people)).toBe('eins78');
  });

  it('keeps an undeclared Assignee as the plan wrote it', () => {
    expect(planOwner({ assignee: ' Ada Lovelace ' }, people)).toBe('Ada Lovelace');
  });

  it('skips an approver or author that names no declared person', () => {
    expect(planOwner({ approver: 'in-session review after panel (round 1)', author: 'Jan Wloka' }, people)).toBe('jwloka');
    expect(planOwner({ approver: 'Claude', author: 'someone' }, people)).toBe('');
  });

  it('is empty where the plan names nobody', () => {
    expect(planOwner({}, people)).toBe('');
    expect(planOwner({ approver: 'Jan Wloka' })).toBe('');
  });
});
