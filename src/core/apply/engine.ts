import { DiffParser, DiffValidator, DiffApplier } from '../diff/index.js';
import { BackupManager } from '../backup/index.js';
import { dbClient } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import { join } from 'path';

export interface ApplyOptions {
    dryRun?: boolean;
    force?: boolean;
    createBackup?: boolean;
    interactive?: boolean;
}

export interface ApplyEngineResult {
    success: boolean;
    suggestionId: string;
    filesModified: string[];
    backupId?: string;
    error?: string;
    warnings?: string[];
}

export class ApplyEngine {
    private backupManager: BackupManager;

    constructor() {
        this.backupManager = new BackupManager();
    }

    /**
     * Apply a suggestion to the codebase
     */
    async applySuggestion(
        suggestionId: string,
        options: ApplyOptions = {}
    ): Promise<ApplyEngineResult> {
        const {
            dryRun = false,
            force = false,
            createBackup = true,
        } = options;

        try {
            logger.verbose(`Applying suggestion: ${suggestionId}`);

            // 1. Load suggestion from database
            const suggestion = await this.loadSuggestion(suggestionId);
            if (!suggestion) {
                return {
                    success: false,
                    suggestionId,
                    filesModified: [],
                    error: 'Suggestion not found',
                };
            }

            // 2. Parse diff
            logger.verbose('Parsing diff...');
            const diffs = DiffParser.parse(suggestion.diff);
            if (diffs.length === 0) {
                return {
                    success: false,
                    suggestionId,
                    filesModified: [],
                    error: 'No valid diff found in suggestion',
                };
            }

            // 3. Validate all diffs
            logger.verbose('Validating changes...');
            const validationResults = await Promise.all(
                diffs.map((diff) => {
                    const filePath = join(process.cwd(), diff.filePath);
                    return DiffValidator.validate(diff, filePath);
                })
            );

            const allValid = validationResults.every((r) => r.valid);
            const warnings = validationResults.flatMap((r) => r.warnings);

            if (!allValid && !force) {
                const errors = validationResults.flatMap((r) => r.errors);
                return {
                    success: false,
                    suggestionId,
                    filesModified: [],
                    error: `Validation failed: ${errors.join(', ')}`,
                    warnings,
                };
            }

            // 4. Dry run mode - just show what would change
            if (dryRun) {
                logger.info('Dry run mode - no changes will be made');
                return {
                    success: true,
                    suggestionId,
                    filesModified: diffs.map((d) => d.filePath),
                    warnings,
                };
            }

            // 5. Create backup
            let backupId: string | undefined;
            if (createBackup) {
                logger.verbose('Creating backup...');
                const filesToBackup = diffs.map((d) => join(process.cwd(), d.filePath));
                backupId = await this.backupManager.createBackup(
                    filesToBackup,
                    `apply-${suggestionId}`
                );
                logger.verbose(`Backup created: ${backupId}`);
            }

            // 6. Apply changes
            logger.verbose('Applying changes...');
            const filesModified: string[] = [];
            const applyErrors: string[] = [];

            for (const diff of diffs) {
                const filePath = join(process.cwd(), diff.filePath);
                const result = await DiffApplier.apply(diff, filePath);

                if (result.success) {
                    filesModified.push(result.filePath);
                    logger.verbose(`Applied changes to ${result.filePath}`);
                } else {
                    applyErrors.push(result.error || 'Unknown error');
                    logger.error(`Failed to apply changes to ${result.filePath}: ${result.error}`);
                }
            }

            // 7. If any apply failed, rollback
            if (applyErrors.length > 0 && backupId) {
                logger.warn('Some changes failed, rolling back...');
                await this.backupManager.restore(backupId);
                return {
                    success: false,
                    suggestionId,
                    filesModified: [],
                    backupId,
                    error: `Apply failed: ${applyErrors.join(', ')}`,
                    warnings,
                };
            }

            // 8. Record apply in database
            if (dbClient.isConnected()) {
                await this.recordApply(suggestionId, filesModified, backupId);
            }

            logger.success(`Successfully applied suggestion ${suggestionId}`);
            return {
                success: true,
                suggestionId,
                filesModified,
                backupId,
                warnings,
            };
        } catch (error) {
            logger.error('Apply engine error:', error as Error);
            return {
                success: false,
                suggestionId,
                filesModified: [],
                error: (error as Error).message,
            };
        }
    }

    /**
     * Load suggestion from database OR local storage
     */
    private async loadSuggestion(suggestionId: string): Promise<{ diff: string } | null> {
        // Try database first (if connected)
        if (dbClient.isConnected()) {
            try {
                const sql = dbClient.getClient();
                if (sql) {
                    const results = await sql`
                        SELECT diff FROM suggestions WHERE id = ${suggestionId}
                    `;

                    if (results.length > 0) {
                        logger.verbose('Loaded suggestion from database');
                        return results[0] as { diff: string };
                    }
                }
            } catch (error) {
                logger.warn(`Failed to load from database: ${(error as Error).message}`);
            }
        }

        // Fall back to local storage
        try {
            const { localStorage } = await import('../../storage/local.js');
            const stored = await localStorage.loadSuggestion(suggestionId);

            if (stored && stored.diff) {
                logger.verbose('Loaded suggestion from local storage');
                return { diff: stored.diff };
            }
        } catch (error) {
            logger.warn(`Failed to load from local storage: ${(error as Error).message}`);
        }

        return null;
    }

    /**
     * Record apply operation in database
     */
    private async recordApply(
        suggestionId: string,
        filesModified: string[],
        backupId?: string
    ): Promise<void> {
        const sql = dbClient.getClient();
        if (!sql) {
            return;
        }

        await sql`
            INSERT INTO applies (
                id,
                suggestion_id,
                files_modified,
                backup_id,
                applied_at,
                status
            ) VALUES (
                gen_random_uuid(),
                ${suggestionId},
                ${JSON.stringify(filesModified)},
                ${backupId || null},
                NOW(),
                'success'
            )
        `;
    }

    /**
     * Get backup manager instance
     */
    getBackupManager(): BackupManager {
        return this.backupManager;
    }
}
