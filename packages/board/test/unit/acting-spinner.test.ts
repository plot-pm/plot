import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTING_CLASS } from '../../src/app/components/ui/ActingSpinner.js';

/**
 * WHAT THE TWO INDICATORS PROMISE, HELD APART AT THE SOURCE.
 *
 * The regression this file guards is not that a spinner is missing — the
 * browser suite (`test/integration/spinner.browser.test.ts`) owns everything a
 * rendered page can show. It is that the two markers get UNIFIED: one class for
 * the button and the row alike passes every "is there a marker" assertion and
 * quietly makes every WORKING row promise a completion nothing measures. `isLive`
 * is `group === 'working'`, so such a row can pulse for hours with no known end.
 *
 * | Indicator          | Means                                | Lives for |
 * |--------------------|--------------------------------------|-----------|
 * | `LiveDot` on a row | something is alive, end unknown      | hours     |
 * | Spinner on button  | an answer is coming                  | seconds   |
 *
 * This repo has no component-test seat — vitest runs `environment: 'node'`, with
 * no jsdom and no React Testing Library — so what a page renders is asserted in
 * a browser and what the SOURCE commits to is asserted here, by reading it.
 * Reading the file is the honest form of the question: the claim is about which
 * animation utility each component chose, and that is a fact about the source.
 *
 * FIELDS, NOT WHOLE FILES. Every assertion names the one thing it cares about,
 * so an unrelated edit in either component does not fail this suite.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) =>
  fs.readFileSync(path.resolve(here, '../../src/app/components', rel), 'utf8');

const SPINNER = src('ui/ActingSpinner.tsx');
const AGENT_LIST = src('AgentList.tsx');
const START_WORK = src('StartWorkButton.tsx');
const APPROVE = src('ApproveButton.tsx');

/** The `LiveDot` component body — the row's marker, and nothing around it. */
function liveDotBody(): string {
  const from = AGENT_LIST.indexOf('function LiveDot()');
  expect(from).toBeGreaterThan(-1);
  return AGENT_LIST.slice(from, AGENT_LIST.indexOf('\n}', from));
}

describe('the two indicators are different markers making different claims', () => {
  it('the BUTTON spins — rotation, because a click ends', () => {
    // A click resolves in seconds: the request returns and the pulse confirms.
    // Rotation is honest there in a way it is not on a row.
    expect(SPINNER).toMatch(/\banimate-spin\b/);
  });

  it('the ROW pulses — no rotation, because a row does not end', () => {
    // `working-rows-show-motion` chose this deliberately: *rotation implies
    // progress toward completion, which nothing here measures*. That is still
    // true of a row, and it is what makes unifying the two markers wrong.
    const dot = liveDotBody();
    expect(dot).toMatch(/\banimate-pulse\b/);
    expect(dot).not.toMatch(/\banimate-spin\b/);
  });

  it('and neither borrows the other\'s test hook', () => {
    // The hook a unifying change would collapse. `data-live-dot` is already
    // asserted by the Agents tab suite; a spinner wearing it would inherit
    // those assertions while changing what the row claims.
    expect(SPINNER).toMatch(/data-acting-spinner/);
    expect(SPINNER).not.toMatch(/data-live-dot/);
    expect(liveDotBody()).not.toMatch(/data-acting-spinner/);
  });
});

describe('motion-reduce stops the animation and keeps the marker', () => {
  it('the spinner suppresses MOTION, not itself', () => {
    // Both halves. Removing the element under reduced motion would take the
    // marker away with the movement, leaving a reader who prefers reduced
    // motion with LESS information rather than the same information held still.
    expect(SPINNER).toMatch(/motion-reduce:animate-none/);
  });

  it('and the marker is not rendered CONDITIONALLY on a motion query', () => {
    // The failure mode the rule above is written against: a component that
    // asked `prefers-reduced-motion` in JavaScript and returned nothing would
    // satisfy "no motion" and fail the reader it was meant to serve.
    expect(SPINNER).not.toMatch(/prefers-reduced-motion/);
    expect(SPINNER).not.toMatch(/matchMedia/);
  });

  it('the row keeps the same pattern, untouched', () => {
    expect(liveDotBody()).toMatch(/motion-reduce:animate-none/);
  });
});

describe('the marker is decoration, never the carrier', () => {
  it('the spinner is aria-hidden', () => {
    // The state is announced twice already — the label and `aria-busy`, both
    // landed in earlier waves. A third announcement is noise.
    expect(SPINNER).toMatch(/aria-hidden/);
  });

  it('both buttons keep their label change, and render the marker BESIDE it', () => {
    // Motion must never be the only carrier of a fact. The pairing that
    // matters: a marker rendered INSTEAD of the word passes every "is there a
    // spinner" assertion and leaves a screen reader with nothing.
    expect(START_WORK).toMatch(/'starting…'/);
    expect(APPROVE).toMatch(/'approving…'/);
    expect(START_WORK).toMatch(/\{starting && <ActingSpinner \/>\}/);
    expect(APPROVE).toMatch(/\{running && <ActingSpinner \/>\}/);
  });

  it('an IDLE button renders no marker — the render is guarded by the state', () => {
    // Trivial by construction, pinned so nobody later renders it
    // unconditionally: a spinner on every button says every button is acting.
    expect(START_WORK).not.toMatch(/^\s*<ActingSpinner \/>/m);
    expect(APPROVE).not.toMatch(/^\s*<ActingSpinner \/>/m);
  });
});

describe('the dimming keys off the same state as the label', () => {
  it('is applied on the in-flight state, not on a timer or a second derivation', () => {
    // `refusal` and `starting` are read once each and the dimming rides the
    // latter. Two derivations of one fact are how two gates start disagreeing —
    // the button would dim while its label said it was idle, or the reverse.
    expect(START_WORK).toMatch(new RegExp(`starting \\? \` \\$\\{ACTING_CLASS\\}\``));
    expect(APPROVE).toMatch(new RegExp(`running \\? \` \\$\\{ACTING_CLASS\\}\``));
  });

  it('and dims rather than hides — the label stays legible', () => {
    // A button faded to nothing loses the word, which is the carrier. Opacity
    // well above zero keeps the three channels — motion, text, contrast —
    // saying it once each rather than one of them cancelling another.
    const opacity = Number(ACTING_CLASS.replace('opacity-', ''));
    expect(opacity).toBeGreaterThan(30);
    expect(opacity).toBeLessThan(100);
  });
});
