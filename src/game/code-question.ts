/** What Import pack and Load ask before new code comes in (`main.ts`): which scripts, and what code can do. */
export function codeQuestion(label: string, code: readonly { id: string; name: string }[], verb: 'Import' | 'Load'): string {
  const named = code.map((entry) => (entry.name === '' ? entry.id : `${entry.name} (${entry.id})`));
  return [
    `${label} carries code: ${code.length === 1 ? 'one script' : `${code.length} scripts`} -- ${named.join(', ')}.`,
    'Code in a pack runs inside the game with everything the game can reach. It is not sandboxed.',
    `${verb} it only if you trust whoever made it. ${verb} it, code and all?`,
  ].join('\n\n');
}
