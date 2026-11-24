import { post } from './passkey-client.js';

/**
 * The sentence a "Book as Released" click shows for the route's answer.
 *
 * @param status - the HTTP status of `POST /api/release-finish`.
 * @param body - the answer's body.
 * @returns the booked plans, the already-released notice, or the refusal's reason and detail.
 */
export const releaseFinishWording = (status: number, body: Record<string, unknown>): string => {
  const version = String(body.version ?? '');
  if (status === 200 && body.outcome === 'booked') {
    const booked = Array.isArray(body.booked) ? body.booked.map(String) : [];
    return `${version} booked: ${booked.length === 0 ? 'no plan' : booked.join(', ')}.`;
  }
  if (status === 200 && body.outcome === 'already-released') return `${version} is already released.`;
  const reason = String(body.reason ?? '');
  const error = String(body.error ?? '');
  if (reason === '') return error === '' ? `refused (HTTP ${status})` : error;
  return error === '' ? reason : `${reason}: ${error}`;
};

/**
 * Asks the board to finish one merged release.
 *
 * @param version - the release version.
 * @returns the sentence to show.
 */
export const finishReleaseVersion = async (version: string): Promise<string> => {
  const done = await post('/api/release-finish', { version });
  return releaseFinishWording(done.status, done.body);
};
