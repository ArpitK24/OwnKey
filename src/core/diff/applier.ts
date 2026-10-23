import { ParsedDiff, Hunk } from './parser.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';

export interface ApplyResult {
    success: boolean;
    filePath: string;
    linesChanged: number;
    error?: string;
}

export interface ContentResult {
    ok: boolean;
    content: string;
    linesChanged: number;
    errors: string[];
    warnings: string[];
    isNewFile: boolean;
}

export class DiffApplier {
    /**
     * Apply a diff to file content in memory.
     *
     * Each hunk is located by matching its context + removed lines against the file,
     * starting at the line the hunk claims and searching outward, so slightly wrong
     * line numbers (common in model output) still apply cleanly. A hunk whose lines
     * do not exist in the file is rejected instead of being written in the wrong place.
     */
    static applyToContent(original: string | null, diff: ParsedDiff): ContentResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const isNewFile = original === null;

        if (diff.newPath === '/dev/null') {
            return { ok: false, content: original ?? '', linesChanged: 0, errors: ['File deletion is not supported'], warnings, isNewFile };
        }

        const usesCRLF = original?.includes('\r\n') ?? false;
        const text = (original ?? '').replace(/\r\n/g, '\n');
        const lines = text === '' ? [] : text.split('\n');
        let offset = 0;
        let linesChanged = 0;

        diff.hunks.forEach((hunk, index) => {
            const oldBlock = hunk.changes.filter((c) => c.type !== 'add').map((c) => c.content);
            const newBlock = hunk.changes.filter((c) => c.type !== 'remove').map((c) => c.content);
            const expected = Math.max(0, hunk.oldStart - 1 + offset);

            const at = DiffApplier.locate(lines, oldBlock, expected);
            if (at === -1) {
                errors.push(
                    `Hunk ${index + 1} (around line ${hunk.oldStart}) does not match the current file contents`
                );
                return;
            }
            if (oldBlock.length > 0 && at !== expected) {
                warnings.push(`Hunk ${index + 1} applied at line ${at + 1} (diff said ${hunk.oldStart})`);
            }

            lines.splice(at, oldBlock.length, ...newBlock);
            offset += newBlock.length - oldBlock.length;
            linesChanged += hunk.changes.filter((c) => c.type !== 'context').length;
        });

        let content = lines.join('\n');
        if (isNewFile && content !== '' && !content.endsWith('\n')) content += '\n';
        if (usesCRLF) content = content.replace(/\n/g, '\r\n');

        return { ok: errors.length === 0, content, linesChanged, errors, warnings, isNewFile };
    }

    /** Find where `block` occurs in `lines`, preferring the position closest to `expected`. */
    private static locate(lines: string[], block: string[], expected: number): number {
        if (block.length === 0) {
            return Math.min(expected, lines.length);
        }
        const matchesAt = (i: number, loose: boolean): boolean => {
            for (let k = 0; k < block.length; k++) {
                const a = lines[i + k];
                const b = block[k];
                if (a === undefined) return false;
                if (loose ? a.trim() !== b.trim() : a !== b) return false;
            }
            return true;
        };
        const last = lines.length - block.length;
        for (const loose of [false, true]) {
            for (let d = 0; d <= Math.max(expected, last - expected); d++) {
                for (const i of d === 0 ? [expected] : [expected - d, expected + d]) {
                    if (i >= 0 && i <= last && matchesAt(i, loose)) return i;
                }
            }
        }
        return -1;
    }

    /**
     * Apply a parsed diff to a file on disk (creates the file for new-file diffs).
     */
    static async apply(diff: ParsedDiff, targetPath: string): Promise<ApplyResult> {
        try {
            const original = existsSync(targetPath) ? await readFile(targetPath, 'utf-8') : null;
            const result = DiffApplier.applyToContent(original, diff);
            if (!result.ok) {
                return { success: false, filePath: targetPath, linesChanged: 0, error: result.errors.join('; ') };
            }
            await mkdir(dirname(targetPath), { recursive: true });
            await writeFile(targetPath, result.content, 'utf-8');
            return { success: true, filePath: targetPath, linesChanged: result.linesChanged };
        } catch (error) {
            return { success: false, filePath: targetPath, linesChanged: 0, error: (error as Error).message };
        }
    }

    /** Dry run: the file's lines after applying, without writing. */
    static async dryRun(diff: ParsedDiff, targetPath: string): Promise<string[]> {
        const original = existsSync(targetPath) ? await readFile(targetPath, 'utf-8') : null;
        return DiffApplier.applyToContent(original, diff).content.split('\n');
    }

    /** Kept for API compatibility. */
    static hunkSize(hunk: Hunk): number {
        return hunk.changes.length;
    }
}
