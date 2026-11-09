/** The date prefix a plan file's name carries before its slug. */
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

/** A plan slug as the first column of a plan table writes it. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** A markdown table row's cells, outer pipes dropped. */
const cellsOf = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** The slug a first-column cell names, or `null` where it names none. */
const slugOfCell = (cell: string): string | null => {
  const link = /^\[[^\]]*\]\(([^)\s]+)\)$/.exec(cell);
  const raw = link !== null
    ? link[1].replace(/^.*\//, '').replace(/\.md$/, '').replace(DATE_PREFIX, '')
    : cell.replace(/^`|`$/g, '');
  return SLUG.test(raw) ? raw : null;
};

/**
 * The plan slugs a story's plan table names.
 *
 * Reads the first column of each table under a heading whose text ends in
 * `Plans`, and stops at the next heading. A cell is a bare slug or a markdown
 * link to `<directory>/<date>-<slug>.md`; the slug of a link is its target
 * without the directory and the date prefix. A table's header and separator
 * rows name no plan, and a cell that is neither form is skipped.
 *
 * @param text - the story file's text.
 * @returns the slugs in table order, each once; `[]` where the story has no such table.
 */
export const storyPlanTableSlugs = (text: string): string[] => {
  const slugs: string[] = [];
  let inSection = false;
  let rowInTable = 0;
  for (const line of text.split('\n')) {
    const heading = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (heading !== null) {
      inSection = /Plans$/.test(heading[1]);
      rowInTable = 0;
      continue;
    }
    if (!inSection) continue;
    if (!line.trim().startsWith('|')) {
      rowInTable = 0;
      continue;
    }
    rowInTable += 1;
    // Row 1 is the header and row 2 the separator.
    if (rowInTable <= 2) continue;
    const slug = slugOfCell(cellsOf(line)[0]);
    if (slug !== null && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
};
