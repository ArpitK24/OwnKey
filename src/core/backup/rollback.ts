import { BackupManager } from './manager.js';
import { localStorage } from '../../storage/local.js';
import { dbClient } from '../../db/client.js';

/**
 * Restore a backup and mark its suggestions as not applied (locally and in the optional database).
 */
export async function rollbackBackup(backupId: string, backupManager: BackupManager = new BackupManager()): Promise<void> {
    await backupManager.restore(backupId);
    await localStorage.clearApplied(backupId).catch(() => undefined);
    const sql = dbClient.isConnected() ? dbClient.getClient() : null;
    if (sql) {
        await sql`UPDATE applies SET status = 'rolled_back' WHERE backup_id = ${backupId}`.catch(() => undefined);
    }
}
