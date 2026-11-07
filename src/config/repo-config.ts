import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import ignore from 'ignore';
import { parse } from 'yaml';
import type { Severity } from '../types/index.js';

/**
 * Per-repository review settings, read from `.ownkey.yml` (or `.ownkey.yaml`) at the
 * repository root. Every key is optional; a repository without the file reviews with
 * the defaults below. Shared by `ownkey review` and the pull request bot.
 */
export interface RepoConfig {
    reviews: {
        /** chill: bugs, security and correctness only. assertive: also style, refactors and tests. */
        profile: 'chill' | 'assertive';
        /** Guidance for every review, e.g. "We validate input with zod" */
        instructions: string;
        /** Extra guidance for files matching a glob */
        pathInstructions: { path: string; instructions: string }[];
        /** Globs to include; a leading ! excludes. Applied on top of .gitignore/.ownkeyignore */
        pathFilters: string[];
        severity?: Severity;
        maxFiles?: number;
        /** Pull request bot */
        summary: boolean;
        walkthrough: boolean;
        inlineComments: boolean;
        /** Review only the commits pushed since the last review */
        incremental: boolean;
        autoReview: {
            enabled: boolean;
            drafts: boolean;
            ignoreTitleKeywords: string[];
            /** Base branches to review; empty means all */
            baseBranches: string[];
        };
    };
    /** Things the team taught the reviewer, applied to every review */
    learnings: string[];
}

export const DEFAULT_REPO_CONFIG: RepoConfig = {
    reviews: {
        profile: 'chill',
        instructions: '',
        pathInstructions: [],
        pathFilters: [],
        summary: true,
        walkthrough: true,
        inlineComments: true,
        incremental: true,
        autoReview: { enabled: true, drafts: false, ignoreTitleKeywords: ['WIP', 'DO NOT REVIEW'], baseBranches: [] },
    },
    learnings: [],
};

export const REPO_CONFIG_FILES = ['.ownkey.yml', '.ownkey.yaml'];

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

function bool(v: unknown, fallback: boolean): boolean {
    return typeof v === 'boolean' ? v : fallback;
}

function strings(v: unknown): string[] {
    if (typeof v === 'string') return [v];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
}

/** Accept snake_case or camelCase keys. */
function pick(obj: any, ...keys: string[]): unknown {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const k of keys) if (obj[k] !== undefined) return obj[k];
    return undefined;
}

/** Turn parsed YAML into a full config, ignoring unknown or mistyped keys. */
export function normalizeRepoConfig(raw: unknown): RepoConfig {
    const d = DEFAULT_REPO_CONFIG.reviews;
    const r: any = pick(raw, 'reviews') ?? {};
    const auto: any = pick(r, 'auto_review', 'autoReview') ?? {};
    const profile = pick(r, 'profile');
    const severity = String(pick(r, 'severity') ?? '').toLowerCase() as Severity;
    const maxFiles = Number(pick(r, 'max_files', 'maxFiles'));
    const pathInstructions = (Array.isArray(pick(r, 'path_instructions', 'pathInstructions')) ? (pick(r, 'path_instructions', 'pathInstructions') as any[]) : [])
        .filter((p) => p && typeof p.path === 'string' && typeof p.instructions === 'string')
        .map((p) => ({ path: p.path.trim(), instructions: p.instructions.trim() }));
    return {
        reviews: {
            profile: profile === 'assertive' ? 'assertive' : 'chill',
            instructions: typeof pick(r, 'instructions') === 'string' ? String(pick(r, 'instructions')).trim() : '',
            pathInstructions,
            pathFilters: strings(pick(r, 'path_filters', 'pathFilters')),
            severity: SEVERITIES.includes(severity) ? severity : undefined,
            maxFiles: Number.isInteger(maxFiles) && maxFiles > 0 ? maxFiles : undefined,
            summary: bool(pick(r, 'summary'), d.summary),
            walkthrough: bool(pick(r, 'walkthrough'), d.walkthrough),
            inlineComments: bool(pick(r, 'inline_comments', 'inlineComments'), d.inlineComments),
            incremental: bool(pick(r, 'incremental'), d.incremental),
            autoReview: {
                enabled: bool(pick(auto, 'enabled'), d.autoReview.enabled),
                drafts: bool(pick(auto, 'drafts'), d.autoReview.drafts),
                ignoreTitleKeywords: pick(auto, 'ignore_title_keywords', 'ignoreTitleKeywords') !== undefined ? strings(pick(auto, 'ignore_title_keywords', 'ignoreTitleKeywords')) : d.autoReview.ignoreTitleKeywords,
                baseBranches: strings(pick(auto, 'base_branches', 'baseBranches')),
            },
        },
        learnings: strings(pick(raw, 'learnings')),
    };
}

/** Read `.ownkey.yml` from a repository root. A broken file is an error, not a silent default. */
export function loadRepoConfig(root: string): RepoConfig & { source?: string } {
    for (const name of REPO_CONFIG_FILES) {
        const file = join(root, name);
        if (!existsSync(file)) continue;
        let raw: unknown;
        try {
            raw = parse(readFileSync(file, 'utf-8'));
        } catch (e) {
            throw new Error(`${name} is not valid YAML: ${(e as Error).message.split('\n')[0]}`);
        }
        return { ...normalizeRepoConfig(raw ?? {}), source: name };
    }
    return normalizeRepoConfig({});
}

function matcher(pattern: string): (file: string) => boolean {
    const ig = ignore().add(pattern);
    return (file) => ig.ignores(file.replace(/\\/g, '/'));
}

/** Whether a changed file passes the config's path filters. */
export function passesPathFilters(file: string, filters: string[]): boolean {
    const include = filters.filter((f) => !f.startsWith('!')).map(matcher);
    const exclude = filters.filter((f) => f.startsWith('!')).map((f) => matcher(f.slice(1)));
    if (exclude.some((m) => m(file))) return false;
    return include.length === 0 || include.some((m) => m(file));
}

/**
 * Review guidance for the model: the profile, the repository's instructions, the
 * instructions for the files under review, and the team's learnings.
 */
export function reviewGuidance(config: RepoConfig, files: string[]): string {
    const parts: string[] = [];
    if (config.reviews.profile === 'chill') {
        parts.push(
            'Review profile: chill. Report only real problems: bugs, security issues, data loss, broken error handling, and clear performance problems. Skip style, naming, formatting, and optional refactors.'
        );
    } else {
        parts.push('Review profile: assertive. Besides bugs and security issues, also point out unclear code, missing tests, and refactors that make the change easier to maintain.');
    }
    if (config.reviews.instructions) parts.push(`Repository instructions:\n${config.reviews.instructions}`);
    for (const p of config.reviews.pathInstructions) {
        const m = matcher(p.path);
        const hit = files.filter((f) => m(f));
        if (hit.length) parts.push(`Instructions for ${p.path} (applies to ${hit.join(', ')}):\n${p.instructions}`);
    }
    if (config.learnings.length) parts.push(`What this team has taught you (follow these):\n${config.learnings.map((l) => `- ${l}`).join('\n')}`);
    return parts.join('\n\n');
}
