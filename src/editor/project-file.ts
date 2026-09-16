/**
 * The file a project is saved to, kept between saves.
 *
 * Save used to build a blob and click an invisible link, which is a *download*:
 * the browser puts a new file beside the last one, so editing a project for an
 * afternoon left `project.json`, `project (1).json`, `project (2).json` and no
 * way to tell which was current. Picking the file once and holding the handle
 * means every save after that writes the same file, with no prompt — which is
 * what saving has always meant everywhere else.
 *
 * Firefox and Safari have no File System Access API, and neither does the
 * headless Chromium the browser suite runs, so the download is still here as
 * the fallback. It is chosen by asking whether the picker exists, not by
 * sniffing the browser.
 *
 * Nothing here knows what a project is: it is handed text and a name.
 */

/** The file this project is being saved to, once somebody has chosen one. */
let handle: FileSystemFileHandle | null = null;

/** What a save did, so the caller knows whether to mark the project saved. */
export type SaveOutcome = 'written' | 'downloaded' | 'cancelled';

/** Whether this browser can write back to a file it was given. */
export function canWriteInPlace(): boolean {
  return typeof window !== 'undefined' && window.showSaveFilePicker !== undefined;
}

/** The file saves are going to, for a caller that wants to say so. */
export function savingTo(): string | null {
  return handle?.name ?? null;
}

/** Forget the file, so the next save asks for a new one. This is "Save as…". */
export function forgetFile(): void {
  handle = null;
}

/**
 * Write `text` to the project's file, asking which file the first time.
 *
 * A cancelled picker is not a failure and not a save: the project stays dirty,
 * so the tab still warns before it closes. Any other fault falls back to the
 * download rather than losing the edit — a save that lands somewhere is better
 * than a save that does not land.
 */
export async function saveProjectFile(text: string, name: string): Promise<SaveOutcome> {
  if (!canWriteInPlace()) {
    download(text, name);
    return 'downloaded';
  }
  try {
    handle ??= await window.showSaveFilePicker!({
      suggestedName: name,
      types: [{ description: 'Project', accept: { 'application/json': ['.json'] } }],
    });
  } catch (error) {
    // The one error that is a decision rather than a fault: they closed the dialog.
    if (isAbort(error)) return 'cancelled';
    download(text, name);
    return 'downloaded';
  }
  try {
    const stream = await handle.createWritable();
    await stream.write(text);
    await stream.close();
    return 'written';
  } catch (error) {
    // The handle went stale — the file was moved, or permission lapsed. Let it go,
    // so the next save asks again rather than failing the same way for ever.
    handle = null;
    if (isAbort(error)) return 'cancelled';
    download(text, name);
    return 'downloaded';
  }
}

/**
 * Open a project, keeping the file so later saves go back to it.
 *
 * Null when this browser has no picker, or the dialog was closed; the caller
 * falls back to its own file input, which cannot give a handle back.
 */
export async function openProjectFile(): Promise<{ text: string; name: string } | null> {
  if (typeof window === 'undefined' || window.showOpenFilePicker === undefined) return null;
  try {
    const [picked] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Project', accept: { 'application/json': ['.json'] } }],
    });
    if (picked === undefined) return null;
    const file = await picked.getFile();
    handle = picked;
    return { text: await file.text(), name: file.name };
  } catch {
    return null;
  }
}

/** A file the browser puts wherever downloads go. The old way, still the way where it must be. */
function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
