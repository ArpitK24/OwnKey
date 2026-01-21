import { AIProvider } from './provider.js';
import type { CodeContext, Suggestion } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class OpenAIProvider extends AIProvider {
    private baseUrl = 'https://api.openai.com/v1';

    constructor(apiKey?: string, model?: string) {
        super(apiKey, model);
    }

    getDefaultModel(): string {
        return 'gpt-4-turbo';
    }

    async testConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
            });

            if (!response.ok) {
                logger.debug(`OpenAI connection test failed: ${response.status}`);
                return false;
            }

            return true;
        } catch (error) {
            logger.debug('OpenAI connection test error:', error);
            return false;
        }
    }

    async *analyze(context: CodeContext): AsyncGenerator<Suggestion> {
        const prompt = this.buildUserPrompt(context);

        try {
            logger.verbose(`Analyzing with OpenAI (${this.model})...`);

            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: this.getSystemPrompt(),
                        },
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                    temperature: 0.3,
                    max_tokens: 8192,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json() as any;
                logger.error('OpenAI API error:', errorData as Error);
                throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
            }

            const data = await response.json() as any;
            const content = data.choices[0]?.message?.content;

            if (!content) {
                throw new Error('No content in OpenAI response');
            }

            // Parse suggestions from response
            const suggestions = this.parseSuggestions(content);
            for (const suggestion of suggestions) {
                yield suggestion;
            }
        } catch (error) {
            logger.error('OpenAI analysis error:', error as Error);
            throw error;
        }
    }

    static async getAvailableModels(apiKey: string): Promise<string[]> {
        try {
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.statusText}`);
            }

            const data = await response.json() as any;

            // Filter for GPT models suitable for code analysis
            const models = data.data
                .filter((m: any) =>
                    m.id.includes('gpt') &&
                    !m.id.includes('instruct') &&
                    !m.id.includes('vision')
                )
                .map((m: any) => m.id)
                .sort((a: string, b: string) => {
                    // Sort by preference: gpt-4-turbo > gpt-4 > gpt-3.5
                    if (a.includes('4-turbo')) return -1;
                    if (b.includes('4-turbo')) return 1;
                    if (a.includes('gpt-4')) return -1;
                    if (b.includes('gpt-4')) return 1;
                    return 0;
                });

            return models;
        } catch (error) {
            logger.error('Failed to fetch OpenAI models:', error as Error);
            return ['gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo']; // Fallback
        }
    }
}
