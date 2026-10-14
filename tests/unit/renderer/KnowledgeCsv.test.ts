import { describe, expect, it } from 'vitest';
import { parseCsv, serializeCsv } from '../../../packages/desktop/src/renderer/pages/knowledge/csv';

describe('knowledge CSV documents', () => {
  it('round trips commas, quotes and multiline cells without evaluating formulas', () => {
    const rows = [
      ['名称', '正文'],
      ['a,b', '他说"你好"\n下一行'],
      ['=SUM(A1)', ''],
    ];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });
  it('accepts a UTF-8 BOM and CRLF files', () => {
    expect(parseCsv('\uFEFF"名称",状态\r\n甲,完成\r\n')).toEqual([
      ['名称', '状态'],
      ['甲', '完成'],
    ]);
  });
  it('rejects an unterminated quote so the editor can preserve the source', () => {
    expect(() => parseCsv('名称\n"未结束')).toThrow('Unclosed CSV quote');
  });
});
