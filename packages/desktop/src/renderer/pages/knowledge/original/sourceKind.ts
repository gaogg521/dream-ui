export function sourceKind(
  mime: string,
  title: string
): 'pdf' | 'word' | 'slides' | 'sheets' | 'image' | 'video' | 'audio' | 'html' | 'unsupported' {
  if (
    /\.(xlsx?|xlsm)$/i.test(title) ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel'
  )
    return 'sheets';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(title))
    return 'word';
  if (mime === 'application/pdf' || /\.pdf$/i.test(title)) return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || /\.pptx$/i.test(title))
    return 'slides';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'text/html') return 'html';
  return 'unsupported';
}
