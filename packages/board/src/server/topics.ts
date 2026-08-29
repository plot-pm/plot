/**
 * Topic extraction for story filtering.
 *
 * Uses a hybrid approach:
 * 1. Story slugs (human-curated domain concepts like "plot-board", "plot-gates")
 * 2. Meaningful compound terms from plan titles (hyphenated domain terms)
 *
 * This surfaces the domain vocabulary that actually matters for navigation,
 * rather than generic words that happen to appear frequently.
 */

/**
 * Stop words that carry no semantic value for topic filtering.
 * Aggressive list to ensure only meaningful domain terms surface.
 */
const STOP_WORDS = new Set([
  // Plot implementation terms (too specific to the tool itself)
  'plan', 'plans', 'branch', 'branches', 'wave', 'waves', 'sprint', 'sprints',
  'story', 'stories', 'board', 'agent', 'agents', 'fleet', 'dispatch',
  'ref', 'refs', 'scan', 'pulse', 'claim', 'claims', 'worktree', 'worktrees',
  'skill', 'skills', 'spoke', 'spokes', 'hub', 'phase', 'phases',
  // Generic software terms (too common across all stories)
  'code', 'file', 'files', 'path', 'paths', 'line', 'lines', 'row', 'rows',
  'column', 'columns', 'section', 'sections', 'page', 'pages', 'tab', 'tabs',
  'data', 'value', 'values', 'field', 'fields', 'key', 'keys', 'item', 'items',
  'list', 'lists', 'array', 'arrays', 'map', 'maps', 'object', 'objects',
  'string', 'strings', 'number', 'numbers', 'type', 'types', 'function', 'functions',
  'error', 'errors', 'warning', 'warnings', 'message', 'messages', 'text', 'texts',
  'state', 'states', 'status', 'config', 'option', 'options', 'setting', 'settings',
  'result', 'results', 'output', 'outputs', 'input', 'inputs', 'response', 'request',
  // Generic nouns that appear everywhere
  'thing', 'things', 'something', 'nothing', 'everything', 'anything',
  'way', 'ways', 'place', 'places', 'point', 'points', 'part', 'parts',
  'time', 'times', 'day', 'days', 'week', 'weeks', 'month', 'year',
  'case', 'cases', 'example', 'examples', 'instance', 'instances',
  'kind', 'kinds', 'sort', 'sorts', 'form', 'forms', 'hand', 'hands',
  'end', 'ends', 'side', 'sides', 'top', 'bottom', 'front', 'back',
  'question', 'questions', 'answer', 'answers', 'problem', 'problems',
  'issue', 'issues', 'reason', 'reasons', 'fact', 'facts', 'idea', 'ideas',
  'word', 'words', 'name', 'names', 'title', 'titles', 'label', 'labels',
  'user', 'users', 'person', 'people', 'body', 'bodies', 'head', 'heads',
  'host', 'hosts', 'server', 'servers', 'client', 'clients',
  // Ordinals and quantities
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'first', 'second', 'third', 'fourth', 'fifth', 'last', 'next', 'single', 'double',
  'half', 'whole', 'full', 'empty', 'none', 'zero',
  // Common verbs and their forms
  'add', 'adds', 'added', 'adding', 'remove', 'removes', 'removed', 'removing',
  'make', 'makes', 'made', 'making', 'show', 'shows', 'showed', 'showing',
  'get', 'gets', 'got', 'getting', 'set', 'sets', 'setting',
  'use', 'uses', 'used', 'using', 'create', 'creates', 'created', 'creating',
  'update', 'updates', 'updated', 'updating', 'fix', 'fixes', 'fixed', 'fixing',
  'hold', 'holds', 'held', 'holding', 'tell', 'tells', 'told', 'telling',
  'say', 'says', 'said', 'saying', 'ask', 'asks', 'asked', 'asking',
  'speak', 'speaks', 'spoke', 'speaking', 'talk', 'talks', 'talked', 'talking',
  'work', 'works', 'worked', 'working', 'read', 'reads', 'write', 'writes',
  'run', 'runs', 'running', 'ran', 'start', 'starts', 'started', 'starting',
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
  'mean', 'means', 'meant', 'meaning', 'promise', 'promises', 'promised',
  'live', 'lives', 'lived', 'living', 'happen', 'happens', 'happened',
  'carry', 'carries', 'carried', 'carrying', 'pass', 'passes', 'passed', 'passing',
  'follow', 'follows', 'followed', 'following', 'lead', 'leads', 'led', 'leading',
  'open', 'opens', 'opened', 'opening', 'close', 'closes', 'closed', 'closing',
  'allow', 'allows', 'allowed', 'allowing', 'help', 'helps', 'helped', 'helping',
  'fail', 'fails', 'failed', 'failing', 'report', 'reports', 'reported',
  'check', 'checks', 'checked', 'checking', 'test', 'tests', 'tested', 'testing',
  'send', 'sends', 'sent', 'sending', 'return', 'returns', 'returned',
  'build', 'builds', 'built', 'building', 'match', 'matches', 'matched',
  'mark', 'marks', 'marked', 'marking', 'exist', 'exists', 'existed',
  'support', 'supports', 'supported', 'require', 'requires', 'required',
  'provide', 'provides', 'provided', 'include', 'includes', 'included',
  'contain', 'contains', 'contained', 'belong', 'belongs', 'belonged',
  // Modal and auxiliary verbs
  'must', 'should', 'would', 'could', 'might', 'may', 'can', 'will', 'shall',
  'have', 'has', 'had', 'having', 'be', 'is', 'are', 'was', 'were', 'been', 'being',
  'do', 'does', 'did', 'done', 'doing',
  // Adjectives
  'new', 'old', 'current', 'same', 'own', 'other', 'different', 'real', 'actual',
  'good', 'bad', 'right', 'wrong', 'true', 'false', 'valid', 'invalid',
  'high', 'low', 'big', 'small', 'long', 'short', 'large', 'little',
  'able', 'unable', 'possible', 'impossible', 'available', 'unavailable',
  'local', 'remote', 'internal', 'external', 'public', 'private',
  'main', 'base', 'default', 'standard', 'common', 'special', 'specific',
  'visible', 'hidden', 'active', 'inactive', 'ready', 'pending', 'complete',
  // Articles, prepositions, conjunctions
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under',
  'out', 'up', 'down', 'off', 'over', 'away', 'back', 'around', 'along',
  'and', 'or', 'but', 'if', 'because', 'until', 'while', 'about', 'against',
  'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some', 'any',
  'no', 'not', 'only', 'very', 'just', 'also', 'now', 'then', 'here', 'there',
  'so', 'than', 'too', 'yet', 'still', 'already', 'always', 'never', 'ever',
  'even', 'well', 'back', 'again', 'away', 'enough', 'rather', 'quite',
  // Pronouns
  'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'we', 'us', 'our', 'ours', 'ourselves', 'they', 'them', 'their', 'theirs',
  'nobody', 'somebody', 'anybody', 'everybody', 'someone', 'anyone', 'everyone',
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
 * Returns single words (unigrams) that pass the stop word filter.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Extract hyphenated compound terms from text.
 * These are often meaningful domain terms like "merge-queue", "status-drift".
 */
function extractCompounds(text: string): string[] {
  const compounds: string[] = [];
  const matches = text.toLowerCase().match(/[a-z]+-[a-z]+(?:-[a-z]+)*/g) || [];
  for (const match of matches) {
    // Filter out compounds where all parts are stop words
    const parts = match.split('-');
    const meaningful = parts.filter((p) => p.length > 2 && !STOP_WORDS.has(p));
    if (meaningful.length >= 1) {
      compounds.push(match);
    }
  }
  return compounds;
}

/**
 * Words that often form meaningful bigrams when followed by a noun.
 * These are modifiers that create domain concepts.
 */
const BIGRAM_MODIFIERS = new Set([
  // Adjectives that create domain concepts
  'parallel', 'master', 'main', 'base', 'draft', 'approved', 'delivered', 'released',
  'planning', 'running', 'working', 'blocking', 'blocked', 'pending', 'active',
  'semantic', 'strategic', 'tactical', 'atomic', 'automatic', 'manual', 'visual',
  'merge', 'release', 'review', 'approval', 'delivery', 'dispatch', 'reconcile',
  'identity', 'economics', 'model', 'gates', 'rules', 'drift', 'queue', 'truth',
]);

/**
 * Extract meaningful two-word phrases (bigrams) from text.
 * Looks for modifier + noun patterns that form domain concepts.
 */
function extractBigrams(text: string): string[] {
  const bigrams: string[] = [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  for (let i = 0; i < words.length - 1; i++) {
    const first = words[i];
    const second = words[i + 1];

    // Skip if either is a basic stop word
    if (STOP_WORDS.has(first) && !BIGRAM_MODIFIERS.has(first)) continue;
    if (STOP_WORDS.has(second)) continue;

    // Include if first word is a known modifier, or if both are meaningful
    if (BIGRAM_MODIFIERS.has(first) || (!STOP_WORDS.has(first) && !STOP_WORDS.has(second))) {
      bigrams.push(`${first} ${second}`);
    }
  }

  return bigrams;
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
 * Basic stop words for slug filtering (a minimal set to remove noise).
 */
const SLUG_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'what', 'which', 'who', 'where', 'when', 'why', 'how',
  'this', 'that', 'these', 'those', 'it', 'its',
  'and', 'or', 'but', 'if', 'then', 'else',
  'not', 'no', 'yes', 'all', 'any', 'some',
  'for', 'with', 'from', 'into', 'about',
  'already', 'asks', 'knows', 'holds', 'matters', 'blank',
]);

/**
 * Extract meaningful domain keywords from a story slug.
 * Returns compound topic (2-3 meaningful words joined) plus individual words.
 */
function keywordsFromSlug(slug: string): string[] {
  // Remove common prefixes
  const cleaned = slug
    .replace(/^(plot-|the-|a-|an-|setup-)/, '')
    .replace(/(-v\d+|-wip|-draft)$/, '');

  // Filter to meaningful words only
  const words = cleaned
    .split('-')
    .filter((w) => w.length > 2 && !SLUG_STOP_WORDS.has(w));

  if (words.length === 0) return [];

  // Create a compound topic from first 2-3 meaningful words
  const compound = words.slice(0, 3).join('-');

  // Return compound + individual words (for matching across stories)
  return [compound, ...words];
}

/**
 * Extract topics from stories for filtering.
 *
 * Uses a domain-focused approach:
 * 1. Extract keywords from story slugs (human-curated domain concepts)
 * 2. Extract meaningful compound terms from plan titles
 * 3. Rank by how many stories share each topic (for filter utility)
 *
 * @param stories Array of story documents
 * @param maxTopics Maximum number of topics to return (default 12)
 * @returns Topics sorted by count (most useful for filtering), then alphabetically
 */
export function extractTopics(stories: StoryDocument[], maxTopics = 12): TopicEntry[] {
  if (stories.length === 0) return [];

  // Track which stories each topic appears in
  const topicToStories = new Map<string, Set<string>>();

  for (const story of stories) {
    // 1. Keywords from story slug (these are the primary domain concepts)
    const slugKeywords = keywordsFromSlug(story.slug);

    // 2. Compound terms from plan titles (domain-specific hyphenated terms)
    const planCompounds = story.planTitles.flatMap((t) => extractCompounds(t));

    // 3. Bigrams from story title (meaningful two-word phrases)
    const titleBigrams = extractBigrams(story.title);

    // 4. Bigrams from plan titles
    const planBigrams = story.planTitles.flatMap((t) => extractBigrams(t));

    // Combine all terms (prefer bigrams and compounds over single words)
    const allTerms = new Set([
      ...slugKeywords,
      ...planCompounds,
      ...titleBigrams,
      ...planBigrams,
    ]);

    for (const term of allTerms) {
      const storySet = topicToStories.get(term) ?? new Set();
      storySet.add(story.slug);
      topicToStories.set(term, storySet);
    }
  }

  // Terms to exclude (noise that slipped through)
  const NOISE_TERMS = new Set([
    // Numeric words
    'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
    'sixty-seven', 'twenty-four', 'thirty-two',
    // Overly generic compound terms
    'first-class', 'long-term', 'short-term', 'real-time', 'high-level', 'low-level',
    'long-horizon', 'next-step', 'last-step',
  ]);

  // Convert to array and sort by count
  const allTopics = Array.from(topicToStories.entries())
    .map(([topic, slugs]) => ({
      topic,
      score: slugs.size,
      count: slugs.size,
      storySlugs: Array.from(slugs),
    }))
    // Exclude noise terms and topics in ALL stories
    .filter((t) => !NOISE_TERMS.has(t.topic) && t.count < stories.length)
    // Sort by count desc, then alphabetically
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));

  // Prefer topics that appear in 2+ stories (better for filtering)
  const multiStory = allTopics.filter((t) => t.count >= 2);

  // If we have enough multi-story topics, use those
  // Otherwise, fill with single-story topics (compound slugs are still useful)
  if (multiStory.length >= maxTopics / 2) {
    return multiStory.slice(0, maxTopics);
  }

  // Mix: all multi-story + some single-story to fill
  const singleStory = allTopics
    .filter((t) => t.count === 1)
    // Prefer compound topics (hyphenated) over single words
    .sort((a, b) => {
      const aCompound = a.topic.includes('-') ? 1 : 0;
      const bCompound = b.topic.includes('-') ? 1 : 0;
      return bCompound - aCompound || a.topic.localeCompare(b.topic);
    });

  return [...multiStory, ...singleStory].slice(0, maxTopics);
}
