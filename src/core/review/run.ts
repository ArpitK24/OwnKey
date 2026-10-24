import { basename } from 'path';
import { FileScanner } from '../scanner.js';
import { collectChanges, readForReview, type ChangeSet, type ReviewScope } from './git.js';
import type { AIProvider } from '../../ai/provider.js';
import type { CodeContext, FileContent, FileMetadata, Suggestion } from '../../types/index.js';

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
export async function prepareReview(root: string, scope: ReviewScope, maxFiles = 25): Promise<ReviewTarget> {
    const changes = collectChanges(root, scope);
    const scanner = new FileScanner(root);
    const scanned = await scanner.scan();
    const metadata = new Map(scanned.files.map((f) => [f.relativePath.replace(/\\/g, '/'), f] as const));
    const reviewable = changes.files.filter((f) => metadata.has(f));
    return { changes, reviewable, selected: reviewable.slice(0, maxFiles), metadata };
}

/**
 * Send the selected files (in full, for context) and the patch (as focus) to the model.
 * Returns suggestions on the selected files only, with normalized paths.
 */
export async function analyzeChanges(root: string, scope: ReviewScope, target: ReviewTarget, provider: AIProvider): Promise<Suggestion[]> {
    const contents: FileContent[] = target.selected.map((f) => ({ ...target.metadata.get(f)!, content: readForReview(root, scope, f) }));

    const context: CodeContext = {
        files: contents,
        projectInfo: { name: basename(root), rootPath: root, fileCount: contents.length },
        reviewPatch: target.changes.patch,
    };

    const raw: Suggestion[] = [];
    for await (const s of provider.analyze(context)) raw.push(s);

    const inScope = new Set(target.selected);
    return raw
        .map((s) => ({ ...s, filePath: s.filePath.replace(/\\/g, '/').replace(/^\.\//, '') }))
        .filter((s) => inScope.has(s.filePath));
}
