import { ParsedDiff, Hunk } from './parser.js';
import { readFile, writeFile } from 'fs/promises';
import { DiffValidator } from './validator.js';

export interface ApplyResult {
    success: boolean;
    filePath: string;
    linesChanged: number;
    error?: string;
}

export class DiffApplier {
    /**
     * Apply a parsed diff to a file
     */
    static async apply(diff: ParsedDiff, targetPath: string): Promise<ApplyResult> {
        try {
            // Validate first
            const validation = await DiffValidator.validate(diff, targetPath);
            if (!validation.valid) {
                return {
                    success: false,
                    filePath: targetPath,
                    linesChanged: 0,
                    error: `Validation failed: ${validation.errors.join(', ')}`,
                };
            }

            // Read file
            const fileContent = await readFile(targetPath, 'utf-8');
            const lines = fileContent.split('\n');

            // Apply hunks
            let linesChanged = 0;
            let offset = 0; // Track line number shifts

            for (const hunk of diff.hunks) {
                const result = this.applyHunk(hunk, lines, offset);
                linesChanged += result.linesChanged;
                offset += result.offset;
            }

            // Write back
            await writeFile(targetPath, lines.join('\n'), 'utf-8');

            return {
                success: true,
                filePath: targetPath,
                linesChanged,
            };
        } catch (error) {
            return {
                success: false,
                filePath: targetPath,
                linesChanged: 0,
                error: (error as Error).message,
            };
        }
    }

    /**
     * Apply a single hunk to file lines
     */
    private static applyHunk(
        hunk: Hunk,
        lines: string[],
        offset: number
    ): { linesChanged: number; offset: number } {
        let linesChanged = 0;
        let currentOffset = offset;
        let fileLineIndex = hunk.oldStart - 1 + offset;

        // Collect changes to apply
        const toRemove: number[] = [];
        const toAdd: { index: number; content: string }[] = [];

        for (const change of hunk.changes) {
            if (change.type === 'remove') {
                toRemove.push(fileLineIndex);
                fileLineIndex++;
                linesChanged++;
            } else if (change.type === 'add') {
                toAdd.push({ index: fileLineIndex, content: change.content });
                fileLineIndex++;
                currentOffset++;
                linesChanged++;
            } else if (change.type === 'context') {
                fileLineIndex++;
            }
        }

        // Apply removals (in reverse to maintain indices)
        for (let i = toRemove.length - 1; i >= 0; i--) {
            lines.splice(toRemove[i], 1);
            currentOffset--;
        }

        // Apply additions
        for (const add of toAdd) {
            lines.splice(add.index, 0, add.content);
        }

        return { linesChanged, offset: currentOffset - offset };
    }

    /**
     * Dry run - show what would change without actually applying
     */
    static async dryRun(diff: ParsedDiff, targetPath: string): Promise<string[]> {
        const fileContent = await readFile(targetPath, 'utf-8');
        const lines = fileContent.split('\n').slice(); // Copy
        let offset = 0;

        for (const hunk of diff.hunks) {
            const result = this.applyHunk(hunk, lines, offset);
            offset += result.offset;
        }

        return lines;
    }
}
