import { AIProvider } from './provider.js';
import type { CodeContext, Suggestion } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_MODELS } from '../config/models.js';

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
        return DEFAULT_MODELS.ollama;
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
        let response: Response;
        try {
            // Same prompt and JSON contract as every other provider, so suggestions carry diffs.
            response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    system: this.getSystemPrompt(),
                    prompt: this.buildUserPrompt(context),
                    stream: false,
                    options: { temperature: 0.2 },
                }),
            });
        } catch (error) {
            throw new Error(
                `Cannot reach Ollama at ${this.baseUrl} (${(error as Error).message}).\n` +
                    '  Start it with: ollama serve\n' +
                    '  Or set another endpoint: ownkey config --provider ollama --endpoint <url>'
            );
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            if (response.status === 404 && /model/i.test(body)) {
                throw new Error(`Model "${this.model}" is not installed. Run: ollama pull ${this.model}`);
            }
            throw new Error(`Ollama API error: ${response.status} ${response.statusText} ${body}`.trim());
        }

        const data = (await response.json()) as { response?: string };
        const text = data.response ?? '';
        logger.debug(`Ollama raw response (${text.length} chars): ${text.slice(0, 500)}`);

        for (const suggestion of this.parseSuggestions(text)) {
            yield suggestion;
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
