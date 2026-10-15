import { describe, expect, it } from 'vitest';
import { storyCardView } from '../src/rules/story-card.js';

describe('storyCardView', () => {
  it('gives no owner where the story has no stated author', () => {
    expect(storyCardView('').owner).toBeNull();
  });

  it('resolves an authors handle through the People directory', () => {
    expect(storyCardView('Jan Wloka', { 'jan wloka': 'jwloka' }).owner).toBe('jwloka');
  });

  it('renders an author spelling undeclared in People as written', () => {
    expect(storyCardView('Nobody Declared').owner).toBe('nobody declared');
  });

  it('gives no owner where the author field is only whitespace', () => {
    expect(storyCardView('   ').owner).toBeNull();
  });
});
