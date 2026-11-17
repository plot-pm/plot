import { describe, expect, it } from 'vitest';

import { checksOfColour, decodeEscapes, listingBuildMap, plainBuildMap, shapeOfJob } from '../src/rules/ci-build-map.js';

describe('checksOfColour', () => {
  it.each([
    ['blue', 'green'],
    ['red', 'failing'],
    ['yellow', 'failing'],
    ['red_anime', 'pending'],
    ['blue_anime', 'pending'],
    ['disabled', 'none'],
    ['notbuilt', 'none'],
    ['', 'none'],
    [null, 'none'],
    [undefined, 'none'],
    [7, 'none'],
  ])('reads %j as %s', (color, checks) => {
    expect(checksOfColour(color)).toBe(checks);
  });
});

describe('decodeEscapes', () => {
  it('turns each escape into one code unit', () => {
    expect(decodeEscapes('feature%2Fa%20b')).toBe('feature/a b');
    expect(decodeEscapes('x%C3%BC')).toBe('xÃ¼');
    expect(decodeEscapes('plain')).toBe('plain');
  });
});

describe('shapeOfJob', () => {
  it.each([
    [{ _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob' }, 'plain'],
    [{ _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject' }, 'multibranch'],
    [{ _class: 'hudson.model.FreeStyleProject' }, 'other'],
    [{ _class: '' }, 'unreadable'],
    [{ _class: 3 }, 'unreadable'],
    [{}, 'unreadable'],
    [null, 'unreadable'],
    ['<html>', 'unreadable'],
    [[], 'unreadable'],
  ])('reads %j as %s', (view, shape) => {
    expect(shapeOfJob(view)).toBe(shape);
  });
});

describe('plainBuildMap', () => {
  it('keys the one entry by the last segment of the job', () => {
    expect(plainBuildMap({ color: 'blue_anime' }, 'team/deploy')).toEqual({
      status: 'ok',
      map: { deploy: { color: 'blue_anime', checks: 'pending', job: 'team/deploy' } },
    });
  });

  it('reads a colour that is no string as none', () => {
    expect(plainBuildMap({}, 'deploy')).toEqual({ status: 'ok', map: { deploy: { color: null, checks: 'none', job: 'deploy' } } });
  });
});

describe('listingBuildMap', () => {
  it('decodes each child name and joins it to the job', () => {
    expect(listingBuildMap([{ name: 'feature%2Fa', color: 'red' }, { name: 'main' }], 'team/portal')).toEqual({
      status: 'ok',
      map: {
        'feature/a': { color: 'red', checks: 'failing', job: 'team/portal/feature/a' },
        main: { color: null, checks: 'none', job: 'team/portal/main' },
      },
    });
  });

  it('names a root listing`s job by the branch alone', () => {
    expect(listingBuildMap([{ name: 'main', color: 'blue' }], '').map.main?.job).toBe('main');
  });

  it('is empty and ok for a listing with no children', () => {
    expect(listingBuildMap([], 'x')).toEqual({ status: 'ok', map: {} });
  });

  it.each([[null], ['x'], [{}], [[null]], [[{ color: 'blue' }]], [[{ name: 4 }]]])('reads %j as failed', (jobs) => {
    expect(listingBuildMap(jobs, 'x')).toEqual({ status: 'failed', map: {} });
  });
});
