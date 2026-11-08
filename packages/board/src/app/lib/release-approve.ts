import type { ReleasePrReading } from '@plot-pm/domain/rules/release-approvable';
import type { AgentRow } from '../../contract/schema.js';
import { assertWith, refusalWording } from './passkey.js';
import { challenge, post } from './passkey-client.js';

/**
 * The release PR's reading as the domain rule takes it.
 *
 * @param pr - the row's `pr`.
 * @returns the reading, or `null` where the row has no PR. `open` is false for a payload that predates the field.
 */
export const releaseReadingOf = (pr: AgentRow['pr']): ReleasePrReading | null =>
  pr === null
    ? null
    : {
        open: pr.open === true,
        headSha: pr.headSha,
        checksSha: pr.checksSha,
        ciChecks: pr.ciChecks,
        plotReview: pr.plotReview,
        plotReviewSha: pr.plotReviewSha,
        plotReviewJudged: pr.plotReviewJudged,
        plotReviewCheckedSha: pr.plotReviewCheckedSha,
      };

/**
 * Approves one release PR at one head with the registered passkey.
 *
 * @param pr - the release PR's number.
 * @param sha - the head the row read.
 * @returns the sentence to show: the approval, or the server's refusal in words.
 */
export const approveRelease = async (pr: number, sha: string): Promise<string> => {
  const assertion = await assertWith(await challenge({ action: 'release-approve', pr, sha }));
  const done = await post('/api/release-approve', { pr, sha, assertion });
  if (done.status === 200 && done.body.approved) {
    return `Release PR #${pr} approved with passkey ${String(done.body.credentialId ?? '')}.`;
  }
  return refusalWording(String(done.body.reason ?? ''), String(done.body.detail ?? ''));
};
