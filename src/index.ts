#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from './utils/logger.js';
import { configManager } from './config/manager.js';
import { dbClient } from './db/client.js';
import chalk from 'chalk';

// Import commands
import { configCommand } from './commands/config.js';
import { scanCommand } from './commands/scan.js';
import { suggestCommand } from './commands/suggest.js';
import { applyCommand } from './commands/apply.js';
import { undoCommand } from './commands/undo.js';

const program = new Command();

program
    .name('ownkey')
    .description('Local-first AI coding agent for intelligent codebase analysis')
    .version('0.7.0');

// Global options
program.option('--local-only', 'Run without database persistence');
program.option('--verbose', 'Enable verbose logging');
program.option('--debug', 'Enable debug logging');
program.option('--quiet', 'Suppress non-essential output');

// Commands
program.addCommand(configCommand);
program.addCommand(scanCommand);
program.addCommand(suggestCommand);
program.addCommand(applyCommand);
program.addCommand(undoCommand);

// Pre-parse hook to set up logging and check config
program.hook('preAction', async (thisCommand) => {
    await logger.init();

    const opts = thisCommand.opts();

    // Set log level
    if (opts.debug) {
        logger.setLevel('debug');
    } else if (opts.verbose) {
        logger.setLevel('verbose');
    } else if (opts.quiet) {
        logger.setLevel('quiet');
    }

    // Check if this is the config command
    const isConfigCommand = thisCommand.name() === 'config';

    // For non-config commands, check if config exists
    if (!isConfigCommand) {
        const configExists = await configManager.exists();

        if (!configExists) {
            console.log(chalk.yellow('\n⚠️  No configuration found.\n'));
            console.log('OwnKey needs to be configured before use.');
            console.log(chalk.cyan('\nRun: ownkey config\n'));
            process.exit(1);
        }

        // Connect to database (or enter local-only mode)
        await dbClient.connect(opts.localOnly);
    }
});

// Post-action hook to clean up
program.hook('postAction', async () => {
    await dbClient.disconnect();
});

// Parse arguments
program.parse();
