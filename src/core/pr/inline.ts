import { createHash } from 'crypto';
import type { Finding } from '../review/report.js';

/** Lines on the new side of a pull request diff that GitHub accepts review comments on. */
export type CommentableLines = Map<string, Array<[number, number]>>;

export function isCommentable(lines: CommentableLines, file: string, line: number): boolean {
    return (lines.get(file) ?? []).some(([a, b]) => line >= a && line <= b);
}

/** Nearest commentable line within `slack` lines, for findings anchored just outside a hunk. */
export function nearestCommentable(lines: CommentableLines, file: string, line: number, slack = 3): number | undefined {
    if (isCommentable(lines, file, line)) return line;
    for (let d = 1; d <= slack; d++) {
        if (isCommentable(lines, file, line - d)) return line - d;
        if (isCommentable(lines, file, line + d)) return line + d;
    }
    return undefined;
}

export interface SuggestedChange {
    /** First and last line (1-based, new side) the suggestion replaces */
    start: number;
    end: number;
    /** Replacement text for those lines */
    replacement: string[];
}

/**
 * Turn a finding's unified diff into a GitHub suggested change: the block of current
 * lines it replaces and what replaces them. Only a single contiguous change qualifies,
 * and its removed lines must match the file as it stands, so "Commit suggestion" on
 * GitHub produces exactly the fix the model proposed.
 */
export function toSuggestedChange(diff: string, fileLines: string[]): SuggestedChange | undefined {
    if (!diff?.trim()) return undefined;
    const body = diff.split('\n').filter((l) => !l.startsWith('---') && !l.startsWith('+++') && !l.startsWith('\\'));
    const hunks = body.filter((l) => l.startsWith('@@')).length;
    if (hunks !== 1) return undefined;
    const lines = body.slice(body.findIndex((l) => l.startsWith('@@')) + 1);
    while (lines.length && lines[lines.length - 1] === '') lines.pop();

    // The changed block: removed and added lines, with no unchanged line between them
    const first = lines.findIndex((l) => l.startsWith('-') || l.startsWith('+'));
    if (first === -1) return undefined;
    let last = first;
    for (let i = first; i < lines.length; i++) if (lines[i].startsWith('-') || lines[i].startsWith('+')) last = i;
    const block = lines.slice(first, last + 1);
    if (block.some((l) => !l.startsWith('-') && !l.startsWith('+'))) return undefined;

    const removed = block.filter((l) => l.startsWith('-')).map((l) => l.slice(1));
    const added = block.filter((l) => l.startsWith('+')).map((l) => l.slice(1));
    const before = lines.slice(0, first).map((l) => l.slice(1));
    const after = lines.slice(last + 1).map((l) => l.slice(1));

    const find = (needle: string[]): number[] => {
        const hits: number[] = [];
        for (let i = 0; i + needle.length <= fileLines.length; i++) {
            if (needle.every((n, j) => fileLines[i + j].trimEnd() === n.trimEnd())) hits.push(i);
        }
        return hits;
    };

    if (removed.length) {
        // Locate the removed block, using the context around it to pick the right copy
        const full = [...before, ...removed, ...after];
        let at = find(full).map((i) => i + before.length);
        if (at.length !== 1) at = find(removed);
        if (at.length !== 1) return undefined;
        return { start: at[0] + 1, end: at[0] + removed.length, replacement: added };
    }
    // A pure insertion: replace the context line just before it with itself plus the new lines
    if (!before.length) return undefined;
    const at = find([...before, ...after]);
    if (at.length !== 1) return undefined;
    const anchor = at[0] + before.length; // 0-based index of the last context line, plus one
    return { start: anchor, end: anchor, replacement: [fileLines[anchor - 1], ...added] };
}

/**
 * A stable identity for a finding across runs, so a re-review does not post the same
 * comment twice: the file, the type, and the line rounded to a small window.
 */
export function fingerprint(f: Pick<Finding, 'filePath' | 'type'>): string {
    return createHash('sha1').update(`${f.filePath}\n${f.type}`).digest('hex').slice(0, 12);
}

export const FINDING_MARKER = /<!-- ownkey:finding ([0-9a-f]{12}) (\d+) -->/;

export function findingMarker(f: Finding): string {
    return `<!-- ownkey:finding ${fingerprint(f)} ${f.line} -->`;
}

/** Whether an existing bot comment already covers this finding (same file and type, within a few lines). */
export function alreadyPosted(f: Finding, existing: { body: string; path?: string; line?: number | null }[], window = 3): boolean {
    const fp = fingerprint(f);
    return existing.some((c) => {
        const m = FINDING_MARKER.exec(c.body ?? '');
        if (!m || m[1] !== fp) return false;
        const line = c.line ?? parseInt(m[2], 10);
        return Math.abs(line - f.line) <= window;
    });
}

const SEVERITY_LABEL: Record<string, string> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    info: 'Info',
};

function titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The body of an inline review comment for one finding. */
export function inlineCommentBody(f: Finding, suggestion?: SuggestedChange): string {
    const out: string[] = [];
    out.push(`**${SEVERITY_LABEL[f.severity] ?? f.severity} · ${titleCase(f.type)}**`);
    out.push('');
    out.push(f.content.trim());
    if (f.rationale?.trim()) {
        out.push('');
        out.push(f.rationale.trim());
    }
    if (suggestion) {
        out.push('');
        out.push('```suggestion');
        out.push(...suggestion.replacement);
        out.push('```');
    } else if (f.diff?.trim()) {
        out.push('');
        out.push('<details><summary>Proposed fix</summary>');
        out.push('');
        out.push('```diff');
        out.push(f.diff.trim());
        out.push('```');
        out.push('');
        out.push('</details>');
    }
    out.push('');
    out.push(findingMarker(f));
    return out.join('\n');
}
