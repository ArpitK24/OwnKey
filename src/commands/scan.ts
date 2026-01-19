import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import { FileScanner } from '../core/scanner.js';
import { dbOps } from '../db/operations.js';
import { dbClient } from '../db/client.js';
import chalk from 'chalk';

export const scanCommand = new Command('scan')
    .description('Scan a project directory')
    .argument('[path]', 'Path to scan', '.')
    .option('--max-file-size <size>', 'Maximum file size (e.g., 500kb, 1mb)', '500kb')
    .option('--ignore <patterns...>', 'Additional ignore patterns')
    .action(async (path: string, options) => {
        try {
            const targetPath = resolve(path);

            // Validate path
            if (!existsSync(targetPath)) {
                logger.error(`Path does not exist: ${targetPath}`);
                process.exit(1);
            }

            logger.info(`Scanning: ${chalk.cyan(targetPath)}`);

            // Parse max file size
            const maxFileSize = parseFileSize(options.maxFileSize);

            // Create scanner
            const scanner = new FileScanner(targetPath, maxFileSize);

            // Scan
            const startTime = Date.now();
            const result = await scanner.scan();
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);

            // Display results
            console.log(chalk.bold('\n📊 Scan Results:\n'));
            console.log(`  Files found:    ${chalk.green(result.files.length)}`);
            console.log(`  Total size:     ${formatBytes(result.totalSize)}`);
            console.log(`  Skipped files:  ${result.skippedFiles.length}`);
            console.log(`  Duration:       ${duration}s\n`);

            if (result.warnings.length > 0) {
                console.log(chalk.yellow(`⚠️  ${result.warnings.length} warnings:`));
                result.warnings.slice(0, 5).forEach((w) => console.log(chalk.gray(`  - ${w}`)));
                if (result.warnings.length > 5) {
                    console.log(chalk.gray(`  ... and ${result.warnings.length - 5} more`));
                }
                console.log();
            }

            // Store in database if connected
            if (dbClient.isConnected()) {
                const projectName = targetPath.split(/[/\\]/).pop() || 'unknown';
                let project = await dbOps.getProjectByPath(targetPath);

                if (!project) {
                    project = await dbOps.createProject(projectName, targetPath);
                    logger.verbose('Created project record in database');
                }

                if (project) {
                    const run = await dbOps.createRun(project.id, `scan ${path}`);
                    if (run) {
                        await dbOps.updateRunStatus(
                            run.id,
                            'completed',
                            `Scanned ${result.files.length} files`
                        );
                    }
                }
            }

            logger.success('Scan complete');

            // Show next steps
            console.log(chalk.cyan('Next step:'));
            console.log(chalk.gray(`  ownkey suggest ${path}\n`));
        } catch (error) {
            logger.error('Scan failed', error as Error);
            process.exit(1);
        }
    });

function parseFileSize(sizeStr: string): number {
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)(kb|mb|gb)?$/i);
    if (!match) {
        throw new Error(`Invalid file size format: ${sizeStr}`);
    }

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'b').toLowerCase();

    switch (unit) {
        case 'b':
            return value;
        case 'kb':
            return value * 1024;
        case 'mb':
            return value * 1024 * 1024;
        case 'gb':
            return value * 1024 * 1024 * 1024;
        default:
            return value;
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
