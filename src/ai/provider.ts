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

        prompt += `\nAnalyze the above code and provide suggestions in JSON format.`;

        return prompt;
    }

    /**
     * Parse AI response and extract suggestions
     */
    protected parseSuggestions(response: string): Suggestion[] {
        try {
            // Try to extract JSON from response
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                throw new Error('No JSON array found in response');
            }

            const suggestions = JSON.parse(jsonMatch[0]);

            // Validate and normalize suggestions
            return suggestions.map((s: any) => ({
                type: s.type || 'refactor',
                severity: s.severity || 'medium',
                content: s.content || 'No description provided',
                filePath: s.filePath || '',
                rationale: s.rationale || '',
                diff: s.diff || '',
                tags: s.tags,
            }));
        } catch (error) {
            throw new Error(`Failed to parse suggestions: ${error}`);
        }
    }
}
