export function sourceKind(mime: string, title: string): 'pdf' | 'image' | 'video' | 'audio' | 'html' | 'unsupported' {
  if (mime === 'application/pdf' || /\.pdf$/i.test(title)) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'text/html') return 'html';
  return 'unsupported';
}
