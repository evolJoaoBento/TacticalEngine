/** Open the page again, on what was chosen: every choice of the main menu's, and an adventure begun at the camp's portal. */
export function openPage(query: string): void {
  window.location.assign(`${window.location.pathname}?${query}`);
}
