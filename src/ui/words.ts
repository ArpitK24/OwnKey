/**
 * Split a typed command line into arguments the way a shell would for simple cases:
 * whitespace separates, single and double quotes group, backslash escapes the next character.
 */
export function splitWords(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quote: '"' | "'" | null = null;
    let has = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) quote = null;
            else if (ch === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
            else cur += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            has = true;
        } else if (ch === '\\' && i + 1 < line.length) {
            cur += line[++i];
            has = true;
        } else if (/\s/.test(ch)) {
            if (has) out.push(cur);
            cur = '';
            has = false;
        } else {
            cur += ch;
            has = true;
        }
    }
    if (quote) throw new Error('Unclosed quote');
    if (has) out.push(cur);
    return out;
}
