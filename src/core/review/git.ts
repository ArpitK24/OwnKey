import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

export type ReviewScope =
    | { kind: 'staged' }
    | { kind: 'working' }
    | { kind: 'base'; ref: string; mergeBase: string };

export interface ChangeSet {
    root: string;
    scope: ReviewScope;
    /** Changed files (added, copied, modified, renamed), relative to the repo root */
    files: string[];
    /** Unified diff of those files, used as review focus for the model */
    patch: string;
    /** Changed line ranges per file in the new version, for SARIF/inline locations */
    changedLines: Map<string, Array<[number, number]>>;
}

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function gitRoot(cwd: string): string {
    try {
        return git(cwd, ['rev-parse', '--show-toplevel']).trim();
    } catch {
        throw new Error('Not a git repository. `ownkey review` reviews git changes; use `ownkey suggest` for any folder.');
    }
}

function diffArgs(scope: ReviewScope): string[] {
    switch (scope.kind) {
        case 'staged':
            return ['--cached'];
        case 'working':
            return ['HEAD'];
        case 'base':
            return [scope.mergeBase];
    }
}

/**
 * Resolve what to review. Default: staged changes if any, otherwise uncommitted changes against HEAD.
 */
export function resolveScope(root: string, opts: { staged?: boolean; base?: string }): ReviewScope {
    if (opts.base) {
        let mergeBase: string;
        try {
            mergeBase = git(root, ['merge-base', opts.base, 'HEAD']).trim();
        } catch {
            throw new Error(`Cannot find a merge base with "${opts.base}". Fetch it first (git fetch origin) or check the name.`);
        }
        return { kind: 'base', ref: opts.base, mergeBase };
    }
    if (opts.staged) return { kind: 'staged' };
    const staged = git(root, ['diff', '--cached', '--name-only']).trim();
    return staged ? { kind: 'staged' } : { kind: 'working' };
}

export function collectChanges(root: string, scope: ReviewScope): ChangeSet {
    const args = diffArgs(scope);
    const files = git(root, ['diff', ...args, '--name-only', '--diff-filter=ACMR', '-z'])
        .split('\0')
        .filter(Boolean);
    const patch = files.length ? git(root, ['diff', ...args, '--diff-filter=ACMR', '--unified=3', '--no-color', '--', ...files]) : '';
    return { root, scope, files, patch, changedLines: parseChangedLines(patch) };
}

/** Content of a file as it will be committed (index for staged reviews, working tree otherwise). */
export function readForReview(root: string, scope: ReviewScope, file: string): string {
    if (scope.kind === 'staged') return git(root, ['show', `:${file}`]);
    return readFileSync(join(root, file), 'utf-8');
}

export function describeScope(scope: ReviewScope): string {
    switch (scope.kind) {
        case 'staged':
            return 'staged changes';
        case 'working':
            return 'uncommitted changes';
        case 'base':
            return `changes since ${scope.ref} (${scope.mergeBase.slice(0, 7)})`;
    }
}

export function parseChangedLines(patch: string): Map<string, Array<[number, number]>> {
    const out = new Map<string, Array<[number, number]>>();
    let current: string | null = null;
    for (const line of patch.split('\n')) {
        if (line.startsWith('+++ ')) {
            const p = line.slice(4).trim();
            current = p === '/dev/null' ? null : p.replace(/^b\//, '');
            if (current && !out.has(current)) out.set(current, []);
            continue;
        }
        const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (m && current) {
            const start = parseInt(m[1], 10);
            const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
            if (count > 0) out.get(current)!.push([start, start + count - 1]);
        }
    }
    return out;
}
