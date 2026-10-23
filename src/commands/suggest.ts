import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import { FileScanner } from '../core/scanner.js';
import { AIProviderFactory } from '../ai/factory.js';
import { dbClient } from '../db/client.js';
import { CodeContext } from '../types/index.js';
import chalk from 'chalk';
import { persistSuggestions } from '../core/persist.js';
import { configManager } from '../config/manager.js';
import { meetsSeverity, parseSeverity } from '../utils/severity.js';

export const suggestCommand = new Command('suggest')
    .description('Generate AI-powered suggestions for your code')
    .argument('[path]', 'Path to analyze', '.')
    .option('--type <type>', 'Filter by suggestion type (bug, security, performance, etc.)')
    .option('--severity <severity>', 'Minimum severity (critical, high, medium, low, info)')
    .option('--max-files <number>', 'Maximum number of files to analyze', '10')
    .action(async (path: string, options) => {
        try {
            const targetPath = resolve(path);
            const minSeverity = parseSeverity(options.severity);
            const typeFilter: string | undefined = options.type?.toLowerCase();

            const config = await configManager.load();
            if (!(await configManager.exists()) || !config.activeProvider) {
                console.log(chalk.yellow('\n⚠️  No AI provider configured.\n'));
                console.log('Set one up with:');
                console.log(chalk.cyan('  ownkey config                                   (interactive)'));
                console.log(chalk.cyan('  ownkey config --provider openai --api-key <key>'));
                console.log(chalk.cyan('  ownkey config --provider ollama                 (local, no key)\n'));
                process.exit(1);
            }

            if (!existsSync(targetPath)) {
                logger.error(`Path does not exist: ${targetPath}`);
                process.exit(1);
            }

            logger.info(`Analyzing: ${chalk.cyan(targetPath)}`);

            // Step 1: Scan files
            console.log(chalk.bold('\n📂 Scanning files...\n'));
            const scanner = new FileScanner(targetPath);
            const scanResult = await scanner.scan();

            if (scanResult.files.length === 0) {
                logger.warn('No files found to analyze');
                process.exit(0);
            }

            // Limit files for analysis
            const maxFiles = parseInt(options.maxFiles) || 10;
            const filesToAnalyze = scanResult.files.slice(0, maxFiles);

            console.log(`  Found ${chalk.green(scanResult.files.length)} files`);
            console.log(`  Analyzing ${chalk.cyan(filesToAnalyze.length)} files\n`);

            // Step 2: Load file contents
            logger.verbose('Loading file contents...');
            const fileContents = await scanner.loadFileContents(filesToAnalyze);

            // Step 3: Build context
            const projectName = targetPath.split(/[/\\]/).pop() || 'unknown';
            const context: CodeContext = {
                files: fileContents,
                projectInfo: {
                    name: projectName,
                    rootPath: targetPath,
                    fileCount: filesToAnalyze.length,
                },
            };

            // Step 4: Create AI provider
            console.log(chalk.bold('🤖 Initializing AI provider...\n'));
            const provider = await AIProviderFactory.createProvider();

            // Test connection
            const connected = await AIProviderFactory.testProvider(provider);
            if (!connected) {
                logger.error('Failed to connect to AI provider');
                logger.info('Please check your API key and try again');
                process.exit(1);
            }

            // Step 5: Analyze with AI
            console.log(chalk.bold('🔍 Analyzing code...\n'));
            logger.info('This may take a minute...');

            const suggestions = [];
            let count = 0;

            for await (const suggestion of provider.analyze(context)) {
                if (typeFilter && suggestion.type !== typeFilter) continue;
                if (!meetsSeverity(suggestion.severity, minSeverity)) continue;
                count++;
                suggestions.push(suggestion);

                // Display suggestion
                const severityColor =
                    suggestion.severity === 'critical' || suggestion.severity === 'high'
                        ? chalk.red
                        : suggestion.severity === 'medium'
                            ? chalk.yellow
                            : chalk.blue;

                console.log(
                    `[${count}] ${chalk.bold(suggestion.type)} ${severityColor(`(${suggestion.severity})`)} in ${chalk.cyan(suggestion.filePath)}`
                );
                console.log(`    ${suggestion.content}`);
                console.log();
            }

            // Step 6: Store locally (and in the optional database)
            const localStored = await persistSuggestions(targetPath, projectName, suggestions, `suggest ${path}`);

            if (localStored.length > 0) {
                console.log(chalk.bold('\n🆔 Suggestion IDs\n'));
                localStored.forEach((s, i) => {
                    const applicable = s.diff && s.diff.trim() ? chalk.green('apply-ready') : chalk.gray('advice only');
                    console.log(`  [${i + 1}] ${chalk.cyan(s.id)}  ${applicable}`);
                });
            }

            // Summary
            console.log(chalk.bold('\n✨ Analysis Complete!\n'));
            console.log(`  Total suggestions: ${chalk.green(suggestions.length)}`);

            if (suggestions.length > 0) {
                const bySeverity = suggestions.reduce(
                    (acc, s) => {
                        acc[s.severity] = (acc[s.severity] || 0) + 1;
                        return acc;
                    },
                    {} as Record<string, number>
                );

                console.log('\n  By severity:');
                if (bySeverity.critical) console.log(`    Critical: ${chalk.red(bySeverity.critical)}`);
                if (bySeverity.high) console.log(`    High:     ${chalk.red(bySeverity.high)}`);
                if (bySeverity.medium) console.log(`    Medium:   ${chalk.yellow(bySeverity.medium)}`);
                if (bySeverity.low) console.log(`    Low:      ${chalk.blue(bySeverity.low)}`);
                if (bySeverity.info) console.log(`    Info:     ${chalk.gray(bySeverity.info)}`);
            }

            console.log();
            if (localStored.some((s) => s.diff && s.diff.trim())) {
                console.log(chalk.cyan('  Next: ownkey apply <id>   (or ownkey apply --all)\n'));
            }
        } catch (error) {
            logger.error('Suggest failed', error as Error);
            process.exit(1);
        } finally {
            // Only disconnect if database was connected
            if (dbClient.isConnected()) {
                await dbClient.disconnect();
            }
        }
    });
