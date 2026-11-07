/**
 * A small GitHub REST client for the pull request bot: just the calls it needs, over fetch,
 * with the token from GITHUB_TOKEN / GH_TOKEN. Works with GitHub Enterprise through GITHUB_API_URL.
 */

export interface PullInfo {
    number: number;
    title: string;
    body: string | null;
    draft: boolean;
    state: string;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
    user?: { login: string };
}

export interface IssueComment {
    id: number;
    body: string;
    user?: { login: string; type?: string };
}

export interface ReviewComment {
    id: number;
    body: string;
    path: string;
    line: number | null;
    original_line?: number | null;
    in_reply_to_id?: number;
    diff_hunk?: string;
    user?: { login: string; type?: string };
}

export interface NewReviewComment {
    path: string;
    line: number;
    side: 'RIGHT';
    start_line?: number;
    start_side?: 'RIGHT';
    body: string;
}

export class GitHubError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
    }
}

export class GitHubClient {
    readonly owner: string;
    readonly repo: string;

    constructor(
        repository: string,
        private readonly token: string | undefined,
        private readonly apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com'
    ) {
        const [owner, repo] = repository.split('/');
        if (!owner || !repo) throw new Error(`Repository must look like owner/name, got "${repository}".`);
        this.owner = owner;
        this.repo = repo;
    }

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await fetch(`${this.apiUrl.replace(/\/$/, '')}${path}`, {
            method,
            headers: {
                accept: 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28',
                'user-agent': 'ownkey',
                ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
                ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        if (!res.ok) {
            let detail = text.slice(0, 300);
            try {
                const j = JSON.parse(text);
                detail = [j.message, ...(Array.isArray(j.errors) ? j.errors.map((e: any) => e.message ?? JSON.stringify(e)) : [])].filter(Boolean).join('; ');
            } catch {
                // keep raw text
            }
            const hint =
                res.status === 401
                    ? ' Check GITHUB_TOKEN.'
                    : res.status === 403 || res.status === 404
                      ? ' The token may lack "pull-requests: write" permission (or this is a fork PR with a read-only token).'
                      : '';
            throw new GitHubError(`GitHub ${method} ${path} failed (${res.status}): ${detail}.${hint}`, res.status);
        }
        return (text ? JSON.parse(text) : undefined) as T;
    }

    private async paginate<T>(path: string, max = 1000): Promise<T[]> {
        const out: T[] = [];
        for (let page = 1; out.length < max; page++) {
            const sep = path.includes('?') ? '&' : '?';
            const batch = await this.request<T[]>('GET', `${path}${sep}per_page=100&page=${page}`);
            out.push(...batch);
            if (batch.length < 100) break;
        }
        return out;
    }

    private get base(): string {
        return `/repos/${this.owner}/${this.repo}`;
    }

    getPull(n: number): Promise<PullInfo> {
        return this.request('GET', `${this.base}/pulls/${n}`);
    }

    listIssueComments(n: number): Promise<IssueComment[]> {
        return this.paginate(`${this.base}/issues/${n}/comments`);
    }

    createIssueComment(n: number, body: string): Promise<IssueComment> {
        return this.request('POST', `${this.base}/issues/${n}/comments`, { body });
    }

    updateIssueComment(id: number, body: string): Promise<IssueComment> {
        return this.request('PATCH', `${this.base}/issues/comments/${id}`, { body });
    }

    listReviewComments(n: number): Promise<ReviewComment[]> {
        return this.paginate(`${this.base}/pulls/${n}/comments`);
    }

    createReview(n: number, review: { commit_id: string; body: string; event: 'COMMENT'; comments: NewReviewComment[] }): Promise<{ id: number; html_url?: string }> {
        return this.request('POST', `${this.base}/pulls/${n}/reviews`, review);
    }

    replyToReviewComment(n: number, commentId: number, body: string): Promise<ReviewComment> {
        return this.request('POST', `${this.base}/pulls/${n}/comments/${commentId}/replies`, { body });
    }

    react(kind: 'issue' | 'review', commentId: number, content: 'eyes' | '+1' | 'rocket'): Promise<unknown> {
        const path = kind === 'issue' ? `${this.base}/issues/comments/${commentId}/reactions` : `${this.base}/pulls/comments/${commentId}/reactions`;
        return this.request('POST', path, { content });
    }
}
