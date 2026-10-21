/** Open the page again, on what was chosen: every choice of the main menu's, and an adventure begun at the camp's portal. */
export function openPage(query: string): void {
  window.location.assign(`${window.location.pathname}?${query}`);
}

/**
 * The address made the game the page plays now, the page not opened again: an adventure begun at a table, which a
 * reload comes back to. What else it says - a peer game's host's - kept.
 */
export function nowPlaying(project: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}?${playingQuery(window.location.search, project)}`);
}

/** An address's query once the page plays another game of the browser's: what said which game it was, gone. */
export function playingQuery(search: string, project: string): string {
  const kept = search.replace(/^\?/, '').split('&').filter((part) => part !== '' && !['play', 'project', 'saved', 'load'].includes(part.split('=')[0]!));
  return [...kept, `play&project=${encodeURIComponent(project)}`].join('&');
}
