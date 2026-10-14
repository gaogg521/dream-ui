/** Parse RFC-style quoted CSV without evaluating cell contents. */
export function parseCsv(content: string): string[][] {
  content = content.replace(/^\uFEFF/, '');
  if (!content)
    return [
      ['', ''],
      ['', ''],
    ];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      if (quoted && content[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted) quoted = false;
      else if (!field) quoted = true;
      else field += ch;
    } else if (ch === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (field || row.length || !/[\r\n]$/.test(content)) {
    row.push(field);
    rows.push(row);
  }
  return rows.length ? rows : [['']];
}

/** Quote delimiters, line breaks and embedded quotation marks on save. */
export function serializeCsv(rows: string[][]): string {
  return (
    rows
      .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell)).join(','))
      .join('\n') + '\n'
  );
}
