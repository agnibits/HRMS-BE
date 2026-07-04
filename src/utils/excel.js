import ExcelJS from 'exceljs';

/**
 * Thin wrappers over ExcelJS for bulk import/export. Export produces a styled
 * .xlsx buffer; import parses the first worksheet into row objects keyed by the
 * header row, tolerating CSV or XLSX input.
 */
export async function buildWorkbookBuffer({ sheetName = 'Sheet1', columns, rows }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEFEFEF' },
  };
  rows.forEach((r) => sheet.addRow(r));
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
  return workbook.xlsx.writeBuffer();
}

export async function parseSheet(buffer, { mimetype } = {}) {
  const workbook = new ExcelJS.Workbook();
  if (mimetype === 'text/csv') {
    const { Readable } = await import('node:stream');
    await workbook.csv.read(Readable.from(buffer));
  } else {
    await workbook.xlsx.load(buffer);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers = [];
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cell.value ?? '').trim();
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = headers[col];
      if (key) obj[key] = normalizeCell(cell.value);
    });
    if (Object.keys(obj).length) rows.push({ __row: rowNumber, ...obj });
  });
  return rows;
}

function normalizeCell(value) {
  if (value == null) return null;
  if (typeof value === 'object' && 'text' in value) return value.text; // rich text / hyperlink
  if (typeof value === 'object' && 'result' in value) return value.result; // formula
  return value;
}

export default { buildWorkbookBuffer, parseSheet };
