const layeredPayloadCache = new Map<string, any>();
const layeredImageCache = new Map<string, string>();
const uxPlanCache = new Map<string, any>();
const uxPlanKeyBySessionStep = new Map<string, string>();
const flowStateCache = new Map<string, any>();

const STORAGE_PREFIX = "supportLayeredCache:";
const STORAGE_VERSION = 1;
const FLOW_STORAGE_PREFIX = "supportFlowState:";
const UX_KEY_PREFIX = `${STORAGE_PREFIX}ux-key:`;

const getSessionStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const getFlowState = (sessionId?: string | null) => {
  if (!sessionId) return null;
  const cached = flowStateCache.get(sessionId);
  if (cached) return cached;
  const storage = getSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(`${FLOW_STORAGE_PREFIX}${sessionId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) return null;
    const state = parsed?.state ?? null;
    if (state) {
      flowStateCache.set(sessionId, state);
    }
    return state;
  } catch {
    return null;
  }
};

export const updateFlowState = (sessionId: string | null | undefined, patch: any) => {
  if (!sessionId || !patch) return;
  const prev = getFlowState(sessionId) || {};
  const next: any = { ...prev };
  Object.entries(patch).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      next[key] = { ...(prev as any)[key], ...value };
    } else {
      next[key] = value;
    }
  });
  flowStateCache.set(sessionId, next);
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(
      `${FLOW_STORAGE_PREFIX}${sessionId}`,
      JSON.stringify({ version: STORAGE_VERSION, state: next })
    );
  } catch {
    // ignore storage errors
  }
};

export const cacheLayeredPayload = (payload: any) => {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  layeredPayloadCache.set(key, payload);
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.setItem(
        `${STORAGE_PREFIX}payload:${key}`,
        JSON.stringify({ version: STORAGE_VERSION, payload })
      );
    } catch {
      // ignore storage errors
    }
  }
  return key;
};

export const getLayeredPayload = (key?: string | string[]) => {
  if (typeof key !== "string") return null;
  const cached = layeredPayloadCache.get(key);
  if (cached) return cached;
  const storage = getSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(`${STORAGE_PREFIX}payload:${key}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) return null;
    const payload = parsed?.payload ?? null;
    if (payload) {
      layeredPayloadCache.set(key, payload);
    }
    return payload;
  } catch {
    return null;
  }
};

export const consumeLayeredPayload = (key?: string | string[]) => {
  if (typeof key !== "string") return null;
  const payload = layeredPayloadCache.get(key) || null;
  if (payload) {
    layeredPayloadCache.delete(key);
  }
  return payload;
};

export const cacheLayeredImage = (prompt: string, url: string) => {
  const key = prompt.trim();
  const value = url.trim();
  if (!key || !value) return;
  layeredImageCache.set(key, value);
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.setItem(
        `${STORAGE_PREFIX}image:${key}`,
        JSON.stringify({ version: STORAGE_VERSION, url: value })
      );
    } catch {
      // ignore storage errors
    }
  }
};

export const getCachedLayeredImage = (prompt: string) => {
  const key = prompt.trim();
  if (!key) return "";
  const cached = layeredImageCache.get(key);
  if (cached) return cached;
  const storage = getSessionStorage();
  if (!storage) return "";
  const raw = storage.getItem(`${STORAGE_PREFIX}image:${key}`);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) return "";
    const url = typeof parsed?.url === "string" ? parsed.url : "";
    if (url) {
      layeredImageCache.set(key, url);
    }
    return url;
  } catch {
    return "";
  }
};

export const cacheUxPlan = (payload: any) => {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  uxPlanCache.set(key, payload);
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.setItem(
        `${STORAGE_PREFIX}ux:${key}`,
        JSON.stringify({ version: STORAGE_VERSION, payload })
      );
    } catch {
      // ignore storage errors
    }
  }
  return key;
};

export const setUxPlanKeyForSessionStep = (
  sessionId: string | null | undefined,
  stepIndex: number,
  cacheKey: string
) => {
  if (!sessionId || !cacheKey || Number.isNaN(stepIndex)) return;
  const key = `${sessionId}:${stepIndex}`;
  uxPlanKeyBySessionStep.set(key, cacheKey);
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.setItem(
        `${UX_KEY_PREFIX}${key}`,
        JSON.stringify({ version: STORAGE_VERSION, cacheKey })
      );
    } catch {
      // ignore storage errors
    }
  }
};

export const getUxPlanKeyForSessionStep = (
  sessionId: string | null | undefined,
  stepIndex: number
) => {
  if (!sessionId || Number.isNaN(stepIndex)) return "";
  const key = `${sessionId}:${stepIndex}`;
  const cached = uxPlanKeyBySessionStep.get(key);
  if (cached) return cached;
  const storage = getSessionStorage();
  if (!storage) return "";
  const raw = storage.getItem(`${UX_KEY_PREFIX}${key}`);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) return "";
    const cacheKey = typeof parsed?.cacheKey === "string" ? parsed.cacheKey : "";
    if (cacheKey) {
      uxPlanKeyBySessionStep.set(key, cacheKey);
    }
    return cacheKey;
  } catch {
    return "";
  }
};

export const getUxPlan = (key?: string | string[]) => {
  if (typeof key !== "string") return null;
  const cached = uxPlanCache.get(key);
  if (cached) return cached;
  const storage = getSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(`${STORAGE_PREFIX}ux:${key}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) return null;
    const payload = parsed?.payload ?? null;
    if (payload) {
      uxPlanCache.set(key, payload);
    }
    return payload;
  } catch {
    return null;
  }
};

export const consumeUxPlan = (key?: string | string[]) => {
  if (typeof key !== "string") return null;
  const payload = uxPlanCache.get(key) || null;
  if (payload) {
    uxPlanCache.delete(key);
  }
  return payload;
};

export const buildSummaryImagePrompt = (summary: string) => {
  const trimmed = summary.trim();
  if (!trimmed) return "";
  return [
    "Create a calming background image for a personalized stress-reduction activity.",
    "It should feel supportive and restorative, suitable as a subtle card backdrop.",
    "No faces or people. No text, logos, or symbols.",
    "Soft natural light, gentle colors, quiet atmosphere; slightly abstract but grounded.",
    `Summary: ${trimmed}`,
  ].join(" ");
};

// Not a route component; prevent Expo Router warnings.
export default {};
