/**
 * React key for a skill row. A member can own a skill with the same name as a
 * company-distributed one (e.g. their own `skill-creator`), so the name alone is
 * not unique; the folder location is.
 */
export const skillRowKey = (skill: { name: string; source?: string; location?: string }): string =>
  skill.location || `${skill.source ?? 'unknown'}:${skill.name}`;
