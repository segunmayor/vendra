/**
 * A strict RFC 4180 CSV reader with the leniency real spreadsheets need: a UTF-8 byte order
 * mark, CRLF or LF line ends, quoted fields spanning lines, and comma, semicolon or tab
 * separators (detected from the header line). No dependency, so nothing to patch.
 */

export interface CsvRow {
  /** Line number in the file where the row starts (1 = the header), for messages staff can find. */
  readonly line: number;
  readonly cells: readonly string[];
}

export interface CsvParseResult {
  readonly rows: readonly CsvRow[];
  readonly separator: ',' | ';' | '\t';
  /** Problems that make the file unreadable past a point, such as an unclosed quote. */
  readonly errors: readonly { line: number; message: string }[];
}

const SEPARATORS = [',', ';', '\t'] as const;

/** Picks the separator that appears most in the header line, outside quotes. */
function detectSeparator(text: string): ',' | ';' | '\t' {
  const counts = new Map<string, number>(SEPARATORS.map((s) => [s, 0]));
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  return [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [',', 0] as [string, number])[0] as ',' | ';' | '\t';
}

export function parseCsv(input: string, options: { maxRows: number; maxCellLength?: number }): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const separator = detectSeparator(text);
  const maxCell = options.maxCellLength ?? 20_000;
  const rows: CsvRow[] = [];
  const errors: { line: number; message: string }[] = [];

  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowStart = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
    afterQuote = false;
  };
  const endRow = () => {
    endCell();
    // Rows that are entirely empty (blank lines, or ",,," from spreadsheets) are skipped.
    if (cells.some((value) => value.trim() !== '')) rows.push({ line: rowStart, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (char === '\n') line += 1;
        cell += char;
      }
    } else if (char === '"') {
      if (cell.trim() === '' && !afterQuote) {
        cell = '';
        quoted = true;
      } else {
        // A stray quote inside an unquoted field: keep it, as spreadsheets do.
        cell += char;
      }
    } else if (char === separator) {
      endCell();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      rowStart = line;
      // One data row past the limit is kept, so the caller can tell the file was too long.
      if (rows.length > options.maxRows + 1) break;
    } else if (afterQuote) {
      if (char.trim() !== '') {
        errors.push({ line, message: 'Text after a closing quote. Put the whole value inside the quotes.' });
        return { rows, separator, errors };
      }
    } else {
      cell += char;
    }
    if (cell.length > maxCell) {
      errors.push({ line: rowStart, message: `A value is longer than ${maxCell.toLocaleString('en-NG')} characters` });
      return { rows, separator, errors };
    }
  }
  if (quoted) {
    errors.push({ line: rowStart, message: 'A quoted value is never closed. Check for a missing " character.' });
    return { rows, separator, errors };
  }
  if (cell !== '' || cells.length > 0) endRow();
  return { rows, separator, errors };
}

/** Makes a value safe to open in a spreadsheet: one starting with = + - @ is not run as a formula. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvLine = (values: readonly (string | number | null | undefined)[]): string => values.map(csvCell).join(',');
