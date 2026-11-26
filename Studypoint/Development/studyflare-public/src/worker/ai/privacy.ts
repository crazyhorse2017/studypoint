// Privacy routing (PRV-01..03, AI_SYSTEM §4, AGENTS rules 1–2).
// Personal content must never reach a provider that trains on free-tier data.
// `privacy` always comes from data (sources → passages → ContentPart), never from a model.

import { PROVIDERS, type ProviderId } from './providers.ts';

export type Privacy = 'personal' | 'published';

export type ContentPart = {
  privacy: Privacy;
  text?: string;
  /** R2 key of an image (page render, slide media) for vision tasks. */
  imageKey?: string;
  /** Passage this part came from, when it's retrieved context. */
  passageId?: string;
};

export class PrivacyViolation extends Error {
  readonly provider: ProviderId;
  readonly personalParts: number;

  constructor(provider: ProviderId, personalParts: number) {
    super(`Refused: ${personalParts} personal part(s) would be sent to "${provider}", which trains on free-tier data.`);
    this.name = 'PrivacyViolation';
    this.provider = provider;
    this.personalParts = personalParts;
  }
}

/** `personal` if ANY part is personal. An empty request counts as published (nothing private to protect). */
export function effectivePrivacy(parts: readonly ContentPart[]): Privacy {
  return parts.some((p) => p.privacy === 'personal') ? 'personal' : 'published';
}

/** Throws PrivacyViolation unless every part may be sent to this provider. Called on every AI request. */
export function assertRoutable(provider: ProviderId, parts: readonly ContentPart[]): void {
  if (!PROVIDERS[provider].trainsOnFreeTier) return;
  const personal = parts.filter((p) => p.privacy !== 'published').length;
  // `!== 'published'` (not `=== 'personal'`) so a missing or corrupted label is treated as private.
  if (personal > 0) throw new PrivacyViolation(provider, personal);
}

export type MixedPrivacyMode = 'private_all' | 'gemini_published_only';

export type ChatContextPlan = {
  /** Which privacy route the answer uses; saved as messages.privacy_route and shown to Alex (PRV-03). */
  privacyRoute: 'private_all' | 'published_only' | 'no_context';
  /** Privacy class of the request, which selects the provider route. */
  privacy: Privacy;
  parts: ContentPart[];
  /** Personal passages left out (gemini_published_only mode), for the "N personal passages not used" note. */
  droppedPersonal: number;
};

/**
 * Decide which retrieved passages a chat answer may use (PRV-03, default `private_all`).
 * - private_all: keep everything; if any part is personal the request runs on a private provider.
 * - gemini_published_only: drop personal parts so the request can use the published route.
 */
export function planChatContext(parts: readonly ContentPart[], mode: MixedPrivacyMode): ChatContextPlan {
  if (parts.length === 0) return { privacyRoute: 'no_context', privacy: 'published', parts: [], droppedPersonal: 0 };
  if (mode === 'gemini_published_only') {
    const kept = parts.filter((p) => p.privacy === 'published');
    return { privacyRoute: 'published_only', privacy: 'published', parts: kept, droppedPersonal: parts.length - kept.length };
  }
  const privacy = effectivePrivacy(parts);
  return {
    privacyRoute: privacy === 'personal' ? 'private_all' : 'published_only',
    privacy,
    parts: [...parts],
    droppedPersonal: 0,
  };
}
