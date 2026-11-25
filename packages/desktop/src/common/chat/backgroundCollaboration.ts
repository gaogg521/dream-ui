const backgroundCollaborationNote =
  '\n\n[SYSTEM NOTE: Stay in this conversation and handle the task yourself by default. ' +
  'Delegate only when at least two substantial parts are independent and parallel work is clearly worth the coordination cost, ' +
  'or the user explicitly asks for parallel delegation or independent verification. ' +
  'Prompt length, multiple steps, or using several tools are not reasons to delegate. ' +
  'Before doing substantial work, check for separate workstreams. When a request needs substantive evidence from several unrelated modules, datasets, or review disciplines, delegate before reading all sources yourself. If Spawn is deferred, locate it with ToolSearch and then call it, so you can integrate the returned evidence. ' +
  'Keep quick work, dependent steps, and work changing the same files with the lead. ' +
  'If delegating, use the native Spawn tool. Each task name is shown to the user: write a short, distinct action phrase in the application interface language ({locale}), even if the request is in a different language. Put that title alone on the first line of the child prompt, before any instructions. Ask each child to return concise evidence, at most five bullets, then stop. ' +
  'Spawn accepts up to five tasks per call. Do not create a team or invite catalog experts. ' +
  'Check the returned results and summarize them yourself.]';

export const withBackgroundCollaboration = (input: string, locale = 'zh-CN') =>
  input + backgroundCollaborationNote.replace('{locale}', locale.match(/^[a-zA-Z0-9-]+$/)?.[0] ?? 'zh-CN');

export const stripBackgroundCollaboration = (input: string) =>
  input.replace(/\n\n\[SYSTEM NOTE: (?:Stay in this conversation|Continue in this conversation\.)[^\]]*\]/g, '');

const internalTaskName = /^(?:[a-zA-Z0-9]+(?:[-_./:][a-zA-Z0-9]+)+|[a-z]+[A-Z][a-zA-Z0-9]*)$/;

export function backgroundTaskTitle(name: string, prompt: unknown, locale = 'en-US'): string | undefined {
  const needsChinese = /^zh(?:-|$)/i.test(locale);
  const readable = (value: string) =>
    !!value && !internalTaskName.test(value) && (!needsChinese || /\p{Script=Han}/u.test(value));
  if (readable(name)) return name;
  if (typeof prompt !== 'string') return undefined;
  const title = prompt
    .trim()
    .split(/\r?\n|[。！？；]|[.!?](?=\s|$)/u, 1)[0]
    .replace(/^(?:#+\s*|[-*]\s+|\d+[.)、]\s*)/u, '')
    .replace(/\*\*|\x60/g, '')
    .trim();
  if (!readable(title)) return undefined;
  const characters = Array.from(title);
  return characters.length > 56 ? characters.slice(0, 56).join('') + '…' : title;
}
