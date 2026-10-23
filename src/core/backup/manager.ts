import { mkdir, copyFile, readdir, rm, readFile, writeFile } from 'fs/promises';
import { join, dirname, relative, resolve } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

export interface BackupMetadata {
    id: string;
    timestamp: Date;
    /** Paths relative to `root` that existed and were copied */
    files: string[];
    reason: string;
    /** Project root the paths are relative to (older backups: the cwd at restore time) */
    root?: string;
    /** Paths relative to `root` that did not exist before the apply; undo deletes them */
    created?: string[];
}

export interface BackupInfo {
    id: string;
    timestamp: Date;
    fileCount: number;
    reason: string;
}

export class BackupManager {
    private backupDir: string;

    constructor(backupDir?: string) {
        this.backupDir = backupDir || join(homedir(), '.ownkey', 'backups');
    }

    /**
     * Create a backup of files before applying changes
     */
    async createBackup(
        files: string[],
        reason: string = 'apply',
        root: string = process.cwd()
    ): Promise<string> {
        const backupId = this.generateBackupId();
        const backupPath = join(this.backupDir, backupId);
        await mkdir(backupPath, { recursive: true });

        const copiedFiles: string[] = [];
        const createdFiles: string[] = [];
        for (const file of files) {
            const relativePath = relative(root, resolve(root, file));
            if (!existsSync(file)) {
                // New file: nothing to copy, remember it so undo can remove it
                createdFiles.push(relativePath);
                continue;
            }
            const targetPath = join(backupPath, 'files', relativePath);
            await mkdir(dirname(targetPath), { recursive: true });
            await copyFile(file, targetPath);
            copiedFiles.push(relativePath);
        }

        const metadata: BackupMetadata = {
            id: backupId,
            timestamp: new Date(),
            files: copiedFiles,
            created: createdFiles,
            reason,
            root,
        };
        await writeFile(join(backupPath, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

        return backupId;
    }

    /**
     * List all available backups
     */
    async listBackups(): Promise<BackupInfo[]> {
        if (!existsSync(this.backupDir)) {
            return [];
        }

        const entries = await readdir(this.backupDir);
        const backups: BackupInfo[] = [];

        for (const entry of entries) {
            const metadataPath = join(this.backupDir, entry, 'metadata.json');
            if (existsSync(metadataPath)) {
                const metadata = JSON.parse(await readFile(metadataPath, 'utf-8')) as BackupMetadata;
                backups.push({
                    id: metadata.id,
                    timestamp: new Date(metadata.timestamp),
                    fileCount: metadata.files.length + (metadata.created?.length ?? 0),
                    reason: metadata.reason,
                });
            }
        }

        // Sort by timestamp (newest first)
        return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    /**
     * Get backup metadata
     */
    async getBackupMetadata(backupId: string): Promise<BackupMetadata | null> {
        const metadataPath = join(this.backupDir, backupId, 'metadata.json');
        if (!existsSync(metadataPath)) {
            return null;
        }

        const metadata = JSON.parse(await readFile(metadataPath, 'utf-8')) as BackupMetadata;
        return metadata;
    }

    /**
     * Restore files from a backup
     */
    async restore(backupId: string, files?: string[]): Promise<void> {
        const metadata = await this.getBackupMetadata(backupId);
        if (!metadata) {
            throw new Error(`Backup not found: ${backupId}`);
        }

        const backupPath = join(this.backupDir, backupId);
        const root = metadata.root || process.cwd();
        // v1.0.0 backups stored files at the top level; v1.0.1+ under files/
        const storeDir = existsSync(join(backupPath, 'files')) ? join(backupPath, 'files') : backupPath;

        for (const file of files || metadata.files) {
            const sourcePath = join(storeDir, file);
            const targetPath = join(root, file);
            if (existsSync(sourcePath)) {
                await mkdir(dirname(targetPath), { recursive: true });
                await copyFile(sourcePath, targetPath);
            }
        }

        if (!files) {
            for (const file of metadata.created || []) {
                await rm(join(root, file), { force: true });
            }
        }
    }

    /**
     * Delete a backup
     */
    async deleteBackup(backupId: string): Promise<void> {
        const backupPath = join(this.backupDir, backupId);
        if (existsSync(backupPath)) {
            await rm(backupPath, { recursive: true, force: true });
        }
    }

    /**
     * Clean old backups (keep last N)
     */
    async cleanOldBackups(keep: number = 10): Promise<number> {
        const backups = await this.listBackups();

        if (backups.length <= keep) {
            return 0;
        }

        const toDelete = backups.slice(keep);
        for (const backup of toDelete) {
            await this.deleteBackup(backup.id);
        }

        return toDelete.length;
    }

    /**
     * Generate a unique backup ID
     */
    private generateBackupId(): string {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -1);
        return existsSync(join(this.backupDir, timestamp)) ? `${timestamp}-${Math.random().toString(36).slice(2, 6)}` : timestamp;
    }

    /**
     * Get backup directory path
     */
    getBackupDir(): string {
        return this.backupDir;
    }
}
