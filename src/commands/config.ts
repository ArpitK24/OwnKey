import { Command } from 'commander';
import inquirer from 'inquirer';
import { configManager } from '../config/manager.js';
import { logger } from '../utils/logger.js';
import { AIProvider } from '../types/index.js';
import chalk from 'chalk';

export const configCommand = new Command('config')
    .description('Configure OwnKey CLI (Supabase, AI providers)')
    .option('--supabase-url <url>', 'Supabase project URL')
    .option('--supabase-key <key>', 'Supabase service role key')
    .option('--provider <provider>', 'AI provider (openai, anthropic, ollama)')
    .option('--api-key <key>', 'API key for the provider')
    .option('--model <model>', 'Model name to use')
    .option('--reset', 'Reset configuration to defaults')
    .action(async (options) => {
        try {
            // Handle reset
            if (options.reset) {
                const { confirm } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'confirm',
                        message: 'Are you sure you want to reset configuration?',
                        default: false,
                    },
                ]);

                if (confirm) {
                    await configManager.reset();
                    logger.success('Configuration reset successfully');
                }
                return;
            }

            // If flags provided, use them
            if (options.supabaseUrl || options.provider) {
                await handleFlagBasedConfig(options);
                return;
            }

            // Otherwise, run interactive wizard
            await runInteractiveWizard();
        } catch (error) {
            logger.error('Configuration failed', error as Error);
            process.exit(1);
        }
    });

async function handleFlagBasedConfig(options: any): Promise<void> {
    // Configure Supabase
    if (options.supabaseUrl && options.supabaseKey) {
        await configManager.setSupabase(options.supabaseUrl, options.supabaseKey);
        logger.success('Supabase configured');
    }

    // Configure AI provider
    if (options.provider && options.apiKey) {
        const provider = options.provider as AIProvider;
        await configManager.setProvider(provider, options.apiKey, options.model);
        logger.success(`${provider} provider configured`);
    }
}

async function runInteractiveWizard(): Promise<void> {
    console.log(chalk.cyan('\n🔧 OwnKey Configuration Wizard\n'));

    // Step 1: Supabase configuration
    console.log(chalk.bold('Step 1: Supabase Database (Optional)'));
    console.log(chalk.gray('Supabase stores your analysis history and suggestions.'));
    console.log(chalk.gray('You can skip this and run in local-only mode.\n'));

    const { configureSupabase } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'configureSupabase',
            message: 'Configure Supabase database?',
            default: true,
        },
    ]);

    if (configureSupabase) {
        const supabaseAnswers = await inquirer.prompt([
            {
                type: 'input',
                name: 'url',
                message: 'Supabase URL:',
                validate: (input) => {
                    if (!input) return 'URL is required';
                    if (!input.startsWith('postgresql://')) {
                        return 'URL should start with postgresql://';
                    }
                    return true;
                },
            },
            {
                type: 'password',
                name: 'key',
                message: 'Supabase Service Role Key:',
                validate: (input) => (input ? true : 'Service role key is required'),
            },
        ]);

        await configManager.setSupabase(supabaseAnswers.url, supabaseAnswers.key);
        logger.success('Supabase configured');
    } else {
        logger.info('Skipping Supabase. You can configure it later.');
    }

    // Step 2: AI Provider configuration
    console.log(chalk.bold('\nStep 2: AI Provider'));
    console.log(chalk.gray('Choose your AI provider for code analysis.\n'));

    const { provider } = await inquirer.prompt([
        {
            type: 'list',
            name: 'provider',
            message: 'Choose AI provider:',
            choices: [
                { name: 'OpenAI (GPT-4)', value: 'openai' },
                { name: 'Anthropic (Claude)', value: 'anthropic' },
                { name: 'Ollama (Local)', value: 'ollama' },
            ],
        },
    ]);

    // Get API key (not needed for Ollama)
    if (provider !== 'ollama') {
        const { apiKey } = await inquirer.prompt([
            {
                type: 'password',
                name: 'apiKey',
                message: `${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API Key:`,
                validate: (input) => (input ? true : 'API key is required'),
            },
        ]);

        await configManager.setProvider(provider, apiKey);
    } else {
        // For Ollama, just set it as active provider
        const config = await configManager.load();
        config.activeProvider = 'ollama';
        await configManager.save(config);
        logger.success('Ollama configured (using local endpoint)');
    }

    // Step 3: Test connection (optional)
    console.log(chalk.bold('\n✓ Configuration Complete!\n'));
    console.log(chalk.green('You can now use OwnKey to analyze your codebase.\n'));
    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.gray('  1. ownkey scan <path>    - Scan your project'));
    console.log(chalk.gray('  2. ownkey suggest <path> - Get AI suggestions'));
    console.log(chalk.gray('  3. ownkey apply <id>     - Apply a suggestion\n'));
}
