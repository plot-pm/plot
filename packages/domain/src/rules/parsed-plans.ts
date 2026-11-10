/**
 * The records the parser read, without the files it could not read.
 *
 * @param records - plan records, some of which may carry `error`.
 * @returns the records with no `error`, in their order.
 */
export const parsedPlans = <R extends { readonly error?: string }>(records: readonly R[]): R[] =>
  records.filter((record) => record.error === undefined);
