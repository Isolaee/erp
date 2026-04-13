import Anthropic from '@anthropic-ai/sdk';
import { Response } from 'express';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { TaskPriority, TaskStatus } from '@prisma/client';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// ─── Tool Definitions ────────────────────────────────────────────────────────

const tools: Anthropic.Tool[] = [
  {
    name: 'create_task',
    description: 'Create a new task in a specified list. Use to break down work, add subtasks, or create new work items.',
    input_schema: {
      type: 'object',
      properties: {
        listId:      { type: 'string', description: 'ID of the list to create the task in' },
        parentId:    { type: 'string', description: 'Optional: ID of parent task to create a subtask' },
        title:       { type: 'string', description: 'Short, clear task title' },
        description: { type: 'string', description: 'Detailed description with acceptance criteria' },
        priority:    { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        dueDate:     { type: 'string', description: 'ISO date string, optional' },
      },
      required: ['listId', 'title'],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task title, description, priority, status, or due date.',
    input_schema: {
      type: 'object',
      properties: {
        taskId:      { type: 'string' },
        title:       { type: 'string' },
        description: { type: 'string' },
        priority:    { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        status:      { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] },
        dueDate:     { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'move_task',
    description: 'Move a task to a different list. Use when reorganizing tasks by scope or team.',
    input_schema: {
      type: 'object',
      properties: {
        taskId:       { type: 'string' },
        targetListId: { type: 'string' },
      },
      required: ['taskId', 'targetListId'],
    },
  },
  {
    name: 'assign_task',
    description: 'Assign a task to a team member. Creates a pending assignment they must accept.',
    input_schema: {
      type: 'object',
      properties: {
        taskId:     { type: 'string' },
        assigneeId: { type: 'string', description: 'User ID of the assignee' },
        note:       { type: 'string', description: 'Optional message explaining why this person was chosen' },
      },
      required: ['taskId', 'assigneeId'],
    },
  },
  {
    name: 'delete_task',
    description: 'Soft-delete a task. Use sparingly — only when clearly redundant or invalid.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['taskId', 'reason'],
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;

async function executeTool(
  toolName: string,
  input: ToolInput,
  requestingUserId: string,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    switch (toolName) {
      case 'create_task': {
        const maxOrder = await prisma.task.aggregate({
          where: { listId: input.listId as string, deletedAt: null },
          _max: { order: true },
        });
        const order = (maxOrder._max.order ?? 0) + 1000;
        const task = await prisma.task.create({
          data: {
            listId:      input.listId as string,
            parentId:    (input.parentId as string | undefined) ?? null,
            title:       input.title as string,
            description: (input.description as string | undefined) ?? null,
            priority:    (input.priority as TaskPriority | undefined) ?? TaskPriority.MEDIUM,
            dueDate:     input.dueDate ? new Date(input.dueDate as string) : null,
            order,
            creatorId:   requestingUserId,
          },
        });
        return { success: true, data: { taskId: task.id, title: task.title } };
      }

      case 'update_task': {
        const task = await prisma.task.update({
          where: { id: input.taskId as string },
          data: {
            ...(input.title       && { title: input.title as string }),
            ...(input.description && { description: input.description as string }),
            ...(input.priority    && { priority: input.priority as TaskPriority }),
            ...(input.status      && { status: input.status as TaskStatus }),
            ...(input.dueDate     && { dueDate: new Date(input.dueDate as string) }),
          },
        });
        return { success: true, data: { taskId: task.id, title: task.title } };
      }

      case 'move_task': {
        const maxOrder = await prisma.task.aggregate({
          where: { listId: input.targetListId as string, deletedAt: null },
          _max: { order: true },
        });
        const order = (maxOrder._max.order ?? 0) + 1000;
        const task = await prisma.task.update({
          where: { id: input.taskId as string },
          data: { listId: input.targetListId as string, order },
        });
        return { success: true, data: { taskId: task.id, newListId: input.targetListId } };
      }

      case 'assign_task': {
        const assignment = await prisma.taskAssignment.create({
          data: {
            taskId:      input.taskId as string,
            assigneeId:  input.assigneeId as string,
            assignedById: requestingUserId,
            note:        (input.note as string | undefined) ?? null,
          },
        });
        return { success: true, data: { assignmentId: assignment.id } };
      }

      case 'delete_task': {
        await prisma.task.update({
          where: { id: input.taskId as string },
          data: { deletedAt: new Date() },
        });
        return { success: true, data: { taskId: input.taskId, reason: input.reason } };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ─── Context Builder ──────────────────────────────────────────────────────────

async function buildContext(targetType: 'task' | 'list', targetId: string): Promise<string> {
  if (targetType === 'list') {
    const list = await prisma.taskList.findUnique({
      where: { id: targetId },
      include: {
        tasks: {
          where: { deletedAt: null, parentId: null },
          orderBy: { order: 'asc' },
          include: {
            subtasks: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
            assignments: { include: { assignee: { select: { id: true, name: true } } } },
          },
        },
        team: { include: { members: { include: { user: { select: { id: true, name: true, role: true } } } } } },
      },
    });
    if (!list) return '';

    const taskLines = list.tasks.map((t) => {
      const subs = t.subtasks.map((s) => `    - [${s.status}] ${s.title} (id:${s.id})`).join('\n');
      const assignees = t.assignments.map((a) => a.assignee.name).join(', ');
      return `  - [${t.status}][${t.priority}] ${t.title} (id:${t.id})${assignees ? ` → assigned: ${assignees}` : ''}${subs ? '\n' + subs : ''}`;
    }).join('\n');

    const members = list.team?.members
      .map((m) => `  - ${m.user.name} (id:${m.user.id}, role:${m.role})`)
      .join('\n') ?? '';

    return `List: "${list.title}" (id:${list.id}, scope:${list.scope})
Tasks:
${taskLines || '  (none)'}
${members ? `Team members:\n${members}` : ''}`;
  }

  // targetType === 'task'
  const task = await prisma.task.findUnique({
    where: { id: targetId },
    include: {
      list: {
        include: {
          team: { include: { members: { include: { user: { select: { id: true, name: true, role: true } } } } } },
        },
      },
      subtasks: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
      assignments: { include: { assignee: { select: { id: true, name: true } } } },
    },
  });
  if (!task) return '';

  const subs = task.subtasks.map((s) => `  - [${s.status}] ${s.title} (id:${s.id})`).join('\n');
  const members = task.list.team?.members
    .map((m) => `  - ${m.user.name} (id:${m.user.id}, role:${m.role})`)
    .join('\n') ?? '';

  return `Task: "${task.title}" (id:${task.id})
Description: ${task.description ?? '(none)'}
Status: ${task.status}, Priority: ${task.priority}
List: "${task.list.title}" (id:${task.listId})
Subtasks:
${subs || '  (none)'}
${members ? `Team members:\n${members}` : ''}`;
}

// ─── Main Refine Function (streaming) ────────────────────────────────────────

export async function refineWithStream(
  targetType: 'task' | 'list',
  targetId: string,
  userPrompt: string,
  requestingUserId: string,
  sseRes: Response,
): Promise<{ response: string; toolCalls: unknown[] }> {
  const context = await buildContext(targetType, targetId);

  const systemPrompt = `You are a task planning assistant for an engineering team.
You have access to tools to create, update, move, assign, and delete tasks.
Always use tools to make changes — never describe changes in prose alone.
After using tools, briefly explain what you did and why.`;

  const userMessage = `${context}\n\nRequest: ${userPrompt}`;

  const collectedToolCalls: unknown[] = [];
  let fullResponse = '';
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

  // Single-turn tool use loop
  for (let round = 0; round < 3; round++) {
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];
    let assistantText = '';

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta') {
        if (chunk.delta.type === 'text_delta') {
          assistantText += chunk.delta.text;
          fullResponse += chunk.delta.text;
          sseRes.write(`event: text\ndata: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
        }
      }
      if (chunk.type === 'content_block_stop') {
        const block = stream.currentMessage?.content?.[chunk.index];
        if (block?.type === 'tool_use') {
          toolUseBlocks.push(block);
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    const stopReason = finalMessage.stop_reason;

    if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') break;

    // Execute tools and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolBlock of toolUseBlocks) {
      sseRes.write(`event: tool_call\ndata: ${JSON.stringify({ tool: toolBlock.name, input: toolBlock.input })}\n\n`);

      const result = await executeTool(toolBlock.name, toolBlock.input as ToolInput, requestingUserId);
      collectedToolCalls.push({ tool: toolBlock.name, input: toolBlock.input, result });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: JSON.stringify(result),
      });

      sseRes.write(`event: tool_result\ndata: ${JSON.stringify({ tool: toolBlock.name, result })}\n\n`);
    }

    // Add assistant message + tool results for next round
    messages.push({ role: 'assistant', content: finalMessage.content });
    messages.push({ role: 'user', content: toolResults });
  }

  return { response: fullResponse, toolCalls: collectedToolCalls };
}
