import { AIProvider } from './provider.js';
import type { CodeContext, Suggestion } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Anthropic Claude AI Provider
 * Supports all Claude models: Opus, Sonnet, and Haiku variants
 * Model names are user-configurable and future-proof
 */
export class AnthropicProvider extends AIProvider {
    private baseUrl = 'https://api.anthropic.com/v1';
    private apiVersion = '2023-06-01';

    constructor(apiKey?: string, model?: string) {
        super(apiKey, model);
    }

    getDefaultModel(): string {
        return 'claude-opus-4-5-20251101';
    }

    async testConnection(): Promise<boolean> {
        try {
            // Anthropic doesn't have a models endpoint, so we test with a minimal message
            const response = await fetch(`${this.baseUrl}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey || '',
                    'anthropic-version': this.apiVersion,
                } as any,
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: 10,
                    messages: [
                        {
                            role: 'user',
                            content: 'test',
                        },
                    ],
                }),
            });

            if (!response.ok) {
                logger.debug(`Anthropic connection test failed: ${response.status}`);
                return false;
            }

            return true;
        } catch (error) {
            logger.debug('Anthropic connection test error:', error);
            return false;
        }
    }

    async *analyze(context: CodeContext): AsyncGenerator<Suggestion> {
        const prompt = this.buildUserPrompt(context);

        try {
            logger.verbose(`Analyzing with Anthropic (${this.model})...`);

            const response = await fetch(`${this.baseUrl}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey || '',
                    'anthropic-version': this.apiVersion,
                } as any,
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: 8192,
                    temperature: 0.3,
                    system: this.getSystemPrompt(),
                    messages: [
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                }),
            });

            if (!response.ok) {
                const errorData = await response.json() as any;
                logger.error('Anthropic API error:', errorData as Error);
                throw new Error(`Anthropic API error: ${errorData.error?.message || response.statusText}`);
            }

            const data = await response.json() as any;
            const content = data.content[0]?.text;

            if (!content) {
                throw new Error('No content in Anthropic response');
            }

            // Parse suggestions from response
            const suggestions = this.parseSuggestions(content);
            for (const suggestion of suggestions) {
                yield suggestion;
            }
        } catch (error) {
            logger.error('Anthropic analysis error:', error as Error);
            throw error;
        }
    }

    /**
     * Get available Claude models
     * Note: Anthropic doesn't provide a models API endpoint
     * Returns known models - users can specify any model name in config
     */
    static async getAvailableModels(_apiKey: string): Promise<string[]> {
        // Return known models as of Jan 2026
        // Users can use ANY model name - this list is just for convenience
        return [
            // Claude 4.5 (Latest - Nov 2025)
            'claude-opus-4-5-20251101',       // Opus 4.5 (Recommended - Best for coding)
            'claude-sonnet-4-5-20251022',     // Sonnet 4.5 (Balanced)
            'claude-haiku-4-5-20251022',      // Haiku 4.5 (Fast)

            // Claude 3.5 (Legacy)
            'claude-3-5-sonnet-20241022',     // Sonnet 3.5
            'claude-3-5-sonnet-20240620',     // Sonnet 3.5 (Older)

            // Claude 3 (Legacy)
            'claude-3-opus-20240229',         // Opus 3
            'claude-3-sonnet-20240229',       // Sonnet 3
            'claude-3-haiku-20240307',        // Haiku 3

            // Future models (5.x, 6.x, etc.) will work automatically
            // Users just need to specify the model name in config
        ];
    }
}
