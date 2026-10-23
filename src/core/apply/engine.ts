import { DiffParser, DiffApplier, ParsedDiff } from '../diff/index.js';
import { BackupManager } from '../backup/index.js';
import { InteractiveMode } from './interactive.js';
import { dbClient } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import { localStorage } from '../../storage/local.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';

export interface ApplyOptions {
    dryRun?: boolean;
    force?: boolean;
    createBackup?: boolean;
    /** Show each change and ask before writing (default when not --auto) */
    interactive?: boolean;
}

export interface ApplyEngineResult {
    success: boolean;
    suggestionId: string;
    filesModified: string[];
    backupId?: string;
    error?: string;
    warnings?: string[];
    /** User declined in interactive mode */
    skipped?: boolean;
    /** User chose "quit" in interactive mode */
    quit?: boolean;
}

export interface LoadedSuggestion {
    id: string;
    diff: string;
    filePath?: string;
    projectPath?: string;
    localId?: string;
    dbId?: string;
    appliedAt?: string;
    backupId?: string;
}

interface PlannedChange {
    diff: ParsedDiff;
    absPath: string;
    relPath: string;
    newContent: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApplyEngine {
    private backupManager: BackupManager;

    constructor(backupManager?: BackupManager) {
        this.backupManager = backupManager ?? new BackupManager();
    }

    async applySuggestion(suggestionId: string, options: ApplyOptions = {}): Promise<ApplyEngineResult> {
        const { dryRun = false, force = false, createBackup = true, interactive = false } = options;
        const fail = (error: string, warnings: string[] = []): ApplyEngineResult => ({
            success: false,
            suggestionId,
            filesModified: [],
            error,
            warnings,
        });

        try {
            // 1. Load
            const suggestion = await this.loadSuggestion(suggestionId);
            if (!suggestion) {
                return fail(`Suggestion not found: ${suggestionId}. Run "ownkey apply" to list available IDs.`);
            }
            if (!suggestion.diff.trim()) {
                return fail('This suggestion has no code change attached (the model gave advice only), so there is nothing to apply.');
            }

            if (suggestion.appliedAt && !dryRun && !force) {
                return fail(
                    `Already applied${suggestion.backupId ? ` (undo with: ownkey undo ${suggestion.backupId})` : ''}. Use --force to try again.`
                );
            }

            // 2. Parse
            const diffs = DiffParser.parse(suggestion.diff).filter((d) => d.hunks.length > 0);
            if (diffs.length === 0) {
                return fail('The suggestion diff could not be parsed as a unified diff');
            }

            // 3. Resolve paths against the project the suggestion was generated for
            const root = this.resolveRoot(suggestion.projectPath);
            const warnings: string[] = [];
            const planned: PlannedChange[] = [];
            const errors: string[] = [];

            for (const diff of diffs) {
                let relPath = diff.filePath;
                // Fall back to the suggestion's filePath when the diff header path does not exist
                if (
                    diffs.length === 1 &&
                    suggestion.filePath &&
                    diff.oldPath !== '/dev/null' &&
                    !existsSync(resolve(root, relPath)) &&
                    existsSync(resolve(root, suggestion.filePath))
                ) {
                    relPath = suggestion.filePath;
                }

                const absPath = resolve(root, relPath);
                const rel = relative(root, absPath);
                if (rel.startsWith('..') || isAbsolute(rel)) {
                    errors.push(`Refusing to modify a file outside the project: ${relPath}`);
                    continue;
                }

                const exists = existsSync(absPath);
                if (!exists && diff.oldPath !== '/dev/null' && diff.hunks.some((h) => h.oldLines > 0)) {
                    errors.push(`File not found: ${rel}`);
                    continue;
                }

                const original = exists ? await readFile(absPath, 'utf-8') : null;
                const result = DiffApplier.applyToContent(original, diff);
                warnings.push(...result.warnings.map((w) => `${rel}: ${w}`));
                if (!result.ok) {
                    errors.push(...result.errors.map((e) => `${rel}: ${e}`));
                    continue;
                }
                planned.push({ diff, absPath, relPath: rel, newContent: result.content });
            }

            if (errors.length > 0 && (!force || planned.length === 0)) {
                return fail(`Cannot apply: ${errors.join('; ')}`, warnings);
            }
            if (errors.length > 0) {
                warnings.push(...errors.map((e) => `Skipped (--force): ${e}`));
            }

            // 4. Dry run: show the change, write nothing
            if (dryRun) {
                for (const change of planned) InteractiveMode.showFullDiff(change.diff);
                return { success: true, suggestionId, filesModified: planned.map((p) => p.relPath), warnings };
            }

            // 5. Interactive confirmation
            let toWrite = planned;
            if (interactive) {
                if (!process.stdin.isTTY) {
                    return fail('No terminal to confirm in. Re-run with --auto to apply, or --dry-run to preview.', warnings);
                }
                toWrite = [];
                for (const change of planned) {
                    const answer = await InteractiveMode.confirmApply(change.diff, { showFullDiff: true });
                    if (answer.skipAll) {
                        return { success: false, suggestionId, filesModified: [], warnings, skipped: true, quit: true, error: 'Cancelled' };
                    }
                    if (answer.confirmed) toWrite.push(change);
                }
                if (toWrite.length === 0) {
                    return { success: false, suggestionId, filesModified: [], warnings, skipped: true, error: 'Skipped' };
                }
            }

            // 6. Backup
            let backupId: string | undefined;
            if (createBackup) {
                backupId = await this.backupManager.createBackup(
                    toWrite.map((c) => c.absPath),
                    `apply-${suggestionId}`,
                    root
                );
                logger.verbose(`Backup created: ${backupId}`);
            }

            // 7. Write, rolling back on any failure
            const filesModified: string[] = [];
            try {
                for (const change of toWrite) {
                    await mkdir(dirname(change.absPath), { recursive: true });
                    await writeFile(change.absPath, change.newContent, 'utf-8');
                    filesModified.push(change.relPath);
                }
            } catch (error) {
                if (backupId) {
                    logger.warn('Write failed, restoring backup...');
                    await this.backupManager.restore(backupId);
                }
                return fail(`Write failed: ${(error as Error).message}`, warnings);
            }

            // 8. Record
            if (suggestion.localId) {
                await localStorage
                    .updateSuggestion(suggestion.localId, { appliedAt: new Date().toISOString(), backupId })
                    .catch(() => undefined);
            }
            if (dbClient.isConnected() && suggestion.dbId) {
                await this.recordApply(suggestion.dbId, filesModified, backupId).catch((error) =>
                    logger.verbose(`Could not record apply in database: ${(error as Error).message}`)
                );
            }

            return { success: true, suggestionId, filesModified, backupId, warnings };
        } catch (error) {
            logger.debug(`Apply engine error: ${(error as Error).stack}`);
            return fail((error as Error).message);
        }
    }

    private resolveRoot(projectPath?: string): string {
        if (projectPath && existsSync(projectPath) && statSync(projectPath).isDirectory()) {
            return projectPath;
        }
        if (projectPath && existsSync(projectPath)) {
            return dirname(projectPath); // suggest was run on a single file
        }
        return process.cwd();
    }

    /**
     * Load a suggestion from local storage (always written by suggest) or the optional database.
     */
    async loadSuggestion(suggestionId: string): Promise<LoadedSuggestion | null> {
        const stored = await localStorage.loadSuggestion(suggestionId).catch(() => null);
        if (stored) {
            return {
                id: stored.id,
                diff: stored.diff || '',
                filePath: stored.filePath,
                projectPath: stored.projectPath,
                localId: stored.id,
                dbId: stored.dbId,
                appliedAt: stored.appliedAt,
                backupId: stored.backupId,
            };
        }

        if (dbClient.isConnected() && UUID_RE.test(suggestionId)) {
            const sql = dbClient.getClient();
            if (sql) {
                const rows = await sql`
                    SELECT s.id, s.diff, s.file_path, p.root_path
                    FROM suggestions s JOIN projects p ON p.id = s.project_id
                    WHERE s.id = ${suggestionId}
                `;
                if (rows.length > 0) {
                    const row = rows[0];
                    return {
                        id: row.id,
                        diff: row.diff || '',
                        filePath: row.file_path,
                        projectPath: row.root_path,
                        dbId: row.id,
                    };
                }
            }
        }
        return null;
    }

    private async recordApply(dbSuggestionId: string, filesModified: string[], backupId?: string): Promise<void> {
        const sql = dbClient.getClient();
        if (!sql) return;
        await sql`
            INSERT INTO applies (id, suggestion_id, files_modified, backup_id, applied_at, status)
            VALUES (gen_random_uuid(), ${dbSuggestionId}, ${JSON.stringify(filesModified)}::jsonb, ${backupId || null}, NOW(), 'success')
        `;
    }

    getBackupManager(): BackupManager {
        return this.backupManager;
    }
}
