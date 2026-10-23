import { Command } from 'commander';
import inquirer from 'inquirer';
import { configManager } from '../config/manager.js';
import { keychainManager } from '../config/keychain.js';
import { logger } from '../utils/logger.js';
import { AIProvider, AI_PROVIDERS, Config } from '../types/index.js';
import { OllamaProvider } from '../ai/ollama.js';
import { AIProviderFactory } from '../ai/factory.js';
import chalk from 'chalk';

const PROVIDER_NAMES: Record<AIProvider, string> = {
    openai: 'OpenAI (or any OpenAI-compatible API)',
    anthropic: 'Anthropic (Claude)',
    gemini: 'Google Gemini',
    ollama: 'Ollama (local, offline, no key)',
};

export const configCommand = new Command('config')
    .description('Configure OwnKey (AI provider, optional database)')
    .option('--show', 'Show the current configuration')
    .option('--provider <provider>', `AI provider (${AI_PROVIDERS.join(', ')})`)
    .option('--api-key <key>', 'API key for the provider (not needed for ollama)')
    .option('--model <model>', 'Model name to use (any model your key can access)')
    .option('--endpoint <url>', 'Base URL: Ollama server, or an OpenAI-compatible API for --provider openai')
    .option('--database-url <url>', 'Optional Postgres connection string (Supabase → Connect) for history')
    .option('--supabase-url <url>', 'Alias of --database-url (must be the postgresql:// connection string)')
    .option('--supabase-key <key>', 'Deprecated, no longer needed (the connection string holds the password)')
    .option('--no-database', 'Remove the database and use local storage only')
    .option('--reset', 'Reset configuration to defaults')
    .option('-y, --yes', 'Skip confirmation prompts')
    .action(async (options) => {
        try {
            if (options.reset) {
                await handleReset(Boolean(options.yes));
                return;
            }

            const hasFlags =
                options.show ||
                options.provider ||
                options.apiKey ||
                options.model ||
                options.endpoint ||
                options.databaseUrl ||
                options.supabaseUrl ||
                options.supabaseKey ||
                options.database === false;

            if (hasFlags) {
                await handleFlagBasedConfig(options);
                return;
            }

            if (!process.stdin.isTTY || !process.stdout.isTTY) {
                console.log(chalk.yellow('\nThe setup wizard needs an interactive terminal. Use flags instead:\n'));
                printFlagHelp();
                await showConfig();
                process.exitCode = 1;
                return;
            }

            await runInteractiveWizard();
        } catch (error) {
            const message = (error as Error).message;
            if ((error as Error).name === 'ExitPromptError') {
                console.log(chalk.yellow('\nSetup cancelled.\n'));
                return;
            }
            logger.error(`Configuration failed: ${message}`);
            process.exitCode = 1;
        }
    });

function printFlagHelp(): void {
    console.log(chalk.cyan('  ownkey config --provider openai --api-key <key> [--model <model>]'));
    console.log(chalk.cyan('  ownkey config --provider anthropic --api-key <key>'));
    console.log(chalk.cyan('  ownkey config --provider gemini --api-key <key>'));
    console.log(chalk.cyan('  ownkey config --provider ollama [--model qwen2.5-coder] [--endpoint http://localhost:11434]'));
    console.log(chalk.cyan('  ownkey config --database-url "postgresql://..."   (optional history in Supabase/Postgres)'));
    console.log(chalk.cyan('  ownkey config --show\n'));
}

function fail(message: string): never {
    throw new Error(message);
}

function isPostgresUrl(url: string): boolean {
    return /^postgres(ql)?:\/\//i.test(url);
}

async function handleReset(skipConfirm: boolean): Promise<void> {
    if (!skipConfirm) {
        if (!process.stdin.isTTY) fail('Add --yes to reset without a prompt');
        const { confirm } = await inquirer.prompt([
            { type: 'confirm', name: 'confirm', message: 'Reset configuration to defaults?', default: false },
        ]);
        if (!confirm) return;
    }
    await configManager.reset();
    for (const p of AI_PROVIDERS) await keychainManager.deleteApiKey(p).catch(() => undefined);
    logger.success('Configuration and stored API keys reset');
}

async function handleFlagBasedConfig(options: any): Promise<void> {
    let changed = false;

    // ---- Database (optional)
    const dbUrl: string | undefined = options.databaseUrl ?? options.supabaseUrl;
    if (options.database === false) {
        await configManager.clearDatabase();
        logger.success('Database removed. OwnKey will use local storage only.');
        changed = true;
    } else if (dbUrl) {
        if (!isPostgresUrl(dbUrl)) {
            fail(
                'The database needs your Postgres connection string, e.g.\n' +
                    '  postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres\n' +
                    '  (Supabase dashboard → Connect → Session pooler). The https://<ref>.supabase.co URL cannot be used.'
            );
        }
        await configManager.setDatabaseUrl(dbUrl);
        logger.success('Database configured. Tables are created automatically on the next command.');
        if (options.supabaseKey) {
            logger.info('--supabase-key is no longer needed and was ignored.');
        }
        changed = true;
    } else if (options.supabaseKey) {
        fail('--supabase-key is no longer used. Pass your connection string with --database-url "postgresql://..."');
    }

    // ---- AI provider
    const config = await configManager.load();
    if (options.provider) {
        const provider = String(options.provider).toLowerCase() as AIProvider;
        if (!AI_PROVIDERS.includes(provider)) {
            fail(`Unknown provider "${options.provider}". Use one of: ${AI_PROVIDERS.join(', ')}`);
        }

        if (provider !== 'ollama' && !options.apiKey) {
            const existing = await configManager.getApiKey(provider);
            if (!existing) {
                fail(`--api-key is required for ${provider}. Example: ownkey config --provider ${provider} --api-key <key>`);
            }
        }
        if (options.endpoint && provider !== 'ollama' && provider !== 'openai') {
            fail('--endpoint works with --provider ollama or --provider openai (OpenAI-compatible APIs)');
        }

        await configManager.setProvider(provider, options.apiKey, options.model, options.endpoint);
        const model =
            (await configManager.load()).providers[provider]?.model || AIProviderFactory.getRecommendedModel(provider);
        logger.success(`Provider set to ${provider} (model: ${model})`);

        if (provider === 'ollama') {
            const endpoint = options.endpoint || config.providers.ollama?.endpoint || 'http://localhost:11434';
            if (!(await OllamaProvider.isOllamaRunning(endpoint))) {
                logger.warn(`Ollama is not reachable at ${endpoint}. Start it with: ollama serve`);
            } else if (!(await OllamaProvider.isModelInstalled(model, endpoint))) {
                logger.warn(`Model "${model}" is not installed. Run: ollama pull ${model}`);
            }
        }
        changed = true;
    } else if (options.apiKey || options.model || options.endpoint) {
        // Update the active provider in place
        const provider = config.activeProvider;
        if (!provider) {
            fail('No provider selected yet. Add --provider <name> (' + AI_PROVIDERS.join(', ') + ')');
        }
        if (options.endpoint && provider !== 'ollama' && provider !== 'openai') {
            fail('--endpoint works with the ollama or openai provider');
        }
        await configManager.setProvider(provider, options.apiKey, options.model, options.endpoint);
        logger.success(`Updated ${provider} settings`);
        changed = true;
    }

    if (options.show || !changed) {
        await showConfig();
    }
}

async function showConfig(): Promise<void> {
    const exists = await configManager.exists();
    const config: Config = await configManager.load();
    console.log(chalk.bold('\nOwnKey configuration\n'));
    if (!exists) {
        console.log(chalk.gray('  Not configured yet.\n'));
        return;
    }
    const provider = config.activeProvider;
    console.log(`  Provider:  ${provider ? chalk.cyan(provider) : chalk.yellow('not set')}`);
    if (provider) {
        const p = config.providers[provider] as { model?: string; endpoint?: string } | undefined;
        console.log(`  Model:     ${p?.model || AIProviderFactory.getRecommendedModel(provider)}`);
        if (p?.endpoint) console.log(`  Endpoint:  ${p.endpoint}`);
        if (provider !== 'ollama') {
            const key = await configManager.getApiKey(provider);
            console.log(`  API key:   ${key ? chalk.green('stored') + chalk.gray(` (…${key.slice(-4)})`) : chalk.red('missing')}`);
        }
    }
    const dbUrl = configManager.getDatabaseUrl(config);
    console.log(
        `  Database:  ${dbUrl ? chalk.green('configured') + chalk.gray(` (${redact(dbUrl)})`) : chalk.gray('none (local storage)')}`
    );
    console.log();
}

function redact(url: string): string {
    try {
        const u = new URL(url);
        if (u.password) u.password = '****';
        return u.toString();
    } catch {
        return 'postgresql://****';
    }
}

async function runInteractiveWizard(): Promise<void> {
    console.log(chalk.cyan('\n🔧 OwnKey setup\n'));

    // Step 1: AI provider (required)
    console.log(chalk.bold('Step 1: AI provider'));
    const { provider } = await inquirer.prompt<{ provider: AIProvider }>([
        {
            type: 'list',
            name: 'provider',
            message: 'Choose AI provider:',
            choices: AI_PROVIDERS.map((p) => ({ name: PROVIDER_NAMES[p], value: p })),
        },
    ]);

    let apiKey: string | undefined;
    let endpoint: string | undefined;
    let model: string | undefined;

    if (provider === 'ollama') {
        ({ endpoint } = await inquirer.prompt([
            { type: 'input', name: 'endpoint', message: 'Ollama URL:', default: 'http://localhost:11434' },
        ]));
        const installed = await OllamaProvider.getAvailableModels(endpoint);
        if (installed.length > 0) {
            ({ model } = await inquirer.prompt([
                { type: 'list', name: 'model', message: 'Model:', choices: installed },
            ]));
        } else {
            logger.warn(`No models found at ${endpoint}. Is Ollama running? (ollama serve)`);
            ({ model } = await inquirer.prompt([
                { type: 'input', name: 'model', message: 'Model name:', default: 'qwen2.5-coder' },
            ]));
        }
    } else {
        ({ apiKey } = await inquirer.prompt([
            {
                type: 'password',
                name: 'apiKey',
                mask: '*',
                message: `${PROVIDER_NAMES[provider]} API key:`,
                validate: (input: string) => (input ? true : 'API key is required'),
            },
        ]));
        if (provider === 'openai') {
            ({ endpoint } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'endpoint',
                    message: 'Base URL (leave empty for api.openai.com, or any OpenAI-compatible API):',
                },
            ]));
            endpoint = endpoint?.trim() || undefined;
        }
        ({ model } = await inquirer.prompt([
            {
                type: 'input',
                name: 'model',
                message: 'Model (any model your key can access):',
                default: AIProviderFactory.getRecommendedModel(provider),
            },
        ]));
    }

    await configManager.setProvider(provider, apiKey, model, endpoint);
    logger.success(`${provider} configured (model: ${model})`);

    // Step 2: optional database
    console.log(chalk.bold('\nStep 2: Database (optional)'));
    console.log(chalk.gray('OwnKey works fully on its own with local storage.'));
    console.log(chalk.gray('Add a Supabase/Postgres database only if you want history stored there.\n'));

    const { configureDb } = await inquirer.prompt([
        { type: 'confirm', name: 'configureDb', message: 'Connect a database?', default: false },
    ]);

    if (configureDb) {
        const { url } = await inquirer.prompt([
            {
                type: 'password',
                name: 'url',
                mask: '*',
                message: 'Postgres connection string (Supabase → Connect → Session pooler):',
                validate: (input: string) =>
                    isPostgresUrl(input) ? true : 'Paste the postgresql://... connection string, not the https:// project URL',
            },
        ]);
        await configManager.setDatabaseUrl(url);
        logger.success('Database configured. Tables are created automatically on first use.');
    }

    console.log(chalk.bold.green('\n✓ Setup complete\n'));
    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.gray('  1. ownkey scan .       Scan your project'));
    console.log(chalk.gray('  2. ownkey suggest .    Get AI suggestions'));
    console.log(chalk.gray('  3. ownkey apply <id>   Apply one (ownkey undo to revert)\n'));
}
