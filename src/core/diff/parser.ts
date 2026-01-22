/**
 * Diff Parser - Parse unified diff format
 */

export interface ParsedDiff {
    filePath: string;
    oldPath?: string;
    newPath?: string;
    hunks: Hunk[];
}

export interface Hunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    changes: Change[];
}

export interface Change {
    type: 'add' | 'remove' | 'context';
    content: string;
    lineNumber: number;
}

export class DiffParser {
    /**
     * Parse unified diff format into structured data
     */
    static parse(diffText: string): ParsedDiff[] {
        const diffs: ParsedDiff[] = [];
        const lines = diffText.split('\n');
        let currentDiff: ParsedDiff | null = null;
        let currentHunk: Hunk | null = null;
        let lineNumber = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // File header: --- a/path/to/file.ts
            if (line.startsWith('--- ')) {
                if (currentDiff && currentHunk) {
                    currentDiff.hunks.push(currentHunk);
                }
                if (currentDiff) {
                    diffs.push(currentDiff);
                }

                const oldPath = line.substring(4).replace(/^a\//, '');
                currentDiff = {
                    filePath: oldPath,
                    oldPath,
                    hunks: [],
                };
                currentHunk = null;
            }
            // File header: +++ b/path/to/file.ts
            else if (line.startsWith('+++ ') && currentDiff) {
                const newPath = line.substring(4).replace(/^b\//, '');
                currentDiff.newPath = newPath;
                currentDiff.filePath = newPath;
            }
            // Hunk header: @@ -10,5 +10,6 @@
            else if (line.startsWith('@@')) {
                if (currentHunk && currentDiff) {
                    currentDiff.hunks.push(currentHunk);
                }

                const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
                if (match) {
                    currentHunk = {
                        oldStart: parseInt(match[1], 10),
                        oldLines: match[2] ? parseInt(match[2], 10) : 1,
                        newStart: parseInt(match[3], 10),
                        newLines: match[4] ? parseInt(match[4], 10) : 1,
                        changes: [],
                    };
                    lineNumber = parseInt(match[1], 10);
                }
            }
            // Change lines
            else if (currentHunk) {
                if (line.startsWith('+')) {
                    currentHunk.changes.push({
                        type: 'add',
                        content: line.substring(1),
                        lineNumber: lineNumber,
                    });
                } else if (line.startsWith('-')) {
                    currentHunk.changes.push({
                        type: 'remove',
                        content: line.substring(1),
                        lineNumber: lineNumber,
                    });
                    lineNumber++;
                } else if (line.startsWith(' ')) {
                    currentHunk.changes.push({
                        type: 'context',
                        content: line.substring(1),
                        lineNumber: lineNumber,
                    });
                    lineNumber++;
                }
            }
        }

        // Push last hunk and diff
        if (currentHunk && currentDiff) {
            currentDiff.hunks.push(currentHunk);
        }
        if (currentDiff) {
            diffs.push(currentDiff);
        }

        return diffs;
    }

    /**
     * Generate unified diff format from structured data
     */
    static generate(diff: ParsedDiff): string {
        let result = '';

        result += `--- a/${diff.oldPath || diff.filePath}\n`;
        result += `+++ b/${diff.newPath || diff.filePath}\n`;

        for (const hunk of diff.hunks) {
            result += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;

            for (const change of hunk.changes) {
                const prefix = change.type === 'add' ? '+' : change.type === 'remove' ? '-' : ' ';
                result += `${prefix}${change.content}\n`;
            }
        }

        return result;
    }
}
