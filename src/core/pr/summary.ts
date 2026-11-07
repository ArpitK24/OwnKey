import { AIProvider } from '../../ai/provider.js';

export interface ChangeGroup {
    /** Files in this group, repo-relative */
    files: string[];
    /** What changed in them and why it matters, one or two sentences */
    summary: string;
}

export interface PullSummary {
    /** What the pull request does, in a short paragraph */
    summary: string;
    /** Walkthrough: the changes grouped by purpose */
    changes: ChangeGroup[];
    /** Estimated review effort, 1 (trivial) to 5 (very complex) */
    effort: number;
    /** Rough minutes for a human review */
    minutes?: number;
    /** Places a human reviewer should look closely */
    attention: string[];
    /** Optional Mermaid sequence diagram of a changed flow */
    diagram?: string;
}

const MAX_PATCH_CHARS = 90_000;

export const SUMMARY_SYSTEM_PROMPT = `You are a senior engineer writing the overview of a pull request for its reviewers.
Read the diff and describe what the change does and why, not line by line. Be specific and factual: name the
functions, endpoints, and behaviours that change. Never speculate beyond the diff.

Reply with exactly one JSON object:
{
  "summary": "2-4 sentences on what this pull request does and its user-visible effect",
  "changes": [ { "files": ["path/a.ts", "path/b.ts"], "summary": "what changed in these files" } ],
  "effort": 1-5 (1 trivial, 3 moderate, 5 very complex),
  "minutes": estimated minutes for a careful human review,
  "attention": ["a specific place a reviewer should check closely, and why"],
  "diagram": "optional Mermaid sequenceDiagram source when the change alters a flow between components, else empty"
}
Group related files in "changes" (tests with the code they test). Every changed file must appear in exactly one group.
Keep "attention" to at most 3 items and leave it empty for trivial changes.`;

/** Keep the diff within budget, cutting whole files from the end and saying so. */
export function clipPatch(patch: string, max = MAX_PATCH_CHARS): { text: string; omitted: string[] } {
    if (patch.length <= max) return { text: patch, omitted: [] };
    const parts = patch.split(/(?=^diff --git )/m);
    const kept: string[] = [];
    const omitted: string[] = [];
    let size = 0;
    for (const part of parts) {
        const name = /^diff --git a\/(\S+)/.exec(part)?.[1] ?? '';
        if (size + part.length > max) {
            if (name) omitted.push(name);
            continue;
        }
        kept.push(part);
        size += part.length;
    }
    return { text: kept.join(''), omitted };
}

export function normalizeSummary(raw: any, files: string[]): PullSummary {
    const obj = raw && typeof raw === 'object' ? raw : {};
    const known = new Set(files);
    const changes: ChangeGroup[] = (Array.isArray(obj.changes) ? obj.changes : [])
        .map((g: any) => ({
            files: (Array.isArray(g?.files) ? g.files : typeof g?.file === 'string' ? [g.file] : [])
                .map((f: unknown) => String(f).replace(/^\.?\//, '').replace(/^[ab]\//, ''))
                .filter((f: string) => known.has(f)),
            summary: String(g?.summary ?? g?.change ?? '').trim(),
        }))
        .filter((g: ChangeGroup) => g.files.length && g.summary);
    // Any file the model left out still shows up, so the walkthrough covers the whole change
    const covered = new Set(changes.flatMap((g) => g.files));
    const missing = files.filter((f) => !covered.has(f));
    if (missing.length) changes.push({ files: missing, summary: 'Other changes.' });
    const effort = Math.min(5, Math.max(1, Math.round(Number(obj.effort) || 2)));
    const minutes = Number(obj.minutes);
    const diagram = typeof obj.diagram === 'string' && /sequenceDiagram|flowchart|graph /.test(obj.diagram) ? obj.diagram.replace(/^```(?:mermaid)?\s*|```\s*$/g, '').trim() : undefined;
    return {
        summary: String(obj.summary ?? '').trim() || 'No summary was produced.',
        changes,
        effort,
        minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : undefined,
        attention: (Array.isArray(obj.attention) ? obj.attention : []).map((a: unknown) => String(a).trim()).filter(Boolean).slice(0, 3),
        diagram,
    };
}

/** Ask the model for the pull request overview: summary, walkthrough, effort and hot spots. */
export async function summarizePull(provider: AIProvider, input: { title?: string; body?: string; patch: string; files: string[] }): Promise<PullSummary> {
    const { text, omitted } = clipPatch(input.patch);
    const user = [
        input.title ? `Title: ${input.title}` : '',
        input.body?.trim() ? `Description:\n${input.body.trim().slice(0, 4000)}` : '',
        `Changed files:\n${input.files.map((f) => `- ${f}`).join('\n')}`,
        omitted.length ? `(Diffs of ${omitted.length} file(s) were left out for length: ${omitted.join(', ')})` : '',
        '```diff\n' + text + '\n```',
        'Reply with the JSON object only.',
    ]
        .filter(Boolean)
        .join('\n\n');
    const reply = await provider.chat(SUMMARY_SYSTEM_PROMPT, [{ role: 'user', content: user }]);
    return normalizeSummary(AIProvider.extractJson(reply), input.files);
}
