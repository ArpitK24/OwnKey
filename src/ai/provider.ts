import { CodeContext, Suggestion, AnalyzeOptions, AIProviderInterface } from '../types/index.js';

/**
 * Base abstract class for AI providers
 * All providers (OpenAI, Gemini, Anthropic, Ollama) must implement this interface
 */
export abstract class AIProvider implements AIProviderInterface {
    protected apiKey?: string;
    protected model: string;
    protected endpoint?: string;

    constructor(apiKey?: string, model?: string, endpoint?: string) {
        this.apiKey = apiKey;
        this.model = model || this.getDefaultModel();
        this.endpoint = endpoint;
    }

    /** The model this provider will call */
    getModel(): string {
        return this.model;
    }

    /**
     * Get the default model for this provider
     */
    abstract getDefaultModel(): string;

    /**
     * Test if the provider connection is working
     */
    abstract testConnection(): Promise<boolean>;

    /**
     * Analyze code and generate suggestions
     * @param context - Code context with files and project info
     * @param options - Analysis options (streaming, max tokens, etc.)
     * @returns AsyncGenerator yielding suggestions as they're generated
     */
    abstract analyze(
        context: CodeContext,
        options?: AnalyzeOptions
    ): AsyncGenerator<Suggestion>;

    /**
     * Format the system prompt for code analysis
     */
    protected getSystemPrompt(): string {
        return `You are a senior software engineer performing code review and analysis.

Your task is to analyze the provided codebase and identify:
- Bugs and potential errors
- Security vulnerabilities
- Performance issues
- Code quality improvements
- Refactoring opportunities
- Missing tests or documentation

Guidelines:
- Be conservative and precise
- Only suggest changes you're confident about
- Provide clear rationale for each suggestion
- Use unified diff format for code changes
- Categorize suggestions by type and severity
- "filePath" must be the file's path relative to the project root, exactly as written in its "###" heading
- "diff" must be a unified diff for that one file: "--- a/<filePath>", "+++ b/<filePath>", then "@@" hunks
  with 2-3 unchanged context lines copied exactly from the file (same indentation)
- If you cannot produce an exact diff, omit the suggestion

Output Format:
Return a JSON array of suggestions. Each suggestion must have:
{
  "type": "bug" | "security" | "performance" | "refactor" | "style" | "architecture" | "test" | "documentation",
  "severity": "critical" | "high" | "medium" | "low" | "info",
  "content": "Brief description of the issue",
  "filePath": "path/to/file.ts",
  "rationale": "Detailed explanation of why this matters",
  "diff": "Unified diff format showing the change"
}

Be thorough but practical. Focus on high-impact suggestions.`;
    }

    /**
     * Build the user prompt with code context
     */
    protected buildUserPrompt(context: CodeContext): string {
        let prompt = `# Project Analysis Request\n\n`;
        prompt += `**Project:** ${context.projectInfo.name}\n`;
        prompt += `**Path:** ${context.projectInfo.rootPath}\n`;
        prompt += `**Files:** ${context.projectInfo.fileCount}\n\n`;

        if (context.projectInfo.language) {
            prompt += `**Primary Language:** ${context.projectInfo.language}\n`;
        }
        if (context.projectInfo.framework) {
            prompt += `**Framework:** ${context.projectInfo.framework}\n`;
        }

        prompt += `\n## Code Files\n\n`;

        for (const file of context.files) {
            prompt += `### ${file.relativePath}\n\n`;
            prompt += `\`\`\`${file.extension.slice(1)}\n`;
            prompt += file.content;
            prompt += `\n\`\`\`\n\n`;
        }

        if (context.reviewPatch) {
            prompt += `## Changes Under Review\n\n`;
            prompt += `The files above are shown in full for context. Review ONLY the changes in this diff:\n`;
            prompt += `report problems introduced or touched by these lines, not pre-existing issues elsewhere.\n\n`;
            prompt += `\`\`\`diff\n${context.reviewPatch}\n\`\`\`\n\n`;
            prompt += `Diffs in your suggestions must apply to the full file contents shown above.\n`;
        }

        prompt += `\nAnalyze the above code and provide suggestions in JSON format.`;

        return prompt;
    }

    /**
     * Parse AI response and extract suggestions
     */
    protected parseSuggestions(response: string): Suggestion[] {
        const parsed = AIProvider.extractJson(response);
        const list: any[] | null = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.suggestions)
              ? parsed.suggestions
              : null;

        if (!list) {
            throw new Error(
                'The model did not return suggestions in the expected JSON format. ' +
                    'Try again, or use a larger model (run with --debug to see the raw reply).'
            );
        }

        return list
            .filter((s) => s && typeof s === 'object')
            .map((s: any) => ({
                type: s.type || 'refactor',
                severity: s.severity || 'medium',
                content: s.content || s.description || 'No description provided',
                filePath: s.filePath || s.file || '',
                rationale: s.rationale || '',
                diff: typeof s.diff === 'string' ? s.diff : '',
                tags: s.tags,
            }));
    }

    /**
     * Pull the first JSON array/object out of a model reply (handles ```json fences and chatter).
     */
    static extractJson(text: string): any {
        const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
        const candidates = [fenced?.[1], text].filter(Boolean) as string[];
        for (const candidate of candidates) {
            const trimmed = candidate.trim();
            try {
                return JSON.parse(trimmed);
            } catch {
                // fall through to bracket scan
            }
            for (const [open, close] of [['[', ']'], ['{', '}']]) {
                const i = trimmed.indexOf(open);
                const j = trimmed.lastIndexOf(close);
                if (i !== -1 && j > i) {
                    try {
                        return JSON.parse(trimmed.slice(i, j + 1));
                    } catch {
                        // try next shape
                    }
                }
            }
        }
        return null;
    }
}
