import { AIProvider } from './provider.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
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
                if (!apiKey) {
                    throw new ConfigError('OpenAI API key not found. Run: ownkey config');
                }
                const openaiModel = config.providers.openai?.model || 'gpt-4-turbo';
                return new OpenAIProvider(apiKey, openaiModel);

            case 'anthropic':
                if (!apiKey) {
                    throw new ConfigError('Anthropic API key not found. Run: ownkey config');
                }
                const anthropicModel = config.providers.anthropic?.model || 'claude-opus-4-5-20251101';
                return new AnthropicProvider(apiKey, anthropicModel);

            case 'ollama':
                throw new ConfigError('Ollama provider not yet implemented (coming in v0.7.0)');

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
                return 'claude-opus-4-5-20251101';
            case 'ollama':
                return 'deepseek-coder:latest';
            default:
                return '';
        }
    }

    /**
     * Get available models for a provider
     */
    static async getAvailableModels(provider: string, apiKey: string): Promise<string[]> {
        try {
            switch (provider) {
                case 'gemini':
                    return await GeminiProvider.getAvailableModels(apiKey);
                case 'openai':
                    return await OpenAIProvider.getAvailableModels(apiKey);
                case 'anthropic':
                    return await AnthropicProvider.getAvailableModels(apiKey);
                case 'ollama':
                    return ['deepseek-coder:latest', 'codellama:latest', 'llama2:latest'];
                default:
                    return [];
            }
        } catch (error) {
            logger.error(`Failed to fetch models for ${provider}:`, error as Error);
            return [AIProviderFactory.getRecommendedModel(provider)];
        }
    }
}
