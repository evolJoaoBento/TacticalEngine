import { describe, it, expect, beforeEach, vi } from 'vitest';
import { canWriteInPlace, forgetFile, saveProjectFile, savingTo } from './project-file';

/**
 * Saving to the file that was chosen, and not to a new one each time.
 *
 * The picker cannot be driven by a test - it is a browser dialog - so what is checked is
 * everything around it: that the handle is reused, that a closed dialog is not a save,
 * that a browser without the API still gets its file, and that "Save as…" makes the next
 * save ask again.
 */

interface Stub {
  picks: number;
  written: string[];
}

/** A window that can write in place, counting how often it was asked to choose. */
function withPicker(): Stub {
  const stub: Stub = { picks: 0, written: [] };
  const handle = {
    kind: 'file' as const,
    name: 'project.json',
    getFile: async (): Promise<File> => new File([''], 'project.json'),
    createWritable: async () => ({
      write: async (data: string | BufferSource | Blob): Promise<void> => {
        stub.written.push(String(data));
      },
      close: async (): Promise<void> => {},
    }),
  };
  vi.stubGlobal('window', {
    showSaveFilePicker: async () => {
      stub.picks += 1;
      return handle;
    },
  });
  return stub;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  forgetFile();
});

describe('the file a project saves to', () => {
  it('asks once, then writes the same file every time after', async () => {
    const stub = withPicker();
    expect(canWriteInPlace()).toBe(true);

    expect(await saveProjectFile('{"a":1}', 'project.json')).toBe('written');
    expect(await saveProjectFile('{"a":2}', 'project.json')).toBe('written');
    expect(await saveProjectFile('{"a":3}', 'project.json')).toBe('written');

    // One dialog, three writes: the whole point of holding the handle.
    expect(stub.picks).toBe(1);
    expect(stub.written).toEqual(['{"a":1}', '{"a":2}', '{"a":3}']);
    expect(savingTo()).toBe('project.json');
  });

  it('asks again once the file is let go, which is what Save as… does', async () => {
    const stub = withPicker();
    await saveProjectFile('{}', 'project.json');
    forgetFile();
    expect(savingTo()).toBeNull();
    await saveProjectFile('{}', 'project.json');
    expect(stub.picks).toBe(2);
  });

  it('is not a save when the dialog is closed, so the project stays dirty', async () => {
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => {
        throw new DOMException('the user aborted a request', 'AbortError');
      },
    });
    expect(await saveProjectFile('{}', 'project.json')).toBe('cancelled');
    expect(savingTo()).toBeNull();
  });

  it('falls back to a download where the browser has no picker', async () => {
    const clicked: string[] = [];
    vi.stubGlobal('window', {});
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    vi.stubGlobal('document', {
      createElement: () => ({
        set download(name: string) {
          clicked.push(name);
        },
        href: '',
        click: () => {},
      }),
    });
    expect(canWriteInPlace()).toBe(false);
    expect(await saveProjectFile('{}', 'sunken-keep.json')).toBe('downloaded');
    expect(clicked).toEqual(['sunken-keep.json']);
  });
});
