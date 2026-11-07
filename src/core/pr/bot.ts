import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AIProvider } from '../../ai/provider.js';
import { loadRepoConfig, type RepoConfig } from '../../config/repo-config.js';
import type { Severity } from '../../types/index.js';
import { meetsSeverity } from '../../utils/severity.js';
import { collectChanges, resolveScope, type ReviewScope } from '../review/git.js';
import { anchorLine, sortFindings, type Finding } from '../review/report.js';
import { analyzeChanges, prepareReview } from '../review/run.js';
import { RepoTools, runAgentChat, type AgentStep } from '../review/agent.js';
import { readState, renderSummaryComment, SUMMARY_MARKER, HELP_TEXT, writeState, type BotState } from './comment.js';
import { GitHubClient, GitHubError, type IssueComment, type NewReviewComment, type PullInfo, type ReviewComment } from './github.js';
import { alreadyPosted, inlineCommentBody, isCommentable, nearestCommentable, toSuggestedChange, FINDING_MARKER } from './inline.js';
import { clipPatch, summarizePull, type PullSummary } from './summary.js';

function git(root: string, args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function tryGit(root: string, args: string[]): string | undefined {
    try {
        return git(root, args);
    } catch {
        return undefined;
    }
}

export function isAncestor(root: string, older: string, newer: string): boolean {
    try {
        execFileSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd: root, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Make sure the pull request's head commit is checked out and its base is reachable.
 * On GitHub Actions the default checkout is a merge commit (pull_request) or the default
 * branch (issue_comment); review comments must be anchored to the head commit, so the
 * bot moves to it. Outside CI it never touches your checkout.
 */
export function ensurePullCheckout(root: string, pull: PullInfo, log: (m: string) => void = () => {}): void {
    const head = tryGit(root, ['rev-parse', 'HEAD'])?.trim();
    const shallow = tryGit(root, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true';
    const haveBase = tryGit(root, ['cat-file', '-e', `${pull.base.sha}^{commit}`]) !== undefined;
    if (head === pull.head.sha && haveBase && !shallow) return;
    if (process.env.GITHUB_ACTIONS !== 'true') {
        if (head !== pull.head.sha) log(`Note: the checkout (${head?.slice(0, 7)}) is not the pull request head (${pull.head.sha.slice(0, 7)}); reviewing the checkout.`);
        return;
    }
    log(`Fetching pull request #${pull.number} head and base`);
    const refs = [`+refs/pull/${pull.number}/head:refs/remotes/origin/pr/${pull.number}`, `+refs/heads/${pull.base.ref}:refs/remotes/origin/${pull.base.ref}`];
    git(root, ['fetch', '--no-tags', ...(shallow ? ['--unshallow'] : []), 'origin', ...refs]);
    if (head !== pull.head.sha) git(root, ['checkout', '--quiet', '--detach', pull.head.sha]);
}

export interface PullReviewOptions {
    root: string;
    provider: AIProvider;
    /** e.g. "ollama/gpt-oss:120b" */
    modelLabel: string;
    /** GitHub API access; omit for a local preview against `base` */
    client?: GitHubClient;
    pr?: number;
    /** Local preview: the ref to compare against */
    base?: string;
    /** Print what would be posted instead of posting */
    dryRun?: boolean;
    /** auto: a push or open event (respects pause, drafts, title keywords). command: someone asked. */
    trigger?: 'auto' | 'command';
    /** Ignore the last reviewed commit and review the whole pull request */
    full?: boolean;
    /** Only refresh the summary and walkthrough */
    summaryOnly?: boolean;
    quick?: boolean;
    maxSteps?: number;
    minSeverity?: Severity;
    maxFiles?: number;
    onStep?: (step: AgentStep) => void;
    log?: (message: string) => void;
}

export interface PullReviewResult {
    skipped?: string;
    findings: Finding[];
    inline: NewReviewComment[];
    outside: Finding[];
    repeated: number;
    summary?: PullSummary;
    summaryComment?: string;
    reviewBody?: string;
    range: string;
    incremental: boolean;
    headSha: string;
    /** Why the review could not be posted (for example a read-only token on a fork) */
    notPosted?: string;
}

/** Why an automatic review should not run on this pull request, if it should not. */
export function autoReviewSkipReason(config: RepoConfig, pull: Pick<PullInfo, 'draft' | 'title' | 'base' | 'state'>, state: BotState): string | undefined {
    const auto = config.reviews.autoReview;
    if (pull.state && pull.state !== 'open') return 'the pull request is not open';
    if (!auto.enabled) return 'automatic reviews are turned off in .ownkey.yml (reviews.auto_review.enabled)';
    if (state.paused) return 'reviews are paused on this pull request (@ownkey resume to turn them back on)';
    if (pull.draft && !auto.drafts) return 'the pull request is a draft (set reviews.auto_review.drafts: true to review drafts)';
    const kw = auto.ignoreTitleKeywords.find((k) => pull.title.toLowerCase().includes(k.toLowerCase()));
    if (kw) return `the title contains "${kw}"`;
    if (auto.baseBranches.length && !auto.baseBranches.includes(pull.base.ref)) return `the base branch ${pull.base.ref} is not in reviews.auto_review.base_branches`;
    return undefined;
}

function findSummaryComment(comments: IssueComment[]): IssueComment | undefined {
    return comments.find((c) => c.body?.startsWith(SUMMARY_MARKER));
}

/**
 * Review a pull request the way a hosted review bot does: a summary and walkthrough in one
 * comment that stays up to date, and findings as inline review comments with one-click
 * suggestions. On later pushes only the new commits are reviewed, and findings already
 * raised are not repeated.
 */
export async function reviewPull(o: PullReviewOptions): Promise<PullReviewResult> {
    const log = o.log ?? (() => {});
    const root = o.root;
    const config = loadRepoConfig(root);
    const short = (sha: string) => sha.slice(0, 7);

    let pull: PullInfo | undefined;
    let summaryComment: IssueComment | undefined;
    let state: BotState = {};
    let botComments: ReviewComment[] = [];

    if (o.client && o.pr) {
        pull = await o.client.getPull(o.pr);
        const comments = await o.client.listIssueComments(o.pr);
        summaryComment = findSummaryComment(comments);
        state = readState(summaryComment?.body);
        ensurePullCheckout(root, pull, log);
        if ((o.trigger ?? 'auto') === 'auto') {
            const why = autoReviewSkipReason(config, pull, state);
            if (why) return { skipped: why, findings: [], inline: [], outside: [], repeated: 0, range: '', incremental: false, headSha: pull.head.sha };
        }
        botComments = (await o.client.listReviewComments(o.pr)).filter((c) => FINDING_MARKER.test(c.body ?? ''));
    }

    const headSha = git(root, ['rev-parse', 'HEAD']).trim();
    const baseRef = pull ? pull.base.sha : o.base;
    if (!baseRef) throw new Error('Nothing to compare against. Pass --base <ref> (for example origin/main), or --pr with a GitHub token.');
    const fullScope = resolveScope(root, { base: baseRef }) as Extract<ReviewScope, { kind: 'base' }>;
    if (pull) fullScope.ref = pull.base.ref;

    if (pull && state.reviewed === headSha && o.trigger !== 'command' && !o.full) {
        return { skipped: `commit ${short(headSha)} was already reviewed`, findings: [], inline: [], outside: [], repeated: 0, range: '', incremental: false, headSha };
    }

    // Incremental: only the commits since the last review, when that review is still in this branch's history
    const incremental = Boolean(pull && config.reviews.incremental && !o.full && state.reviewed && state.reviewed !== headSha && isAncestor(root, state.reviewed, headSha));
    const scope: ReviewScope = incremental ? { kind: 'base', ref: short(state.reviewed!), mergeBase: state.reviewed! } : fullScope;
    const range = incremental ? `${short(state.reviewed!)}..${short(headSha)}` : pull ? `pull request #${pull.number}` : `${o.base}...HEAD`;

    const prChanges = collectChanges(root, fullScope);
    const target = await prepareReview(root, scope, o.maxFiles ?? config.reviews.maxFiles ?? 25, config.reviews.pathFilters);
    const skippedFiles = target.changes.files.length - target.selected.length;

    const wantSummary = config.reviews.summary && prChanges.files.length > 0;
    log(`Reviewing ${target.selected.length} file${target.selected.length === 1 ? '' : 's'} in ${range}${wantSummary ? ', and summarizing the pull request' : ''}`);

    const summaryJob = wantSummary
        ? summarizePull(o.provider, { title: pull?.title, body: pull?.body ?? undefined, patch: prChanges.patch, files: prChanges.files }).catch((e) => {
              log(`Summary failed: ${(e as Error).message}`);
              return undefined;
          })
        : Promise.resolve(undefined);
    const reviewJob =
        o.summaryOnly || target.selected.length === 0
            ? Promise.resolve([])
            : analyzeChanges(root, scope, target, o.provider, { quick: o.quick, maxSteps: o.maxSteps, onStep: o.onStep, repoConfig: config });
    const [summary, suggestions] = await Promise.all([summaryJob, reviewJob]);

    const minSeverity = o.minSeverity ?? config.reviews.severity ?? 'low';
    const findings = sortFindings(
        suggestions
            .filter((s) => meetsSeverity(s.severity, minSeverity))
            .map((s) => ({ ...s, line: anchorLine(s, target.changes.changedLines.get(s.filePath)) }))
    );

    // Inline where GitHub allows it, never twice for the same problem
    const inline: NewReviewComment[] = [];
    const outside: Finding[] = [];
    const posted: Finding[] = [];
    let repeated = 0;
    const lineCache = new Map<string, string[]>();
    const fileLines = (file: string) => {
        if (!lineCache.has(file)) {
            try {
                lineCache.set(file, readFileSync(join(root, file), 'utf-8').split('\n'));
            } catch {
                lineCache.set(file, []);
            }
        }
        return lineCache.get(file)!;
    };
    for (const f of findings) {
        if (alreadyPosted(f, botComments)) {
            repeated++;
            continue;
        }
        const line = config.reviews.inlineComments ? nearestCommentable(prChanges.changedLines, f.filePath, f.line) : undefined;
        if (line === undefined) {
            outside.push(f);
            continue;
        }
        const anchored = { ...f, line };
        let suggestion = toSuggestedChange(f.diff, fileLines(f.filePath));
        // A suggestion must sit wholly inside one hunk of the pull request diff
        if (suggestion && !rangeCommentable(prChanges.changedLines, f.filePath, suggestion.start, suggestion.end)) suggestion = undefined;
        const comment: NewReviewComment = suggestion
            ? {
                  path: f.filePath,
                  side: 'RIGHT',
                  line: suggestion.end,
                  ...(suggestion.start !== suggestion.end ? { start_line: suggestion.start, start_side: 'RIGHT' as const } : {}),
                  body: inlineCommentBody({ ...anchored, line: suggestion.end }, suggestion),
              }
            : { path: f.filePath, side: 'RIGHT', line, body: inlineCommentBody(anchored) };
        inline.push(comment);
        posted.push(anchored);
    }

    const newState: BotState = { reviewed: o.summaryOnly ? state.reviewed : headSha, ...(state.paused ? { paused: true } : {}) };
    const reviewBody = inline.length ? `OwnKey found ${inline.length} issue${inline.length === 1 ? '' : 's'} in ${range}. The summary comment has the overview.` : undefined;

    const render = (postedNow: Finding[], outsideNow: Finding[]) =>
        renderSummaryComment({
            summary: summary ?? undefined,
            walkthrough: config.reviews.walkthrough,
            posted: postedNow,
            outside: outsideNow,
            repeated,
            range,
            incremental,
            model: o.modelLabel,
            state: newState,
            reviewedFiles: target.selected.length,
            skippedFiles,
            paused: state.paused,
            note: o.summaryOnly ? 'Summary refreshed. Findings from earlier reviews are in their threads.' : undefined,
        });

    let body = render(posted, outside);
    let notPosted: string | undefined;
    if (o.client && o.pr && !o.dryRun) {
        try {
            if (inline.length) {
                const kept = await postReview(o.client, o.pr, headSha, reviewBody!, inline, log);
                if (kept.length < inline.length) {
                    // Comments GitHub refused (a line outside the diff) move to the summary instead
                    const refused = posted.filter((_, i) => !kept.includes(inline[i]));
                    body = render(
                        posted.filter((_, i) => kept.includes(inline[i])),
                        [...outside, ...refused]
                    );
                }
            }
            if (summaryComment) await o.client.updateIssueComment(summaryComment.id, body);
            else await o.client.createIssueComment(o.pr, body);
        } catch (e) {
            // A pull request from a fork gets a read-only token: keep the findings (SARIF, job summary) and say why
            if (!(e instanceof GitHubError) || (e.status !== 403 && e.status !== 404)) throw e;
            notPosted = e.message;
            log(`Could not post to the pull request: ${e.message}`);
        }
    }

    return { findings, inline, outside, repeated, summary: summary ?? undefined, summaryComment: body, reviewBody, range, incremental, headSha, notPosted };
}

function rangeCommentable(lines: Map<string, Array<[number, number]>>, file: string, start: number, end: number): boolean {
    return (lines.get(file) ?? []).some(([a, b]) => start >= a && end <= b) && isCommentable(lines, file, end);
}

/** Post one review with every comment; if GitHub rejects it, post them one by one and keep the ones it accepts. */
async function postReview(client: GitHubClient, pr: number, sha: string, body: string, comments: NewReviewComment[], log: (m: string) => void): Promise<NewReviewComment[]> {
    try {
        await client.createReview(pr, { commit_id: sha, body, event: 'COMMENT', comments });
        return comments;
    } catch (e) {
        if (!(e instanceof GitHubError) || e.status !== 422) throw e;
        log(`GitHub rejected the batched review (${e.message}); posting comments one at a time`);
    }
    const kept: NewReviewComment[] = [];
    for (const c of comments) {
        try {
            await client.createReview(pr, { commit_id: sha, body: '', event: 'COMMENT', comments: [c] });
            kept.push(c);
        } catch (e) {
            if (!(e instanceof GitHubError) || e.status !== 422) throw e;
            log(`Skipped an inline comment on ${c.path}:${c.line}: ${e.message}`);
        }
    }
    return kept;
}

// ---------------------------------------------------------------------------------------
// Conversations: @ownkey in a pull request comment or a review thread

export type BotCommand = { kind: 'help' } | { kind: 'pause' } | { kind: 'resume' } | { kind: 'review'; full: boolean } | { kind: 'summary' } | { kind: 'ask'; question: string };

const MENTION = /(^|[^\w-])@ownkey\b/i;

/** The command in a comment that mentions @ownkey, or undefined when it does not. */
export function parseBotCommand(body: string): BotCommand | undefined {
    if (!MENTION.test(body)) return undefined;
    const after = body.replace(/^[\s\S]*?@ownkey\b[\s:,]*/i, '').trim();
    const word = after.toLowerCase().replace(/[.!?]+$/, '');
    if (word === '' || word === 'help') return word === '' ? { kind: 'help' } : { kind: 'help' };
    if (word === 'pause') return { kind: 'pause' };
    if (word === 'resume') return { kind: 'resume' };
    if (word === 'review' || word === 'incremental review') return { kind: 'review', full: false };
    if (word === 'full review' || word === 'review all' || word === 'rereview' || word === 're-review') return { kind: 'review', full: true };
    if (word === 'summary' || word === 'summarize') return { kind: 'summary' };
    return { kind: 'ask', question: after };
}

export interface ConversationOptions {
    root: string;
    provider: AIProvider;
    modelLabel: string;
    client: GitHubClient;
    /** The GitHub webhook payload (GITHUB_EVENT_PATH) */
    event: any;
    eventName: string;
    dryRun?: boolean;
    maxSteps?: number;
    onStep?: (step: AgentStep) => void;
    log?: (message: string) => void;
}

export interface ConversationResult {
    ignored?: string;
    command?: BotCommand;
    reply?: string;
}

function isOwnComment(comment: { body?: string; user?: { type?: string; login?: string } }): boolean {
    const body = comment.body ?? '';
    return body.startsWith(SUMMARY_MARKER) || FINDING_MARKER.test(body) || body.includes('<!-- ownkey:reply -->');
}

/** Answer an @ownkey comment: run a command, or investigate the code and reply to the question. */
export async function handleConversation(o: ConversationOptions): Promise<ConversationResult> {
    const log = o.log ?? (() => {});
    const ev = o.event ?? {};
    const comment = ev.comment;
    if (!comment || (ev.action && ev.action !== 'created')) return { ignored: 'not a new comment' };
    if (isOwnComment(comment)) return { ignored: "OwnKey's own comment" };
    const pr: number | undefined = ev.pull_request?.number ?? (ev.issue?.pull_request ? ev.issue?.number : undefined);
    if (!pr) return { ignored: 'the comment is not on a pull request' };
    const command = parseBotCommand(comment.body ?? '');
    if (!command) return { ignored: 'the comment does not mention @ownkey' };

    const inThread = o.eventName === 'pull_request_review_comment';
    const threadRoot: number = inThread ? (comment.in_reply_to_id ?? comment.id) : 0;
    const reply = async (text: string) => {
        const body = `${text}\n\n<!-- ownkey:reply -->`;
        if (o.dryRun) return;
        if (inThread) await o.client.replyToReviewComment(pr, threadRoot, body);
        else await o.client.createIssueComment(pr, `> ${String(comment.body).split('\n')[0].slice(0, 200)}\n\n${body}`);
    };
    if (!o.dryRun) await o.client.react(inThread ? 'review' : 'issue', comment.id, 'eyes').catch(() => undefined);

    switch (command.kind) {
        case 'help':
            await reply(HELP_TEXT);
            return { command, reply: HELP_TEXT };
        case 'pause':
        case 'resume': {
            const paused = command.kind === 'pause';
            const comments = await o.client.listIssueComments(pr);
            const existing = findSummaryComment(comments);
            const state = { ...readState(existing?.body), paused };
            if (!o.dryRun) {
                if (existing) await o.client.updateIssueComment(existing.id, existing.body.replace(/<!-- ownkey:state .*? -->/s, writeState(state)));
                else await o.client.createIssueComment(pr, `${SUMMARY_MARKER}\n## OwnKey review\n\nNo review yet.\n${writeState(state)}\n`);
            }
            const text = paused ? 'Paused. I will not review new pushes on this pull request until you comment `@ownkey resume`.' : 'Resumed. I will review the next push.';
            await reply(text);
            return { command, reply: text };
        }
        case 'review':
        case 'summary': {
            const result = await reviewPull({
                root: o.root,
                provider: o.provider,
                modelLabel: o.modelLabel,
                client: o.client,
                pr,
                dryRun: o.dryRun,
                trigger: 'command',
                full: command.kind === 'review' && command.full,
                summaryOnly: command.kind === 'summary',
                maxSteps: o.maxSteps,
                onStep: o.onStep,
                log,
            });
            const text =
                command.kind === 'summary'
                    ? 'Updated the summary and walkthrough.'
                    : result.inline.length || result.outside.length
                      ? `Reviewed ${result.range}: ${result.inline.length + result.outside.length} new finding(s). See the review comments and the summary.`
                      : `Reviewed ${result.range}. No new issues.`;
            await reply(text);
            return { command, reply: text };
        }
        case 'ask': {
            const pull = await o.client.getPull(pr);
            ensurePullCheckout(o.root, pull, log);
            const fullScope = resolveScope(o.root, { base: pull.base.sha });
            const changes = collectChanges(o.root, fullScope);
            const config = loadRepoConfig(o.root);
            const target = await prepareReview(o.root, fullScope, 1000, []);
            const tools = new RepoTools(o.root, fullScope, target.metadata.keys(), new Set(changes.files));

            const parts: string[] = [`Pull request #${pr}: ${pull.title}`];
            if (pull.body?.trim()) parts.push(`Description:\n${pull.body.trim().slice(0, 3000)}`);
            if (inThread) {
                const thread = (await o.client.listReviewComments(pr)).filter((c) => c.id === threadRoot || c.in_reply_to_id === threadRoot);
                parts.push(`The question is in a review thread on ${comment.path} line ${comment.line ?? comment.original_line ?? '?'}.`);
                if (comment.diff_hunk) parts.push('```diff\n' + String(comment.diff_hunk) + '\n```');
                const history = thread
                    .filter((c) => c.id !== comment.id)
                    .map((c) => `${c.user?.login ?? 'someone'}: ${c.body.replace(/<!--[\s\S]*?-->/g, '').trim()}`)
                    .join('\n\n');
                if (history) parts.push(`Earlier in this thread:\n${history.slice(-6000)}`);
            }
            parts.push(`Changed files: ${changes.files.join(', ')}`);
            parts.push('The pull request diff:\n```diff\n' + clipPatch(changes.patch, 40_000).text + '\n```');
            if (config.learnings.length) parts.push(`Team learnings:\n${config.learnings.map((l) => `- ${l}`).join('\n')}`);
            parts.push(`Question from ${comment.user?.login ?? 'a reviewer'}:\n${command.question}`);

            const { answer } = await runAgentChat(o.provider, parts.join('\n\n'), tools, { maxSteps: o.maxSteps ?? 4, onStep: o.onStep });
            await reply(answer);
            return { command, reply: answer };
        }
    }
}
