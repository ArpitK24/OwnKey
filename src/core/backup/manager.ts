import { mkdir, copyFile, readdir, rm, readFile, writeFile } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

export interface BackupMetadata {
    id: string;
    timestamp: Date;
    files: string[];
    reason: string;
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
    async createBackup(files: string[], reason: string = 'apply'): Promise<string> {
        const backupId = this.generateBackupId();
        const backupPath = join(this.backupDir, backupId);

        // Create backup directory
        await mkdir(backupPath, { recursive: true });

        // Copy each file
        const copiedFiles: string[] = [];
        for (const file of files) {
            const relativePath = relative(process.cwd(), file);
            const targetPath = join(backupPath, relativePath);

            // Create parent directories
            await mkdir(dirname(targetPath), { recursive: true });

            // Copy file
            await copyFile(file, targetPath);
            copiedFiles.push(relativePath);
        }

        // Save metadata
        const metadata: BackupMetadata = {
            id: backupId,
            timestamp: new Date(),
            files: copiedFiles,
            reason,
        };

        await writeFile(
            join(backupPath, 'metadata.json'),
            JSON.stringify(metadata, null, 2),
            'utf-8'
        );

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
                    fileCount: metadata.files.length,
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
        const filesToRestore = files || metadata.files;

        for (const file of filesToRestore) {
            const sourcePath = join(backupPath, file);
            const targetPath = join(process.cwd(), file);

            if (existsSync(sourcePath)) {
                // Create parent directories
                await mkdir(dirname(targetPath), { recursive: true });

                // Restore file
                await copyFile(sourcePath, targetPath);
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
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
        return timestamp;
    }

    /**
     * Get backup directory path
     */
    getBackupDir(): string {
        return this.backupDir;
    }
}
