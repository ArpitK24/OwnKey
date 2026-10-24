import { Command } from 'commander';
import { basename, resolve } from 'path';
import { writeFile } from 'fs/promises';
import { createRequire } from 'module';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { AIProviderFactory } from '../ai/factory.js';
import { configManager } from '../config/manager.js';
import { meetsSeverity, parseSeverity } from '../utils/severity.js';
import { persistSuggestions } from '../core/persist.js';
import { describeScope, gitRoot, resolveScope } from '../core/review/git.js';
import { analyzeChanges, prepareReview } from '../core/review/run.js';
import { Finding, anchorLine, sortFindings, toMarkdown, toSarif } from '../core/review/report.js';

const FORMATS = ['text', 'markdown', 'json', 'sarif'] as const;
type Format = (typeof FORMATS)[number];

export const reviewCommand = new Command('review')
    .description('Review your git changes: staged, uncommitted, or a branch against its base')
    .argument('[path]', 'Path inside the git repository', '.')
    .option('--staged', 'Review only staged changes')
    .option('--base <ref>', 'Review everything since the merge base with this ref (e.g. origin/main)')
    .option('--severity <level>', 'Minimum severity to report (critical, high, medium, low, info)')
    .option('--type <type>', 'Only report this type (bug, security, performance, ...)')
    .option('--format <format>', 'Output format: text, markdown, json, sarif', 'text')
    .option('--output <file>', 'Write the report to a file instead of stdout')
    .option('--sarif-output <file>', 'Also write a SARIF report to this file (GitHub code scanning)')
    .option('--markdown-output <file>', 'Also write a Markdown report to this file (PR comment, job summary)')
    .option('--fail-on <level>', 'Exit with code 1 if any finding is at or above this severity (for CI)')
    .option('--max-files <number>', 'Maximum changed files to review', '25')
    .option('--quick', 'Single-pass review without repository tools (faster, cheaper, less context)')
    .option('--max-steps <number>', 'Tool rounds the reviewer may use to investigate the repository', '6')
    .action(async (path: string, options) => {
        try {
            const format = String(options.format).toLowerCase() as Format;
            if (!FORMATS.includes(format)) {
                throw new Error(`Unknown format "${options.format}". Use one of: ${FORMATS.join(', ')}`);
            }
            const minSeverity = parseSeverity(options.severity);
            const failOn = parseSeverity(options.failOn);
            const typeFilter: string | undefined = options.type?.toLowerCase();
            const machine = format !== 'text' && !options.output;
            if (machine) logger.useStderr();
            const say = (msg: string) => {
                if (machine) process.stderr.write(msg + '\n');
                else console.log(msg);
            };

            const config = await configManager.load();
            if (!(await configManager.exists()) || !config.activeProvider) {
                throw new Error('No AI provider configured. Run: ownkey config --provider <name> (see ownkey config --help)');
            }

            const root = gitRoot(resolve(path));
            const scope = resolveScope(root, { staged: options.staged, base: options.base });
            const scopeLabel = describeScope(scope);
            const maxFiles = parseInt(options.maxFiles, 10) || 25;
            const target = await prepareReview(root, scope, maxFiles);
            const { changes, reviewable: files, selected } = target;

            if (files.length === 0) {
                say(chalk.green(`\n  Nothing to review in ${scopeLabel}.\n`));
                await emit([], format, options.output, scopeLabel, config.activeProvider);
                await writeExtras([], options, scopeLabel, config.activeProvider);
                return;
            }

            say(chalk.bold(`\nReviewing ${selected.length} file(s) in ${scopeLabel}`) + (files.length > selected.length ? chalk.yellow(` (${files.length - selected.length} skipped by --max-files)`) : ''));
            for (const f of selected) say(chalk.gray(`  ${f}`));

            const provider = await AIProviderFactory.createProvider();
            const model = provider.getModel();
            say(chalk.gray(`\n  Model: ${config.activeProvider} / ${model}\n`));

            if (!options.quick) say(chalk.gray('  Investigating the repository before reporting...'));
            const onStep = (step: { label: string }) => say(chalk.gray(`  ↳ ${step.label}`));
            const maxSteps = Math.max(0, parseInt(options.maxSteps, 10) || 0);
            const kept = (await analyzeChanges(root, scope, target, provider, { quick: options.quick, maxSteps, onStep }))
                .filter((s) => !typeFilter || s.type === typeFilter)
                .filter((s) => meetsSeverity(s.severity, minSeverity));

            const stored = await persistSuggestions(root, basename(root), kept, `review ${scopeLabel}`);
            const findings = sortFindings(
                kept.map((s, i) => ({
                    ...s,
                    id: stored[i]?.id,
                    line: anchorLine(s, changes.changedLines.get(s.filePath)),
                }))
            );

            const modelLabel = `${config.activeProvider}/${model}`;
            await emit(findings, format, options.output, scopeLabel, modelLabel);
            await writeExtras(findings, options, scopeLabel, modelLabel);

            if (failOn && findings.some((f) => meetsSeverity(f.severity, failOn))) {
                say(chalk.red(`\n  Failing: found issues at or above "${failOn}".\n`));
                process.exitCode = 1;
            }
        } catch (error) {
            logger.error(`Review failed: ${(error as Error).message}`);
            process.exitCode = 2;
        }
    });

async function writeExtras(findings: Finding[], options: { sarifOutput?: string; markdownOutput?: string }, scopeLabel: string, model: string): Promise<void> {
    if (options.sarifOutput) {
        await writeFile(options.sarifOutput, JSON.stringify(toSarif(findings, packageVersion()), null, 2) + '\n', 'utf-8');
    }
    if (options.markdownOutput) {
        await writeFile(options.markdownOutput, toMarkdown(findings, scopeLabel, model), 'utf-8');
    }
}

function packageVersion(): string {
    return createRequire(import.meta.url)('../../package.json').version;
}

async function emit(findings: Finding[], format: Format, output: string | undefined, scopeLabel: string, model: string): Promise<void> {
    let body: string;
    switch (format) {
        case 'sarif': {
            body = JSON.stringify(toSarif(findings, packageVersion()), null, 2) + '\n';
            break;
        }
        case 'json':
            body = JSON.stringify({ scope: scopeLabel, model, findings }, null, 2) + '\n';
            break;
        case 'markdown':
            body = toMarkdown(findings, scopeLabel, model);
            break;
        default:
            body = renderText(findings);
    }
    if (output) {
        await writeFile(output, body, 'utf-8');
        console.log(chalk.green(`  Wrote ${format} report to ${output}`));
        if (format !== 'text') console.log(renderText(findings));
    } else {
        process.stdout.write(body);
    }
}

function renderText(findings: Finding[]): string {
    if (findings.length === 0) return chalk.green('  No issues found.\n');
    const color = (sev: string) => (sev === 'critical' || sev === 'high' ? chalk.red : sev === 'medium' ? chalk.yellow : chalk.blue);
    const out: string[] = [''];
    for (const f of findings) {
        out.push(`${color(f.severity)(f.severity.toUpperCase().padEnd(8))} ${chalk.bold(f.type.padEnd(13))} ${chalk.cyan(`${f.filePath}:${f.line}`)}`);
        out.push(`         ${f.content}`);
        if (f.id && f.diff?.trim()) out.push(chalk.gray(`         ownkey apply ${f.id}`));
        out.push('');
    }
    out.push(chalk.bold(`  ${findings.length} finding(s).`) + (findings.some((f) => f.diff?.trim()) ? chalk.gray('  Preview with ownkey apply <id> --dry-run') : ''));
    return out.join('\n') + '\n';
}
