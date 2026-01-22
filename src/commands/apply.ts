import { Command } from 'commander';
import { ApplyEngine, InteractiveMode } from '../core/apply/index.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

export const applyCommand = new Command('apply')
    .description('Apply an AI-generated suggestion to your code')
    .argument('[suggestion-id]', 'Suggestion ID to apply')
    .option('--auto', 'Apply without confirmation')
    .option('--dry-run', 'Show what would change without applying')
    .option('--force', 'Apply even if validation fails')
    .option('--no-backup', 'Skip creating backup (not recommended)')
    .option('--all', 'Apply all pending suggestions')
    .option('--severity <level>', 'Apply only suggestions of this severity (critical, high, medium, low)')
    .action(async (suggestionId, options) => {
        try {
            const engine = new ApplyEngine();

            // Apply all mode
            if (options.all) {
                logger.error('--all mode not yet implemented');
                process.exit(1);
            }

            // Need suggestion ID
            if (!suggestionId) {
                logger.error('Suggestion ID required. Usage: ownkey apply <suggestion-id>');
                console.log(chalk.cyan('\nTip: Run "ownkey suggest ." first to generate suggestions\n'));
                process.exit(1);
            }

            // Apply single suggestion
            await applySuggestion(engine, suggestionId, options);
        } catch (error) {
            logger.error('Apply failed', error as Error);
            process.exit(1);
        }
    });

/**
 * Apply a single suggestion
 */
async function applySuggestion(
    engine: ApplyEngine,
    suggestionId: string,
    options: any
): Promise<void> {
    const applyOptions = {
        dryRun: options.dryRun || false,
        force: options.force || false,
        createBackup: options.backup !== false,
        interactive: !options.auto,
    };

    // Dry run mode
    if (applyOptions.dryRun) {
        console.log(chalk.bold.cyan('\n🔍 Dry Run Mode - No changes will be made\n'));
    }

    // Apply
    const result = await engine.applySuggestion(suggestionId, applyOptions);

    // Show warnings
    if (result.warnings && result.warnings.length > 0) {
        InteractiveMode.showWarnings(result.warnings);
    }

    // Handle result
    if (result.success) {
        if (applyOptions.dryRun) {
            console.log(chalk.green('\n✓ Dry run completed successfully'));
            console.log(chalk.gray(`  ${result.filesModified.length} file(s) would be modified:\n`));
            for (const file of result.filesModified) {
                console.log(chalk.gray(`    - ${file}`));
            }
            console.log();
        } else {
            InteractiveMode.showSuccess(result.filesModified.length, result.backupId);
        }
    } else {
        InteractiveMode.showError(result.error || 'Unknown error');
        process.exit(1);
    }
}
