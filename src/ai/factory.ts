import { AIProvider } from './provider.js';
import { GeminiProvider } from './gemini.js';
import { ConfigError } from '../types/index.js';
import { configManager } from '../config/manager.js';
import { logger } from '../utils/logger.js';

/**
 * Factory for creating AI provider instances
 */
export class AIProviderFactory {
    /**
     * Create an AI provider instance based on configuration
     */
    static async createProvider(): Promise<AIProvider> {
        const config = await configManager.load();

        if (!config.activeProvider) {
            throw new ConfigError('No active AI provider configured. Run: ownkey config');
        }

        const provider = config.activeProvider;
        const apiKey = await configManager.getApiKey(provider);

        logger.verbose(`Creating ${provider} provider...`);

        switch (provider) {
            case 'gemini':
                if (!apiKey) {
                    throw new ConfigError('Gemini API key not found. Run: ownkey config');
                }
                const geminiModel = config.providers.gemini?.model || GeminiProvider.getRecommendedModel();
                return new GeminiProvider(apiKey, geminiModel);

            case 'openai':
                throw new ConfigError('OpenAI provider not yet implemented (coming soon)');

            case 'anthropic':
                throw new ConfigError('Anthropic provider not yet implemented (coming soon)');

            case 'ollama':
                throw new ConfigError('Ollama provider not yet implemented (coming soon)');

            default:
                throw new ConfigError(`Unknown provider: ${provider}`);
        }
    }

    /**
     * Test provider connection
     */
    static async testProvider(provider: AIProvider): Promise<boolean> {
        try {
            logger.verbose('Testing provider connection...');
            const result = await provider.testConnection();
            if (result) {
                logger.success('Provider connection successful');
            } else {
                logger.error('Provider connection failed');
            }
            return result;
        } catch (error) {
            logger.error('Provider test error', error as Error);
            return false;
        }
    }

    /**
     * Get recommended model for a provider
     */
    static getRecommendedModel(provider: string): string {
        switch (provider) {
            case 'gemini':
                return GeminiProvider.getRecommendedModel();
            case 'openai':
                return 'gpt-4-turbo';
            case 'anthropic':
                return 'claude-3-5-sonnet-20241022';
            case 'ollama':
                return 'deepseek-coder:latest';
            default:
                return '';
        }
    }

    /**
     * Get available models for a provider
     */
    static getAvailableModels(provider: string): string[] {
        switch (provider) {
            case 'gemini':
                return GeminiProvider.getAvailableModels();
            case 'openai':
                return ['gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
            case 'anthropic':
                return [
                    'claude-3-5-sonnet-20241022',
                    'claude-3-opus-20240229',
                    'claude-3-haiku-20240307',
                ];
            case 'ollama':
                return ['deepseek-coder:latest', 'codellama:latest', 'llama2:latest'];
            default:
                return [];
        }
    }
}
