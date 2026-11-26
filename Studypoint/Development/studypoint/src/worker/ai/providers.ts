// Provider capability records (AI_SYSTEM §2). The privacy guard reads `trainsOnFreeTier`.
// Changing a provider's data terms (e.g. enabling paid Gemini) means changing this record, and nothing else.

export type ProviderId = 'gemini' | 'workers_ai' | 'claude';

export type ProviderCapability = {
  id: ProviderId;
  /** True if the provider may use submitted content to improve its products (Gemini free tier). */
  trainsOnFreeTier: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
};

export const PROVIDERS: Readonly<Record<ProviderId, ProviderCapability>> = {
  gemini: { id: 'gemini', trainsOnFreeTier: true, supportsVision: true, supportsJsonMode: true },
  workers_ai: { id: 'workers_ai', trainsOnFreeTier: false, supportsVision: true, supportsJsonMode: true },
  claude: { id: 'claude', trainsOnFreeTier: false, supportsVision: true, supportsJsonMode: true },
};

export function isProviderId(value: unknown): value is ProviderId {
  return value === 'gemini' || value === 'workers_ai' || value === 'claude';
}
