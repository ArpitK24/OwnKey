import type { Severity, Suggestion } from '../../types/index.js';

export interface Finding extends Suggestion {
    id?: string;
    line: number;
}

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * Best line to anchor a finding on: the line the model named, else the first added line
 * of its diff, else the first changed line of its file in the review, else line 1.
 */
export function anchorLine(s: Suggestion, changed?: Array<[number, number]>): number {
    if (s.line && s.line > 0) return s.line;
    if (s.diff) {
        let newLine = 0;
        for (const raw of s.diff.split('\n')) {
            const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
            if (h) {
                newLine = parseInt(h[1], 10);
                continue;
            }
            if (!newLine || raw.startsWith('+++') || raw.startsWith('---')) continue;
            if (raw.startsWith('+') || raw.startsWith('-')) return Math.max(1, newLine);
            newLine++;
        }
        if (newLine) return newLine;
    }
    return changed?.[0]?.[0] ?? 1;
}

export function sortFindings(findings: Finding[]): Finding[] {
    return [...findings].sort(
        (a, b) =>
            SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
            a.filePath.localeCompare(b.filePath) ||
            a.line - b.line
    );
}

function sarifLevel(sev: Severity): 'error' | 'warning' | 'note' {
    if (sev === 'critical' || sev === 'high') return 'error';
    if (sev === 'medium') return 'warning';
    return 'note';
}

/** SARIF 2.1.0, accepted by GitHub code scanning (github/codeql-action/upload-sarif). */
export function toSarif(findings: Finding[], version: string): object {
    const ruleIds = [...new Set(findings.map((f) => `ownkey/${f.type}`))];
    return {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [
            {
                tool: {
                    driver: {
                        name: 'OwnKey',
                        version,
                        informationUri: 'https://github.com/ArpitK24/OwnKey',
                        rules: ruleIds.map((id) => ({
                            id,
                            name: id.split('/')[1],
                            shortDescription: { text: `OwnKey ${id.split('/')[1]} finding` },
                        })),
                    },
                },
                results: findings.map((f) => ({
                    ruleId: `ownkey/${f.type}`,
                    level: sarifLevel(f.severity),
                    message: { text: f.rationale ? `${f.content}\n\n${f.rationale}` : f.content },
                    locations: [
                        {
                            physicalLocation: {
                                artifactLocation: { uri: f.filePath.replace(/\\/g, '/') },
                                region: { startLine: f.line },
                            },
                        },
                    ],
                    properties: { severity: f.severity, ...(f.id ? { ownkeyId: f.id } : {}) },
                })),
            },
        ],
    };
}

/** Markdown summary suitable for a PR comment or job summary. */
export function toMarkdown(findings: Finding[], scopeLabel: string, model: string): string {
    const lines: string[] = [];
    lines.push('## OwnKey review');
    lines.push('');
    if (findings.length === 0) {
        lines.push(`No issues found in ${scopeLabel}. Reviewed with \`${model}\`.`);
        return lines.join('\n') + '\n';
    }
    const counts = SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length] as const).filter(([, n]) => n);
    lines.push(`${findings.length} finding(s) in ${scopeLabel}: ${counts.map(([s, n]) => `${n} ${s}`).join(', ')}. Reviewed with \`${model}\`.`);
    lines.push('');
    lines.push('| Severity | Type | Location | Finding |');
    lines.push('|---|---|---|---|');
    for (const f of findings) {
        lines.push(`| ${f.severity} | ${f.type} | \`${f.filePath}:${f.line}\` | ${f.content.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
    }
    for (const f of findings) {
        lines.push('');
        lines.push(`<details><summary><code>${f.filePath}:${f.line}</code> ${escapeHtml(f.content)}</summary>`);
        lines.push('');
        if (f.rationale) lines.push(f.rationale, '');
        if (f.diff?.trim()) lines.push('```diff', f.diff.trim(), '```', '');
        if (f.id) lines.push(`Apply locally: \`ownkey apply ${f.id}\``, '');
        lines.push('</details>');
    }
    return lines.join('\n') + '\n';
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
