export interface CommandInfo {
    name: string;
    description: string;
    options: Array<{ flags: string; description: string }>;
}

export interface Suggestion {
    /** What Tab inserts for the current word */
    value: string;
    label: string;
    description: string;
}

export const BUILTINS: CommandInfo[] = [
    { name: 'help', description: 'Show commands and keys', options: [] },
    { name: 'clear', description: 'Clear the screen', options: [] },
    { name: 'exit', description: 'Leave OwnKey (Ctrl+D)', options: [] },
];

const MAX = 6;

/** Long flag of a commander flags string, e.g. "-y, --yes" -> "--yes", "--case <ids>" -> "--case". */
export function longFlag(flags: string): string {
    const parts = flags.split(/[ ,|]+/).filter((p) => p.startsWith('-'));
    return parts.find((p) => p.startsWith('--')) ?? parts[0] ?? flags;
}

/** Suggestions for the word being typed at the end of `line`. */
export function suggest(line: string, commands: CommandInfo[]): Suggestion[] {
    const all = [...commands, ...BUILTINS];
    const trimmedStart = line.replace(/^\s+/, '').replace(/^ownkey\s+/, '');
    const words = trimmedStart.split(/\s+/);
    if (words.length <= 1) {
        const w = words[0] ?? '';
        return all
            .filter((c) => c.name.startsWith(w) && c.name !== w)
            .slice(0, MAX)
            .map((c) => ({ value: c.name, label: c.name, description: c.description }));
    }
    const cmd = all.find((c) => c.name === words[0]);
    if (!cmd) return [];
    const current = words[words.length - 1];
    if (current !== '' && !current.startsWith('-')) return [];
    const used = new Set(words.slice(1, -1));
    return cmd.options
        .map((o) => ({ value: longFlag(o.flags), label: o.flags, description: o.description }))
        .filter((s) => s.value.startsWith(current) && s.value !== current && !used.has(s.value))
        .slice(0, MAX);
}

/** Replace the word being typed with `value`, followed by a space. */
export function applySuggestion(line: string, value: string): string {
    const i = Math.max(line.lastIndexOf(' '), line.lastIndexOf('\t'));
    return line.slice(0, i + 1) + value + ' ';
}
