import Anthropic from '@anthropic-ai/sdk';
import { Response } from 'express';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { findRelevantSections, rebuildSections } from './docIndexService';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const docTools: Anthropic.Tool[] = [
  {
    name: 'update_doc_content',
    description: 'Replace the full markdown content of the document. Use when rewriting or significantly restructuring.',
    input_schema: {
      type: 'object',
      properties: {
        docId:   { type: 'string' },
        content: { type: 'string', description: 'Full new markdown content' },
        reason:  { type: 'string', description: 'One-line summary of what changed' },
      },
      required: ['docId', 'content', 'reason'],
    },
  },
  {
    name: 'append_section',
    description: 'Append a new markdown section to the end of the document. Use for additive updates.',
    input_schema: {
      type: 'object',
      properties: {
        docId:   { type: 'string' },
        heading: { type: 'string', description: 'Section heading text (without ##)' },
        body:    { type: 'string', description: 'Markdown body of the new section' },
      },
      required: ['docId', 'heading', 'body'],
    },
  },
  {
    name: 'update_section',
    description: 'Find an existing section by heading and replace its content.',
    input_schema: {
      type: 'object',
      properties: {
        docId:   { type: 'string' },
        heading: { type: 'string', description: 'Exact heading to find (case-insensitive)' },
        newBody: { type: 'string', description: 'Replacement markdown body for that section' },
      },
      required: ['docId', 'heading', 'newBody'],
    },
  },
  {
    name: 'read_section',
    description: 'Fetch the full content of a specific section by its order index. Use when you need to read a section not in the initial context.',
    input_schema: {
      type: 'object',
      properties: {
        docId: { type: 'string' },
        order: { type: 'number', description: '0-indexed section order' },
      },
      required: ['docId', 'order'],
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;

async function executeTool(
  toolName: string,
  input: ToolInput,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    switch (toolName) {
      case 'update_doc_content': {
        const docId   = input.docId as string;
        const content = input.content as string;
        await prisma.doc.update({ where: { id: docId }, data: { content } });
        await rebuildSections(docId, content);
        return { success: true, data: { docId, reason: input.reason } };
      }

      case 'append_section': {
        const docId   = input.docId as string;
        const heading = input.heading as string;
        const body    = input.body as string;
        const doc     = await prisma.doc.findUnique({ where: { id: docId } });
        if (!doc) return { success: false, error: 'Doc not found' };
        const newContent = doc.content.trimEnd() + `\n\n## ${heading}\n\n${body}`;
        await prisma.doc.update({ where: { id: docId }, data: { content: newContent } });
        await rebuildSections(docId, newContent);
        return { success: true, data: { docId, addedHeading: heading } };
      }

      case 'update_section': {
        const docId      = input.docId as string;
        const targetHead = (input.heading as string).toLowerCase();
        const newBody    = input.newBody as string;
        const doc        = await prisma.doc.findUnique({ where: { id: docId } });
        if (!doc) return { success: false, error: 'Doc not found' };

        const lines   = doc.content.split('\n');
        const headRe  = /^(#{1,3})\s+(.+)$/;
        let startIdx  = -1;
        let endIdx    = lines.length;
        let headPrefix = '##';

        for (let i = 0; i < lines.length; i++) {
          const m = headRe.exec(lines[i]);
          if (m && m[2].trim().toLowerCase() === targetHead) {
            startIdx  = i;
            headPrefix = m[1];
          } else if (startIdx >= 0 && i > startIdx && m) {
            endIdx = i;
            break;
          }
        }

        if (startIdx === -1) {
          return { success: false, error: `Section "${input.heading}" not found` };
        }

        const before     = lines.slice(0, startIdx + 1);
        const after      = lines.slice(endIdx);
        const newContent = [...before, '', newBody, ...after].join('\n');
        await prisma.doc.update({ where: { id: docId }, data: { content: newContent } });
        await rebuildSections(docId, newContent);
        return { success: true, data: { docId, updatedHeading: input.heading, headPrefix } };
      }

      case 'read_section': {
        const section = await prisma.docSection.findFirst({
          where: { docId: input.docId as string, order: input.order as number },
        });
        if (!section) return { success: false, error: 'Section not found' };
        return { success: true, data: { heading: section.heading, content: section.content, level: section.level } };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Context Builder ──────────────────────────────────────────────────────────

async function buildDocContext(
  docId: string,
  userPrompt: string,
  repoContext?: string,
): Promise<string> {
  const doc = await prisma.doc.findUnique({
    where: { id: docId },
    include: { repoFollow: { select: { owner: true, repo: true } } },
  });
  if (!doc) return '';

  const allSections = await prisma.docSection.findMany({
    where: { docId },
    orderBy: { order: 'asc' },
    select: { heading: true, level: true, order: true },
  });

  const relevant = await findRelevantSections(docId, userPrompt, 3);

  const outline = allSections
    .map((s) => `  ${'  '.repeat(s.level - 1)}${s.order}. ${s.heading}`)
    .join('\n');

  const relevantText = relevant
    .map((s) => `### ${s.heading} (order:${s.order})\n${s.content}`)
    .join('\n\n');

  const repoLine = doc.repoFollow
    ? `Linked repository: ${doc.repoFollow.owner}/${doc.repoFollow.repo}\n`
    : '';

  return [
    `Document: "${doc.title}" (id:${doc.id})`,
    repoLine,
    `Section outline (${allSections.length} total — use read_section to fetch any by order index):`,
    outline,
    '',
    `Relevant sections for this request:`,
    relevantText || '(none matched — see outline above)',
    repoContext ? `\nRepository activity:\n${repoContext}` : '',
  ].join('\n');
}

// ─── Streaming Refine (user-triggered, SSE response) ─────────────────────────

export async function refineDocWithStream(
  docId: string,
  userPrompt: string,
  requestingUserId: string,
  sseRes: Response,
  repoContext?: string,
): Promise<{ response: string; toolCalls: unknown[] }> {
  const context = await buildDocContext(docId, userPrompt, repoContext);

  const systemPrompt = `You are a documentation assistant for an engineering team.
You have tools to update, append, and rewrite sections of a markdown document.
Always use tools to make changes — never describe changes in prose alone.
After using tools, briefly explain what you changed and why.`;

  const userMessage = `${context}\n\nRequest: ${userPrompt}`;
  const collectedToolCalls: unknown[] = [];
  let fullResponse = '';
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

  for (let round = 0; round < 3; round++) {
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: docTools,
      messages,
    });

    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullResponse += chunk.delta.text;
        sseRes.write(`event: text\ndata: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
      if (chunk.type === 'content_block_stop') {
        const block = stream.currentMessage?.content?.[chunk.index];
        if (block?.type === 'tool_use') toolUseBlocks.push(block);
      }
    }

    const finalMessage = await stream.finalMessage();
    if (toolUseBlocks.length === 0 || finalMessage.stop_reason !== 'tool_use') break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolBlock of toolUseBlocks) {
      sseRes.write(`event: tool_call\ndata: ${JSON.stringify({ tool: toolBlock.name, input: toolBlock.input })}\n\n`);
      const result = await executeTool(toolBlock.name, toolBlock.input as ToolInput);
      collectedToolCalls.push({ tool: toolBlock.name, input: toolBlock.input, result });
      toolResults.push({ type: 'tool_result', tool_use_id: toolBlock.id, content: JSON.stringify(result) });
      sseRes.write(`event: tool_result\ndata: ${JSON.stringify({ tool: toolBlock.name, result })}\n\n`);
    }

    messages.push({ role: 'assistant', content: finalMessage.content });
    messages.push({ role: 'user', content: toolResults });
  }

  // Persist final requestingUserId for audit — caller handles AiRefinement record
  void requestingUserId;
  return { response: fullResponse, toolCalls: collectedToolCalls };
}

// ─── Headless Auto-Update (background poller) ────────────────────────────────

export async function autoUpdateDoc(docId: string, repoSummary: string): Promise<void> {
  const context = await buildDocContext(docId, repoSummary, repoSummary);

  const systemPrompt = `You are a documentation assistant. Update the document to reflect new repository activity. Use tools to make targeted changes.`;
  const userMessage  = `${context}\n\nRequest: Update the documentation to reflect this new repository activity.`;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
  let fullResponse = '';
  const collectedToolCalls: unknown[] = [];

  for (let round = 0; round < 3; round++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: docTools,
      messages,
    });

    for (const block of response.content) {
      if (block.type === 'text') fullResponse += block.text;
    }

    if (response.stop_reason !== 'tool_use') break;

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolBlock of toolUseBlocks) {
      const result = await executeTool(toolBlock.name, toolBlock.input as ToolInput);
      collectedToolCalls.push({ tool: toolBlock.name, input: toolBlock.input, result });
      toolResults.push({ type: 'tool_result', tool_use_id: toolBlock.id, content: JSON.stringify(result) });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  await prisma.aiRefinement.create({
    data: {
      docId,
      prompt:      repoSummary,
      response:    fullResponse,
      toolCalls:   collectedToolCalls as any,
      createdById: (await prisma.doc.findUnique({ where: { id: docId }, select: { ownerId: true } }))!.ownerId,
    },
  });
}
