import inquirer from 'inquirer';
import chalk from 'chalk';
import { ParsedDiff } from '../diff/index.js';

export interface InteractiveOptions {
    showFullDiff?: boolean;
    allowPartial?: boolean;
}

export interface InteractiveResult {
    confirmed: boolean;
    selectedHunks?: number[];
    skipAll?: boolean;
}

export class InteractiveMode {
    /**
     * Show diff preview and ask for confirmation
     */
    static async confirmApply(
        diff: ParsedDiff,
        options: InteractiveOptions = {}
    ): Promise<InteractiveResult> {
        const { showFullDiff = false, allowPartial = false } = options;

        // Show diff preview
        console.log(chalk.bold(`\n📝 Changes to ${chalk.cyan(diff.filePath)}:\n`));

        if (showFullDiff) {
            this.showFullDiff(diff);
        } else {
            this.showSummary(diff);
        }

        // Ask for confirmation
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Apply this change?',
                choices: [
                    { name: 'Yes - Apply this change', value: 'yes' },
                    { name: 'No - Skip this change', value: 'no' },
                    { name: 'View full diff', value: 'diff' },
                    ...(allowPartial ? [{ name: 'Select hunks to apply', value: 'partial' }] : []),
                    { name: 'Quit - Cancel all changes', value: 'quit' },
                ],
            },
        ]);

        switch (action) {
            case 'yes':
                return { confirmed: true };

            case 'no':
                return { confirmed: false };

            case 'diff':
                this.showFullDiff(diff);
                return this.confirmApply(diff, options);

            case 'partial':
                const selectedHunks = await this.selectHunks(diff);
                return { confirmed: true, selectedHunks };

            case 'quit':
                return { confirmed: false, skipAll: true };

            default:
                return { confirmed: false };
        }
    }

    /**
     * Show summary of changes
     */
    private static showSummary(diff: ParsedDiff): void {
        let additions = 0;
        let deletions = 0;

        for (const hunk of diff.hunks) {
            for (const change of hunk.changes) {
                if (change.type === 'add') additions++;
                if (change.type === 'remove') deletions++;
            }
        }

        console.log(`  ${chalk.green(`+${additions}`)} additions, ${chalk.red(`-${deletions}`)} deletions`);
        console.log(`  ${diff.hunks.length} hunk(s)\n`);

        // Show first few lines of first hunk
        if (diff.hunks.length > 0) {
            const firstHunk = diff.hunks[0];
            const preview = firstHunk.changes.slice(0, 5);

            console.log(chalk.gray('  Preview:'));
            for (const change of preview) {
                this.printChange(change, '  ');
            }

            if (firstHunk.changes.length > 5) {
                console.log(chalk.gray(`  ... and ${firstHunk.changes.length - 5} more lines`));
            }
            console.log();
        }
    }

    /**
     * Show full diff with syntax highlighting
     */
    private static showFullDiff(diff: ParsedDiff): void {
        console.log(chalk.bold(`\n--- a/${diff.oldPath || diff.filePath}`));
        console.log(chalk.bold(`+++ b/${diff.newPath || diff.filePath}\n`));

        for (const hunk of diff.hunks) {
            console.log(
                chalk.cyan(
                    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
                )
            );

            for (const change of hunk.changes) {
                this.printChange(change);
            }
            console.log();
        }
    }

    /**
     * Print a single change line with color
     */
    private static printChange(change: { type: string; content: string }, indent: string = ''): void {
        const line = `${indent}${change.content}`;

        switch (change.type) {
            case 'add':
                console.log(chalk.green(`+${line}`));
                break;
            case 'remove':
                console.log(chalk.red(`-${line}`));
                break;
            case 'context':
                console.log(chalk.gray(` ${line}`));
                break;
        }
    }

    /**
     * Let user select which hunks to apply
     */
    private static async selectHunks(diff: ParsedDiff): Promise<number[]> {
        console.log(chalk.bold('\n📋 Select hunks to apply:\n'));

        const choices = diff.hunks.map((hunk, index) => {
            let additions = 0;
            let deletions = 0;

            for (const change of hunk.changes) {
                if (change.type === 'add') additions++;
                if (change.type === 'remove') deletions++;
            }

            return {
                name: `Hunk ${index + 1}: Lines ${hunk.oldStart}-${hunk.oldStart + hunk.oldLines} (${chalk.green(`+${additions}`)} ${chalk.red(`-${deletions}`)})`,
                value: index,
                checked: true,
            };
        });

        const { selected } = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'selected',
                message: 'Select hunks to apply:',
                choices,
            },
        ]);

        return selected;
    }

    /**
     * Show progress for multiple files
     */
    static showProgress(current: number, total: number, fileName: string): void {
        const percentage = Math.round((current / total) * 100);
        const bar = this.createProgressBar(percentage, 30);

        console.log(
            `\n${chalk.cyan(`[${current}/${total}]`)} ${bar} ${percentage}% - ${chalk.gray(fileName)}`
        );
    }

    /**
     * Create a progress bar
     */
    private static createProgressBar(percentage: number, width: number): string {
        const filled = Math.round((percentage / 100) * width);
        const empty = width - filled;

        return (
            chalk.green('█'.repeat(filled)) +
            chalk.gray('░'.repeat(empty))
        );
    }

    /**
     * Show success message
     */
    static showSuccess(filesModified: number, backupId?: string): void {
        console.log(chalk.bold.green('\n✨ Changes applied successfully!\n'));
        console.log(`  Files modified: ${chalk.cyan(filesModified)}`);

        if (backupId) {
            console.log(`  Backup created: ${chalk.gray(backupId)}`);
            console.log(chalk.yellow(`\n  To undo: ${chalk.cyan(`ownkey undo ${backupId}`)}\n`));
        }
    }

    /**
     * Show error message
     */
    static showError(error: string): void {
        console.log(chalk.bold.red('\n❌ Apply failed!\n'));
        console.log(chalk.red(`  Error: ${error}\n`));
    }

    /**
     * Show warning message
     */
    static showWarnings(warnings: string[]): void {
        if (warnings.length === 0) return;

        console.log(chalk.bold.yellow('\n⚠️  Warnings:\n'));
        for (const warning of warnings) {
            console.log(chalk.yellow(`  • ${warning}`));
        }
        console.log();
    }
}
