/**
 * Copyright 2026 One Work
 */

/**
 * A picture a person uploads for their own scene.
 *
 * The scene lives in the app's settings store and is copied into every conversation it opens
 * (`extra.scene_greeting`), so the picture is cropped to a small square and stored as a data URL:
 * a few KB, not the original photo.
 */

export const SCENE_AVATAR_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const AVATAR_EDGE = 192;
const AVATAR_QUALITY = 0.88;

/** Upper bound on a stored picture (characters of the data URL); anything larger is not ours. */
export const MAX_AVATAR_DATA_URL_LENGTH = 200_000;

const AVATAR_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** `value` when it is a picture this app produced (or could have), otherwise `undefined`. */
export function sanitizeAvatarDataUrl(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= MAX_AVATAR_DATA_URL_LENGTH && AVATAR_DATA_URL.test(value)
    ? value
    : undefined;
}

/** Centre-crop to a square, scale down, and flatten onto white (JPEG has no transparency). */
export async function encodeSceneAvatarImage(file: File): Promise<string> {
  if (!SCENE_AVATAR_IMAGE_TYPES.includes(file.type)) throw new Error('Unsupported avatar format');
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to resize avatar');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, AVATAR_EDGE, AVATAR_EDGE);
    const crop = Math.min(image.width, image.height);
    context.drawImage(
      image,
      (image.width - crop) / 2,
      (image.height - crop) / 2,
      crop,
      crop,
      0,
      0,
      AVATAR_EDGE,
      AVATAR_EDGE
    );
    const url = canvas.toDataURL('image/jpeg', AVATAR_QUALITY);
    if (!sanitizeAvatarDataUrl(url)) throw new Error('Avatar is too large');
    return url;
  } finally {
    image.close();
  }
}
