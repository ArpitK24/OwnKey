import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Suggestion } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface StoredSuggestion extends Suggestion {
    id: string;
    projectPath: string;
    projectName: string;
    createdAt: string;
    /** Matching row id in the optional database */
    dbId?: string;
    appliedAt?: string;
    backupId?: string;
}

export interface BackupInfo {
    id: string;
    filePath: string;
    originalContent: string;
    modifiedContent: string;
    suggestionId: string;
    createdAt: string;
}

/**
 * Local file storage for suggestions and backups
 * Automatically creates ~/.ownkey/storage/ directory
 * Works as primary storage in local-only mode or cache when database is available
 */
export class LocalStorage {
    private storageDir: string;
    private suggestionsFile: string;
    private backupsDir: string;

    constructor() {
        // Automatically use user's home directory
        this.storageDir = join(homedir(), '.ownkey', 'storage');
        this.suggestionsFile = join(this.storageDir, 'suggestions.json');
        this.backupsDir = join(this.storageDir, 'backups');
    }

    /**
     * Initialize storage directories
     * Creates ~/.ownkey/storage/ if it doesn't exist
     */
    async init(): Promise<void> {
        try {
            // Create storage directory
            if (!existsSync(this.storageDir)) {
                await mkdir(this.storageDir, { recursive: true });
                logger.verbose(`Created storage directory: ${this.storageDir}`);
            }

            // Create backups directory
            if (!existsSync(this.backupsDir)) {
                await mkdir(this.backupsDir, { recursive: true });
                logger.verbose(`Created backups directory: ${this.backupsDir}`);
            }

            // Create suggestions file
            if (!existsSync(this.suggestionsFile)) {
                await writeFile(this.suggestionsFile, JSON.stringify([], null, 2));
                logger.verbose(`Created suggestions file: ${this.suggestionsFile}`);
            }
        } catch (error) {
            logger.error(`Failed to initialize storage: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Save suggestions to local file
     * Automatically cleans up old suggestions (7 days, max 100 per project)
     */
    async saveSuggestions(
        projectPath: string,
        projectName: string,
        suggestions: Suggestion[]
    ): Promise<StoredSuggestion[]> {
        await this.init();

        const timestamp = Date.now();
        const stored: StoredSuggestion[] = suggestions.map((s, index) => ({
            ...s,
            id: `local-${timestamp}-${index}`,
            projectPath,
            projectName,
            createdAt: new Date().toISOString(),
        }));

        // Read existing suggestions
        const existing = await this.loadAllSuggestions();

        // Filter: keep only recent suggestions (7 days) and limit per project (100)
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const filtered = existing.filter(
            s => new Date(s.createdAt).getTime() > sevenDaysAgo
        );

        // Group by project and limit to 100 per project
        const byProject = new Map<string, StoredSuggestion[]>();
        for (const s of filtered) {
            const list = byProject.get(s.projectPath) || [];
            list.push(s);
            byProject.set(s.projectPath, list);
        }

        // Keep only last 100 per project
        const limited: StoredSuggestion[] = [];
        for (const [, list] of byProject.entries()) {
            const sorted = list.sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
            limited.push(...sorted.slice(0, 100));
        }

        // Add new suggestions
        const updated = [...limited, ...stored];

        // Save to file
        await writeFile(this.suggestionsFile, JSON.stringify(updated, null, 2));

        logger.verbose(`Saved ${stored.length} suggestions locally`);
        return stored;
    }

    /**
     * Load a single suggestion by ID
     */
    async loadSuggestion(id: string): Promise<StoredSuggestion | null> {
        const all = await this.loadAllSuggestions();
        return all.find(s => s.id === id) || null;
    }

    /**
     * Merge fields into a stored suggestion (e.g. mark applied, link a database id)
     */
    async updateSuggestion(id: string, patch: Partial<StoredSuggestion>): Promise<StoredSuggestion | null> {
        const all = await this.loadAllSuggestions();
        const index = all.findIndex((s) => s.id === id);
        if (index === -1) return null;
        all[index] = { ...all[index], ...patch, id };
        await writeFile(this.suggestionsFile, JSON.stringify(all, null, 2));
        return all[index];
    }

    /**
     * After an undo: mark the suggestions applied with this backup as pending again
     */
    async clearApplied(backupId: string): Promise<void> {
        const all = await this.loadAllSuggestions();
        let changed = false;
        for (const s of all) {
            if (s.backupId === backupId) {
                delete s.appliedAt;
                delete s.backupId;
                changed = true;
            }
        }
        if (changed) await writeFile(this.suggestionsFile, JSON.stringify(all, null, 2));
    }

    /**
     * Load all suggestions for a specific project
     */
    async loadSuggestionsForProject(projectPath: string): Promise<StoredSuggestion[]> {
        const all = await this.loadAllSuggestions();
        return all.filter(s => s.projectPath === projectPath);
    }

    /**
     * Load all suggestions from local file
     */
    private async loadAllSuggestions(): Promise<StoredSuggestion[]> {
        try {
            await this.init();
            const content = await readFile(this.suggestionsFile, 'utf-8');
            return JSON.parse(content);
        } catch {
            return [];
        }
    }

    /**
     * Save a backup for undo functionality
     */
    async saveBackup(backup: Omit<BackupInfo, 'id' | 'createdAt'>): Promise<BackupInfo> {
        await this.init();

        const backupInfo: BackupInfo = {
            ...backup,
            id: `backup-${Date.now()}`,
            createdAt: new Date().toISOString(),
        };

        const backupFile = join(this.backupsDir, `${backupInfo.id}.json`);
        await writeFile(backupFile, JSON.stringify(backupInfo, null, 2));

        logger.verbose(`Saved backup: ${backupInfo.id}`);
        return backupInfo;
    }

    /**
     * Load a backup by ID
     */
    async loadBackup(id: string): Promise<BackupInfo | null> {
        try {
            const backupFile = join(this.backupsDir, `${id}.json`);
            if (!existsSync(backupFile)) {
                return null;
            }
            const content = await readFile(backupFile, 'utf-8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    /**
     * Clear all local suggestions
     */
    async clear(): Promise<void> {
        await this.init();
        await writeFile(this.suggestionsFile, JSON.stringify([], null, 2));
        logger.info('Cleared all local suggestions');
    }

    /**
     * Get storage statistics
     */
    async getStats(): Promise<{
        totalSuggestions: number;
        projectCount: number;
        oldestSuggestion: string | null;
        newestSuggestion: string | null;
    }> {
        const all = await this.loadAllSuggestions();
        const projects = new Set(all.map(s => s.projectPath));

        const dates = all.map(s => new Date(s.createdAt).getTime()).sort();

        return {
            totalSuggestions: all.length,
            projectCount: projects.size,
            oldestSuggestion: dates.length > 0 ? new Date(dates[0]).toISOString() : null,
            newestSuggestion: dates.length > 0 ? new Date(dates[dates.length - 1]).toISOString() : null,
        };
    }
}

// Singleton instance
export const localStorage = new LocalStorage();
