import { ActionSheet } from './components';
import { downloadFile } from '../services/files';

export interface ReadyFile {
  blob: Blob;
  name: string;
  hint?: string;
}

/** 檔案準備好之後再按一次「分享／儲存」：iPhone 規定分享必須由手指點擊直接觸發。 */
export function FileReady(props: { file: ReadyFile; onClose: () => void }) {
  const kb = Math.max(1, Math.round(props.file.blob.size / 1024));
  return (
    <ActionSheet
      title={`檔案已準備好\n${props.file.name}（${kb} KB）${props.file.hint ? `\n${props.file.hint}` : ''}`}
      onClose={props.onClose}
      actions={[{ label: '分享／儲存檔案', onClick: () => downloadFile(props.file.blob, props.file.name) }]}
    />
  );
}
