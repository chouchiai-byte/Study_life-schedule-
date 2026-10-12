import type { NoteRow } from '../db/db';
import { downloadFile, safeName } from './files';

// 筆記匯出：TXT、HTML、PDF（瀏覽器列印 → 存成 PDF，中文字型由系統處理）。

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dateText = (t: number) => new Date(t).toLocaleString('zh-TW', { hour12: false });

export function noteToText(n: NoteRow): string {
  const head = [n.title, n.subject ? `科目：${n.subject}` : '', `更新：${dateText(n.updatedAt)}`].filter(Boolean).join('\n');
  return `${head}\n\n${n.body}\n`;
}

export function noteToHtml(n: NoteRow, withImages = true): string {
  const imgs = withImages ? n.images.map((src, i) => `<figure><img src="${src}" alt="第 ${i + 1} 頁原圖"><figcaption>第 ${i + 1} 頁原圖</figcaption></figure>`).join('\n') : '';
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(n.title)}</title>
<style>
body{font-family:-apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.7;color:#1c1c1e}
h1{font-size:22px;margin:0 0 4px}.meta{color:#6b6b73;font-size:13px;margin-bottom:18px}
pre{white-space:pre-wrap;font-family:inherit;font-size:16px}
figure{margin:24px 0}img{max-width:100%;border:1px solid #ddd;border-radius:6px}figcaption{color:#6b6b73;font-size:12px}
</style></head><body>
<h1>${escHtml(n.title)}</h1>
<div class="meta">${n.subject ? `科目：${escHtml(n.subject)}　` : ''}更新：${dateText(n.updatedAt)}</div>
<pre>${escHtml(n.body)}</pre>
${imgs}
</body></html>`;
}

export const exportTxt = (n: NoteRow) =>
  downloadFile(new Blob([noteToText(n)], { type: 'text/plain;charset=utf-8' }), `${safeName(n.title)}.txt`);

export const exportHtml = (n: NoteRow) =>
  downloadFile(new Blob([noteToHtml(n)], { type: 'text/html;charset=utf-8' }), `${safeName(n.title)}.html`);

/** 開啟列印畫面；在 iPhone 列印畫面可「分享 → 儲存到檔案」得到 PDF。 */
export function printPdf(n: NoteRow, withImages = true) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  root.innerHTML = `<h1>${escHtml(n.title)}</h1>
<div class="meta">${n.subject ? `科目：${escHtml(n.subject)}　` : ''}更新：${dateText(n.updatedAt)}</div>
<pre>${escHtml(n.body)}</pre>
${withImages ? n.images.map((src) => `<img src="${src}">`).join('') : ''}`;
  const prevTitle = document.title;
  document.title = safeName(n.title);
  setTimeout(() => {
    window.print();
    document.title = prevTitle;
  }, 50);
}
