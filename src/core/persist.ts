import { dbOps } from '../db/operations.js';
import { dbClient } from '../db/client.js';
import { localStorage, StoredSuggestion } from '../storage/local.js';
import { logger } from '../utils/logger.js';
import type { Suggestion } from '../types/index.js';

/**
 * Save suggestions locally (always; these IDs are what `apply` uses) and mirror them
 * to the optional database for history.
 */
export async function persistSuggestions(
    projectPath: string,
    projectName: string,
    suggestions: Suggestion[],
    runLabel: string
): Promise<StoredSuggestion[]> {
    let localStored: StoredSuggestion[] = [];
    try {
        // Re-running a review should not pile up duplicate pending suggestions: reuse a pending
        // suggestion with the same file and change instead of storing it again.
        const key = (s: Suggestion) => `${s.filePath}\u0000${(s.diff || '').trim() || s.content}`;
        const pending = new Map(
            (await localStorage.loadSuggestionsForProject(projectPath))
                .filter((s) => !s.appliedAt)
                .map((s) => [key(s), s] as const)
        );
        const fresh = suggestions.filter((s) => !pending.has(key(s)));
        const saved = fresh.length ? await localStorage.saveSuggestions(projectPath, projectName, fresh) : [];
        let next = 0;
        localStored = suggestions.map((s) => pending.get(key(s)) ?? saved[next++]);
    } catch (error) {
        logger.warn(`Failed to save suggestions locally: ${(error as Error).message}`);
    }

    if (dbClient.isConnected() && suggestions.length > 0) {
        try {
            let project = await dbOps.getProjectByPath(projectPath);
            if (!project) {
                project = await dbOps.createProject(projectName, projectPath);
            }
            if (project) {
                const run = await dbOps.createRun(project.id, runLabel);
                for (let i = 0; i < suggestions.length; i++) {
                    if (localStored[i]?.dbId) continue; // already mirrored on an earlier run
                    const stored = await dbOps.createSuggestion(project.id, suggestions[i]);
                    if (stored && run) await dbOps.linkRunSuggestion(run.id, stored.id);
                    if (stored && localStored[i]) {
                        await localStorage.updateSuggestion(localStored[i].id, { dbId: stored.id });
                    }
                }
                if (run) {
                    await dbOps.updateRunStatus(run.id, 'completed', `Generated ${suggestions.length} suggestions`);
                }
                logger.verbose('Saved suggestions to database');
            }
        } catch (error) {
            logger.warn(`Database save failed (${(error as Error).message}); suggestions are saved locally.`);
        }
    }
    return localStored;
}
