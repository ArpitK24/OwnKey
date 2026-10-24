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
import { reviewCommand } from './commands/review.js';
import { benchCommand } from './commands/bench.js';

const program = new Command();

program
    .name('ownkey')
    .description('Local-first AI code reviewer that runs on your own keys')
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
program.addCommand(reviewCommand);
program.addCommand(applyCommand);
program.addCommand(undoCommand);
program.addCommand(benchCommand);

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

// A bare `ownkey` at a terminal opens the interactive session, where commands are typed
// without the prefix. Scripts, CI, pipes and every subcommand behave exactly as before.
const interactive = process.argv.length <= 2 && !process.env.OWNKEY_NO_UI && !process.env.CI && process.stdin.isTTY && process.stdout.isTTY;

if (interactive) {
    const { startSession } = await import('./ui/session.js');
    const commands = program.commands.map((c) => ({
        name: c.name(),
        description: c.description(),
        options: c.options.map((o) => ({ flags: o.flags, description: o.description })),
    }));
    await startSession(commands, program.version() ?? '');
} else {
    await program.parseAsync();
}
