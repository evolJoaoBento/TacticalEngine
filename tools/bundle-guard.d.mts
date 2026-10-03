/** The build's guard (`bundle-guard.mjs`): a built page carries none of its own game's rules. */
export declare const RULES_SAY: readonly string[];
export declare function rulesIn(text: string): string[];
export declare function judgeBuild(folder: string): string | null;
