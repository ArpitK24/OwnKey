import type { Finding } from '../review/report.js';
import type { PullSummary } from './summary.js';

/** Marks OwnKey's summary comment; the same marker 1.1 used, so old comments are updated in place. */
export const SUMMARY_MARKER = '<!-- ownkey-review -->';

/** What the bot remembers between runs, kept in a hidden line of its summary comment. */
export interface BotState {
    /** Head commit of the last completed review */
    reviewed?: string;
    /** Set with "@ownkey pause", cleared with "@ownkey resume" */
    paused?: boolean;
}

const STATE_RE = /<!-- ownkey:state (.*?) -->/s;

export function readState(body: string | undefined): BotState {
    const m = STATE_RE.exec(body ?? '');
    if (!m) return {};
    try {
        const s = JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8'));
        return s && typeof s === 'object' ? s : {};
    } catch {
        return {};
    }
}

export function writeState(state: BotState): string {
    return `<!-- ownkey:state ${Buffer.from(JSON.stringify(state), 'utf-8').toString('base64')} -->`;
}

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

function counts(findings: Finding[]): string {
    return SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
        .filter(([, n]) => n)
        .map(([s, n]) => `${n} ${s}`)
        .join(', ');
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function cell(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

export interface SummaryCommentInput {
    summary?: PullSummary;
    walkthrough: boolean;
    /** Findings posted inline on this run */
    posted: Finding[];
    /** Findings this run that could not go inline (outside the diff) */
    outside: Finding[];
    /** Findings skipped because an earlier comment already covers them */
    repeated: number;
    /** e.g. "abc1234..def5678" or "the whole pull request" */
    range: string;
    incremental: boolean;
    model: string;
    state: BotState;
    /** Files reviewed this run, and files skipped by limits or filters */
    reviewedFiles: number;
    skippedFiles: number;
    paused?: boolean;
    note?: string;
}

/** The single summary comment the bot keeps up to date on a pull request. */
export function renderSummaryComment(input: SummaryCommentInput): string {
    const out: string[] = [SUMMARY_MARKER, '## OwnKey review', ''];
    if (input.paused) {
        out.push('Automatic reviews are paused on this pull request. Comment `@ownkey resume` to turn them back on, or `@ownkey review` for a one-off review.', '');
    }
    const s = input.summary;
    if (s) {
        out.push('### Summary', '', s.summary, '');
        if (input.walkthrough && s.changes.length) {
            out.push('### Walkthrough', '', '| Files | Change |', '|---|---|');
            for (const g of s.changes) out.push(`| ${g.files.map((f) => `\`${f}\``).join('<br>')} | ${cell(g.summary)} |`);
            out.push('');
            if (s.diagram) out.push('<details><summary>Sequence diagram</summary>', '', '```mermaid', s.diagram, '```', '', '</details>', '');
        }
        out.push(`**Estimated review effort:** ${s.effort}/5${s.minutes ? ` (about ${s.minutes} min)` : ''}`, '');
        if (s.attention.length) {
            out.push('### Worth a close look', '');
            for (const a of s.attention) out.push(`- ${a}`);
            out.push('');
        }
    }

    out.push('### Findings', '');
    const scope = input.incremental ? `the changes in ${input.range}` : input.range;
    if (input.note) out.push(input.note, '');
    else if (!input.posted.length && !input.outside.length) {
        out.push(`No new issues in ${scope}.${input.repeated ? ` ${plural(input.repeated, 'earlier finding')} still ${input.repeated === 1 ? 'stands' : 'stand'} in ${input.repeated === 1 ? 'its thread' : 'their threads'}.` : ''}`, '');
    } else {
        const all = [...input.posted, ...input.outside];
        out.push(
            `${plural(all.length, 'new finding')} in ${scope}: ${counts(all)}.` +
                (input.posted.length ? ` ${input.posted.length === all.length ? (all.length === 1 ? 'It is' : 'All are') : `${input.posted.length} are`} inline on the diff.` : '') +
                (input.repeated ? ` ${plural(input.repeated, 'finding')} raised earlier ${input.repeated === 1 ? 'was' : 'were'} not repeated.` : ''),
            ''
        );
        if (input.outside.length) {
            out.push('<details><summary>Findings outside the diff</summary>', '', '| Severity | Location | Finding |', '|---|---|---|');
            for (const f of input.outside) out.push(`| ${f.severity} | \`${f.filePath}:${f.line}\` | ${cell(f.content)} |`);
            out.push('', '</details>', '');
        }
    }
    if (input.skippedFiles) out.push(`> ${plural(input.skippedFiles, 'changed file')} ${input.skippedFiles === 1 ? 'was' : 'were'} not reviewed (path filters, ignore rules, or the file limit).`, '');

    out.push(
        `<sub>Reviewed ${plural(input.reviewedFiles, 'file')} in ${input.range} with \`${input.model}\`${input.incremental ? ' (incremental)' : ''}. ` +
            'Reply with `@ownkey <question>` to ask about the code, or `@ownkey help` for commands. ' +
            'Configure with <code>.ownkey.yml</code>. Powered by <a href="https://github.com/ArpitK24/OwnKey">OwnKey</a> on your own model key.</sub>'
    );
    out.push(writeState(input.state));
    return out.join('\n') + '\n';
}

export const HELP_TEXT = `**OwnKey commands** (comment on the pull request):

| Command | What it does |
|---|---|
| \`@ownkey review\` | Review the changes since the last review now |
| \`@ownkey full review\` | Review the whole pull request again from scratch |
| \`@ownkey summary\` | Regenerate the summary and walkthrough |
| \`@ownkey pause\` | Stop automatic reviews on this pull request |
| \`@ownkey resume\` | Turn automatic reviews back on |
| \`@ownkey help\` | Show this list |
| \`@ownkey <anything else>\` | Ask a question; OwnKey reads the code before it answers. In a review thread, it answers about that line. |

To teach OwnKey something for every future review, add it under \`learnings:\` in \`.ownkey.yml\`.`;
