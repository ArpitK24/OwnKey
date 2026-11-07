import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { alreadyPosted, findingMarker, inlineCommentBody, isCommentable, nearestCommentable, toSuggestedChange } from '../../src/core/pr/inline';
import { clipPatch, normalizeSummary } from '../../src/core/pr/summary';
import { readState, writeState, renderSummaryComment, SUMMARY_MARKER } from '../../src/core/pr/comment';
import { autoReviewSkipReason, parseBotCommand } from '../../src/core/pr/bot';
import { loadRepoConfig, normalizeRepoConfig, passesPathFilters, reviewGuidance, DEFAULT_REPO_CONFIG } from '../../src/config/repo-config';
import type { Finding } from '../../src/core/review/report';

const FILE = ['function total(items) {', '  let sum = 0;', '  for (let i = 0; i <= items.length; i++) {', '    sum += items[i];', '  }', '  return sum;', '}'];
const f = (over: Partial<Finding> = {}): Finding => ({ type: 'bug', severity: 'high', content: 'Off by one', filePath: 'a.js', line: 3, rationale: 'Reads past the end.', diff: '', ...over }) as Finding;

describe('suggested changes from a unified diff', () => {
    it('replaces the removed lines with the added ones', () => {
        const diff = ['--- a/a.js', '+++ b/a.js', '@@ -2,3 +2,3 @@', '   let sum = 0;', '-  for (let i = 0; i <= items.length; i++) {', '+  for (let i = 0; i < items.length; i++) {', '     sum += items[i];'].join('\n');
        expect(toSuggestedChange(diff, FILE)).toEqual({ start: 3, end: 3, replacement: ['  for (let i = 0; i < items.length; i++) {'] });
    });

    it('handles a multi-line replacement and a deletion', () => {
        const diff = ['@@ -3,3 +3,1 @@', '-  for (let i = 0; i <= items.length; i++) {', '-    sum += items[i];', '-  }', '+  for (const x of items) sum += x;'].join('\n');
        expect(toSuggestedChange(diff, FILE)).toEqual({ start: 3, end: 5, replacement: ['  for (const x of items) sum += x;'] });
        const del = ['@@ -2,2 +2,1 @@', '   let sum = 0;', '-  for (let i = 0; i <= items.length; i++) {'].join('\n');
        expect(toSuggestedChange(del, FILE)).toEqual({ start: 3, end: 3, replacement: [] });
    });

    it('turns an insertion into a replacement of the line before it', () => {
        const diff = ['@@ -1,2 +1,3 @@', ' function total(items) {', '+  if (!items) return 0;', '   let sum = 0;'].join('\n');
        expect(toSuggestedChange(diff, FILE)).toEqual({ start: 1, end: 1, replacement: ['function total(items) {', '  if (!items) return 0;'] });
    });

    it('refuses what it cannot place exactly', () => {
        expect(toSuggestedChange('', FILE)).toBeUndefined();
        // Two hunks
        expect(toSuggestedChange('@@ -1 +1 @@\n-a\n+b\n@@ -5 +5 @@\n-c\n+d', FILE)).toBeUndefined();
        // Removed text that is not in the file
        expect(toSuggestedChange('@@ -1 +1 @@\n-nope\n+yes', FILE)).toBeUndefined();
        // Two separate changes with an unchanged line between them
        expect(toSuggestedChange('@@ -1,3 +1,3 @@\n-function total(items) {\n+function total(xs) {\n   let sum = 0;\n-  for (let i = 0; i <= items.length; i++) {\n+  x', FILE)).toBeUndefined();
        // Ambiguous: the removed line appears twice and there is no context
        expect(toSuggestedChange('@@ -1 +1 @@\n-x\n+y', ['x', 'x'])).toBeUndefined();
    });
});

describe('where comments can go', () => {
    const lines = new Map([['a.js', [[3, 6] as [number, number]]]]);
    it('accepts lines inside a hunk and snaps nearby ones', () => {
        expect(isCommentable(lines, 'a.js', 3)).toBe(true);
        expect(isCommentable(lines, 'a.js', 7)).toBe(false);
        expect(nearestCommentable(lines, 'a.js', 8)).toBe(6);
        expect(nearestCommentable(lines, 'a.js', 20)).toBeUndefined();
        expect(nearestCommentable(lines, 'b.js', 3)).toBeUndefined();
    });
});

describe('inline comments', () => {
    it('carry the severity, reasoning, a suggestion block and a marker', () => {
        const body = inlineCommentBody(f(), { start: 3, end: 3, replacement: ['fixed'] });
        expect(body).toContain('**High · Bug**');
        expect(body).toContain('Reads past the end.');
        expect(body).toContain('```suggestion\nfixed\n```');
        expect(body).toContain(findingMarker(f()));
    });

    it('fall back to a collapsed diff when no suggestion fits', () => {
        expect(inlineCommentBody(f({ diff: '--- a\n+++ b\n@@\n-x\n+y' }))).toContain('<details><summary>Proposed fix</summary>');
    });

    it('are not repeated for the same file and type within a few lines', () => {
        const existing = [{ body: inlineCommentBody(f({ line: 3 })), path: 'a.js', line: 3 }];
        expect(alreadyPosted(f({ line: 5 }), existing)).toBe(true);
        expect(alreadyPosted(f({ line: 9 }), existing)).toBe(false);
        expect(alreadyPosted(f({ type: 'security' }), existing)).toBe(false);
        expect(alreadyPosted(f({ filePath: 'b.js' }), existing)).toBe(false);
        // Outdated comments (line null) fall back to the line in the marker
        expect(alreadyPosted(f({ line: 4 }), [{ body: existing[0].body, line: null }])).toBe(true);
    });
});

describe('pull request summary', () => {
    it('keeps the walkthrough to real files and covers every file', () => {
        const s = normalizeSummary({ summary: ' Adds X. ', changes: [{ files: ['./a.js', 'ghost.js'], summary: 'A' }, { files: [], summary: 'empty' }], effort: 9, minutes: '12', attention: ['one', '', 'two', 'three', 'four'], diagram: '```mermaid\nsequenceDiagram\nA->>B: x\n```' }, ['a.js', 'b.js']);
        expect(s.summary).toBe('Adds X.');
        expect(s.changes).toEqual([{ files: ['a.js'], summary: 'A' }, { files: ['b.js'], summary: 'Other changes.' }]);
        expect(s.effort).toBe(5);
        expect(s.minutes).toBe(12);
        expect(s.attention).toEqual(['one', 'two', 'three']);
        expect(s.diagram).toBe('sequenceDiagram\nA->>B: x');
    });

    it('survives a reply that is not JSON', () => {
        const s = normalizeSummary(null, ['a.js']);
        expect(s.summary).toBe('No summary was produced.');
        expect(s.changes).toEqual([{ files: ['a.js'], summary: 'Other changes.' }]);
        expect(s.diagram).toBeUndefined();
    });

    it('cuts whole files from a long diff and names them', () => {
        const patch = ['diff --git a/a.js b/a.js\n' + 'x'.repeat(50) + '\n', 'diff --git a/b.js b/b.js\n' + 'y'.repeat(50) + '\n'].join('');
        const { text, omitted } = clipPatch(patch, 90);
        expect(text).toContain('a/a.js');
        expect(text).not.toContain('b/b.js');
        expect(omitted).toEqual(['b.js']);
    });
});

describe('bot state and summary comment', () => {
    it('round-trips its state in a hidden line', () => {
        expect(readState(`x\n${writeState({ reviewed: 'abc', paused: true })}\n`)).toEqual({ reviewed: 'abc', paused: true });
        expect(readState('no state')).toEqual({});
        expect(readState('<!-- ownkey:state !!! -->')).toEqual({});
    });

    it('says when there is nothing new and when files were skipped', () => {
        const body = renderSummaryComment({ walkthrough: true, posted: [], outside: [], repeated: 2, range: 'abc..def', incremental: true, model: 'm', state: {}, reviewedFiles: 1, skippedFiles: 3, paused: true });
        expect(body.startsWith(SUMMARY_MARKER)).toBe(true);
        expect(body).toContain('No new issues in the changes in abc..def. 2 earlier findings still stand');
        expect(body).toContain('3 changed files were not reviewed');
        expect(body).toContain('Automatic reviews are paused');
    });
});

describe('@ownkey commands', () => {
    it('reads commands and questions', () => {
        expect(parseBotCommand('thanks!')).toBeUndefined();
        expect(parseBotCommand('mail me@ownkeyx.com')).toBeUndefined();
        expect(parseBotCommand('@ownkey')).toEqual({ kind: 'help' });
        expect(parseBotCommand('@OwnKey help')).toEqual({ kind: 'help' });
        expect(parseBotCommand('@ownkey pause')).toEqual({ kind: 'pause' });
        expect(parseBotCommand('@ownkey resume.')).toEqual({ kind: 'resume' });
        expect(parseBotCommand('@ownkey review')).toEqual({ kind: 'review', full: false });
        expect(parseBotCommand('@ownkey full review')).toEqual({ kind: 'review', full: true });
        expect(parseBotCommand('@ownkey summary')).toEqual({ kind: 'summary' });
        expect(parseBotCommand('Hey @ownkey, why is this async?')).toEqual({ kind: 'ask', question: 'why is this async?' });
    });

    it('skips automatic reviews when it should', () => {
        const cfg = normalizeRepoConfig({});
        const pull = { draft: false, title: 'Add x', base: { ref: 'main', sha: '' }, state: 'open' };
        expect(autoReviewSkipReason(cfg, pull, {})).toBeUndefined();
        expect(autoReviewSkipReason(cfg, { ...pull, draft: true }, {})).toContain('draft');
        expect(autoReviewSkipReason(cfg, { ...pull, title: '[wip] x' }, {})).toContain('WIP');
        expect(autoReviewSkipReason(cfg, pull, { paused: true })).toContain('paused');
        expect(autoReviewSkipReason(cfg, { ...pull, state: 'closed' }, {})).toContain('not open');
        const only = normalizeRepoConfig({ reviews: { auto_review: { base_branches: ['release'], enabled: true } } });
        expect(autoReviewSkipReason(only, pull, {})).toContain('base_branches');
        expect(autoReviewSkipReason(normalizeRepoConfig({ reviews: { auto_review: { enabled: false } } }), pull, {})).toContain('turned off');
    });
});

describe('.ownkey.yml', () => {
    it('reads snake_case and camelCase, and ignores mistyped values', () => {
        const c = normalizeRepoConfig({
            reviews: { profile: 'assertive', severity: 'HIGH', max_files: 10, path_filters: ['src/**', '!**/*.test.ts'], pathInstructions: [{ path: 'api/**', instructions: 'Check auth.' }, { path: 3 }], inline_comments: 'yes' },
            learnings: ['Use zod.', 42],
        });
        expect(c.reviews.profile).toBe('assertive');
        expect(c.reviews.severity).toBe('high');
        expect(c.reviews.maxFiles).toBe(10);
        expect(c.reviews.pathInstructions).toEqual([{ path: 'api/**', instructions: 'Check auth.' }]);
        expect(c.reviews.inlineComments).toBe(true);
        expect(c.learnings).toEqual(['Use zod.']);
        expect(normalizeRepoConfig(undefined)).toEqual(DEFAULT_REPO_CONFIG);
    });

    it('filters paths with includes and excludes', () => {
        const filters = ['src/**', '!**/*.test.ts', '!src/gen/**'];
        expect(passesPathFilters('src/a.ts', filters)).toBe(true);
        expect(passesPathFilters('src/a.test.ts', filters)).toBe(false);
        expect(passesPathFilters('src/gen/x.ts', filters)).toBe(false);
        expect(passesPathFilters('docs/a.md', filters)).toBe(false);
        expect(passesPathFilters('docs/a.md', ['!*.lock'])).toBe(true);
        expect(passesPathFilters('package-lock.json', [])).toBe(true);
    });

    it('builds guidance from the profile, matching path instructions and learnings', () => {
        const c = normalizeRepoConfig({ reviews: { instructions: 'Money is in cents.', path_instructions: [{ path: 'api/**', instructions: 'Check auth.' }, { path: 'web/**', instructions: 'Check a11y.' }] }, learnings: ['Use zod.'] });
        const g = reviewGuidance(c, ['api/users.ts']);
        expect(g).toContain('Review profile: chill');
        expect(g).toContain('Money is in cents.');
        expect(g).toContain('Check auth.');
        expect(g).not.toContain('Check a11y.');
        expect(g).toContain('- Use zod.');
    });

    it('loads the file from a repository, and reports broken YAML', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ok-cfg-'));
        expect(loadRepoConfig(dir).source).toBeUndefined();
        writeFileSync(join(dir, '.ownkey.yml'), 'reviews:\n  profile: assertive\n');
        expect(loadRepoConfig(dir)).toMatchObject({ source: '.ownkey.yml', reviews: { profile: 'assertive' } });
        writeFileSync(join(dir, '.ownkey.yml'), 'reviews: [unclosed\n');
        expect(() => loadRepoConfig(dir)).toThrow(/not valid YAML/);
    });
});
