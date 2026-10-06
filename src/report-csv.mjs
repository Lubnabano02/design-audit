/**
 * Findings as a spreadsheet.
 *
 * One row per finding, so it can be sorted, filtered, assigned and tracked
 * in Excel or Sheets. Suppressed findings are included with their reason,
 * because a decision that is invisible gets re-argued.
 */

const cell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COLUMNS = [
  'Severity', 'Status', 'Check', 'Screen', 'Element', 'Finding', 'Times',
  'Property', 'Value', 'Expected', 'Exception', 'Reason', 'Approved by',
];

function row(f, status) {
  const d = f.detail ?? {};
  return [
    f.severity,
    status,
    f.check,
    f.screen,
    f.selector,
    f.message,
    f.times ?? 1,
    d.property ?? '',
    d.value ?? d.ratio ?? '',
    d.nearest ?? d.required ?? d.minimum ?? (Array.isArray(d.allowed) ? d.allowed.join(' | ') : ''),
    f.exception?.id ?? '',
    f.exception?.reason ?? '',
    f.exception?.approvedBy ?? '',
  ].map(cell).join(',');
}

/**
 * @param {{findings:Array, suppressed?:Array}} result
 * @param {{baseUrl?:string, project?:string}} meta
 */
export function toCSV(result, meta = {}) {
  const lines = [];

  // A short provenance block, so a stray spreadsheet can still be traced.
  lines.push(cell(`design-audit — ${meta.project ?? 'report'}`));
  if (meta.baseUrl) lines.push(cell(meta.baseUrl));
  lines.push(cell(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`));
  lines.push('');

  lines.push(COLUMNS.map(cell).join(','));
  for (const f of result.findings ?? []) lines.push(row(f, 'Open'));
  for (const f of result.suppressed ?? []) lines.push(row(f, 'By design'));

  // Excel reads UTF-8 correctly only with a BOM; without it ΔE and × break.
  return '﻿' + lines.join('\n') + '\n';
}
