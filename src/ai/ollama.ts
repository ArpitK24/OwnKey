import { AIProvider } from './provider.js';
import type { CodeContext, Suggestion } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Ollama AI Provider
 * Supports local LLMs via Ollama (DeepSeek Coder, CodeLlama, etc.)
 * No API key required - runs completely offline
 */
export class OllamaProvider extends AIProvider {
    private baseUrl: string;

    constructor(apiKey?: string, model?: string, baseUrl?: string) {
        super(apiKey, model);
        this.baseUrl = baseUrl || 'http://localhost:11434';
    }

    getDefaultModel(): string {
        return 'deepseek-coder:latest';
    }

    async testConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
            });
            return response.ok;
        } catch (error) {
            logger.verbose(`Ollama connection test failed: ${(error as Error).message}`);
            return false;
        }
    }

    async *analyze(context: CodeContext): AsyncGenerator<Suggestion> {
        const prompt = this.buildPrompt(context);

        try {
            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    prompt: prompt,
                    stream: false,
                }),
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json() as { response: string };
            const suggestions = this.parseResponse(data.response, context);

            for (const suggestion of suggestions) {
                yield suggestion;
            }
        } catch (error) {
            if ((error as any).code === 'ECONNREFUSED') {
                throw new Error(
                    'Cannot connect to Ollama. Please ensure Ollama is running:\n' +
                    '  Start Ollama: ollama serve\n' +
                    '  Or check if Ollama is installed: https://ollama.ai'
                );
            }
            throw error;
        }
    }

    private buildPrompt(context: CodeContext): string {
        const fileContents = context.files
            .map((file) => `File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``)
            .join('\n\n');

        return `You are a code analysis expert. Analyze the following code and identify issues.

Project: ${context.projectInfo.name}
Files to analyze: ${context.projectInfo.fileCount}

${fileContents}

Please analyze this code and provide suggestions for:
- Bugs and potential errors
- Security vulnerabilities
- Performance issues
- Code quality improvements
- Missing tests
- Documentation gaps

For each issue found, provide:
1. Type (bug, security, performance, test, documentation, style)
2. Severity (critical, high, medium, low, info)
3. File path
4. Description of the issue
5. Suggested fix

Format your response as a JSON array of suggestions:
[
  {
    "type": "bug",
    "severity": "high",
    "filePath": "path/to/file.js",
    "content": "Description of the issue and suggested fix"
  }
]`;
    }

    private parseResponse(response: string, context: CodeContext): Suggestion[] {
        try {
            // Try to extract JSON from response
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                // Fallback: create generic suggestion
                return [
                    {
                        type: 'style',
                        severity: 'info',
                        filePath: context.files[0]?.path || 'unknown',
                        content: response.substring(0, 200),
                        diff: '',
                        rationale: 'AI response could not be parsed',
                    },
                ];
            }

            const suggestions = JSON.parse(jsonMatch[0]);
            return suggestions.map((s: any) => ({
                type: s.type || 'info',
                severity: s.severity || 'info',
                filePath: s.filePath || context.files[0]?.path || 'unknown',
                content: s.content || s.description || 'No description provided',
            }));
        } catch (error) {
            logger.verbose(`Failed to parse Ollama response: ${(error as Error).message}`);
            // Return generic suggestion if parsing fails
            return [
                {
                    type: 'style',
                    severity: 'info',
                    filePath: context.files[0]?.path || 'unknown',
                    content: response.substring(0, 200),
                    diff: '',
                    rationale: 'AI response parsing failed',
                },
            ];
        }
    }

    /**
     * Get available Ollama models
     * Lists models installed on the local Ollama instance
     */
    static async getAvailableModels(baseUrl: string = 'http://localhost:11434'): Promise<string[]> {
        try {
            const response = await fetch(`${baseUrl}/api/tags`);
            if (!response.ok) {
                return [];
            }

            const data = await response.json() as { models?: Array<{ name: string }> };
            return data.models?.map((m) => m.name) || [];
        } catch (error) {
            logger.verbose(`Failed to get Ollama models: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Check if Ollama is running
     */
    static async isOllamaRunning(baseUrl: string = 'http://localhost:11434'): Promise<boolean> {
        try {
            const response = await fetch(`${baseUrl}/api/tags`);
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Check if a specific model is installed
     */
    static async isModelInstalled(
        model: string,
        baseUrl: string = 'http://localhost:11434'
    ): Promise<boolean> {
        const models = await this.getAvailableModels(baseUrl);
        return models.includes(model);
    }
}
