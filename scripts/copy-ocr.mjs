// 把文字辨識程式與繁中／英文語言模型複製到 public/ocr/，由自己的網站提供（可離線、不依賴外部 CDN）。
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const out = 'public/ocr';
mkdirSync(out, { recursive: true });
const copy = (from, name) => {
  if (!existsSync(from)) throw new Error(`找不到 ${from}，請先 npm install`);
  cpSync(from, `${out}/${name}`);
};
copy('node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js');
for (const v of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
  copy(`node_modules/tesseract.js-core/tesseract-core-${v}.wasm.js`, `tesseract-core-${v}.wasm.js`);
}
copy('node_modules/@tesseract.js-data/chi_tra/4.0.0_best_int/chi_tra.traineddata.gz', 'chi_tra.traineddata.gz');
copy('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz');
console.log('OCR 檔案已複製到 public/ocr/');
