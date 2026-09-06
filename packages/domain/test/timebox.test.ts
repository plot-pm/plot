import { describe, expect, it } from 'vitest';
import { daysLate, timeboxLabel, timeboxStanding } from '../src/rules/timebox.js';

const readings = (start: string, end: string, today: string) => ({ start, end, today });

describe('where a sprint sits against its own dates', () => {
  it('reports running inside the box', () => {
    expect(timeboxStanding(readings('2026-08-18', '2026-08-22', '2026-08-20'))).toBe('running');
  });

  it('includes both ends of the box', () => {
    // A sprint is not late on the day it ends.
    expect(timeboxStanding(readings('2026-08-18', '2026-08-22', '2026-08-18'))).toBe('running');
    expect(timeboxStanding(readings('2026-08-18', '2026-08-22', '2026-08-22'))).toBe('running');
  });

  it('reports late past the end', () => {
    expect(timeboxStanding(readings('2026-08-18', '2026-08-22', '2026-08-23'))).toBe('late');
  });

  it('reports upcoming before the start', () => {
    expect(timeboxStanding(readings('2026-08-18', '2026-08-22', '2026-08-17'))).toBe('upcoming');
  });

  it('reports none where the file names no dates', () => {
    expect(timeboxStanding(readings('', '', '2026-08-20'))).toBe('none');
  });

  it('reads an end alone, which is the half worth seeing', () => {
    expect(timeboxStanding(readings('', '2026-08-22', '2026-08-23'))).toBe('late');
    expect(timeboxStanding(readings('', '2026-08-22', '2026-08-21'))).toBe('running');
  });

  it('reads a start alone as running from that day', () => {
    expect(timeboxStanding(readings('2026-08-18', '', '2026-08-30'))).toBe('running');
    expect(timeboxStanding(readings('2026-08-18', '', '2026-08-17'))).toBe('upcoming');
  });

  it('treats a malformed date as one the file did not name', () => {
    // The comparison is lexicographic, so `2026-9-6` would sort after
    // `2026-10-01` and answer the wrong question confidently.
    expect(timeboxStanding(readings('2026-8-18', '2026-8-22', '2026-08-30'))).toBe('none');
    expect(timeboxStanding(readings('next monday', 'whenever', '2026-08-30'))).toBe('none');
    expect(timeboxStanding(readings('2026-08-18', 'whenever', '2026-08-30'))).toBe('running');
  });

  it('answers none when today itself cannot be compared', () => {
    expect(timeboxStanding(readings('2026-08-18', '2026-08-22', ''))).toBe('none');
  });
});

describe('how late a sprint is', () => {
  it('counts whole days past the end', () => {
    expect(daysLate(readings('2026-08-18', '2026-08-22', '2026-08-23'))).toBe(1);
    expect(daysLate(readings('2026-08-18', '2026-08-22', '2026-09-05'))).toBe(14);
  });

  it('counts zero for a sprint that is not late', () => {
    expect(daysLate(readings('2026-08-18', '2026-08-22', '2026-08-20'))).toBe(0);
    expect(daysLate(readings('', '', '2026-08-20'))).toBe(0);
  });

  it('counts across a month boundary', () => {
    expect(daysLate(readings('2026-08-18', '2026-08-31', '2026-09-01'))).toBe(1);
  });
});

describe('the timebox as a card prints it', () => {
  it('prints the range while the sprint runs', () => {
    expect(timeboxLabel(readings('2026-08-18', '2026-08-22', '2026-08-20'))).toBe(
      '2026-08-18 → 2026-08-22',
    );
  });

  it('names the days once a sprint is late', () => {
    expect(timeboxLabel(readings('2026-08-18', '2026-08-22', '2026-08-23'))).toBe(
      '2026-08-18 → 2026-08-22 · 1 day late',
    );
    expect(timeboxLabel(readings('2026-08-18', '2026-08-22', '2026-08-25'))).toBe(
      '2026-08-18 → 2026-08-22 · 3 days late',
    );
  });

  it('prints the half it has, with the arrow saying the other is unknown', () => {
    expect(timeboxLabel(readings('2026-08-18', '', '2026-08-20'))).toBe('2026-08-18 → …');
    expect(timeboxLabel(readings('', '2026-08-22', '2026-08-20'))).toBe('… → 2026-08-22');
  });

  it('prints nothing where the sprint named no usable date', () => {
    expect(timeboxLabel(readings('', '', '2026-08-20'))).toBe('');
  });
});
