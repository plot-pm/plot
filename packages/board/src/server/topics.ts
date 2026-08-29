/**
 * Topic extraction using TF-IDF (pure implementation, no external deps).
 *
 * Extracts meaningful topic keywords from story titles and their plan titles,
 * ranking them by distinctiveness across the corpus rather than raw frequency.
 */

/**
 * Project-specific stop words that appear frequently but carry no semantic value.
 * These are implementation terms, not topics.
 */
const PROJECT_STOP_WORDS = new Set([
  // Plot implementation terms
  'plan', 'plans', 'branch', 'branches', 'wave', 'waves', 'sprint', 'sprints',
  'story', 'stories', 'board', 'agent', 'agents', 'fleet', 'dispatch',
  'ref', 'refs', 'scan', 'pulse', 'claim', 'claims', 'worktree', 'worktrees',
  // Common verbs and generic terms
  'one', 'two', 'three', 'four', 'five', 'first', 'second', 'third',
  'add', 'adds', 'added', 'adding', 'remove', 'removes', 'removed', 'removing',
  'make', 'makes', 'made', 'making', 'show', 'shows', 'showed', 'showing',
  'get', 'gets', 'got', 'getting', 'set', 'sets', 'setting',
  'use', 'uses', 'used', 'using', 'create', 'creates', 'created', 'creating',
  'update', 'updates', 'updated', 'updating', 'fix', 'fixes', 'fixed', 'fixing',
  'new', 'old', 'current', 'next', 'last', 'same', 'own', 'other',
  'hold', 'holds', 'held', 'holding', 'name', 'names', 'named', 'naming',
  'say', 'says', 'said', 'saying', 'answer', 'answers', 'answered',
  'work', 'works', 'worked', 'working', 'read', 'reads', 'write', 'writes',
  'run', 'runs', 'running', 'start', 'starts', 'started', 'starting',
  'stop', 'stops', 'stopped', 'stopping', 'move', 'moves', 'moved', 'moving',
  'take', 'takes', 'took', 'taking', 'give', 'gives', 'gave', 'giving',
  'need', 'needs', 'needed', 'needing', 'want', 'wants', 'wanted', 'wanting',
  'know', 'knows', 'knew', 'knowing', 'think', 'thinks', 'thought', 'thinking',
  'see', 'sees', 'saw', 'seeing', 'look', 'looks', 'looked', 'looking',
  'find', 'finds', 'found', 'finding', 'keep', 'keeps', 'kept', 'keeping',
  'let', 'lets', 'put', 'puts', 'call', 'calls', 'called', 'calling',
  'try', 'tries', 'tried', 'trying', 'leave', 'leaves', 'left', 'leaving',
  'come', 'comes', 'came', 'coming', 'go', 'goes', 'went', 'going',
  'change', 'changes', 'changed', 'changing', 'turn', 'turns', 'turned', 'turning',
  'mean', 'means', 'meant', 'meaning', 'must', 'should', 'would', 'could',
  'might', 'may', 'can', 'will', 'shall', 'have', 'has', 'had', 'having',
  'be', 'is', 'are', 'was', 'were', 'been', 'being', 'do', 'does', 'did', 'done',
  // Articles, prepositions, conjunctions
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under',
  'and', 'or', 'but', 'if', 'because', 'until', 'while', 'about', 'against',
  'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some', 'any',
  'no', 'not', 'only', 'very', 'just', 'also', 'now', 'then', 'here', 'there',
  'so', 'than', 'too', 'yet', 'still', 'already', 'always', 'never', 'ever',
  // Pronouns
  'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'we', 'us', 'our', 'ours', 'ourselves', 'they', 'them', 'their', 'theirs',
]);

/**
 * A topic keyword with its score (higher = more distinctive).
 */
export interface TopicEntry {
  topic: string;
  score: number;
  /** Number of stories this topic appears in */
  count: number;
  /** Story slugs that contain this topic (for filtering) */
  storySlugs: string[];
}

/**
 * Input for topic extraction: a story with its title and plan titles.
 */
export interface StoryDocument {
  slug: string;
  title: string;
  planTitles: string[];
}

/**
 * Tokenize and normalize text, filtering stop words.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !PROJECT_STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Compute TF (term frequency) for a document.
 * Returns a map of term -> frequency in this document.
 */
function computeTf(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  // Normalize by document length
  const len = tokens.length || 1;
  for (const [term, count] of tf) {
    tf.set(term, count / len);
  }
  return tf;
}

/**
 * Compute IDF (inverse document frequency) for all terms across documents.
 * IDF = log(N / df) where N is total docs and df is docs containing term.
 */
function computeIdf(documents: string[][]): Map<string, number> {
  const df = new Map<string, number>(); // document frequency
  const N = documents.length;

  for (const doc of documents) {
    const uniqueTerms = new Set(doc);
    for (const term of uniqueTerms) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, docFreq] of df) {
    // Add 1 to avoid division by zero and smooth the IDF
    idf.set(term, Math.log((N + 1) / (docFreq + 1)) + 1);
  }
  return idf;
}

/**
 * Extract topics from stories using TF-IDF.
 *
 * Each story (with its plan titles) is treated as a document. TF-IDF finds
 * terms that are distinctive across documents — terms that appear in some
 * stories but not all, weighted by their frequency within each story.
 *
 * @param stories Array of story documents
 * @param maxTopics Maximum number of topics to return (default 20)
 * @returns Topics sorted by aggregate TF-IDF score, with story slugs for filtering
 */
export function extractTopics(stories: StoryDocument[], maxTopics = 20): TopicEntry[] {
  if (stories.length === 0) return [];

  // Tokenize all documents
  const documents: { slug: string; tokens: string[] }[] = stories.map((s) => ({
    slug: s.slug,
    tokens: tokenize([s.title, ...s.planTitles].join(' ')),
  }));

  // Track which stories each term appears in
  const termToStories = new Map<string, Set<string>>();
  for (const doc of documents) {
    const uniqueTerms = new Set(doc.tokens);
    for (const term of uniqueTerms) {
      const storySet = termToStories.get(term) ?? new Set();
      storySet.add(doc.slug);
      termToStories.set(term, storySet);
    }
  }

  // Compute IDF across all documents
  const idf = computeIdf(documents.map((d) => d.tokens));

  // Aggregate TF-IDF scores across all documents
  const topicScores = new Map<string, number>();

  for (const doc of documents) {
    const tf = computeTf(doc.tokens);
    for (const [term, tfValue] of tf) {
      const idfValue = idf.get(term) ?? 1;
      const tfidf = tfValue * idfValue;
      topicScores.set(term, (topicScores.get(term) ?? 0) + tfidf);
    }
  }

  // Convert to array and sort by score
  const topics: TopicEntry[] = Array.from(topicScores.entries())
    .map(([topic, score]) => ({
      topic,
      score,
      count: termToStories.get(topic)?.size ?? 0,
      storySlugs: Array.from(termToStories.get(topic) ?? []),
    }))
    // Prefer topics that appear in multiple stories but not all
    // (appearing in all stories = not distinctive)
    .filter((t) => t.count > 1 || stories.length <= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTopics);

  return topics;
}
