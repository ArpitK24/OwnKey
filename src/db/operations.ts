import { eq, desc } from 'drizzle-orm';
import { dbClient } from './client.js';
import * as schema from './schema.js';
import {
    Project,
    Run,
    SuggestionRecord,
    RunStatus,
    SuggestionAction,
} from '../types/index.js';
import { logger } from '../utils/logger.js';

export class DatabaseOperations {
    // Projects
    async createProject(name: string, rootPath: string): Promise<Project | null> {
        if (dbClient.isLocalOnlyMode()) {
            logger.verbose('Skipping project creation (local-only mode)');
            return null;
        }

        const db = dbClient.getDb();
        const [project] = await db
            .insert(schema.projects)
            .values({ name, rootPath })
            .returning();

        return {
            id: project.id,
            name: project.name,
            rootPath: project.rootPath,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
        };
    }

    async getProjectByPath(rootPath: string): Promise<Project | null> {
        if (dbClient.isLocalOnlyMode()) {
            return null;
        }

        const db = dbClient.getDb();
        const [project] = await db
            .select()
            .from(schema.projects)
            .where(eq(schema.projects.rootPath, rootPath))
            .limit(1);

        if (!project) return null;

        return {
            id: project.id,
            name: project.name,
            rootPath: project.rootPath,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
        };
    }

    // Runs
    async createRun(projectId: string, command: string): Promise<Run | null> {
        if (dbClient.isLocalOnlyMode()) {
            logger.verbose('Skipping run creation (local-only mode)');
            return null;
        }

        const db = dbClient.getDb();
        const [run] = await db
            .insert(schema.runs)
            .values({ projectId, command, status: 'running' })
            .returning();

        return {
            id: run.id,
            projectId: run.projectId,
            command: run.command,
            status: run.status as RunStatus,
            summary: run.summary || undefined,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt || undefined,
        };
    }

    async updateRunStatus(
        runId: string,
        status: RunStatus,
        summary?: string
    ): Promise<void> {
        if (dbClient.isLocalOnlyMode()) {
            return;
        }

        const db = dbClient.getDb();
        await db
            .update(schema.runs)
            .set({ status, summary, finishedAt: new Date() })
            .where(eq(schema.runs.id, runId));
    }

    async getRecentRuns(limit: number = 10): Promise<Run[]> {
        if (dbClient.isLocalOnlyMode()) {
            return [];
        }

        const db = dbClient.getDb();
        const runs = await db
            .select()
            .from(schema.runs)
            .orderBy(desc(schema.runs.startedAt))
            .limit(limit);

        return runs.map((run) => ({
            id: run.id,
            projectId: run.projectId,
            command: run.command,
            status: run.status as RunStatus,
            summary: run.summary || undefined,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt || undefined,
        }));
    }

    // Suggestions
    async createSuggestion(
        projectId: string,
        suggestion: Omit<SuggestionRecord, 'id' | 'projectId' | 'createdAt'>
    ): Promise<SuggestionRecord | null> {
        if (dbClient.isLocalOnlyMode()) {
            logger.verbose('Skipping suggestion storage (local-only mode)');
            return null;
        }

        const db = dbClient.getDb();
        const [created] = await db
            .insert(schema.suggestions)
            .values({
                projectId,
                type: suggestion.type,
                severity: suggestion.severity,
                content: suggestion.content,
                diff: suggestion.diff,
                filePath: suggestion.filePath,
                rationale: suggestion.rationale,
                tags: suggestion.tags,
            })
            .returning();

        return {
            id: created.id,
            projectId: created.projectId,
            type: created.type as any,
            severity: created.severity as any,
            content: created.content,
            diff: created.diff,
            filePath: created.filePath,
            rationale: created.rationale,
            tags: created.tags as any,
            createdAt: created.createdAt,
        };
    }

    async getSuggestionById(id: string): Promise<SuggestionRecord | null> {
        if (dbClient.isLocalOnlyMode()) {
            return null;
        }

        const db = dbClient.getDb();
        const [suggestion] = await db
            .select()
            .from(schema.suggestions)
            .where(eq(schema.suggestions.id, id))
            .limit(1);

        if (!suggestion) return null;

        return {
            id: suggestion.id,
            projectId: suggestion.projectId,
            type: suggestion.type as any,
            severity: suggestion.severity as any,
            content: suggestion.content,
            diff: suggestion.diff,
            filePath: suggestion.filePath,
            rationale: suggestion.rationale,
            tags: suggestion.tags as any,
            createdAt: suggestion.createdAt,
        };
    }

    async linkRunSuggestion(runId: string, suggestionId: string): Promise<void> {
        if (dbClient.isLocalOnlyMode()) {
            return;
        }

        const db = dbClient.getDb();
        await db.insert(schema.runSuggestions).values({ runId, suggestionId });
    }

    // Suggestion History
    async recordSuggestionAction(
        suggestionId: string,
        action: SuggestionAction,
        details?: string
    ): Promise<void> {
        if (dbClient.isLocalOnlyMode()) {
            return;
        }

        const db = dbClient.getDb();
        await db.insert(schema.suggestionHistory).values({
            suggestionId,
            action,
            details,
        });
    }
}

export const dbOps = new DatabaseOperations();
