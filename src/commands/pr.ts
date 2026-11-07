import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { AIProviderFactory } from '../ai/factory.js';
import { configManager } from '../config/manager.js';
import { parseSeverity, meetsSeverity } from '../utils/severity.js';
import { gitRoot } from '../core/review/git.js';
import { toSarif } from '../core/review/report.js';
import { GitHubClient } from '../core/pr/github.js';
import { handleConversation, reviewPull } from '../core/pr/bot.js';

function packageVersion(): string {
    return createRequire(import.meta.url)('../../package.json').version;
}

function readEvent(path: string | undefined): any {
    if (!path) return undefined;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
        throw new Error(`Cannot read the GitHub event file at ${path}.`);
    }
}

function token(): string | undefined {
    return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
}

async function providerAndLabel() {
    const config = await configManager.load();
    if (!(await configManager.exists()) || !config.activeProvider) {
        throw new Error('No AI provider configured. Run: ownkey config --provider <name> (see ownkey config --help)');
    }
    const provider = await AIProviderFactory.createProvider();
    return { provider, modelLabel: `${config.activeProvider}/${provider.getModel()}` };
}

const say = (m: string) => process.stderr.write(chalk.gray(`  ${m}\n`));

const reviewSub = new Command('review')
    .description('Review a pull request: summary, walkthrough, inline comments with suggested fixes')
    .argument('[path]', 'Path inside the git repository', '.')
    .option('--pr <number>', 'Pull request number (default: from the GitHub event)')
    .option('--repo <owner/name>', 'Repository (default: GITHUB_REPOSITORY)')
    .option('--base <ref>', 'Preview locally against this ref, without GitHub (e.g. origin/main)')
    .option('--dry-run', 'Print what would be posted instead of posting')
    .option('--full', 'Review the whole pull request, not just the commits since the last review')
    .option('--force', 'Review even when automatic reviews would skip (draft, paused, title keyword)')
    .option('--summary-only', 'Only refresh the summary and walkthrough')
    .option('--severity <level>', 'Minimum severity to report (default: reviews.severity in .ownkey.yml, else low)')
    .option('--fail-on <level>', 'Exit with code 1 if a new finding is at or above this severity')
    .option('--max-files <number>', 'Maximum changed files to review')
    .option('--max-steps <number>', 'Tool rounds the reviewer may use', '6')
    .option('--quick', 'Single-pass review without repository tools')
    .option('--sarif-output <file>', 'Also write the findings as SARIF (GitHub code scanning)')
    .option('--json-output <file>', 'Also write the result as JSON')
    .action(async (path: string, options) => {
        try {
            logger.useStderr();
            const root = gitRoot(resolve(path));
            const event = readEvent(process.env.GITHUB_EVENT_PATH);
            const pr = options.pr ? parseInt(options.pr, 10) : event?.pull_request?.number;
            const local = Boolean(options.base) || !pr;
            if (local && !options.base) throw new Error('No pull request found. Pass --pr <number> (with GITHUB_TOKEN), or --base <ref> for a local preview.');
            const repo = options.repo || process.env.GITHUB_REPOSITORY;
            if (!local && !repo) throw new Error('Pass --repo owner/name (or set GITHUB_REPOSITORY).');
            if (!local && !token() && !options.dryRun) throw new Error('Set GITHUB_TOKEN (or GH_TOKEN) to post the review, or add --dry-run.');

            const { provider, modelLabel } = await providerAndLabel();
            const result = await reviewPull({
                root,
                provider,
                modelLabel,
                client: local ? undefined : new GitHubClient(repo!, token()),
                pr: local ? undefined : pr,
                base: options.base,
                dryRun: options.dryRun || local,
                trigger: options.force ? 'command' : 'auto',
                full: options.full,
                summaryOnly: options.summaryOnly,
                quick: options.quick,
                maxSteps: Math.max(0, parseInt(options.maxSteps, 10) || 0),
                minSeverity: parseSeverity(options.severity),
                maxFiles: options.maxFiles ? parseInt(options.maxFiles, 10) : undefined,
                onStep: (s) => say(`│ ${s.label}`),
                log: say,
            });

            if (options.jsonOutput) writeFileSync(options.jsonOutput, JSON.stringify(result, null, 2) + '\n', 'utf-8');
            if (options.sarifOutput) writeFileSync(options.sarifOutput, JSON.stringify(toSarif(result.findings, packageVersion()), null, 2) + '\n', 'utf-8');

            if (result.skipped) {
                say(`Skipped: ${result.skipped}.`);
                return;
            }
            if (options.dryRun || local) {
                process.stdout.write((result.summaryComment ?? '').replace(/\n<!-- ownkey:state .*? -->/s, ''));
                if (result.inline.length) {
                    process.stdout.write(`\n---\n\n## Inline comments (${result.inline.length})\n`);
                    for (const c of result.inline) {
                        process.stdout.write(`\n### ${c.path}:${c.start_line ? `${c.start_line}-` : ''}${c.line}\n\n${c.body.replace(/\n<!-- ownkey:finding .*? -->/, '')}\n`);
                    }
                }
            } else if (result.notPosted) {
                say('The review ran but could not be posted (see above). Findings are still in the SARIF and JSON outputs.');
            } else {
                say(`Posted ${result.inline.length} inline comment(s) and updated the summary on #${pr}.`);
            }
            if (process.env.GITHUB_STEP_SUMMARY && result.summaryComment) {
                try {
                    writeFileSync(process.env.GITHUB_STEP_SUMMARY, result.summaryComment.replace(/\n<!-- ownkey:state .*? -->/s, '') + '\n', { flag: 'a' });
                } catch {
                    // The job summary is a nicety
                }
            }
            const failOn = parseSeverity(options.failOn);
            const fresh = [...result.findings];
            if (failOn && fresh.some((f) => meetsSeverity(f.severity, failOn))) {
                say(chalk.red(`Failing: found issues at or above "${failOn}".`));
                process.exitCode = 1;
            }
        } catch (error) {
            logger.error(`Pull request review failed: ${(error as Error).message}`);
            process.exitCode = 2;
        }
    });

const replySub = new Command('reply')
    .description('Answer an @ownkey comment on a pull request (run from an issue_comment or review comment event)')
    .argument('[path]', 'Path inside the git repository', '.')
    .option('--event <file>', 'GitHub event payload (default: GITHUB_EVENT_PATH)')
    .option('--event-name <name>', 'GitHub event name (default: GITHUB_EVENT_NAME)')
    .option('--repo <owner/name>', 'Repository (default: GITHUB_REPOSITORY)')
    .option('--dry-run', 'Print the reply instead of posting it')
    .option('--max-steps <number>', 'Tool rounds for answering a question', '4')
    .action(async (path: string, options) => {
        try {
            logger.useStderr();
            const root = gitRoot(resolve(path));
            const event = readEvent(options.event || process.env.GITHUB_EVENT_PATH);
            if (!event) throw new Error('No GitHub event. Pass --event <file> or run inside GitHub Actions.');
            const eventName = options.eventName || process.env.GITHUB_EVENT_NAME || (event.issue ? 'issue_comment' : 'pull_request_review_comment');
            const repo = options.repo || process.env.GITHUB_REPOSITORY || event.repository?.full_name;
            if (!repo) throw new Error('Pass --repo owner/name (or set GITHUB_REPOSITORY).');
            if (!token() && !options.dryRun) throw new Error('Set GITHUB_TOKEN (or GH_TOKEN) to reply, or add --dry-run.');

            // Commands that need no model (help, pause, resume) work even before a provider is set
            const { provider, modelLabel } = await providerAndLabel();
            const result = await handleConversation({
                root,
                provider,
                modelLabel,
                client: new GitHubClient(repo, token()),
                event,
                eventName,
                dryRun: options.dryRun,
                maxSteps: Math.max(0, parseInt(options.maxSteps, 10) || 0),
                onStep: (s) => say(`│ ${s.label}`),
                log: say,
            });
            if (result.ignored) {
                say(`Nothing to do: ${result.ignored}.`);
                return;
            }
            if (options.dryRun) process.stdout.write((result.reply ?? '') + '\n');
            else say(`Replied (${result.command?.kind}).`);
        } catch (error) {
            logger.error(`Reply failed: ${(error as Error).message}`);
            process.exitCode = 2;
        }
    });

export const prCommand = new Command('pr')
    .description('Pull request bot: summaries, walkthroughs, inline reviews, and @ownkey chat')
    .addCommand(reviewSub)
    .addCommand(replySub);
