/**
 * Copyright 2026 One Work
 */

/**
 * What a scene is, beyond a bag of skills and tools.
 *
 * A scene is an entry point for a kind of work: it holds the standing context
 * (the prompt), the resources (skills, connectors) and — the part that makes it
 * more than a preset — how to turn a rough request into a real one. People say
 * "make me a website"; that is a starting point, not a specification, and an AI
 * that starts building from it delivers something that looks complete and
 * cannot be used. A scene whose `intent.discovery` is on makes the conversation
 * run a requirements round first (who it is for, how it is done today, what is
 * in and out of the first version) and only build once the user has confirmed.
 *
 * Both kinds of scene carry this: the ones a company administrator issues and
 * the ones a person makes for themselves (see `PersonalScene`).
 */

export type SceneIntent = {
  /** Run a requirements round before building; the conversation asks, then confirms scope. */
  discovery: boolean;
  /** Example first sentences a person might open with ("make me a website"). */
  starters: string[];
  /** Questions this kind of work always needs answered before it starts. */
  questions: string[];
  /** Hard rules and the explicit "not doing" list; never traded away mid-task. */
  constraints: string;
  /** What gets handed over and how it is accepted. */
  deliverables: string;
};

export const SCENE_LIMITS = {
  name: 40,
  description: 200,
  prompt: 8000,
  starters: 4,
  starter: 120,
  questions: 8,
  question: 200,
  constraints: 2000,
  deliverables: 2000,
} as const;

export const emptySceneIntent = (): SceneIntent => ({
  discovery: true,
  starters: [],
  questions: [],
  constraints: '',
  deliverables: '',
});

/** A scene a person made for themselves; kept on this machine, not issued by anyone. */
export type PersonalScene = {
  id: string;
  name: string;
  description: string;
  /** One emoji standing in for a picture. */
  icon: string;
  /** Standing context for the conversation: role, tone, what to do first. */
  prompt: string;
  intent: SceneIntent;
  /** Local skill names this scene starts a conversation with. */
  skillNames: string[];
  /**
   * Local MCP server ids this scene's conversation is limited to. Empty means
   * "whatever is enabled", which is what a conversation does by default.
   */
  mcpServerIds: string[];
  /** The template it was made from, when it was. Informational. */
  templateId?: string;
  createdAt: number;
  updatedAt: number;
};
