import { Command } from 'commander';
import { BackupManager } from '../core/backup/index.js';
import { dbClient } from '../db/client.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { localStorage } from '../storage/local.js';

let assumeYes = false;

/** Confirm, honouring --yes and refusing to hang when there is no terminal. */
async function confirmOrYes(message: string): Promise<boolean> {
    if (assumeYes) return true;
    if (!process.stdin.isTTY) {
        throw new Error('No terminal to confirm in. Re-run with --yes.');
    }
    const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message, default: false }]);
    return confirm;
}

export const undoCommand = new Command('undo')
    .description('Undo a previously applied suggestion')
    .argument('[backup-id]', 'Backup ID to restore (optional)')
    .option('--list', 'List recent applies')
    .option('--all', 'Undo all applies from today')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(async (backupId, options) => {
        try {
            assumeYes = Boolean(options.yes);
            const backupManager = new BackupManager();

            // List mode
            if (options.list) {
                await listRecentApplies(backupManager);
                return;
            }

            // Undo all mode
            if (options.all) {
                await undoAllToday(backupManager);
                return;
            }

            // Undo specific backup
            if (backupId) {
                await undoBackup(backupManager, backupId);
                return;
            }

            // Interactive mode - show list and let user choose
            if (!process.stdin.isTTY) {
                await listRecentApplies(backupManager);
                return;
            }
            await interactiveUndo(backupManager);
        } catch (error) {
            logger.error(`Undo failed: ${(error as Error).message}`);
            process.exitCode = 1;
        }
    });

/**
 * List recent applies
 */
async function listRecentApplies(backupManager: BackupManager): Promise<void> {
    console.log(chalk.bold('\n📋 Recent Applies:\n'));

    const backups = await backupManager.listBackups();

    if (backups.length === 0) {
        console.log(chalk.gray('  No backups found.\n'));
        return;
    }

    for (const backup of backups.slice(0, 10)) {
        const timeAgo = getTimeAgo(backup.timestamp);
        console.log(
            `  ${chalk.cyan(backup.id)} - ${chalk.gray(timeAgo)} - ${backup.fileCount} file(s)`
        );
    }

    console.log(chalk.gray(`\n  Total: ${backups.length} backup(s)`));
    console.log(chalk.cyan('\n  To undo: ownkey undo <backup-id>\n'));
}

/**
 * Undo a specific backup
 */
async function undoBackup(backupManager: BackupManager, backupId: string): Promise<void> {
    logger.info(`Undoing backup: ${backupId}`);

    // Get backup metadata
    const metadata = await backupManager.getBackupMetadata(backupId);
    if (!metadata) {
        logger.error(`Backup not found: ${backupId}. See: ownkey undo --list`);
        process.exitCode = 1;
        return;
    }

    // Show what will be restored
    console.log(chalk.bold(`\n🔄 Restoring from backup: ${chalk.cyan(backupId)}\n`));
    console.log(`  Files to restore: ${chalk.yellow(metadata.files.length)}`);
    for (const file of metadata.files) {
        console.log(chalk.gray(`    - ${file}`));
    }
    for (const file of metadata.created || []) {
        console.log(chalk.gray(`    - ${file} (created by apply, will be removed)`));
    }

    // Confirm
    const confirm = await confirmOrYes('Restore these files?');

    if (!confirm) {
        console.log(chalk.yellow('\n  Undo cancelled.\n'));
        return;
    }

    // Restore
    await backupManager.restore(backupId);
    await localStorage.clearApplied(backupId).catch(() => undefined);

    // Update database if connected
    if (dbClient.isConnected()) {
        await markAsRolledBack(backupId);
    }

    logger.success('Files restored successfully!');
    console.log(chalk.green(`\n✓ Restored ${metadata.files.length + (metadata.created?.length ?? 0)} file(s) from backup\n`));
}

/**
 * Undo all applies from today
 */
async function undoAllToday(backupManager: BackupManager): Promise<void> {
    const backups = await backupManager.listBackups();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayBackups = backups.filter((b) => {
        const backupDate = new Date(b.timestamp);
        backupDate.setHours(0, 0, 0, 0);
        return backupDate.getTime() === today.getTime();
    });

    if (todayBackups.length === 0) {
        console.log(chalk.yellow('\n  No applies found from today.\n'));
        return;
    }

    console.log(chalk.bold(`\n🔄 Found ${todayBackups.length} apply(ies) from today:\n`));
    for (const backup of todayBackups) {
        console.log(`  ${chalk.cyan(backup.id)} - ${backup.fileCount} file(s)`);
    }

    const confirm = await confirmOrYes(`Undo all ${todayBackups.length} apply(ies)?`);

    if (!confirm) {
        console.log(chalk.yellow('\n  Undo cancelled.\n'));
        return;
    }

    // Restore in reverse order (newest first)
    for (const backup of todayBackups) {
        console.log(chalk.gray(`\n  Restoring ${backup.id}...`));
        await backupManager.restore(backup.id);
        await localStorage.clearApplied(backup.id).catch(() => undefined);

        if (dbClient.isConnected()) {
            await markAsRolledBack(backup.id);
        }
    }

    logger.success(`Restored ${todayBackups.length} backup(s)`);
}

/**
 * Interactive undo - let user choose from list
 */
async function interactiveUndo(backupManager: BackupManager): Promise<void> {
    const backups = await backupManager.listBackups();

    if (backups.length === 0) {
        console.log(chalk.yellow('\n  No backups found.\n'));
        return;
    }

    console.log(chalk.bold('\n📋 Select backup to restore:\n'));

    const choices = backups.slice(0, 10).map((backup) => ({
        name: `${backup.id} - ${getTimeAgo(backup.timestamp)} - ${backup.fileCount} file(s)`,
        value: backup.id,
    }));

    choices.push({ name: chalk.gray('Cancel'), value: 'cancel' });

    const { selected } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selected',
            message: 'Choose backup to restore:',
            choices,
        },
    ]);

    if (selected === 'cancel') {
        console.log(chalk.yellow('\n  Undo cancelled.\n'));
        return;
    }

    await undoBackup(backupManager, selected);
}

/**
 * Mark apply as rolled back in database
 */
async function markAsRolledBack(backupId: string): Promise<void> {
    const sql = dbClient.getClient();
    if (!sql) {
        return;
    }

    await sql`
        UPDATE applies
        SET status = 'rolled_back'
        WHERE backup_id = ${backupId}
    `;
}

/**
 * Get human-readable time ago
 */
function getTimeAgo(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
}
