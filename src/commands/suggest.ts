import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import { FileScanner } from '../core/scanner.js';
import { AIProviderFactory } from '../ai/factory.js';
import { dbOps } from '../db/operations.js';
import { dbClient } from '../db/client.js';
import { CodeContext } from '../types/index.js';
import chalk from 'chalk';
import { localStorage } from '../storage/local.js';

export const suggestCommand = new Command('suggest')
    .description('Generate AI-powered suggestions for your code')
    .argument('[path]', 'Path to analyze', '.')
    .option('--type <type>', 'Filter by suggestion type (bug, security, performance, etc.)')
    .option('--severity <severity>', 'Minimum severity (critical, high, medium, low, info)')
    .option('--max-files <number>', 'Maximum number of files to analyze', '10')
    .action(async (path: string, options) => {
        try {
            const targetPath = resolve(path);

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

            // Step 6: Store suggestions (hybrid: database + local file)
            let storedIds: string[] = [];

            // Try database first (if connected)
            if (dbClient.isConnected()) {
                try {
                    logger.verbose('Storing suggestions in database...');

                    let project = await dbOps.getProjectByPath(targetPath);
                    if (!project) {
                        project = await dbOps.createProject(projectName, targetPath);
                    }

                    if (project) {
                        const run = await dbOps.createRun(project.id, `suggest ${path}`);

                        for (const suggestion of suggestions) {
                            try {
                                const stored = await dbOps.createSuggestion(project.id, suggestion);
                                if (stored && run) {
                                    await dbOps.linkRunSuggestion(run.id, stored.id);
                                    storedIds.push(stored.id);
                                }
                            } catch (err) {
                                logger.warn(`Failed to store suggestion: ${(err as Error).message}`);
                            }
                        }

                        if (run) {
                            await dbOps.updateRunStatus(
                                run.id,
                                'completed',
                                `Generated ${suggestions.length} suggestions`
                            );
                        }
                    }

                    logger.success('Saved to database');
                } catch (error) {
                    logger.warn('Database save failed, using local storage only');
                    logger.debug(`Database error: ${(error as Error).message}`);
                }
            }

            // Always save to local file (cache or primary storage)
            try {
                const localStored = await localStorage.saveSuggestions(targetPath, projectName, suggestions);

                if (!dbClient.isConnected()) {
                    // Local-only mode: show IDs to user
                    storedIds = localStored.map(s => s.id);
                    logger.success('Saved locally');
                    console.log(chalk.gray(`\n  💾 Suggestion IDs: ${storedIds.slice(0, 3).join(', ')}${storedIds.length > 3 ? '...' : ''}`));
                } else {
                    logger.verbose('Also cached locally for quick access');
                }
            } catch (error) {
                logger.warn(`Failed to save locally: ${(error as Error).message}`);
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
            logger.success('Suggestions generated successfully');
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
