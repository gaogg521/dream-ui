import React, { useMemo } from 'react';
import { Button, Input, Table } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { parseCsv, serializeCsv } from './csv';

type Props = { value: string; onChange?: (value: string) => void; readOnly?: boolean };
const CsvDocument: React.FC<Props> = ({ value, onChange, readOnly = false }) => {
  const { t } = useTranslation();
  const parsed = useMemo(() => {
    try {
      return { rows: parseCsv(value), error: false };
    } catch {
      return { rows: [] as string[][], error: true };
    }
  }, [value]);
  if (parsed.error || parsed.rows.length > 1000 || parsed.rows.some((row) => row.length > 50))
    return (
      <div>
        <p>{t('common.knowledgeLibrary.csvSourceHint')}</p>
        {readOnly ? (
          <pre className='whitespace-pre-wrap'>{value}</pre>
        ) : (
          <Input.TextArea value={value} onChange={onChange} rows={20} />
        )}
      </div>
    );
  const rows = parsed.rows;
  const width = Math.max(1, ...rows.map((row) => row.length));
  const update = (rowIndex: number, column: number, next: string) =>
    onChange?.(
      serializeCsv(
        rows.map((row, index) =>
          index === rowIndex
            ? Array.from({ length: width }, (_, cell) => (cell === column ? next : (row[cell] ?? '')))
            : row
        )
      )
    );
  const columns = Array.from({ length: width }, (_, column) => ({
    title: readOnly ? (
      rows[0][column] || t('common.knowledgeLibrary.columnLabel', { index: column + 1 })
    ) : (
      <Input
        aria-label={t('common.knowledgeLibrary.columnLabel', { index: column + 1 })}
        value={rows[0][column] ?? ''}
        onChange={(next) => update(0, column, next)}
      />
    ),
    width: 180,
    render: (_: unknown, record: { cells: string[]; row: number }) =>
      readOnly ? (
        (record.cells[column] ?? '')
      ) : (
        <Input
          aria-label={t('common.knowledgeLibrary.cellLabel', { row: record.row, column: column + 1 })}
          value={record.cells[column] ?? ''}
          onChange={(next) => update(record.row, column, next)}
        />
      ),
  }));
  const data = rows.slice(1).map((cells, index) => ({ cells, row: index + 1 }));
  return (
    <div className='flex flex-col gap-12px'>
      {!readOnly && (
        <div className='flex gap-8px'>
          <Button
            disabled={rows.length >= 1000}
            onClick={() => onChange?.(serializeCsv([...rows, Array.from({ length: width }, () => '')]))}
          >
            {t('common.knowledgeLibrary.addRow')}
          </Button>
          <Button
            disabled={width >= 50}
            onClick={() =>
              onChange?.(
                serializeCsv(rows.map((row) => [...Array.from({ length: width }, (_, index) => row[index] ?? ''), '']))
              )
            }
          >
            {t('common.knowledgeLibrary.addColumn')}
          </Button>
        </div>
      )}
      <Table
        rowKey='row'
        columns={columns}
        data={data}
        scroll={{ x: width * 180 }}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />
    </div>
  );
};
export default CsvDocument;
