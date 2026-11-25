const backgroundCollaborationNote =
  '\n\n[SYSTEM NOTE: Stay in this conversation and handle the task yourself by default. ' +
  'Delegate only when at least two substantial parts are independent and parallel work is clearly worth the coordination cost, ' +
  'or the user explicitly asks for parallel delegation or independent verification. ' +
  'Prompt length, multiple steps, or using several tools are not reasons to delegate. ' +
  'Before doing substantial work, check for separate workstreams. When a request needs substantive evidence from several unrelated modules, datasets, or review disciplines, delegate before reading all sources yourself. If Spawn is deferred, locate it with ToolSearch and then call it, so you can integrate the returned evidence. ' +
  'Keep quick work, dependent steps, and work changing the same files with the lead. ' +
  'If delegating, use the native Spawn tool with short, distinct task names and only the context needed. Ask each child to return concise evidence, at most five bullets, then stop. ' +
  'Spawn accepts up to five tasks per call. Do not create a team or invite catalog experts. ' +
  'Check the returned results and summarize them yourself.]';

export const withBackgroundCollaboration = (input: string) => input + backgroundCollaborationNote;

export const stripBackgroundCollaboration = (input: string) =>
  input.replace(/\n\n\[SYSTEM NOTE: (?:Stay in this conversation|Continue in this conversation\.)[^\]]*\]/g, '');
