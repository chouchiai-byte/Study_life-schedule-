/** 下載或分享檔案：iPhone 上優先用分享選單（可存到「檔案」、傳 LINE），否則直接下載。 */
export async function downloadFile(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // 使用者取消
      // 其他錯誤（例如不在點擊流程中）改用下載
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 檔名不能有的字元換掉。 */
export const safeName = (s: string) => (s.trim() || '未命名').replace(/[\\/:*?"<>|\n\r]+/g, '_').slice(0, 60);
