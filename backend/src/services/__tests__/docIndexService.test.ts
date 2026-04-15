import { parseMarkdownSections, findRelevantSections } from '../docIndexService';
import { prisma } from '../../lib/prisma';

// ---------------------------------------------------------------------------
// Mock Prisma for findRelevantSections (which hits DB)
// ---------------------------------------------------------------------------
jest.mock('../../lib/prisma', () => ({
  prisma: {
    docSection: { findMany: jest.fn() },
  },
}));

const mockFindMany = prisma.docSection.findMany as jest.Mock;

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
// parseMarkdownSections  (pure function — no DB)
// ===========================================================================
describe('parseMarkdownSections', () => {
  it('empty string produces one Introduction section with empty content', () => {
    const sections = parseMarkdownSections('');
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ heading: 'Introduction', content: '', level: 1, order: 0 });
  });

  it('text with no headings becomes a single Introduction section', () => {
    const sections = parseMarkdownSections('Hello world\nSecond line');
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Introduction');
    expect(sections[0].content).toBe('Hello world\nSecond line');
  });

  it('single h1 heading with no preamble text', () => {
    const md = '# My Heading\nSome content here';
    const sections = parseMarkdownSections(md);
    // Empty Introduction flushed before heading, then the h1 section
    // Introduction has empty content so it's only included as the first (and there's no other)
    expect(sections.length).toBeGreaterThanOrEqual(1);
    const h1 = sections.find((s) => s.heading === 'My Heading');
    expect(h1).toBeDefined();
    expect(h1!.level).toBe(1);
    expect(h1!.content).toContain('Some content here');
  });

  it('text before first heading becomes Introduction section', () => {
    const md = 'Preamble text\n# Section One\nContent one';
    const sections = parseMarkdownSections(md);
    expect(sections[0].heading).toBe('Introduction');
    expect(sections[0].content).toContain('Preamble text');
    expect(sections[1].heading).toBe('Section One');
  });

  it('h2 heading has level 2', () => {
    const sections = parseMarkdownSections('## Sub Section\nContent');
    const h2 = sections.find((s) => s.heading === 'Sub Section');
    expect(h2).toBeDefined();
    expect(h2!.level).toBe(2);
  });

  it('h3 heading has level 3', () => {
    const sections = parseMarkdownSections('### Deep Section\nContent');
    const h3 = sections.find((s) => s.heading === 'Deep Section');
    expect(h3!.level).toBe(3);
  });

  it('h4 headings are NOT parsed as sections (only h1–h3)', () => {
    const md = '#### Too Deep\nContent';
    const sections = parseMarkdownSections(md);
    // The #### line does not match the regex, so it becomes part of Introduction content
    expect(sections.every((s) => s.heading !== 'Too Deep')).toBe(true);
    expect(sections[0].content).toContain('#### Too Deep');
  });

  it('order increments correctly across multiple sections', () => {
    const md = '# One\nA\n## Two\nB\n### Three\nC';
    const sections = parseMarkdownSections(md);
    const named = sections.filter((s) => ['One', 'Two', 'Three'].includes(s.heading));
    const orders = named.map((s) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length); // all unique
  });

  it('heading with extra spaces is trimmed', () => {
    const sections = parseMarkdownSections('#   Spaced Heading  \nContent');
    const h = sections.find((s) => s.heading === 'Spaced Heading');
    expect(h).toBeDefined();
  });

  it('multiple h1/h2/h3 sections are all captured', () => {
    const md = [
      '# Section A',
      'Content A',
      '## Section B',
      'Content B',
      '# Section C',
      'Content C',
    ].join('\n');
    const sections = parseMarkdownSections(md);
    const names = sections.map((s) => s.heading);
    expect(names).toContain('Section A');
    expect(names).toContain('Section B');
    expect(names).toContain('Section C');
  });

  it('content between two headings is attributed to the first heading', () => {
    const md = '# First\nLine 1\nLine 2\n# Second\nLine 3';
    const sections = parseMarkdownSections(md);
    const first = sections.find((s) => s.heading === 'First');
    expect(first!.content).toContain('Line 1');
    expect(first!.content).toContain('Line 2');
    expect(first!.content).not.toContain('Line 3');
  });

  it('empty section between two headings is dropped by the parser', () => {
    // flush() skips a section when content is empty AND it is not the very first section
    const md = '# Empty Section\n# Next Section\nContent';
    const sections = parseMarkdownSections(md);
    expect(sections.find((s) => s.heading === 'Empty Section')).toBeUndefined();
    expect(sections.find((s) => s.heading === 'Next Section')).toBeDefined();
  });
});

// ===========================================================================
// findRelevantSections
// ===========================================================================
describe('findRelevantSections', () => {
  const makeSections = (overrides: Partial<{ heading: string; content: string; order: number }>[]) =>
    overrides.map((o, i) => ({
      id: `sec-${i}`,
      docId: 'doc-1',
      heading: o.heading ?? `Section ${i}`,
      content: o.content ?? '',
      level: 1,
      order: o.order ?? i,
    }));

  it('returns empty array when no sections exist', async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await findRelevantSections('doc-1', 'any query')).toEqual([]);
  });

  it('returns up to limit=3 sections by default', async () => {
    const sections = makeSections([
      { heading: 'Alpha', content: 'alpha content' },
      { heading: 'Beta', content: 'beta content' },
      { heading: 'Gamma', content: 'gamma content' },
      { heading: 'Delta', content: 'delta content' },
    ]);
    mockFindMany.mockResolvedValue(sections);
    const result = await findRelevantSections('doc-1', 'alpha beta gamma delta');
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('respects custom limit', async () => {
    const sections = makeSections([
      { heading: 'A', content: 'aa' },
      { heading: 'B', content: 'bb' },
    ]);
    mockFindMany.mockResolvedValue(sections);
    const result = await findRelevantSections('doc-1', 'aa bb', 1);
    expect(result).toHaveLength(1);
  });

  it('heading match scores higher than content match', async () => {
    const sections = makeSections([
      { heading: 'authentication', content: 'unrelated stuff' },
      { heading: 'Overview', content: 'authentication is described here in detail' },
    ]);
    mockFindMany.mockResolvedValue(sections);
    const result = await findRelevantSections('doc-1', 'authentication', 2);
    // The section with "authentication" in the heading should rank first
    expect(result[0].heading).toBe('authentication');
  });

  it('falls back to first 2 sections when tokens are non-empty but all scores are zero', async () => {
    const sections = makeSections([
      { heading: 'Intro', content: 'hello world' },
      { heading: 'Setup', content: 'installation steps' },
      { heading: 'Advanced', content: 'expert tips' },
    ]);
    mockFindMany.mockResolvedValue(sections);
    // Non-stop-word tokens that match nothing in the sections
    const result = await findRelevantSections('doc-1', 'xyzzy nonexistent foobar', 3);
    expect(result).toHaveLength(2);
    expect(result[0].heading).toBe('Intro');
    expect(result[1].heading).toBe('Setup');
  });

  it('returns sliced sections for empty query tokens (after stop-word filtering)', async () => {
    const sections = makeSections([
      { heading: 'A', content: 'aa' },
      { heading: 'B', content: 'bb' },
      { heading: 'C', content: 'cc' },
      { heading: 'D', content: 'dd' },
    ]);
    mockFindMany.mockResolvedValue(sections);
    // Empty string query → no tokens → returns first `limit` sections
    const result = await findRelevantSections('doc-1', '', 2);
    expect(result).toHaveLength(2);
  });

  it('stop words are filtered from query tokens → empty token set → returns first limit sections', async () => {
    const sections = makeSections([
      { heading: 'Deployment', content: 'docker kubernetes' },
      { heading: 'Introduction', content: 'this is the project' },
    ]);
    mockFindMany.mockResolvedValue(sections);
    // All tokens are stop words → tokens.length === 0 → returns sections.slice(0, limit)
    const result = await findRelevantSections('doc-1', 'how to the a an', 2);
    expect(result).toHaveLength(2);
  });

  it('queries docSection ordered by order field', async () => {
    mockFindMany.mockResolvedValue([]);
    await findRelevantSections('doc-1', 'test');
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { docId: 'doc-1' },
        orderBy: { order: 'asc' },
      }),
    );
  });
});
