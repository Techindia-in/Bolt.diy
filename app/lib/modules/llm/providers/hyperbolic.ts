import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { formatTokens } from './tokenFormat';

export default class HyperbolicProvider extends BaseProvider {
  name = 'Hyperbolic';
  getApiKeyLink = 'https://app.hyperbolic.xyz/settings';

  config = {
    apiTokenKey: 'HYPERBOLIC_API_KEY',
  };

  staticModels: ModelInfo[] = [];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    const { baseUrl: fetchBaseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'HYPERBOLIC_API_KEY',
    });
    const baseUrl = fetchBaseUrl || 'https://api.hyperbolic.xyz/v1';

    if (!apiKey) {
      throw `Missing Api Key configuration for ${this.name} provider`;
    }

    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const res = (await response.json()) as any;

    const data = res.data.filter((model: any) => model.object === 'model' && model.supports_chat);

    return data.map((m: any) => ({
      name: m.id,
      label: `${m.id} - context ${formatTokens(m.context_length)} : 'N/A'}`,
      provider: this.name,
      maxTokenAllowed: m.context_length || 8000,
    }));
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'HYPERBOLIC_API_KEY',
    });

    if (!apiKey) {
      throw `Missing Api Key configuration for ${this.name} provider`;
    }

    const openai = createOpenAI({
      baseURL: 'https://api.hyperbolic.xyz/v1/',
      apiKey,
    });

    return openai(model);
  }
}
