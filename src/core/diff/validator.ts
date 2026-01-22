import { ParsedDiff, Hunk } from './parser.js';
import { readFile } from 'fs/promises';

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export class DiffValidator {
    /**
     * Validate a parsed diff before applying
     */
    static async validate(diff: ParsedDiff, targetPath: string): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            // Check if file exists
            const fileContent = await readFile(targetPath, 'utf-8');
            const lines = fileContent.split('\n');

            // Validate each hunk
            for (const hunk of diff.hunks) {
                const hunkValidation = this.validateHunk(hunk, lines);
                errors.push(...hunkValidation.errors);
                warnings.push(...hunkValidation.warnings);
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                errors.push(`File not found: ${targetPath}`);
            } else {
                errors.push(`Failed to read file: ${(error as Error).message}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * Validate a single hunk against file content
     */
    private static validateHunk(hunk: Hunk, fileLines: string[]): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Check if hunk is within file bounds
        if (hunk.oldStart < 1 || hunk.oldStart > fileLines.length + 1) {
            errors.push(`Hunk starts at line ${hunk.oldStart}, but file only has ${fileLines.length} lines`);
            return { valid: false, errors, warnings };
        }

        // Validate context lines match
        let fileLineIndex = hunk.oldStart - 1;
        for (const change of hunk.changes) {
            if (change.type === 'context' || change.type === 'remove') {
                if (fileLineIndex >= fileLines.length) {
                    errors.push(`Context line ${fileLineIndex + 1} is beyond end of file`);
                    break;
                }

                const fileLine = fileLines[fileLineIndex];
                if (fileLine !== change.content) {
                    warnings.push(
                        `Line ${fileLineIndex + 1} doesn't match context:\n` +
                        `  Expected: "${change.content}"\n` +
                        `  Found:    "${fileLine}"`
                    );
                }
                fileLineIndex++;
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Check if diff can be applied cleanly (no conflicts)
     */
    static canApplyCleanly(diff: ParsedDiff, fileContent: string): boolean {
        const lines = fileContent.split('\n');

        for (const hunk of diff.hunks) {
            let fileLineIndex = hunk.oldStart - 1;

            for (const change of hunk.changes) {
                if (change.type === 'context' || change.type === 'remove') {
                    if (fileLineIndex >= lines.length) {
                        return false;
                    }
                    if (lines[fileLineIndex] !== change.content) {
                        return false;
                    }
                    fileLineIndex++;
                }
            }
        }

        return true;
    }
}
