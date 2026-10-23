import { Command } from 'commander';
import { resolve } from 'path';
import { ApplyEngine, ApplyEngineResult, InteractiveMode } from '../core/apply/index.js';
import { localStorage, StoredSuggestion } from '../storage/local.js';
import { meetsSeverity, parseSeverity } from '../utils/severity.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

export const applyCommand = new Command('apply')
    .description('Apply an AI-generated suggestion to your code')
    .argument('[suggestion-id]', 'Suggestion ID to apply (omit to list pending suggestions)')
    .option('--auto', 'Apply without confirmation')
    .option('--dry-run', 'Show what would change without applying')
    .option('--force', 'Apply the parts that match even if some hunks do not')
    .option('--no-backup', 'Skip creating backup (not recommended)')
    .option('--all', 'Apply all pending suggestions for the project')
    .option('--severity <level>', 'With --all: only suggestions at or above this severity (critical, high, medium, low, info)')
    .option('--project <path>', 'Project the suggestions were generated for', '.')
    .action(async (suggestionId: string | undefined, options) => {
        try {
            const engine = new ApplyEngine();
            const severity = parseSeverity(options.severity);
            const applyOptions = {
                dryRun: Boolean(options.dryRun),
                force: Boolean(options.force),
                createBackup: options.backup !== false,
                interactive: !options.auto && !options.dryRun,
            };

            if (applyOptions.dryRun) {
                console.log(chalk.bold.cyan('\n🔍 Dry run: no files will be changed\n'));
            }

            if (options.all || (!suggestionId && severity)) {
                const pending = (await pendingFor(options.project)).filter((s) => meetsSeverity(s.severity, severity));
                if (pending.length === 0) {
                    console.log(chalk.yellow('\n  No pending suggestions with code changes for this project.\n'));
                    return;
                }
                console.log(chalk.bold(`\nApplying ${pending.length} suggestion(s)...\n`));
                let applied = 0;
                let failed = 0;
                for (const s of pending) {
                    console.log(`${chalk.cyan(s.id)} ${chalk.bold(s.type)} (${s.severity}) ${chalk.gray(s.filePath)}`);
                    const result = await engine.applySuggestion(s.id, applyOptions);
                    report(result, applyOptions.dryRun, true);
                    if (result.success) applied++;
                    else if (!result.skipped) failed++;
                    if (result.quit) break;
                }
                console.log(chalk.bold(`\n${applyOptions.dryRun ? 'Would apply' : 'Applied'}: ${applied}, failed: ${failed}\n`));
                if (failed > 0) process.exitCode = 1;
                return;
            }

            if (!suggestionId) {
                await listPending(options.project);
                return;
            }

            const result = await engine.applySuggestion(suggestionId, applyOptions);
            report(result, applyOptions.dryRun, false);
            if (!result.success && !result.skipped) process.exitCode = 1;
        } catch (error) {
            logger.error('Apply failed', error as Error);
            process.exitCode = 1;
        }
    });

async function pendingFor(project: string): Promise<StoredSuggestion[]> {
    const suggestions = await localStorage.loadSuggestionsForProject(resolve(project));
    return suggestions.filter((s) => !s.appliedAt && s.diff && s.diff.trim());
}

async function listPending(project: string): Promise<void> {
    const pending = await pendingFor(project);
    if (pending.length === 0) {
        console.log(chalk.yellow('\n  No pending suggestions for this project.'));
        console.log(chalk.cyan('  Run "ownkey suggest ." to generate some.\n'));
        return;
    }
    console.log(chalk.bold('\n📋 Pending suggestions:\n'));
    for (const s of pending.slice(-20)) {
        console.log(`  ${chalk.cyan(s.id)}  ${chalk.bold(s.type)} (${s.severity})  ${chalk.gray(s.filePath)}`);
        console.log(chalk.gray(`      ${s.content}`));
    }
    console.log(chalk.cyan('\n  Apply one:  ownkey apply <id>'));
    console.log(chalk.cyan('  Apply all:  ownkey apply --all [--severity high]\n'));
}

function report(result: ApplyEngineResult, dryRun: boolean, compact: boolean): void {
    if (result.warnings?.length) InteractiveMode.showWarnings(result.warnings);
    if (result.skipped) {
        console.log(chalk.yellow(`  ${result.error ?? 'Skipped'}\n`));
        return;
    }
    if (!result.success) {
        InteractiveMode.showError(result.error || 'Unknown error');
        return;
    }
    if (dryRun) {
        console.log(chalk.green(`✓ Would modify ${result.filesModified.length} file(s): ${result.filesModified.join(', ')}\n`));
    } else if (compact) {
        console.log(chalk.green(`  ✓ ${result.filesModified.join(', ')}${result.backupId ? chalk.gray(`  (undo: ownkey undo ${result.backupId})`) : ''}\n`));
    } else {
        InteractiveMode.showSuccess(result.filesModified.length, result.backupId);
    }
}
