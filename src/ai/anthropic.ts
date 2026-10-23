import { AIProvider } from './provider.js';
import type { CodeContext, Suggestion } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_MODELS } from '../config/models.js';

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
        return DEFAULT_MODELS.anthropic;
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
                    // No temperature: Claude 5.x models reject sampling parameters.
                    // Adaptive thinking shares this budget, so leave headroom.
                    max_tokens: 32000,
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
            // Adaptive thinking can put thinking blocks before the text; read text blocks only.
            const content = (data.content || [])
                .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
                .map((b: any) => b.text)
                .join('\n');

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
        // Known models as of Oct 2026
        // Users can use ANY model name - this list is just for convenience
        return [
            'claude-sonnet-5-5', // balanced default
            'claude-opus-5-5', // deepest review
            'claude-haiku-5-5', // fastest, cheapest
            'claude-fable-5-1',
        ];
    }
}
