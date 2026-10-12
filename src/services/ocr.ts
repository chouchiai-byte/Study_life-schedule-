import { addDays, dayKey, todayKey } from '../core/time';

// 文件辨識（第一版）：在手機瀏覽器內辨識印刷文字，照片不上傳。
// 語言模型第一次使用時下載，之後由瀏覽器快取，可離線使用。

/** 讀取照片、縮小、轉灰階並加強對比；黑板照片可反相（白字黑底 → 黑字白底）。 */
export async function preprocess(file: Blob, opts: { invert?: boolean; maxDim?: number } = {}): Promise<{ canvas: HTMLCanvasElement; jpeg: string }> {
  const { invert = false, maxDim = 2000 } = opts;
  const bitmap = await loadImage(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  // 原圖（存檔用，彩色）
  const keep = document.createElement('canvas');
  keep.width = w;
  keep.height = h;
  keep.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  const jpeg = keep.toDataURL('image/jpeg', 0.8);

  // 辨識用（灰階＋對比）
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < px.length; i += 4) {
    let v = ((px[i] - min) / range) * 255;
    if (invert) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, jpeg };
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('無法讀取這張圖片'));
    };
    img.src = url;
  });
}

/** 中文字之間辨識出來的多餘空白去掉。 */
export function cleanText(text: string): string {
  const cjk = '[\\u3000-\\u303f\\u3400-\\u9fff\\uff00-\\uffef]';
  return text
    .replace(new RegExp(`(${cjk})[ \\t]+(?=${cjk})`, 'g'), '$1')
    .replace(new RegExp(`(${cjk})[ \\t]+(?=\\d)`, 'g'), '$1')
    .replace(new RegExp(`(\\d)[ \\t]+(?=${cjk})`, 'g'), '$1')
    .replace(new RegExp(`(${cjk})[ \\t]*,[ \\t]*`, 'g'), '$1，')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 逐張辨識（繁體中文＋英文）。onProgress 回報 0–1。 */
export async function recognize(canvases: HTMLCanvasElement[], onProgress: (p: number, label: string) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  onProgress(0, '下載語言模型（第一次較久）…');
  let page = 0;
  // 正式網站：程式與語言模型放在本站 ocr/ 資料夾；單檔預覽版改由 CDN 下載。
  const local = import.meta.env.MODE !== 'single' ? new URL('ocr/', document.baseURI).href : null;
  const paths = local ? { workerPath: `${local}worker.min.js`, corePath: local, langPath: local.replace(/\/$/, '') } : {};
  const worker = await createWorker(['chi_tra', 'eng'], 1, {
    ...paths,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onProgress((page + m.progress) / canvases.length, `辨識第 ${page + 1}/${canvases.length} 頁…`);
      } else if (m.status.includes('loading')) {
        onProgress(0, '下載語言模型（第一次較久）…');
      }
    },
  });
  const out: string[] = [];
  try {
    for (page = 0; page < canvases.length; page++) {
      const { data } = await worker.recognize(canvases[page]);
      out.push(cleanText(data.text));
    }
  } finally {
    await worker.terminate();
  }
  onProgress(1, '完成');
  return out.join('\n\n——\n\n');
}

/** 從文字中找日期（10/20、10月20日、115年10月20日、2026/10/20），回傳今天以後最早的一個。 */
export function findDate(text: string, today = todayKey()): string | null {
  const year = Number(today.slice(0, 4));
  const found: string[] = [];
  const push = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    const key = dayKey(new Date(y, m - 1, d));
    found.push(key);
  };
  const full = /(\d{2,4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/g;
  for (const m of text.matchAll(full)) {
    let y = Number(m[1]);
    if (y < 1911) y += 1911; // 民國年
    push(y, Number(m[2]), Number(m[3]));
  }
  const short = /(?<!\d[/.-]?)(\d{1,2})\s*(?:月|\/)\s*(\d{1,2})\s*日?/g;
  for (const m of text.matchAll(short)) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    let key = dayKey(new Date(year, mo - 1, d));
    if (key < addDays(today, -60)) key = dayKey(new Date(year + 1, mo - 1, d)); // 跨年
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) found.push(key);
  }
  const future = found.filter((k) => k >= today).sort();
  return future[0] ?? null;
}
