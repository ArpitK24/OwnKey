import { existsSync, readFileSync, statSync } from 'fs';
import { join, normalize } from 'path';
import { AIProvider, type ChatMessage } from '../../ai/provider.js';
import type { CodeContext, Suggestion } from '../../types/index.js';
import { readForReview, type ReviewScope } from './git.js';

/** One tool call the agent made, for progress output and reports. */
export interface AgentStep {
    tool: 'read_file' | 'search' | 'list_files';
    /** Short human label, e.g. "read src/db.ts:1-120" */
    label: string;
}

export interface AgentOptions {
    /** Tool rounds before the agent must answer (default 6) */
    maxSteps?: number;
    /** Tool calls allowed per round (default 4) */
    maxCallsPerStep?: number;
    onStep?: (step: AgentStep) => void;
}

export interface AgentResult {
    suggestions: Suggestion[];
    steps: AgentStep[];
}

interface ToolCall {
    tool?: string;
    name?: string;
    path?: string;
    start?: number;
    end?: number;
    pattern?: string;
    [k: string]: unknown;
}

const READ_MAX_LINES = 300;
const SEARCH_MAX_MATCHES = 40;
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const LIST_MAX = 200;
const ROUND_MAX_CHARS = 24_000;

export function agentSystemPrompt(base: string): string {
    return `${base}

## Working as an agent

Before you report anything, investigate. You can call read-only tools on the repository to confirm a suspected
problem: open the definition of a function the change calls, find its other callers, check how a value is
validated elsewhere, look at tests. Only report issues you have confirmed or that are certain from the code shown.
Do not report a bug that the surrounding code already handles.

Every reply must be exactly one JSON object and nothing else. Either call tools:

{"calls": [
  {"tool": "read_file", "path": "src/db.ts", "start": 1, "end": 120},
  {"tool": "search", "pattern": "getUser\\\\(", "path": "src"},
  {"tool": "list_files", "path": "src/routes"}
]}

or finish with your findings (an empty list is a valid answer):

{"findings": [ ...suggestions in the output format above... ]}

Tools:
- read_file: lines of a file with line numbers (at most ${READ_MAX_LINES} lines per call). "start" and "end" are optional.
- search: regular expression search across the repository, returns "path:line: text" (at most ${SEARCH_MAX_MATCHES} matches). "path" optionally limits it to a folder or file.
- list_files: files under a folder ("path" optional).

Use at most a few calls per reply and only the ones you need. Paths are relative to the repository root.
Files ignored by .gitignore or .ownkeyignore are not available.`;
}

/** Pull the tool calls out of a parsed reply, in any of the shapes models tend to use. */
export function readCalls(parsed: any): ToolCall[] | null {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const list = parsed.calls ?? parsed.tools ?? parsed.tool_calls;
    if (Array.isArray(list)) return list.filter((c) => c && typeof c === 'object');
    if (typeof parsed.tool === 'string' || typeof parsed.name === 'string') return [parsed];
    return null;
}

/** Findings from a parsed reply, or null when the reply is not a final answer. */
export function readFindings(parsed: any): unknown[] | null {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.findings)) return parsed.findings;
        if (Array.isArray(parsed.suggestions)) return parsed.suggestions;
    }
    return null;
}

/** Read-only view of the repository the agent may look at: only files the scanner allows. */
export class RepoTools {
    private allowed: string[];

    constructor(
        private root: string,
        private scope: ReviewScope,
        allowedFiles: Iterable<string>,
        private changed: Set<string>
    ) {
        this.allowed = [...allowedFiles].map((f) => f.replace(/\\/g, '/')).sort();
    }

    private clean(path: unknown): string {
        const p = normalize(String(path ?? '').trim())
            .replace(/\\/g, '/')
            .replace(/^\.\//, '')
            .replace(/\/+$/, '');
        return p === '.' ? '' : p;
    }

    private content(file: string): string {
        // Changed files are read as the version under review (e.g. the staged copy)
        if (this.changed.has(file)) return readForReview(this.root, this.scope, file);
        return readFileSync(join(this.root, file), 'utf-8');
    }

    readFile(path: unknown, start?: unknown, end?: unknown): string {
        const file = this.clean(path);
        if (!this.allowed.includes(file)) {
            const near = this.allowed.filter((f) => f.endsWith('/' + file.split('/').pop())).slice(0, 3);
            return `Error: ${file || '(no path)'} is not an available file.` + (near.length ? ` Did you mean: ${near.join(', ')}?` : '');
        }
        const lines = this.content(file).split('\n');
        if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
        const from = Math.max(1, Number(start) || 1);
        const to = Math.min(lines.length, Number(end) || from + READ_MAX_LINES - 1, from + READ_MAX_LINES - 1);
        const body = lines
            .slice(from - 1, to)
            .map((l, i) => `${String(from + i).padStart(5)}  ${l}`)
            .join('\n');
        const more = to < lines.length ? `\n... (${lines.length} lines total; ask for start=${to + 1} to read more)` : '';
        return `${file} lines ${from}-${to}:\n${body}${more}`;
    }

    search(pattern: unknown, path?: unknown): string {
        const raw = String(pattern ?? '');
        if (!raw) return 'Error: search needs a "pattern".';
        let re: RegExp;
        try {
            re = new RegExp(raw);
        } catch {
            re = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
        const prefix = this.clean(path);
        const out: string[] = [];
        for (const file of this.allowed) {
            if (prefix && file !== prefix && !file.startsWith(prefix + '/')) continue;
            const abs = join(this.root, file);
            if (!this.changed.has(file) && (!existsSync(abs) || statSync(abs).size > SEARCH_MAX_FILE_BYTES)) continue;
            const lines = this.content(file).split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (re.test(lines[i])) {
                    out.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
                    if (out.length >= SEARCH_MAX_MATCHES) return out.join('\n') + `\n... (stopped at ${SEARCH_MAX_MATCHES} matches; narrow the pattern or path)`;
                }
            }
        }
        return out.length ? out.join('\n') : `No matches for /${raw}/${prefix ? ` in ${prefix}` : ''}.`;
    }

    listFiles(path?: unknown): string {
        const prefix = this.clean(path);
        const files = this.allowed.filter((f) => !prefix || f.startsWith(prefix + '/'));
        if (!files.length) return `No files under ${prefix || 'the repository root'}.`;
        const shown = files.slice(0, LIST_MAX).join('\n');
        return files.length > LIST_MAX ? `${shown}\n... (${files.length} files; list a subfolder)` : shown;
    }

    run(call: ToolCall): { step: AgentStep; output: string } {
        const tool = String(call.tool ?? call.name ?? '');
        const args = (call.args && typeof call.args === 'object' ? call.args : call) as ToolCall;
        switch (tool) {
            case 'read_file': {
                const label = `read ${this.clean(args.path)}${args.start || args.end ? `:${args.start ?? 1}-${args.end ?? ''}` : ''}`;
                return { step: { tool, label }, output: this.readFile(args.path, args.start, args.end) };
            }
            case 'search': {
                const where = this.clean(args.path);
                return { step: { tool, label: `search /${String(args.pattern ?? '')}/${where ? ` in ${where}` : ''}` }, output: this.search(args.pattern, args.path) };
            }
            case 'list_files':
                return { step: { tool, label: `list ${this.clean(args.path) || '.'}` }, output: this.listFiles(args.path) };
            default:
                return { step: { tool: 'list_files', label: `unknown tool ${tool}` }, output: `Error: unknown tool "${tool}". Use read_file, search or list_files.` };
        }
    }
}

/**
 * Agentic review: the model sees the changed files and the patch, then investigates the repository with
 * read-only tools before it answers. Works with every provider through plain JSON turns, no native tool API.
 */
export async function runAgentReview(provider: AIProvider, context: CodeContext, tools: RepoTools, options: AgentOptions = {}): Promise<AgentResult> {
    const maxSteps = options.maxSteps ?? 6;
    const maxCalls = options.maxCallsPerStep ?? 4;
    const system = agentSystemPrompt(provider.getSystemPrompt());
    const messages: ChatMessage[] = [
        {
            role: 'user',
            content:
                provider.buildUserPrompt(context) +
                '\n\nInvestigate with tools if anything needs confirming, then reply with {"findings": [...]}. Reply with one JSON object only.',
        },
    ];
    const steps: AgentStep[] = [];
    let nudged = false;

    for (let round = 0; ; round++) {
        const reply = await provider.chat(system, messages);
        const parsed = AIProvider.extractJson(reply);

        const findings = readFindings(parsed);
        if (findings) return { suggestions: provider.parseSuggestions(JSON.stringify(findings)), steps };

        const calls = readCalls(parsed);
        if (!calls || calls.length === 0) {
            if (nudged) return { suggestions: provider.parseSuggestions(reply), steps };
            nudged = true;
            messages.push({ role: 'assistant', content: reply });
            messages.push({ role: 'user', content: 'That was not a valid reply. Reply with exactly one JSON object: {"calls": [...]} or {"findings": [...]}.' });
            continue;
        }

        if (round > maxSteps) {
            throw new Error('The model kept calling tools instead of answering. Try a larger model, or run with --quick for a single-pass review.');
        }
        messages.push({ role: 'assistant', content: reply });
        if (round >= maxSteps) {
            messages.push({ role: 'user', content: 'No more tool calls are available. Reply now with {"findings": [...]} based on what you have seen.' });
            continue;
        }

        const results: string[] = [];
        let used = 0;
        for (const call of calls.slice(0, maxCalls)) {
            const { step, output } = tools.run(call);
            steps.push(step);
            options.onStep?.(step);
            const room = ROUND_MAX_CHARS - used;
            if (room <= 200) {
                results.push(`[${step.label}] skipped: output budget for this reply is used up.`);
                continue;
            }
            const clipped = output.length > room ? output.slice(0, room) + '\n... (truncated)' : output;
            used += clipped.length;
            results.push(`[${step.label}]\n${clipped}`);
        }
        if (calls.length > maxCalls) results.push(`Only the first ${maxCalls} calls were run.`);
        const left = maxSteps - round - 1;
        results.push(left > 0 ? `${left} tool round(s) left.` : 'That was the last tool round. Reply next with {"findings": [...]}.');
        messages.push({ role: 'user', content: results.join('\n\n') });
    }
}
