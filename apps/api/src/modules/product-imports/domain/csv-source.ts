import { classifyHeader, COLUMNS, HeaderTarget } from './columns';
import { parseCsv } from './csv';
import { Issue, SourceRecord } from './drafts';

export interface SourceReadResult {
  readonly records: readonly SourceRecord[];
  /** Problems with the file as a whole. Any error here means nothing can be imported. */
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
}

const REQUIRED = COLUMNS.filter((column) => column.required).map((column) => column.name);

/** Reads a CSV file's text into records keyed by column name. */
export function readCsvSource(text: string, maxRows: number): SourceReadResult {
  const parsed = parseCsv(text, { maxRows });
  const errors: Issue[] = parsed.errors.map((error) => ({ line: error.line, field: null, message: error.message }));
  const warnings: Issue[] = [];
  const [header, ...rows] = parsed.rows;
  if (!header) return { records: [], errors: [...errors, { line: null, field: null, message: 'The file is empty' }], warnings };
  if (rows.length > maxRows) {
    errors.push({ line: null, field: null, message: `The file has more than ${maxRows.toLocaleString('en-NG')} rows. Split it into smaller files.` });
    return { records: [], errors, warnings };
  }

  const targets: HeaderTarget[] = header.cells.map(classifyHeader);
  const seen = new Map<string, string>();
  const ignored: string[] = [];
  targets.forEach((target, index) => {
    const raw = header.cells[index]!.trim();
    if (target.kind === 'unknown') {
      if (raw) ignored.push(raw);
      return;
    }
    const key =
      target.kind === 'column' ? target.name
      : target.kind === 'option' ? `option${target.index}_${target.part}`
      : target.kind === 'image' ? `image_${target.index}`
      : `attr:${target.key}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) errors.push({ line: 1, field: key, message: `The columns "${earlier}" and "${raw}" both mean ${key}. Keep one.` });
    else seen.set(key, raw);
  });
  if (ignored.length) warnings.push({ line: 1, field: null, message: `Columns not recognised and ignored: ${ignored.slice(0, 10).join(', ')}${ignored.length > 10 ? '…' : ''}` });
  const missing = REQUIRED.filter((name) => !seen.has(name));
  if (!seen.has('weight_grams') && !seen.has('weight_kg')) missing.push('weight_grams');
  if (missing.length) errors.push({ line: 1, field: null, message: `Missing required columns: ${missing.join(', ')}. Download the template to see every column.` });
  if (errors.length) return { records: [], errors, warnings };

  const records = rows.map((row): SourceRecord => {
    if (row.cells.length > header.cells.length && row.cells.slice(header.cells.length).some((cell) => cell.trim())) {
      warnings.push({ line: row.line, field: null, message: 'This row has more values than there are columns; the extra values were ignored. Check for an unquoted comma.' });
    }
    const values: Record<string, string> = {};
    const options = new Map<number, { index: number; name: string; value: string }>();
    const imageColumns: string[] = [];
    const attributes: Record<string, string> = {};
    targets.forEach((target, index) => {
      const cell = row.cells[index] ?? '';
      switch (target.kind) {
        case 'column':
          values[target.name] = cell;
          break;
        case 'option': {
          const option = options.get(target.index) ?? { index: target.index, name: '', value: '' };
          options.set(target.index, { ...option, [target.part]: cell });
          break;
        }
        case 'image':
          imageColumns[target.index - 1] = cell;
          break;
        case 'attribute':
          attributes[target.key] = cell;
          break;
        default:
      }
    });
    return { line: row.line, values, options: [...options.values()], imageColumns: imageColumns.filter((url) => url !== undefined), attributes };
  });
  return { records, errors, warnings };
}

/** Product files arrive from spreadsheets saved as UTF-8 or as Windows "ANSI". Both are read correctly. */
export function decodeText(bytes: Uint8Array): { text: string; warning: string | null } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), warning: null };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      warning: 'The file is not UTF-8, so it was read as Windows text. If names show odd characters, save it as "CSV UTF-8" and upload again.',
    };
  }
}
