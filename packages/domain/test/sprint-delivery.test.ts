import { describe, it, expect } from 'vitest';
import {
  deliveryScope,
  parsePersonDirectory,
  sprintDeliveryGroups,
  sprintDeliveryTitle,
  sprintGroupHeader,
  type Reader,
} from '../src/index.js';

const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const jan: Reader = { hostUser: 'jwloka', directory };
const alpha = { slug: 'alpha', title: 'Alpha sprint', ownerHandle: 'jwloka', members: ['p1', 'p2'] };
const beta = { slug: 'beta', title: 'Beta sprint', ownerHandle: 'jwloka', members: ['p2', 'p3'] };
const other = { slug: 'other', title: 'Other sprint', ownerHandle: 'eins78', members: ['p4'] };
const ownerless = { slug: 'nobody', title: 'Nobody sprint', ownerHandle: '', members: ['p5'] };
const approved = ['p1', 'p2', 'p3', 'p4', 'p5'];

describe('sprintDeliveryTitle', () => {
  it('names the sprint where the toggle is on with one owned sprint', () => {
    expect(sprintDeliveryTitle(deliveryScope(['alpha'], jan, [alpha, other]))).toBe('Sprint delivery · Alpha sprint');
  });
  it('drops the name where several owned sprints are selected', () => {
    expect(sprintDeliveryTitle(deliveryScope(['alpha', 'beta'], jan, [alpha, beta, other]))).toBe('Sprint delivery');
  });
  it('reads Release delivery with the toggle off', () => {
    expect(sprintDeliveryTitle(deliveryScope([], jan, [alpha, other]))).toBe('Release delivery');
  });
  it('reads Release delivery for a sprint with no Owner and for a reader with no host login', () => {
    expect(sprintDeliveryTitle(deliveryScope(['nobody'], jan, [ownerless]))).toBe('Release delivery');
    expect(sprintDeliveryTitle(deliveryScope(['nobody'], { hostUser: '', directory }, [ownerless]))).toBe('Release delivery');
  });
  it('reads Release delivery for a reader who owns none of the sprints', () => {
    expect(sprintDeliveryTitle(deliveryScope(['other'], jan, [other]))).toBe('Release delivery');
  });
  it('falls back to the slug where the sprint has no title', () => {
    const bare = { slug: 'bare', ownerHandle: 'jwloka', members: [] as string[] };
    expect(sprintDeliveryTitle(deliveryScope(['bare'], jan, [bare]))).toBe('Sprint delivery · bare');
  });
});

describe('sprintDeliveryGroups', () => {
  it('lists only the owned sprint plans and none of the other sprint', () => {
    const groups = sprintDeliveryGroups(deliveryScope(['alpha'], jan, [alpha, other]), approved);
    expect(groups).toEqual([{ sprint: 'alpha', name: 'Alpha sprint', plans: ['p1', 'p2'] }]);
  });
  it('makes one group per owned sprint and lists a shared plan under both', () => {
    const groups = sprintDeliveryGroups(deliveryScope(['alpha', 'beta'], jan, [alpha, beta, other]), approved);
    expect(groups.map((g) => [g.name, g.plans])).toEqual([
      ['Alpha sprint', ['p1', 'p2']],
      ['Beta sprint', ['p2', 'p3']],
    ]);
  });
  it('lists only approved plans', () => {
    expect(sprintDeliveryGroups(deliveryScope(['alpha'], jan, [alpha]), ['p2'])[0]!.plans).toEqual(['p2']);
  });
  it('makes no group under the release scope', () => {
    expect(sprintDeliveryGroups(deliveryScope([], jan, [alpha, beta, other]), approved)).toEqual([]);
  });
});

describe('sprintGroupHeader', () => {
  it('carries the counts alone for one sprint and the name for several', () => {
    expect(sprintGroupHeader('Alpha sprint', false, '2 plans')).toBe('2 plans');
    expect(sprintGroupHeader('Alpha sprint', true, '2 plans')).toBe('Alpha sprint · 2 plans');
  });
});
