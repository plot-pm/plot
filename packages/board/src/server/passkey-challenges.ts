import { randomBytes } from 'node:crypto';

/** How long an issued challenge lives, in milliseconds. */
export const CHALLENGE_TTL_MS = 120_000;

/**
 * The single-use challenges the board has issued, each bound to what it
 * approves.
 *
 * Held in the board process's memory and never persisted: a restart loses the
 * open challenges, and the person asks again.
 */
export interface ChallengeStore {
  /**
   * Issues a challenge bound to one subject.
   *
   * @param binding - what the challenge approves, such as `release-approve:<pr>:<sha>`.
   * @returns the challenge, base64url.
   */
  issue(binding: string): string;

  /**
   * Spends a challenge.
   *
   * @param challenge - the challenge the assertion carried.
   * @param binding - what the call asks to approve.
   * @returns `'ok'`, or `'challenge-expired'` where the challenge is unknown,
   *   already spent, older than {@link CHALLENGE_TTL_MS}, or bound to another
   *   subject. Every case spends it.
   */
  consume(challenge: string, binding: string): 'ok' | 'challenge-expired';
}

/**
 * Builds a challenge store.
 *
 * @param now - the clock, in epoch milliseconds.
 * @returns an empty store.
 */
export const challengeStore = (now: () => number = Date.now): ChallengeStore => {
  const open = new Map<string, { binding: string; at: number }>();
  return {
    issue: (binding) => {
      for (const [challenge, held] of open) {
        if (now() - held.at > CHALLENGE_TTL_MS) open.delete(challenge);
      }
      const challenge = randomBytes(32).toString('base64url');
      open.set(challenge, { binding, at: now() });
      return challenge;
    },
    consume: (challenge, binding) => {
      const held = open.get(challenge);
      open.delete(challenge);
      if (held === undefined) return 'challenge-expired';
      if (now() - held.at > CHALLENGE_TTL_MS) return 'challenge-expired';
      return held.binding === binding ? 'ok' : 'challenge-expired';
    },
  };
};

/** The process's own store, used where a route is given none. */
export const boardChallenges: ChallengeStore = challengeStore();
