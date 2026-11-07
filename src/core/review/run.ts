import { basename } from 'path';
import { FileScanner } from '../scanner.js';
import { collectChanges, readForReview, type ChangeSet, type ReviewScope } from './git.js';
import type { AIProvider } from '../../ai/provider.js';
import { verifyFindings } from './verify.js';
import { RepoTools, runAgentReview, type AgentStep } from './agent.js';
import type { CodeContext, FileContent, FileMetadata, Suggestion } from '../../types/index.js';
import { passesPathFilters, reviewGuidance, type RepoConfig } from '../../config/repo-config.js';

export interface ReviewTarget {
    changes: ChangeSet;
    /** Changed files that pass ignore/size/binary rules */
    reviewable: string[];
    /** Files actually sent to the model (reviewable, capped by maxFiles) */
    selected: string[];
    /** Scanner metadata by repo-relative path */
    metadata: Map<string, FileMetadata>;
}

/** Work out which changed files to review, honouring .gitignore/.ownkeyignore, size and binary rules. */
export async function prepareReview(root: string, scope: ReviewScope, maxFiles = 25, pathFilters: string[] = []): Promise<ReviewTarget> {
    const changes = collectChanges(root, scope);
    const scanner = new FileScanner(root);
    const scanned = await scanner.scan();
    const metadata = new Map(scanned.files.map((f) => [f.relativePath.replace(/\\/g, '/'), f] as const));
    const reviewable = changes.files.filter((f) => metadata.has(f) && passesPathFilters(f, pathFilters));
    return { changes, reviewable, selected: reviewable.slice(0, maxFiles), metadata };
}

export interface AnalyzeOptions {
    /** Single request with no tools, as in 1.3 and earlier (default false: agentic review) */
    quick?: boolean;
    /** Tool rounds the agent may use (default 6) */
    maxSteps?: number;
    onStep?: (step: AgentStep) => void;
    /** Settings from .ownkey.yml: profile, instructions and learnings for the model */
    repoConfig?: RepoConfig;
    /** Check each finding against the real code in a second pass and drop the unsupported ones (default: on, except with quick) */
    doubleCheck?: boolean;
    /** Called for each finding the double check dropped */
    onRejected?: (finding: Suggestion, reason: string) => void;
}

/**
 * Send the selected files (in full, for context) and the patch (as focus) to the model. By default the model
 * then investigates the rest of the repository with read-only tools before answering.
 * Returns suggestions on the selected files only, with normalized paths.
 */
export async function analyzeChanges(root: string, scope: ReviewScope, target: ReviewTarget, provider: AIProvider, options: AnalyzeOptions = {}): Promise<Suggestion[]> {
    const budget = fitContext(
        target.selected.map((f) => ({ ...target.metadata.get(f)!, content: readForReview(root, scope, f) })),
        target.changes.patch
    );
    const contents: FileContent[] = budget.files;

    const context: CodeContext = {
        files: contents,
        projectInfo: { name: basename(root), rootPath: root, fileCount: contents.length },
        reviewPatch: budget.patch,
        guidance: options.repoConfig ? reviewGuidance(options.repoConfig, target.selected) : undefined,
        newFiles: newFilesIn(budget.patch),
    };

    const raw: Suggestion[] = [];
    if (options.quick) {
        for await (const s of provider.analyze(context)) raw.push(s);
    } else {
        const tools = new RepoTools(root, scope, target.metadata.keys(), new Set(target.changes.files));
        raw.push(...(await runAgentReview(provider, context, tools, { maxSteps: options.maxSteps, onStep: options.onStep })).suggestions);
    }

    const inScope = new Set(target.selected);
    const found = raw.map((s) => ({ ...s, filePath: s.filePath.replace(/\\/g, '/').replace(/^\.\//, '') })).filter((s) => inScope.has(s.filePath));
    if (!(options.doubleCheck ?? !options.quick)) return found;
    const readLines = (file: string) => {
        try {
            return readForReview(root, scope, file).split('\n');
        } catch {
            return undefined;
        }
    };
    return verifyFindings(provider, found, readLines, options.onRejected);
}

/** Files a unified diff adds. */
export function newFilesIn(patch: string): string[] {
    const out: string[] = [];
    let current: string | undefined;
    for (const line of patch.split('\n')) {
        const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(line);
        if (m) current = m[2];
        else if (current && line.startsWith('new file mode')) out.push(current);
    }
    return out;
}

/** Characters of files and diff the first prompt may hold (about 4 characters per token). */
export const DEFAULT_CONTEXT_CHARS = 200_000;

/**
 * Keep the first prompt within the model's context. The diff is the focus, so it goes in
 * first (whole files cut from its end if it alone is too long). Changed files follow in
 * full while they fit; the rest are listed with a pointer to read_file, which the agent
 * can use to read exactly the parts it needs.
 */
export function fitContext(files: FileContent[], patch: string, max = Number(process.env.OWNKEY_MAX_CONTEXT_CHARS) || DEFAULT_CONTEXT_CHARS): { files: FileContent[]; patch: string; trimmed: string[] } {
    let fittedPatch = patch;
    if (patch.length > max * 0.6) {
        const parts = patch.split(/(?=^diff --git )/m);
        const kept: string[] = [];
        let size = 0;
        for (const part of parts) {
            if (size + part.length > max * 0.6) continue;
            kept.push(part);
            size += part.length;
        }
        fittedPatch = kept.join('') + `\n# (${parts.length - kept.length} more file diff(s) left out to fit the model's context)\n`;
    }
    let room = max - fittedPatch.length;
    const trimmed: string[] = [];
    const out = files.map((f) => {
        if (f.content.length <= room) {
            room -= f.content.length;
            return f;
        }
        trimmed.push(f.relativePath);
        return { ...f, content: `(${f.content.split('\n').length} lines, not shown in full to fit the model's context. Its changes are in the diff; use read_file for the rest.)` };
    });
    return { files: out, patch: fittedPatch, trimmed };
}
