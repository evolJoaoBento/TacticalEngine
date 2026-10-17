/**
 * The saves of a peer game's host (`docs/PEER.md`): the host's browser's, as a game played alone keeps them, but each
 * one written with who plays whom at the table as it was saved (`HostTable.seating`) - so a game hosted again from it
 * seats everybody in their own as they come back. And a save read back with them (`seatingOf`), for the table to load.
 */

import type { SaveShelf, SaveSlot, SavedSeating } from '../save-slots';
import type { HostTable } from './host-table';

export class TableSaves implements SaveShelf {
  constructor(
    private readonly inner: SaveShelf,
    private readonly table: () => Pick<HostTable, 'seating'> | null,
  ) {}

  list(): SaveSlot[] {
    return this.inner.list();
  }

  has(id: string): boolean {
    return this.inner.has(id);
  }

  read(id: string): string | null {
    return this.inner.read(id);
  }

  /** A save written with who plays whom, when anybody is seated or kept a seat for. */
  write(text: string, name: string, where: string, id?: string, project?: string): SaveSlot | null {
    const seating = this.table()?.seating();
    const kept = seating !== undefined && Object.keys(seating.seats).length > 0 ? seating : undefined;
    return this.inner.write(text, name, where, id, project, kept);
  }

  remove(id: string): boolean {
    return this.inner.remove(id);
  }

  refused(): string {
    return this.inner.refused();
  }
}

/** A save's text and who played whom in it, for the host's table to load (`TableOptions.readSave`); none if no such. */
export function seatingOf(shelf: SaveShelf, slot: string): ({ text: string } & SavedSeating) | null {
  const text = shelf.read(slot);
  if (text === null) return null;
  const listed = shelf.list().find((each) => each.id === slot);
  return { text, ...(listed?.seats === undefined ? {} : { seats: listed.seats }), ...(listed?.names === undefined ? {} : { names: listed.names }) };
}
