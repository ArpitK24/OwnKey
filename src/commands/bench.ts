import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { configManager } from '../config/manager.js';
import { AIProviderFactory } from '../ai/factory.js';
import type { AIProvider } from '../ai/provider.js';
import { analyzeChanges, prepareReview, type AnalyzeOptions } from '../core/review/run.js';
import { anchorLine } from '../core/review/report.js';
import { BENCH_CASES, type BenchCase } from '../bench/cases.js';
import { scoreCase, summarize, type BenchFinding, type BenchSummary, type CaseResult } from '../bench/score.js';

const FORMATS = ['text', 'json', 'markdown'] as const;
type Format = (typeof FORMATS)[number];

export const benchCommand = new Command('bench')
    .description('Measure review quality on seeded-bug cases with your configured model')
    .option('--case <ids>', 'Comma-separated case ids to run (default: all)')
    .option('--list', 'List the cases and exit')
    .option('--model <model>', 'Model to use for this run instead of the configured one')
    .option('--format <format>', 'Output format: text, json, markdown', 'text')
    .option('--output <file>', 'Write the report to a file')
    .option('--quick', 'Benchmark the single-pass review instead of the agentic one')
    .option('--max-steps <number>', 'Tool rounds the reviewer may use per case', '6')
    .option('--min-recall <ratio>', 'Exit with code 1 if recall is below this ratio (0 to 1)')
    .action(async (options) => {
        try {
            if (options.list) {
                for (const c of BENCH_CASES) {
                    console.log(`${c.id.padEnd(20)} ${(c.expect ? 'bug' : 'control').padEnd(8)} ${c.language.padEnd(11)} ${c.title}`);
                }
                return;
            }

            const format = String(options.format).toLowerCase() as Format;
            if (!FORMATS.includes(format)) throw new Error(`Unknown format "${options.format}". Use one of: ${FORMATS.join(', ')}`);
            const minRecall = options.minRecall === undefined ? undefined : Number(options.minRecall);
            if (minRecall !== undefined && !(minRecall >= 0 && minRecall <= 1)) throw new Error('--min-recall must be a number from 0 to 1');

            const cases = selectCases(options.case);
            const config = await configManager.load();
            if (!(await configManager.exists()) || !config.activeProvider) {
                throw new Error('No AI provider configured. Run: ownkey config --provider <name> (see ownkey config --help)');
            }
            const provider = await AIProviderFactory.createProvider({ model: options.model });
            const modelLabel = `${config.activeProvider}/${provider.getModel()}`;

            const machine = format !== 'text' && !options.output;
            if (machine) logger.useStderr();
            const say = (msg: string) => (machine ? process.stderr.write(msg + '\n') : console.log(msg));

            const mode = options.quick ? 'quick' : 'agentic';
            const maxSteps = Math.max(0, parseInt(options.maxSteps, 10) || 0);
            say(chalk.bold(`\nOwnKey bench: ${cases.length} case(s) with ${modelLabel} (${mode} review)\n`));
            const results: CaseResult[] = [];
            for (const c of cases) {
                const r = await runCase(c, provider, { quick: options.quick, maxSteps });
                results.push(r);
                say(caseLine(r));
            }
            const summary = summarize(results);

            let body: string;
            if (format === 'json') body = JSON.stringify({ model: modelLabel, mode, summary, results }, null, 2) + '\n';
            else if (format === 'markdown') body = toMarkdown(results, summary, modelLabel);
            else body = summaryText(summary);

            if (options.output) {
                await writeFile(options.output, body, 'utf-8');
                console.log(summaryText(summary));
                console.log(chalk.green(`  Wrote ${format} report to ${options.output}`));
            } else {
                process.stdout.write(body);
            }

            if (minRecall !== undefined && summary.recall < minRecall) {
                say(chalk.red(`\n  Recall ${pct(summary.recall)} is below --min-recall ${pct(minRecall)}.\n`));
                process.exitCode = 1;
            }
        } catch (error) {
            logger.error(`Bench failed: ${(error as Error).message}`);
            process.exitCode = 2;
        }
    });

function selectCases(ids?: string): BenchCase[] {
    if (!ids) return BENCH_CASES;
    const wanted = String(ids).split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = wanted.filter((id) => !BENCH_CASES.some((c) => c.id === id));
    if (unknown.length) throw new Error(`Unknown case(s): ${unknown.join(', ')}. See ownkey bench --list`);
    return BENCH_CASES.filter((c) => wanted.includes(c.id));
}

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.name=ownkey-bench', '-c', 'user.email=bench@ownkey.local', '-c', 'commit.gpgsign=false', ...args], {
        cwd,
        stdio: 'ignore',
    });
}

/** Build a throwaway repo for one case, stage the change, and review it. Nothing is persisted. */
export async function runCase(c: BenchCase, provider: AIProvider, options: AnalyzeOptions = {}): Promise<CaseResult> {
    const started = Date.now();
    const repo = mkdtempSync(join(tmpdir(), `ownkey-bench-${c.id}-`));
    try {
        const file = join(repo, c.file);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, c.base);
        for (const [path, body] of Object.entries(c.context ?? {})) {
            mkdirSync(dirname(join(repo, path)), { recursive: true });
            writeFileSync(join(repo, path), body);
        }
        git(repo, 'init', '-q');
        git(repo, 'add', '.');
        git(repo, 'commit', '-qm', 'base');
        writeFileSync(file, c.changed);
        git(repo, 'add', '.');

        const scope = { kind: 'staged' } as const;
        const target = await prepareReview(repo, scope);
        const suggestions = await analyzeChanges(repo, scope, target, provider, options);
        const findings: BenchFinding[] = suggestions.map((s) => ({
            filePath: s.filePath,
            line: anchorLine(s, target.changes.changedLines.get(s.filePath)),
            type: s.type,
            severity: s.severity,
            content: s.content,
        }));
        return scoreCase(c, findings, Date.now() - started);
    } catch (error) {
        return scoreCase(c, [], Date.now() - started, (error as Error).message);
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function caseLine(r: CaseResult): string {
    const secs = chalk.gray(`${(r.durationMs / 1000).toFixed(1)}s`);
    if (r.error) return `  ${chalk.red('ERROR ')} ${r.id.padEnd(20)} ${chalk.red(r.error)} ${secs}`;
    const noise = r.noise ? chalk.yellow(` +${r.noise} noise`) : '';
    if (r.kind === 'control') {
        return `  ${r.noise ? chalk.yellow('FLAG  ') : chalk.green('CLEAN ')} ${r.id.padEnd(20)} ${chalk.gray('control')}${noise} ${secs}`;
    }
    return `  ${r.caught ? chalk.green('CAUGHT') : chalk.red('MISSED')} ${r.id.padEnd(20)} ${chalk.gray(r.title)}${noise} ${secs}`;
}

function summaryText(s: BenchSummary): string {
    return [
        '',
        chalk.bold(`  Recall     ${pct(s.recall)}  (${s.caught}/${s.bugCases} planted bugs caught)`),
        chalk.bold(`  Precision  ${pct(s.precision)}  (matched findings vs. medium+ findings that matched nothing)`),
        chalk.bold(`  Controls   ${s.controlCases - s.controlsFlagged}/${s.controlCases} clean changes passed without a false alarm`),
        s.errors ? chalk.red(`  Errors     ${s.errors} case(s) could not run`) : '',
        '',
    ]
        .filter((l) => l !== '')
        .join('\n')
        .concat('\n\n');
}

export function toMarkdown(results: CaseResult[], s: BenchSummary, model: string): string {
    const out = [
        `## OwnKey bench: ${model}`,
        '',
        `**Recall ${pct(s.recall)}** (${s.caught}/${s.bugCases} planted bugs caught) · **Precision ${pct(s.precision)}** · **Controls ${s.controlCases - s.controlsFlagged}/${s.controlCases} clean**`,
        '',
        '| Case | Kind | Result | Noise |',
        '| --- | --- | --- | --- |',
    ];
    for (const r of results) {
        const result = r.error ? `error: ${r.error}` : r.kind === 'control' ? (r.noise ? 'false alarm' : 'clean') : r.caught ? 'caught' : 'missed';
        out.push(`| ${r.id} | ${r.kind} | ${result} | ${r.noise} |`);
    }
    out.push('', '_Recall: planted bugs reported on the right line (within 3) with a matching type. Precision: matching findings over all findings at medium or above. Low and info findings never count as noise._', '');
    return out.join('\n');
}
