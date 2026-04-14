import { prisma } from '../lib/prisma';
import type { DocSection } from '@prisma/client';

export interface ParsedSection {
  heading: string;
  content: string;
  level: number;
  order: number;
}

/**
 * Parse raw markdown into an array of sections split on h1/h2/h3 headings.
 * Any text before the first heading becomes a synthetic "Introduction" section.
 */
export function parseMarkdownSections(markdown: string): ParsedSection[] {
  const lines = markdown.split('\n');
  const sections: ParsedSection[] = [];
  let currentHeading = 'Introduction';
  let currentLevel = 1;
  let currentLines: string[] = [];
  let order = 0;

  const headingRe = /^(#{1,3})\s+(.+)$/;

  const flush = () => {
    const content = currentLines.join('\n').trim();
    if (content || sections.length === 0) {
      sections.push({ heading: currentHeading, content, level: currentLevel, order: order++ });
    }
  };

  for (const line of lines) {
    const match = headingRe.exec(line);
    if (match) {
      flush();
      currentLevel = match[1].length;
      currentHeading = match[2].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * Delete and recreate all DocSection rows for a doc inside a transaction.
 * Called synchronously on every doc create/update.
 */
export async function rebuildSections(docId: string, content: string): Promise<void> {
  const parsed = parseMarkdownSections(content);

  await prisma.$transaction([
    prisma.docSection.deleteMany({ where: { docId } }),
    prisma.docSection.createMany({
      data: parsed.map((s) => ({
        docId,
        heading: s.heading,
        content: s.content,
        level: s.level,
        order: s.order,
      })),
    }),
  ]);
}

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','this','that','these',
  'those','it','its','how','what','when','where','why','which','who',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Score sections by keyword overlap with the query and return the top `limit`.
 * Heading matches are weighted 3x over content matches.
 * Falls back to the first two sections if all scores are zero.
 */
export async function findRelevantSections(
  docId: string,
  query: string,
  limit = 3,
): Promise<DocSection[]> {
  const sections = await prisma.docSection.findMany({
    where: { docId },
    orderBy: { order: 'asc' },
  });

  if (sections.length === 0) return [];

  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) return sections.slice(0, limit);

  const scored = sections.map((s) => {
    const headingTokens = tokenize(s.heading);
    const contentTokens = tokenize(s.content);
    let score = 0;
    for (const t of tokens) {
      if (headingTokens.includes(t)) score += 3;
      if (contentTokens.includes(t)) score += 1;
    }
    return { section: s, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, limit);
  if (top.every((s) => s.score === 0)) {
    return sections.slice(0, Math.min(2, sections.length));
  }

  return top.map((s) => s.section);
}
