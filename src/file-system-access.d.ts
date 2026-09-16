/**
 * The File System Access API, as much of it as saving a project needs.
 *
 * TypeScript's DOM library does not declare it, so this does — the same way
 * `shipped-models.d.ts` declares the virtual module. Only what is used: a handle
 * to a file, a stream to write it, and the two pickers, which are optional
 * because Firefox and Safari do not have them and a headless Chromium does not
 * either. Guarding on `undefined` is how the fallback path is chosen, so they
 * are typed as possibly absent rather than asserted into existence.
 */

interface FileSystemWritableFileStream {
  write(data: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, readonly string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: readonly FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: readonly FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
}
