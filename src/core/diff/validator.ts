import { ParsedDiff } from './parser.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { DiffApplier } from './applier.js';

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export class DiffValidator {
    /**
     * Validate a parsed diff against the file it targets (a missing file is only
     * valid when the diff creates it).
     */
    static async validate(diff: ParsedDiff, targetPath: string): Promise<ValidationResult> {
        try {
            const exists = existsSync(targetPath);
            if (!exists && diff.oldPath !== '/dev/null' && diff.hunks.some((h) => h.oldLines > 0)) {
                return { valid: false, errors: [`File not found: ${targetPath}`], warnings: [] };
            }
            const original = exists ? await readFile(targetPath, 'utf-8') : null;
            const result = DiffApplier.applyToContent(original, diff);
            return { valid: result.ok, errors: result.errors, warnings: result.warnings };
        } catch (error) {
            return { valid: false, errors: [`Failed to read file: ${(error as Error).message}`], warnings: [] };
        }
    }

    /** Check if a diff applies to the given content. */
    static canApplyCleanly(diff: ParsedDiff, fileContent: string): boolean {
        return DiffApplier.applyToContent(fileContent, diff).ok;
    }
}
