import { AIProvider } from '../../ai/provider.js';
import type { Suggestion } from '../../types/index.js';

export const VERIFY_SYSTEM_PROMPT = `You are a strict senior engineer double-checking another reviewer's findings before they are posted.
For each finding you get the claim and the exact current code around the line it points at, with line numbers.
Reject a finding when the code shown does not have the problem: the claimed syntax error is not there, the "duplicate"
is just the file being added, the issue is already handled in the code shown, or the claim is speculation about code
you cannot see. Confirm it only when the code shown supports it. When unsure, reject.

Reply with exactly one JSON object:
{"verdicts": [{"index": 0, "verdict": "confirmed" | "rejected", "reason": "one short sentence"}]}`;

export interface Verdict {
    index: number;
    confirmed: boolean;
    reason: string;
}

const CONTEXT_LINES = 12;
const MAX_FINDINGS_PER_CALL = 20;

/** Numbered lines around a finding, the evidence the checker sees. */
export function evidence(lines: string[] | undefined, line: number | undefined, context = CONTEXT_LINES): string {
    if (!lines || !lines.length) return '(file not available)';
    const at = Math.min(Math.max(1, line ?? 1), lines.length);
    const from = Math.max(1, at - context);
    const to = Math.min(lines.length, at + context);
    const out: string[] = [];
    for (let n = from; n <= to; n++) out.push(`${String(n).padStart(5)}${n === at ? ' >' : '  '} ${lines[n - 1]}`);
    return out.join('\n');
}

export function parseVerdicts(reply: string, count: number): Verdict[] | undefined {
    const parsed = AIProvider.extractJson(reply);
    const list: any[] | undefined = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.verdicts) ? parsed.verdicts : undefined;
    if (!list) return undefined;
    const out: Verdict[] = [];
    for (const v of list) {
        const index = Number(v?.index);
        if (!Number.isInteger(index) || index < 0 || index >= count) continue;
        out.push({ index, confirmed: String(v?.verdict ?? '').toLowerCase().startsWith('confirm'), reason: String(v?.reason ?? '').trim() });
    }
    return out;
}

/**
 * A second, skeptical pass over the findings: each claim is checked against the real code
 * around its line, and the ones the code does not support are dropped. A finding the
 * checker gives no verdict on is kept; if the check itself fails, every finding is kept.
 */
export async function verifyFindings(
    provider: AIProvider,
    findings: Suggestion[],
    readLines: (file: string) => string[] | undefined,
    onRejected?: (finding: Suggestion, reason: string) => void
): Promise<Suggestion[]> {
    if (findings.length === 0) return findings;
    const keep = new Array<boolean>(findings.length).fill(true);
    for (let start = 0; start < findings.length; start += MAX_FINDINGS_PER_CALL) {
        const batch = findings.slice(start, start + MAX_FINDINGS_PER_CALL);
        const body = batch
            .map((f, i) =>
                [
                    `## Finding ${i}`,
                    `File: ${f.filePath}, line ${f.line ?? '?'} (${f.severity} ${f.type})`,
                    `Claim: ${f.content}`,
                    f.rationale ? `Reasoning: ${f.rationale}` : '',
                    'Current code:',
                    '```',
                    evidence(readLines(f.filePath), f.line),
                    '```',
                ]
                    .filter(Boolean)
                    .join('\n')
            )
            .join('\n\n');
        let verdicts: Verdict[] | undefined;
        try {
            const reply = await provider.chat(VERIFY_SYSTEM_PROMPT, [{ role: 'user', content: `${body}\n\nReply with the JSON object only.` }]);
            verdicts = parseVerdicts(reply, batch.length);
        } catch {
            verdicts = undefined;
        }
        for (const v of verdicts ?? []) {
            if (!v.confirmed) {
                keep[start + v.index] = false;
                onRejected?.(findings[start + v.index], v.reason);
            }
        }
    }
    return findings.filter((_, i) => keep[i]);
}
