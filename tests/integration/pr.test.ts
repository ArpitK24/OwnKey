import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ownkey, makeHome } from '../helpers/cli';
import { startMockGitHub } from '../helpers/mock-github';
import { startMockReviewer } from '../helpers/mock-reviewer';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

const DB = ['export async function saveOrder(order) {', "  await pool.query('insert into orders values ($1, $2)', [order.id, order.total]);", '}', ''].join('\n');
const ORDERS = ['import { saveOrder } from "./db";', '', 'export async function createOrder(req) {', '  const order = { id: req.id, total: req.total };', '  saveOrder(order);', '  return order;', '}', ''].join('\n');

const AWAIT_FIX = [
    '--- a/src/orders.js',
    '+++ b/src/orders.js',
    '@@ -4,3 +4,3 @@',
    '   const order = { id: req.id, total: req.total };',
    '-  saveOrder(order);',
    '+  await saveOrder(order);',
    '   return order;',
].join('\n');

const FINDINGS = [
    { type: 'bug', severity: 'high', content: 'saveOrder is not awaited', filePath: 'src/orders.js', line: 5, rationale: 'The write can fail silently.', diff: AWAIT_FIX },
    { type: 'security', severity: 'medium', content: 'Total comes from the client', filePath: 'src/orders.js', line: 4, rationale: 'Recompute it on the server.', diff: '' },
    { type: 'bug', severity: 'low', content: 'An old problem outside the diff', filePath: 'src/old.js', line: 1, rationale: '', diff: '' },
];

describe('ownkey pr', () => {
    let model: Awaited<ReturnType<typeof startMockReviewer>>;
    let gh: Awaited<ReturnType<typeof startMockGitHub>>;
    let home: string;
    let repo: string;
    let base: string;
    let env: Record<string, string>;

    beforeAll(async () => {
        model = await startMockReviewer();
        model.state.summary = {
            summary: 'Adds order creation backed by a new saveOrder helper.',
            changes: [{ files: ['src/orders.js'], summary: 'createOrder builds and saves an order.' }],
            effort: 2,
            minutes: 8,
            attention: ['The total is taken from the request.'],
            diagram: 'sequenceDiagram\n  A->>B: hi',
        };
        model.state.findings = FINDINGS;
        home = makeHome();
        repo = join(home, 'repo');
        mkdirSync(join(repo, 'src'), { recursive: true });
        writeFileSync(join(repo, 'src', 'old.js'), 'export const old = 1;\n');
        git(repo, 'init', '-q', '-b', 'main');
        git(repo, 'config', 'user.email', 't@t');
        git(repo, 'config', 'user.name', 't');
        git(repo, 'add', '.');
        git(repo, 'commit', '-qm', 'init');
        base = git(repo, 'rev-parse', 'HEAD');
        git(repo, 'checkout', '-q', '-b', 'feature');
        writeFileSync(join(repo, 'src', 'db.js'), DB);
        writeFileSync(join(repo, 'src', 'orders.js'), ORDERS);
        git(repo, 'add', '.');
        git(repo, 'commit', '-qm', 'orders');
        gh = await startMockGitHub({ number: 7, title: 'Add orders', head: git(repo, 'rev-parse', 'HEAD'), base });
        env = { GITHUB_TOKEN: 'test-token', GITHUB_API_URL: gh.url, GITHUB_ACTIONS: '', GITHUB_EVENT_PATH: '', GITHUB_REPOSITORY: 'o/r' };
        const cfg = await ownkey(['config', '--provider', 'ollama', '--endpoint', model.url, '--model', 'mock-coder', '--no-database', '--yes'], { home });
        expect(cfg.code).toBe(0);
    });

    afterAll(async () => {
        await model.close();
        await gh.close();
    });

    it('previews a pull request locally without GitHub', async () => {
        const r = await ownkey(['pr', 'review', '--base', 'main'], { home, cwd: repo, env: { ...env, GITHUB_TOKEN: '' } });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('### Summary');
        expect(r.stdout).toContain('Adds order creation');
        expect(r.stdout).toContain('| `src/orders.js` | createOrder builds and saves an order. |');
        // db.js was left out of the walkthrough by the model; it still appears
        expect(r.stdout).toContain('`src/db.js`');
        expect(r.stdout).toContain('```suggestion\n  await saveOrder(order);\n```');
        expect(r.stdout).not.toContain('ownkey:state');
        expect(gh.state.requests).toHaveLength(0);
    });

    it('posts a summary comment and one review with inline comments and a suggestion', async () => {
        const r = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r'], { home, cwd: repo, env });
        expect(r.code, r.out).toBe(0);
        expect(gh.state.requests.every((q) => q.auth === 'Bearer test-token')).toBe(true);
        expect(gh.state.reviews).toHaveLength(1);
        const review = gh.state.reviews[0];
        expect(review.commit_id).toBe(gh.state.pull.head.sha);
        expect(review.event).toBe('COMMENT');
        const byLine = Object.fromEntries(review.comments.map((c: any) => [`${c.path}:${c.line}`, c]));
        expect(byLine['src/orders.js:5'].body).toContain('```suggestion\n  await saveOrder(order);\n```');
        expect(byLine['src/orders.js:5'].body).toContain('**High · Bug**');
        expect(byLine['src/orders.js:4'].body).toContain('**Medium · Security**');
        expect(byLine['src/orders.js:4'].body).not.toContain('suggestion');
        // A finding outside the pull request's diff cannot be an inline comment
        expect(review.comments.some((c: any) => c.path === 'src/old.js')).toBe(false);

        expect(gh.state.issueComments).toHaveLength(1);
        const summary = gh.state.issueComments[0].body;
        expect(summary.startsWith('<!-- ownkey-review -->')).toBe(true);
        expect(summary).toContain('**Estimated review effort:** 2/5 (about 8 min)');
        expect(summary).toContain('### Worth a close look');
        expect(summary).toContain('```mermaid');
        // Findings on files the pull request does not change are dropped
        expect(summary).not.toContain('src/old.js');
        expect(summary).toContain('<!-- ownkey:state ');
    });

    it('skips a commit it already reviewed', async () => {
        const r = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r'], { home, cwd: repo, env });
        expect(r.code).toBe(0);
        expect(r.stderr, JSON.stringify(gh.state.requests.map((q) => q.method + ' ' + q.url)) + gh.state.issueComments[0]?.body.slice(-200)).toContain('already reviewed');
        expect(gh.state.reviews).toHaveLength(1);
    });

    it('reviews only new commits on a push and does not repeat earlier findings', async () => {
        writeFileSync(join(repo, 'src', 'db.js'), DB + 'export const LIMIT = 10;\n');
        git(repo, 'commit', '-qam', 'limit');
        gh.state.pull.head.sha = git(repo, 'rev-parse', 'HEAD');
        // The model, seeing the new commit, raises the same orders.js problems again plus one in db.js
        model.state.findings = [...FINDINGS, { type: 'style', severity: 'low', content: 'Magic number', filePath: 'src/db.js', line: 4, rationale: '', diff: '' }];
        const before = model.state.prompts.length;
        const r = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r'], { home, cwd: repo, env });
        expect(r.code, r.out).toBe(0);
        // Only db.js changed since the last review, so only db.js went to the reviewer
        const reviewPrompt = model.state.prompts.slice(before).find((p) => p.includes('Changes Under Review'))!;
        expect(reviewPrompt).toContain('### src/db.js');
        expect(reviewPrompt).not.toContain('### src/orders.js');
        expect(gh.state.reviews).toHaveLength(2);
        expect(gh.state.reviews[1].comments.map((c: any) => `${c.path}:${c.line}`)).toEqual(['src/db.js:4']);
        // The summary comment is updated in place, not duplicated
        expect(gh.state.issueComments).toHaveLength(1);
        expect(gh.state.issueComments[0].body).toMatch(/the changes in [0-9a-f]{7}\.\.[0-9a-f]{7}/);
        expect(gh.state.issueComments[0].body).toContain('(incremental)');
    });

    it('re-reviews everything on --full without repeating comments already in their threads', async () => {
        const r = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r', '--full'], { home, cwd: repo, env });
        expect(r.code, r.out).toBe(0);
        expect(gh.state.reviews).toHaveLength(2);
        expect(gh.state.issueComments[0].body).toMatch(/No new issues in pull request #7\. \d+ earlier findings? still stands?/);
    });

    it('moves comments GitHub refuses into the summary instead of failing', async () => {
        writeFileSync(join(repo, 'src', 'orders.js'), ORDERS.replace('return order;', 'return { ...order };'));
        git(repo, 'commit', '-qam', 'spread');
        gh.state.pull.head.sha = git(repo, 'rev-parse', 'HEAD');
        model.state.findings = [
            { type: 'performance', severity: 'medium', content: 'Needless copy', filePath: 'src/orders.js', line: 6, rationale: '', diff: '' },
            { type: 'test', severity: 'low', content: 'No test', filePath: 'src/orders.js', line: 3, rationale: '', diff: '' },
        ];
        gh.state.refuse.add('src/orders.js:3');
        const r = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r'], { home, cwd: repo, env });
        expect(r.code, r.out).toBe(0);
        expect(gh.state.reviews.at(-1).comments.map((c: any) => c.line)).toEqual([6]);
        expect(gh.state.issueComments[0].body).toContain('`src/orders.js:3`');
    });

    it('answers an @ownkey question in the conversation', async () => {
        const event = join(home, 'event.json');
        writeFileSync(event, JSON.stringify({ action: 'created', issue: { number: 7, pull_request: {} }, comment: { id: 55, body: '@ownkey is the insert safe?', user: { login: 'arpit', type: 'User' } } }));
        model.state.answer = 'Yes, it uses parameters ($1, $2).';
        const r = await ownkey(['pr', 'reply', '--event', event, '--event-name', 'issue_comment', '--repo', 'o/r'], { home, cwd: repo, env });
        expect(r.code, r.out).toBe(0);
        const reply = gh.state.issueComments.at(-1).body;
        expect(reply).toContain('> @ownkey is the insert safe?');
        expect(reply).toContain('Yes, it uses parameters ($1, $2).');
        expect(gh.state.reactions.some((x) => x.content === 'eyes' && x.url.endsWith('/issues/comments/55/reactions'))).toBe(true);
        const asked = model.state.prompts.at(-1)!;
        expect(asked).toContain('is the insert safe?');
        expect(asked).toContain('Pull request #7: Add orders');
    });

    it('replies inside a review thread with the thread as context', async () => {
        const first = gh.state.reviewComments.find((c) => c.path === 'src/orders.js' && c.line === 5);
        const event = join(home, 'event2.json');
        writeFileSync(
            event,
            JSON.stringify({ action: 'created', pull_request: { number: 7 }, comment: { id: 77, in_reply_to_id: first.id, path: 'src/orders.js', line: 5, diff_hunk: '@@ -0,0 +1,7 @@', body: '@ownkey why does this matter?', user: { login: 'arpit', type: 'User' } } })
        );
        model.state.answer = 'Because the write can fail after the response.';
        const r = await ownkey(['pr', 'reply', '--event', event, '--event-name', 'pull_request_review_comment', '--repo', 'o/r'], { home, cwd: repo, env });
        expect(r.code, r.out).toBe(0);
        const reply = gh.state.reviewComments.at(-1);
        expect(reply.in_reply_to_id).toBe(first.id);
        expect(reply.body).toContain('Because the write can fail after the response.');
        expect(model.state.prompts.at(-1)).toContain('saveOrder is not awaited');
    });

    it('pauses and resumes automatic reviews, and ignores its own comments', async () => {
        const ev = (body: string, id: number) => {
            const file = join(home, `ev-${id}.json`);
            writeFileSync(file, JSON.stringify({ action: 'created', issue: { number: 7, pull_request: {} }, comment: { id, body, user: { login: 'arpit' } } }));
            return file;
        };
        const reply = (file: string) => ownkey(['pr', 'reply', '--event', file, '--event-name', 'issue_comment', '--repo', 'o/r'], { home, cwd: repo, env });

        expect((await reply(ev('@ownkey pause', 90))).code).toBe(0);
        expect(gh.state.issueComments.at(-1).body).toContain('Paused.');
        writeFileSync(join(repo, 'src', 'db.js'), DB + 'export const LIMIT = 20;\n');
        git(repo, 'commit', '-qam', 'limit 20');
        gh.state.pull.head.sha = git(repo, 'rev-parse', 'HEAD');
        const paused = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r'], { home, cwd: repo, env });
        expect(paused.stderr).toContain('paused');

        const own = await reply(ev(gh.state.issueComments[0].body, 91));
        expect(own.stderr).toContain("OwnKey's own comment");
        const none = await reply(ev('looks good to me', 92));
        expect(none.stderr).toContain('does not mention @ownkey');

        expect((await reply(ev('@ownkey resume', 93))).code).toBe(0);
        expect(gh.state.issueComments.at(-1).body).toContain('Resumed.');
        const resumed = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r'], { home, cwd: repo, env });
        expect(resumed.stderr).not.toContain('Skipped');
    });

    it('skips drafts and WIP titles unless forced', async () => {
        gh.state.pull.draft = true;
        writeFileSync(join(repo, 'src', 'db.js'), DB + 'export const LIMIT = 30;\n');
        git(repo, 'commit', '-qam', 'limit 30');
        gh.state.pull.head.sha = git(repo, 'rev-parse', 'HEAD');
        const draft = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r'], { home, cwd: repo, env });
        expect(draft.stderr).toContain('draft');
        gh.state.pull.draft = false;
        gh.state.pull.title = 'WIP: orders';
        const wip = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r'], { home, cwd: repo, env });
        expect(wip.stderr).toContain('"WIP"');
        const forced = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r', '--force'], { home, cwd: repo, env });
        expect(forced.stderr).not.toContain('Skipped');
        gh.state.pull.title = 'Add orders';
    });

    it('still posts findings when the summary call fails', async () => {
        model.state.failSummary = true;
        const r = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r', '--full'], { home, cwd: repo, env });
        model.state.failSummary = false;
        expect(r.code, r.out).toBe(0);
        expect(r.stderr).toContain('Summary failed');
        expect(gh.state.issueComments[0].body).not.toContain('### Summary');
    });

    it('explains a missing token and a missing pull request', async () => {
        const noToken = await ownkey(['pr', 'review', '--pr', '7', '--repo', 'o/r'], { home, cwd: repo, env: { ...env, GITHUB_TOKEN: '', GH_TOKEN: '' } });
        expect(noToken.code).toBe(2);
        expect(noToken.out).toContain('GITHUB_TOKEN');
        const noPr = await ownkey(['pr', 'review'], { home, cwd: repo, env });
        expect(noPr.code).toBe(2);
        expect(noPr.out).toContain('--base');
    });
});
