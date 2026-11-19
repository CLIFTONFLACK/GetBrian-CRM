// Turn the first sheet of an .xlsx / .xls workbook into the same string[][]
// rows that parseCsv produces, so the importer has one pipeline for both.
//
// Traps this avoids:
//   - sheet_to_csv prints dates in the cell's display format ("11/17/26" for
//     US-style formats), which the importer would then read day-first. Date
//     cells are written as ISO text instead.
//   - Formatted text drops digits from long numbers: a 12-digit phone or
//     company number in a General cell shows as 4.47701E+11. Whole-number
//     cells with General format (or an exponent in the shown text) are written
//     from the stored value.
//   - Leading zeros: text cells are read as shown, so "0207..." keeps its zero.
//   - A huge sheet: more than MAX_SHEET_ROWS rows or MAX_SHEET_COLS columns is
//     an error, never a silently partial import.
//
// The xlsx module is passed in, not imported, so the browser can load it on
// demand and Node scripts can load it their own way.

export const MAX_SHEET_ROWS = 50_000;
export const MAX_SHEET_COLS = 200;

type SheetCell = { t?: string; v?: unknown; w?: string; z?: string | number };
type Sheet = Record<string, SheetCell | unknown>;
type Xlsx = {
  read(data: ArrayBuffer | Uint8Array, opts: { type: "array"; cellDates: boolean }): {
    SheetNames: string[];
    Sheets: Record<string, Sheet>;
  };
  utils: {
    decode_range(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } };
    encode_cell(addr: { r: number; c: number }): string;
  };
};

/** A problem with the workbook itself; the message is safe to show the user. */
export class WorkbookError extends Error {}

export type WorkbookRows = {
  rows: string[][];
  /** Name of the sheet that was read (always the first). */
  sheetName: string;
  /** Things the user should know that do not stop the import. */
  warnings: string[];
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A date cell as ISO text. SheetJS builds the Date from the sheet's wall-clock
 * numbers as if they were UTC, so the UTC getters give back what the sheet
 * shows. A midnight value is a date only; anything else carries its time.
 */
export function dateCellToIso(d: Date): string {
  // Round to the second: floating-point serials arrive as 08:16:49.999.
  const t = new Date(Math.round(d.getTime() / 1000) * 1000);
  const day = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  const time = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
  return time === "00:00:00" ? day : `${day} ${time}`;
}

/** The text for one cell. */
export function cellText(cell: SheetCell | undefined): string {
  if (!cell) return "";
  if (cell.t === "d" && cell.v instanceof Date) return dateCellToIso(cell.v);
  if (cell.t === "n" && typeof cell.v === "number" && Number.isInteger(cell.v)) {
    const general = cell.z === undefined || cell.z === "General" || cell.z === 0;
    if (general || /E\+/i.test(cell.w ?? "")) return String(cell.v);
  }
  return String(cell.w ?? cell.v ?? "");
}

export function workbookToRows(XLSX: Xlsx, data: ArrayBuffer | Uint8Array): WorkbookRows {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  const sheet = ws as Record<string, unknown> | undefined;
  const ref = sheet?.["!ref"];
  if (!ws || !sheet || typeof ref !== "string") {
    throw new WorkbookError("This workbook has no sheet with any data in it.");
  }
  const range = XLSX.utils.decode_range(ref);
  const rowCount = range.e.r - range.s.r + 1;
  const colCount = range.e.c - range.s.c + 1;
  if (rowCount > MAX_SHEET_ROWS || colCount > MAX_SHEET_COLS) {
    throw new WorkbookError(
      `Sheet "${sheetName}" is too large (${rowCount} rows by ${colCount} columns; ` +
        `the limit is ${MAX_SHEET_ROWS} rows by ${MAX_SHEET_COLS} columns). ` +
        `Nothing was read. Split the file and try again.`,
    );
  }
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      row.push(cellText(ws[XLSX.utils.encode_cell({ r, c })] as SheetCell | undefined));
    }
    rows.push(row);
  }
  const kept = rows.filter((r) => r.some((x) => x.trim() !== ""));
  if (kept.length === 0) {
    throw new WorkbookError(`Sheet "${sheetName}" has no rows.`);
  }
  const warnings: string[] = [];
  const merges = sheet["!merges"];
  if (Array.isArray(merges)) {
    const tall = merges.filter(
      (m: { s: { r: number }; e: { r: number } }) => m.e.r > m.s.r,
    ).length;
    if (tall > 0) {
      warnings.push(
        `Sheet "${sheetName}" has ${tall} merged range${tall > 1 ? "s" : ""} spanning more than one row. ` +
          `Only the top-left cell of a merge holds a value, so the rows below it read as blank.`,
      );
    }
  }
  return { rows: kept, sheetName, warnings };
}
