import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

/**
 * Real file exports (PDF or CSV) shared through the system share sheet, so the user can
 * save them to Files/Drive or send them by email/chat.
 */

export type ExportFormat = 'pdf' | 'csv';

export interface ExportColumn<Row> {
  label: string;
  value: (row: Row) => string | number | null | undefined;
  /** Right-align numbers in the PDF table */
  numeric?: boolean;
}

export interface ExportReport<Row> {
  title: string;
  /** Lines shown under the title in the PDF (e.g. athlete, date range) */
  subtitle?: string[];
  /** Headline figures shown above the PDF table */
  summary?: { label: string; value: string }[];
  columns: ExportColumn<Row>[];
  rows: Row[];
  /** File name without extension; a date stamp is added */
  fileName: string;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const htmlEscape = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function buildCsv<Row>(report: ExportReport<Row>): string {
  const lines = [
    report.columns.map((c) => csvCell(c.label)).join(','),
    ...report.rows.map((r) => report.columns.map((c) => csvCell(c.value(r))).join(',')),
  ];
  // BOM so Excel opens the file as UTF-8
  return '﻿' + lines.join('\r\n');
}

function buildHtml<Row>(report: ExportReport<Row>): string {
  const generated = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const summary = (report.summary ?? [])
    .map(
      (s) =>
        `<div class="stat"><div class="value">${htmlEscape(s.value)}</div><div class="label">${htmlEscape(s.label)}</div></div>`
    )
    .join('');
  const head = report.columns
    .map((c) => `<th class="${c.numeric ? 'num' : ''}">${htmlEscape(c.label)}</th>`)
    .join('');
  const body = report.rows
    .map(
      (r) =>
        `<tr>${report.columns
          .map((c) => `<td class="${c.numeric ? 'num' : ''}">${htmlEscape(c.value(r))}</td>`)
          .join('')}</tr>`
    )
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @page { margin: 28px; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; }
  .brand { color: #1b5e3b; font-weight: 800; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; }
  h1 { font-size: 22px; margin: 4px 0 2px; }
  .sub { color: #475569; font-size: 12px; margin: 1px 0; }
  .stats { display: flex; gap: 10px; margin: 14px 0; flex-wrap: wrap; }
  .stat { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; min-width: 110px; }
  .stat .value { font-size: 16px; font-weight: 800; }
  .stat .label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .5px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #1b5e3b; color: #fff; text-align: left; padding: 6px; font-weight: 700; }
  td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; }
  .foot { margin-top: 12px; font-size: 9px; color: #94a3b8; }
</style></head>
<body>
  <div class="brand">SmartAthlete</div>
  <h1>${htmlEscape(report.title)}</h1>
  ${(report.subtitle ?? []).map((l) => `<div class="sub">${htmlEscape(l)}</div>`).join('')}
  ${summary ? `<div class="stats">${summary}</div>` : ''}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  <div class="foot">Generated ${htmlEscape(generated)} · ${report.rows.length} row${report.rows.length === 1 ? '' : 's'}</div>
</body></html>`;
}

function stampedName(base: string, ext: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${base.replace(/[^A-Za-z0-9_-]+/g, '_')}_${stamp}.${ext}`;
}

const PDF_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Opens the share sheet without waiting for it to close. On Android the promise only
 * settles when the share activity returns a result, which some launchers and share
 * targets never do, so awaiting it would leave the caller's spinner running forever.
 */
function openShareSheet(uri: string, options: Sharing.SharingOptions): void {
  Sharing.shareAsync(uri, options).catch((err) => {
    Alert.alert('Could not share the file', err?.message || 'Please try again.');
  });
}

/**
 * Writes the report as a file and opens the share sheet for it. Resolves once the file
 * is ready and the share sheet has been requested.
 */
export async function exportReport<Row>(report: ExportReport<Row>, format: ExportFormat): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing files is not available on this device.');
  }

  const name = stampedName(report.fileName, format);
  const target = new File(Paths.cache, name);
  if (target.exists) target.delete();

  if (format === 'csv') {
    target.create();
    await target.write(buildCsv(report));
    openShareSheet(target.uri, {
      mimeType: 'text/csv',
      dialogTitle: report.title,
      UTI: 'public.comma-separated-values-text',
    });
    return;
  }

  // Landscape A4 (in points) so wide session tables fit
  const { uri } = await withTimeout(
    Print.printToFileAsync({ html: buildHtml(report), width: 842, height: 595 }),
    PDF_TIMEOUT_MS,
    'Creating the PDF took too long. Try CSV, or export fewer sessions.'
  );
  // printToFileAsync picks a random name; give the file a readable one
  await new File(uri).move(target);
  openShareSheet(target.uri, {
    mimeType: 'application/pdf',
    dialogTitle: report.title,
    UTI: 'com.adobe.pdf',
  });
}

/** Asks PDF or CSV, then exports. Errors are shown to the user. */
export function promptExport<Row>(report: ExportReport<Row>, onBusyChange?: (busy: boolean) => void): void {
  const run = async (format: ExportFormat) => {
    onBusyChange?.(true);
    try {
      await exportReport(report, format);
    } catch (err: any) {
      Alert.alert('Export failed', err?.message || 'Please try again.');
    } finally {
      onBusyChange?.(false);
    }
  };
  Alert.alert('Export format', 'Choose a file type to export.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'CSV (Excel)', onPress: () => run('csv') },
    { text: 'PDF', onPress: () => run('pdf') },
  ]);
}

// ─── Shared formatting ────────────────────────────────────────

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
