/**
 * The branch an agent's Fleet row names, for display only.
 *
 * The registry's `branch` comes first. A synthesized desk agent carries
 * `branch: ''` and its branch in `checkout`; that `checkout` is the answer
 * then. Placement never reads this rule: it reads `branch` alone.
 *
 * @param agent - the registry entry's `branch` and, where read, its `checkout`.
 * @returns the branch, or `null` where both fields are empty.
 */
export const agentActsOnBranch = (agent: { branch: string; checkout?: string | undefined }): string | null => {
  if (agent.branch !== '') return agent.branch;
  const checkout = agent.checkout ?? '';
  return checkout === '' ? null : checkout;
};
