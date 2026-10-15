import { resolvePerson, type PersonDirectory } from '../entities/person.js';

/** Everything a story card needs to render its owner name. */
export interface StoryCardView {
  /** The author's handle, resolved through `People`; `null` where the story names none. */
  readonly owner: string | null;
}

/**
 * The owner name a story card renders.
 *
 * `StoryCardSchema.author` defaults to `''` where the frontmatter carries no
 * `author:` line — that default must read as no owner, never as a name.
 * Stories carry no `type` field: the issue names a story owner but no story
 * type source, and this rule does not invent one.
 *
 * @param author - the story's `author` field, as frontmatter spelled it; `''` where none is stated.
 * @param directory - the declared `People` spellings; `{}` where none is declared.
 * @returns the card's owner, `null` where the story names none.
 */
export const storyCardView = (author: string, directory: PersonDirectory = {}): StoryCardView => {
  const raw = author.trim();
  return { owner: raw === '' ? null : resolvePerson(raw, directory).handle };
};
