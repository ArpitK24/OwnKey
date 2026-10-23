#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from './utils/logger.js';
import { dbClient } from './db/client.js';
import { createRequire } from 'module';

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
    .version(createRequire(import.meta.url)('../package.json').version);

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

// Pre-action hook: set up logging and storage.
// Note: the hook is registered on the root program, so `thisCommand` is always the
// root. The command actually being run is the second argument (`actionCommand`).
program.hook('preAction', async (thisCommand, actionCommand) => {
    await logger.init();

    // Global flags live on the root program
    const opts = thisCommand.opts();

    if (opts.debug) {
        logger.setLevel('debug');
    } else if (opts.verbose) {
        logger.setLevel('verbose');
    } else if (opts.quiet) {
        logger.setLevel('quiet');
    }

    // `config` must always run, even with no configuration yet; it never needs the database.
    if (actionCommand.name() === 'config') {
        return;
    }

    // Optional database (Supabase/Postgres). Silent no-op when not configured.
    await dbClient.connect(Boolean(opts.localOnly));
});

// Post-action hook to clean up
program.hook('postAction', async () => {
    await dbClient.disconnect();
});

// Parse arguments
await program.parseAsync();
