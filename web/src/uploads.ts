export type UploadedFileRef = {
  name: string;
  path: string;
  relativePath: string;
  mime?: string;
  size: number;
};

export function buildAttachmentPrompt(text: string, files: UploadedFileRef[]): string {
  const body = text.trim();
  if (files.length === 0) return body;
  const lines = [
    'Uploaded files:',
    ...files.map((f) => `- @${f.relativePath} (${fileKind(f)}, ${formatFileSize(f.size)})`),
  ];
  if (!body) return `Please inspect these uploaded files:\n\n${lines.join('\n')}`;
  return `${body}\n\n${lines.join('\n')}`;
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function fileKind(file: UploadedFileRef): string {
  if (file.mime?.startsWith('image/')) return file.mime.replace('image/', '');
  return file.mime || 'file';
}
