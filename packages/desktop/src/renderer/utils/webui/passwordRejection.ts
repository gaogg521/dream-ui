/**
 * Copyright 2026 One Work
 */

/**
 * The backend refuses a weak password with an English sentence (`Password is too common`), not a
 * code, so a lookup keyed on codes never matched and Chinese users saw the English text. Match the
 * sentences it actually sends (and the codes, in case a gateway ever swaps them in).
 *
 * Returns the localized message, or an empty string when nothing in `raw` is a password rule.
 */
export const translatePasswordRejection = (raw: string, t: (key: string) => string): string => {
  const messages: string[] = [];
  for (const part of raw.split('; ')) {
    const text = part.trim().toLowerCase();
    if (text === 'password_too_short' || text.includes('at least 8 characters')) {
      messages.push(t('settings.webui.passwordTooShort'));
    } else if (text === 'password_too_long' || text.includes('must not exceed')) {
      messages.push(t('settings.webui.passwordTooLong'));
    } else if (
      text === 'password_too_common' ||
      text.includes('too common') ||
      text.includes('same character repeated')
    ) {
      messages.push(t('settings.webui.passwordTooCommon'));
    }
  }
  return [...new Set(messages)].join('; ');
};
