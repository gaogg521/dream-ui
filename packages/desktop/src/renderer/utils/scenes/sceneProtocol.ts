/**
 * Copyright 2026 One Work
 */

/**
 * The standing rules a scene gives its conversation.
 *
 * Three layers, all optional except the first: who the assistant is in this
 * scene (the written prompt, or a line generated from the scene's own fields);
 * the working method (requirements round before building) when the scene asks
 * for it; and the hard rules and acceptance the scene fixes. They are plain
 * text so they ride the existing `preset_rules` channel, which every backend
 * already honours.
 *
 * The method is the point of the feature. A request like "make me a website" is
 * an entry point, not a specification. An assistant that starts from it
 * produces something that looks complete and cannot be delivered, so the method
 * has it read the request back, ask what is missing, write down the scope —
 * including what is out — and only then build.
 */

import type { SceneIntent } from '@/common/types/platform/sceneTypes';

export type SceneRulesInput = {
  name: string;
  description?: string | null;
  prompt?: string | null;
  /** Roles a company scene says it covers. */
  jobFunctions?: string[];
  intent?: SceneIntent | null;
};

const clean = (items: string[] | undefined): string[] =>
  (items ?? []).map((item) => item.trim()).filter((item) => item.length > 0);

/** The role layer: the written prompt, else what the scene's own fields say. */
export function buildRoleRules(input: SceneRulesInput): string {
  const written = input.prompt?.trim();
  if (written) return written;

  const lines = [`You are working in the scene "${input.name}".`];
  const description = input.description?.trim();
  if (description) lines.push(`About this scene: ${description}`);
  const functions = clean(input.jobFunctions);
  if (functions.length > 0) lines.push(`Roles it covers: ${functions.join(', ')}.`);
  lines.push('Use the skills and tools attached to this conversation when they fit the task.');
  return lines.join('\n');
}

/** The working method: understand before building. */
export function buildDiscoveryRules(questions: string[]): string {
  const lines = [
    '## How to work in this scene: understand first, then build',
    '',
    'The first message is an entry point, not a specification. Do not start producing the deliverable from it: delivering fast on a guess gives something that looks complete and cannot be used.',
    '',
    'Step 1 - Read back. In one or two sentences say what you think the user wants, and what you cannot tell yet.',
    'Step 2 - Requirements round, before any build work. Cover, most decisive first: who the result is for and who will maintain it; what the people it serves should do or achieve afterwards; how this is done today and where it hurts (take stock of what already exists by asking: materials, data, accounts, tools, the people involved); comparable examples in the same field worth borrowing from or avoiding (search the web for them if you have a search tool); what "done" means - merely having it, or having it work well - and what is explicitly out of scope for a first version.',
  ];
  const required = clean(questions);
  if (required.length > 0) {
    lines.push('', 'This scene always needs these answered:', ...required.map((question) => `- ${question}`));
  }
  lines.push(
    '',
    'This round is a conversation, not an investigation. Until the user has confirmed the brief, call no tools except the ask-the-user tool, web search for comparable examples, and reading a file or folder the user has pointed you to. Do not browse the file system, run commands or query connected systems to look around; ask instead.',
    'Ask at most five questions at a time, the most decisive first. For each, offer your best default so the user can simply reply "ok". Use the ask-the-user tool if you have one. Never ask for something the user has already told you.',
    'Step 3 - Requirements brief. Write down the goal, the users, the key flows, what is IN the first version, what is OUT, your assumptions and the open risks. Ask the user to confirm or correct it.',
    'Step 4 - Only after the user confirms: plan briefly, build in small steps, check each step yourself and report what you verified.',
    '',
    'Skip steps 1-3 only when the user asks you to, or when the request is already specific enough to act on (it names the audience, the outcome and the constraints). When in doubt, ask. Reply in the language the user writes in.'
  );
  return lines.join('\n');
}

/** Everything the conversation should be told about the scene, as one block of standing rules. */
export function buildSceneRules(input: SceneRulesInput): string {
  const parts = [buildRoleRules(input)];
  const intent = input.intent;
  if (intent?.discovery) parts.push(buildDiscoveryRules(intent.questions));

  const constraints = intent?.constraints.trim();
  if (constraints) {
    parts.push(
      `## Hard rules for this scene\nThese apply at every step and are never traded away for speed:\n${constraints}`
    );
  }
  const deliverables = intent?.deliverables.trim();
  if (deliverables) parts.push(`## What to hand over, and how it is accepted\n${deliverables}`);
  return parts.join('\n\n');
}
