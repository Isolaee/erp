jest.mock('../../lib/prisma', () => ({
  prisma: {
    docSection: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { prisma } from '../../lib/prisma';
import {
  parseMarkdownSections,
  rebuildSections,
  findRelevantSections,
} from '../../services/docIndexService';

const mockDocSection = prisma.docSection as any;
const mockTx = prisma.$transaction as jest.Mock;

describe('parseMarkdownSections', () => {
  it('returns a synthetic Introduction for content before the first heading', () => {
    const md = 'Some intro text\n\n# Section One\nContent here';
    const sections = parseMarkdownSections(md);
    expect(sections[0].heading).toBe('Introduction');
    expect(sections[0].content).toContain('Some intro text');
    expect(sections[0].level).toBe(1);
    expect(sections[0].order).toBe(0);
  });

  it('parses h1, h2, h3 headings and assigns correct levels', () => {
    // Function always flushes an "Introduction" entry first (sections.length === 0 rule)
    const md = '# Title\nParagraph\n## Sub\nMore\n### Sub-sub\nDeep';
    const sections = parseMarkdownSections(md);
    // Introduction (empty) + 3 real sections = 4 total
    expect(sections).toHaveLength(4);
    expect(sections[0]).toMatchObject({ heading: 'Introduction', level: 1, order: 0 });
    expect(sections[1]).toMatchObject({ heading: 'Title', level: 1, order: 1 });
    expect(sections[2]).toMatchObject({ heading: 'Sub', level: 2, order: 2 });
    expect(sections[3]).toMatchObject({ heading: 'Sub-sub', level: 3, order: 3 });
  });

  it('ignores h4+ headings (treats them as body text)', () => {
    const md = '# Title\n#### Not a section\nBody';
    const sections = parseMarkdownSections(md);
    // Introduction (empty) + Title section = 2 total
    expect(sections).toHaveLength(2);
    expect(sections[1].content).toContain('#### Not a section');
  });

  it('returns a single Introduction section for content with no headings', () => {
    const md = 'Just plain text with no headings.';
    const sections = parseMarkdownSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Introduction');
  });

  it('trims whitespace from section content', () => {
    const md = '# Heading\n\n  some content  \n\n## Next\nstuff';
    const sections = parseMarkdownSections(md);
    expect(sections[0].content.startsWith('\n')).toBe(false);
  });

  it('assigns monotonically increasing order numbers', () => {
    // Use content lines so non-Introduction sections are retained
    const md = '# A\ntext A\n## B\ntext B\n### C\ntext C';
    const sections = parseMarkdownSections(md);
    const orders = sections.map((s) => s.order);
    // [Introduction(0), A(1), B(2), C(3)]
    expect(orders).toEqual([0, 1, 2, 3]);
  });
});

describe('rebuildSections', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes existing sections and creates new ones in a transaction', async () => {
    mockTx.mockImplementation(async (ops: any[]) => {
      for (const op of ops) await op;
    });
    mockDocSection.deleteMany.mockResolvedValue({ count: 2 });
    mockDocSection.createMany.mockResolvedValue({ count: 2 });

    await rebuildSections('doc-1', '# Section\nContent');

    expect(mockTx).toHaveBeenCalledTimes(1);
    expect(mockDocSection.deleteMany).toHaveBeenCalledWith({ where: { docId: 'doc-1' } });
    expect(mockDocSection.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ docId: 'doc-1', heading: 'Section' }),
        ]),
      }),
    );
  });
});

describe('findRelevantSections', () => {
  beforeEach(() => jest.clearAllMocks());

  const fakeSections = [
    { id: 's1', docId: 'doc-1', heading: 'Authentication', content: 'Login and tokens', level: 1, order: 0, createdAt: new Date(), updatedAt: new Date() },
    { id: 's2', docId: 'doc-1', heading: 'Authorization', content: 'Roles and permissions', level: 1, order: 1, createdAt: new Date(), updatedAt: new Date() },
    { id: 's3', docId: 'doc-1', heading: 'Database', content: 'Schema and migrations', level: 1, order: 2, createdAt: new Date(), updatedAt: new Date() },
  ];

  it('returns sections ordered by keyword relevance', async () => {
    mockDocSection.findMany.mockResolvedValue(fakeSections);

    const result = await findRelevantSections('doc-1', 'authentication tokens login', 2);

    expect(result[0].heading).toBe('Authentication');
    expect(result).toHaveLength(2);
  });

  it('weights heading matches 3x over content matches', async () => {
    mockDocSection.findMany.mockResolvedValue(fakeSections);

    // "roles" appears in content of s2, but "authorization" matches heading of s2
    const result = await findRelevantSections('doc-1', 'authorization roles', 1);
    expect(result[0].heading).toBe('Authorization');
  });

  it('falls back to first two sections when query tokens match nothing', async () => {
    mockDocSection.findMany.mockResolvedValue(fakeSections);

    // Use real words that don't appear in any section heading or content
    const result = await findRelevantSections('doc-1', 'widgets sprockets gizmos', 3);
    // All scores are 0 → fallback to first 2 sections
    expect(result).toHaveLength(2);
    expect(result[0].heading).toBe('Authentication');
    expect(result[1].heading).toBe('Authorization');
  });

  it('returns empty array when doc has no sections', async () => {
    mockDocSection.findMany.mockResolvedValue([]);

    const result = await findRelevantSections('doc-1', 'anything');
    expect(result).toHaveLength(0);
  });

  it('respects the limit parameter', async () => {
    mockDocSection.findMany.mockResolvedValue(fakeSections);

    const result = await findRelevantSections('doc-1', 'schema migrations database', 1);
    expect(result).toHaveLength(1);
    expect(result[0].heading).toBe('Database');
  });
});
