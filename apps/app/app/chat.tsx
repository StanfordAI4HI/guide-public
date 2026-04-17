import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  Pressable,
  ScrollView,
  FlatList,
  NativeSyntheticEvent,
  NativeScrollEvent,
  TextInput,
  Animated,
} from "react-native";
import {
  Bubble,
  GiftedChat,
  IMessage,
  InputToolbar,
  SystemMessage,
  Avatar,
  Time,
} from "react-native-gifted-chat";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  buildSummaryImagePrompt,
  cacheLayeredImage,
  cacheUxPlan,
  getCachedLayeredImage,
  getUxPlanKeyForSessionStep,
  setUxPlanKeyForSessionStep,
} from "./layered-store";
import { Asset } from "expo-asset";
import { LinearGradient } from "expo-linear-gradient";

const BOT = { _id: "bot", name: "AI Support" };
const USER = { _id: "user", name: "You" };
const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:8787";
const LOG_STREAM_URL = `${API_BASE}/logs/stream`;
const TRANSCRIBE_URL = `${API_BASE}/dev/media/transcribe`;

const createSessionIdentifier = () => {
  const globalCrypto = (globalThis as any)?.crypto;
  if (globalCrypto?.randomUUID) {
    try {
      return globalCrypto.randomUUID();
    } catch {
      // ignore and fall through to manual id
    }
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const resolveCachedImageUrl = (payload: any) => {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  const cached =
    typeof payload?.cached_url === "string"
      ? payload.cached_url
      : typeof payload?.cachedUrl === "string"
        ? payload.cachedUrl
        : "";
  if (cached) return cached;
  if (typeof payload?.url === "string") return payload.url;
  if (typeof payload?.image?.url === "string") return payload.image.url;
  return "";
};

const deriveSelectedInterventionPlan = (support: any, fallbackSummary: string) => {
  const combinationOptions = Array.isArray(support?.combination_options)
    ? support.combination_options
    : [];
  const selectedCombination =
    combinationOptions.find(
      (option: any) =>
        option?.option_id &&
        option.option_id ===
          (support?.selected_combination_id || combinationOptions[0]?.option_id)
    ) ||
    combinationOptions[0] ||
    null;
  const blendedActivity =
    selectedCombination?.blended_activity || support?.blended_activity || null;
  const blendedOptions = Array.isArray(blendedActivity?.options)
    ? blendedActivity.options
    : [];
  const finalStepDuration =
    typeof support?.total_duration_minutes === "number" &&
    !Number.isNaN(support.total_duration_minutes)
      ? support.total_duration_minutes
      : null;
  const perStepFallback =
    finalStepDuration && blendedOptions.length
      ? Math.max(1, Math.round(finalStepDuration / blendedOptions.length))
      : null;
  const finalInstructionSteps = blendedOptions
    .slice(0, 2)
    .map((opt: any) => ({
      title: opt?.label || undefined,
      description: [opt?.description || "", ...(Array.isArray(opt?.micro_steps) ? opt.micro_steps : [])]
        .filter(Boolean)
        .join(" ")
        .trim(),
      durationMinutes:
        typeof opt?.duration_minutes === "number" && !Number.isNaN(opt.duration_minutes)
          ? opt.duration_minutes
          : perStepFallback,
    }))
    .filter((step: any) => step.description);
  const combinedDescription = finalInstructionSteps
    .map((step: any) => step.description)
    .filter(Boolean)
    .join(" ")
    .trim();
  const summaryRecap = support?.summary_recap || fallbackSummary || "";

  return {
    selectedCombination,
    blendedActivity,
    finalInstructionSteps,
    combinedDescription,
    summaryRecap,
  };
};

type Prompt = {
  id: string;
  title: string;
  prompt: string;
};


type FollowUpRecord = {
  question: string;
  answer: string | null;
};

type StepAnswer = {
  text: string;
  recordedAt: string;
};

type StepRecord = {
  id: string;
  title: string;
  question: string;
  answers: StepAnswer[];
  followUps: FollowUpRecord[];
};

const SESSION_STORAGE_PREFIX = "supportChatState:";
const SESSION_STORAGE_VERSION = 1;

const getSessionStorage = () => {
  if (Platform.OS !== "web") return null;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const serializeMessage = (message: IMessage) => {
  const createdAt =
    message.createdAt instanceof Date
      ? message.createdAt.toISOString()
      : typeof message.createdAt === "string"
        ? message.createdAt
        : message.createdAt
          ? new Date(message.createdAt as any).toISOString()
          : new Date().toISOString();
  return {
    ...message,
    createdAt,
  };
};

const deserializeMessage = (message: any): IMessage => {
  const createdAt =
    typeof message?.createdAt === "string" ? new Date(message.createdAt) : new Date();
  return {
    ...message,
    createdAt,
  } as IMessage;
};

// Single source of truth for guided chat prompts.
// To add/remove questions later, edit this list only.
const CORE_QUESTIONS: Prompt[] = [
  {
    id: "the_situation",
    title: "The Situation",
    prompt:
      "Please describe the situation, pattern, or concern that has been causing you stress lately.",
  },
  {
    id: "what_feels_hardest",
    title: "What Feels Hardest",
    prompt: "What feels most difficult or burdensome about this for you?",
  },
  {
    id: "how_it_affects_you",
    title: "How It Affects You",
    prompt:
      "In what ways does this affect you, for example in your thoughts, mood, focus, energy, relationships, or daily life?",
  },
  {
    id: "sense_of_control",
    title: "Sense of Control",
    prompt: "How much control do you feel you have over this situation right now?",
  },
  {
    id: "current_context",
    title: "Your Current Context",
    prompt:
      "Right now, where are you and what are you doing? For example, at a desk, commuting, outside, or resting.",
  },
];

const INTRO_PROMPT: Prompt = CORE_QUESTIONS[0];
const QUESTIONS: Prompt[] = CORE_QUESTIONS.slice(1);

const SAFETY_HEADLINE = "I need to pause this conversation now.";
const SAFETY_DESCRIPTION =
  "If you’re thinking about self-harm or suicide, reach out for immediate support:";
const SAFETY_RESOURCES = [
  {
    label: "United States",
    value:
      "Call or text 988 (Suicide & Crisis Lifeline, 24/7). You can also chat at 988lifeline.org.",
  },
  {
    label: "Canada",
    value:
      "Call or text 988 (Suicide & Crisis Lifeline, 24/7). You can also chat at 988lifeline.org.",
  },
];
const SAFETY_FOOTER = "Please stop the study here and reach out for immediate support if needed.";

const SAFETY_PLACEHOLDER_TEXT = `${SAFETY_HEADLINE} ${SAFETY_DESCRIPTION} ${SAFETY_RESOURCES.map(
  (entry) => `${entry.label}: ${entry.value}`
).join(" ")} ${SAFETY_FOOTER}`;

const normalizeMessageText = (text: string) => {
  if (!text) return "";
  return text.replace(/^\s+/, "").replace(/\s+$/, "");
};

const formatMessagesForContext = (messages: IMessage[], limit = 12) =>
  messages
    .slice(-limit)
    .map((msg) => {
      const role =
        msg.user?._id === BOT._id
          ? "assistant"
          : msg.user?._id === USER._id
          ? "user"
          : "system";
      return {
        role,
        text: normalizeMessageText(msg.text || ""),
        createdAt: msg.createdAt || msg._id,
      };
    })
    .filter((entry) => entry.text);

// Full 10-step reference for future expansion:
// const QUESTIONS_FULL: Prompt[] = [
//   { id: "trigger", title: "Trigger / Context", prompt: "Can you describe what was happening just before the stressful situation began? (Where were you, who was involved, what was going on?)" },
//   { id: "event", title: "Event Description", prompt: "What exactly happened that made the situation stressful?" },
//   { id: "thoughts", title: "Thoughts", prompt: "What was the first thought that came to your mind when it happened?" },
//   { id: "emotions", title: "Emotions", prompt: "How did you feel in that moment? (You can mention more than one feeling.)" },
//   { id: "body", title: "Bodily or Physical Reactions", prompt: "Did you notice any changes in your body—like tension, restlessness, or tiredness?" },
//   { id: "actions", title: "Actions / Responses", prompt: "What did you do next? How did you respond or cope at the time?" },
//   { id: "outcome", title: "Outcome", prompt: "What happened after you responded? Did the situation change in any way?" },
//   { id: "reflection", title: "Reflection", prompt: "Looking back, what stands out to you most about this experience?" },
//   { id: "learning", title: "Learning / Reappraisal", prompt: "Has this experience taught you anything about yourself, others, or how you handle stress?" },
//   { id: "support", title: "Support / Unmet Need", prompt: "Was there anything or anyone that helped—or could have helped—you deal with it better?" },
// ];


type RubricDimension = {
  key: string;
  title: string;
  description: string;
  anchors: string;
  group?: string;
};

type InterventionActivity = {
  label?: string;
  description?: string;
  duration_minutes?: number;
  reasoning?: string;
};

type InterventionCandidate = {
  plan_id?: string;
  plan_title?: string;
  summary?: string;
  activities?: InterventionActivity[];
  rationale?: string;
  scores?: Record<string, number>;
  score_notes?: Record<string, string>;
};

type InterventionResult = {
  plan_title?: string;
  summary?: string;
  selection_reasoning?: string;
  source_plan_ids?: string[];
  activities?: InterventionActivity[];
  scores?: Record<string, number>;
  score_notes?: Record<string, string>;
  candidates?: InterventionCandidate[];
  candidate_rubric?: RubricDimension[];
  selection_rubric?: RubricDimension[];
};

type StepControlResult = {
  decision: "follow_up" | "advance";
  follow_up_focus?: string;
  rationale?: string;
  error?: string;
  sessionId?: string;
};

type StepControlRequestArgs = {
  step: Prompt;
  answer: string;
  followUps: FollowUpRecord[];
  nextStep: Prompt | null;
  isFollowUp: boolean;
  introSummary: string;
  stepSummaries: StepRecord[];
};

type AcknowledgeRequestArgs = {
  step: Prompt;
  answer: string;
  decision: "follow_up" | "advance";
  followUpFocus: string;
  nextStep: Prompt | null;
  introSummary: string;
  previousSteps: StepRecord[];
  stepNumber: number;
  totalSteps: number;
  isFollowUp: boolean;
};

type AcknowledgeResult = {
  message: string;
  follow_up_question?: string;
  sessionId?: string;
};

type AutoChatMode = "manual" | "auto";

type AutoTrigger = {
  mode: "intro" | "step" | "follow_up";
  prompt: string;
  step: Prompt | null;
};

const MAX_SNIPPET_CHARS = 140;
const THINKING_VARIATIONS = [
  "Re-reading how you described the turning point.",
  "Noting what felt most intense so I can respond to it directly.",
  "Connecting your emotions with the context you shared.",
];
const OVERLAY_EVENT_LEVEL_MAP: Record<string, number> = {
  "api:layered-intervention:v2-candidates:start": 1,
  "api:layered-intervention:v2-candidates": 2,
  "api:layered-intervention:v2-candidates:partial": 2,
  "api:layered-intervention:v2-candidates:retry": 2,
  "api:layered-intervention:v2-candidates:error": 2,
  "api:layered-intervention:v2-cognitive": 1,
  "api:layered-intervention:v2-cognitive:start": 1,
  "api:layered-intervention:v2-experiential": 1,
  "api:layered-intervention:v2-experiential:start": 1,
  "api:layered-intervention:experiential:start": 1,
  "api:layered-intervention:cognitive:start": 1,
  "api:layered-intervention:v2-combine": 2,
  "api:layered-intervention:v2-combine:start": 2,
  "api:layered-intervention:v2-combine:partial": 2,
  "api:layered-intervention:selection:start": 2,
  "api:layered-intervention:v2-judge": 3,
  "api:layered-intervention:v2-judge:start": 3,
  "api:layered-intervention:v2-judge:complete": 3,
  "api:layered-intervention:v2-simple-judge:start": 3,
  "api:layered-intervention:v2-simple-judge:complete": 3,
  "api:layered-intervention:v2-plan": 4,
  "api:layered-intervention:selection:complete": 4,
  "api:layered-intervention:res": 4,
};
function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function extractSnippet(text: string, maxChars = MAX_SNIPPET_CHARS) {
  const normalized = normalizeWhitespace(text || "");
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function toLowerPhrase(text: string) {
  const trimmed = normalizeWhitespace(text || "");
  if (!trimmed) return "";
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function ensureSentence(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/[.?!]$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.`;
}

function serializeStepRecord(record: StepRecord) {
  return {
    id: record.id,
    title: record.title,
    question: record.question,
    answers: record.answers.map((entry) => entry.text),
    answer_timestamps: record.answers.map((entry) => entry.recordedAt),
    followUps: record.followUps,
  };
}

function buildAcknowledgement({
  step,
  answerSnippet,
  introSnippet,
  isFollowUpResponse,
}: {
  step: Prompt;
  answerSnippet: string;
  introSnippet: string;
  isFollowUpResponse: boolean;
}) {
  const segments: string[] = [];

  if (step.id !== INTRO_PROMPT.id && introSnippet) {
    segments.push(
      `Thinking back to what you shared about ${toLowerPhrase(introSnippet)},`
    );
  }

  if (answerSnippet) {
    const lowered = toLowerPhrase(answerSnippet);
    if (isFollowUpResponse) {
      segments.push(`thanks for clarifying ${lowered}.`);
    } else {
      segments.push(`thanks for sharing ${lowered}.`);
    }
  } else if (isFollowUpResponse) {
    segments.push("thanks for clarifying that.");
  } else {
    segments.push("thanks for sharing that.");
  }

  const sentence = ensureSentence(segments.join(" ").replace(/\s+/g, " "));
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function buildFollowUpQuestion(step: Prompt, focusHint: string) {
  const cleanedHint = toLowerPhrase(focusHint || "");
  const focus = cleanedHint || `what felt most important about ${step.title.toLowerCase()}`;
  return ensureSentence(
    `To stay with ${step.title.toLowerCase()}, could you share a bit more about ${focus}?`
  ).replace(/\.$/, "?");
}


function buildAdvanceContinuation({
  nextStep,
  currentIndex,
  totalSteps,
}: {
  nextStep: Prompt | null;
  currentIndex: number;
  totalSteps: number;
}) {
  if (!nextStep) {
    return "Let me gather everything you’ve shared and pull a summary together next.";
  }

  const stepNumber = currentIndex + 2;
  return [
    `Step ${stepNumber} of ${totalSteps} — ${nextStep.title}`,
    nextStep.prompt,
  ].join("\n");
}

function composeStepMessage({
  step,
  answer,
  decision,
  followUpFocus,
  introSnippet,
  nextStep,
  currentIndex,
  totalSteps,
  isFollowUpResponse,
}: {
  step: Prompt;
  answer: string;
  decision: "follow_up" | "advance";
  followUpFocus: string;
  introSnippet: string;
  nextStep: Prompt | null;
  currentIndex: number;
  totalSteps: number;
  isFollowUpResponse: boolean;
}) {
  const answerSnippet = extractSnippet(answer);
  const acknowledgement = buildAcknowledgement({
    step,
    answerSnippet,
    introSnippet,
    isFollowUpResponse,
  });

  if (decision === "follow_up") {
    const followUpQuestion = buildFollowUpQuestion(step, followUpFocus);
    return {
      message: `${acknowledgement} ${followUpQuestion}`,
      followUpQuestion,
    };
  }

  const continuation = buildAdvanceContinuation({
    nextStep,
    currentIndex,
    totalSteps,
  });

  return {
    message: `${acknowledgement}\n\n${continuation}`,
    followUpQuestion: undefined,
  };
}

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    participantId?: string;
    sessionId?: string;
    condition?: string;
  }>();
  const sessionIdParam =
    typeof params?.sessionId === "string" && params.sessionId.trim()
      ? params.sessionId.trim()
      : "";
  const participantId =
    typeof params.participantId === "string" && params.participantId.trim()
      ? params.participantId.trim()
      : "";
  const conditionCode =
    typeof params?.condition === "string" && params.condition.trim() === "2"
      ? 2
      : 1;
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [introComplete, setIntroComplete] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  const [summaryShown, setSummaryShown] = useState(false);
  const [intervention, setIntervention] = useState<InterventionResult | null>(null);
  const [layeredSupport, setLayeredSupport] = useState<any>(null);
  const [showDecisionDetails, setShowDecisionDetails] = useState(false);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [interventionRequested, setInterventionRequested] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [interventionDurationMs, setInterventionDurationMs] = useState<number | null>(null);
  const [sessionSummary, setSessionSummary] = useState("");
  const [summaryOriginal, setSummaryOriginal] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryVariantMode, setSummaryVariantMode] = useState<"third_person" | "movie" | "character" | "custom">(
    "third_person"
  );
  const [summaryVariantCustom, setSummaryVariantCustom] = useState("");
  const [summaryVariantLoading, setSummaryVariantLoading] = useState(false);
  const [summaryVariantError, setSummaryVariantError] = useState<string | null>(null);
  const [interventionsVisible, setInterventionsVisible] = useState(false);
  const [layeredStatus, setLayeredStatus] = useState<"idle" | "pending" | "ready" | "error">("idle");
  const [layeredError, setLayeredError] = useState<string | null>(null);
  const [summaryTtsStatus, setSummaryTtsStatus] = useState<"idle" | "pending" | "ready" | "error">(
    "idle"
  );
  const [summaryTtsUrl, setSummaryTtsUrl] = useState<string | null>(null);
  const [summaryTtsSourceKey, setSummaryTtsSourceKey] = useState<string>("");
  const [summaryTtsError, setSummaryTtsError] = useState<string | null>(null);
  const summaryTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  const summaryMusicAudioRef = useRef<HTMLAudioElement | null>(null);
const [summaryMusicUri, setSummaryMusicUri] = useState<string | null>(null);
  const [voiceRepliesEnabled, setVoiceRepliesEnabled] = useState(false);
  const [voiceReplyStatus, setVoiceReplyStatus] = useState<"idle" | "pending" | "error">("idle");
  const [voiceReplyError, setVoiceReplyError] = useState<string | null>(null);
  const [lastVoiceReplyUrl, setLastVoiceReplyUrl] = useState<string | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceRecordError, setVoiceRecordError] = useState<string | null>(null);
  const [voiceDraftText, setVoiceDraftText] = useState<string>("");
  const [voiceDraftPending, setVoiceDraftPending] = useState(false);
  const voiceReplyAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenMessageRef = useRef<string | null>(null);
  const voiceTogglePrevRef = useRef(false);
  const mediaRecorderRef = useRef<any>(null);
  const recordingStreamRef = useRef<any>(null);
  const recordChunksRef = useRef<any[]>([]);
  const sessionTimingSubmittedRef = useRef(false);
  const [summaryTtsSentenceIdx, setSummaryTtsSentenceIdx] = useState<number>(-1);
  const [summaryTtsPlaying, setSummaryTtsPlaying] = useState(false);
  const summaryOverlayScrollRef = useRef<ScrollView | null>(null);
  const [summaryOverlayViewportHeight, setSummaryOverlayViewportHeight] = useState(0);
  const [summaryOverlayContentHeight, setSummaryOverlayContentHeight] = useState(0);
  const summaryImageRequestsRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const [summaryImageUrl, setSummaryImageUrl] = useState<string | null>(null);
  const [, setSummaryImageReady] = useState(false);
  const [primaryUxCacheKey, setPrimaryUxCacheKey] = useState<string>("");
  const uxPrefetchStartedRef = useRef(false);
  const uxPrefetchingStepsRef = useRef<Set<number>>(new Set());
  const summarySentences = useMemo(
    () =>
      sessionSummary
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [sessionSummary]
  );
  const summaryParts = useMemo(() => {
    const text = sessionSummary || "";
    const parts: { text: string; isSentence: boolean; index?: number }[] = [];
    const regex = /[^.!?]+[.!?]?/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    let sentenceIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ text: text.slice(lastIndex, match.index), isSentence: false });
      }
      parts.push({ text: match[0], isSentence: true, index: sentenceIndex });
      sentenceIndex += 1;
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), isSentence: false });
    }
    return parts;
  }, [sessionSummary]);
  useEffect(() => {
    if (summaryTtsAudioRef.current) {
      summaryTtsAudioRef.current.pause();
      summaryTtsAudioRef.current = null;
    }
    if (summaryMusicAudioRef.current) {
      summaryMusicAudioRef.current.pause();
      summaryMusicAudioRef.current = null;
    }
    setSummaryImageReady(false);
    setSummaryImageUrl(null);
    setSummaryTtsUrl(null);
    setSummaryTtsSourceKey("");
    setSummaryTtsStatus("idle");
    setSummaryTtsError(null);
    setSummaryTtsPlaying(false);
    setSummaryTtsSentenceIdx(-1);
  }, [sessionSummary]);
  const summarySentenceWordCounts = useMemo(
    () =>
      summarySentences.map((line) => {
        const words = line.split(/\s+/).filter(Boolean);
        return Math.max(1, words.length);
      }),
    [summarySentences]
  );
  const summaryTotalWords = useMemo(
    () => summarySentenceWordCounts.reduce((sum, count) => sum + count, 0),
    [summarySentenceWordCounts]
  );
  const summaryHighlightPulse = useRef(new Animated.Value(0)).current;
  const summaryHighlightScale = summaryHighlightPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const summaryHighlightGlow = summaryHighlightPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.85],
  });
  const isVoiceoverActive = summaryTtsPlaying && summaryTtsSentenceIdx >= 0;
  const stopSummaryNarration = useCallback(() => {
    if (summaryTtsAudioRef.current) {
      summaryTtsAudioRef.current.pause();
      summaryTtsAudioRef.current.currentTime = 0;
    }
    if (summaryMusicAudioRef.current) {
      summaryMusicAudioRef.current.pause();
      summaryMusicAudioRef.current.currentTime = 0;
    }
    setSummaryTtsPlaying(false);
    setSummaryTtsSentenceIdx(-1);
  }, []);
  const [overlaySaplingLevel, setOverlaySaplingLevel] = useState(0);
  const [safetyLock, setSafetyLock] = useState(false);
  const [safetyDetails, setSafetyDetails] = useState("");
  const [sessionId, setSessionId] = useState<string>(() =>
    sessionIdParam ? sessionIdParam : createSessionIdentifier()
  );
  const [autoChatMode, setAutoChatMode] = useState<AutoChatMode>("manual");
  const [interventionLoadingElapsedMs, setInterventionLoadingElapsedMs] = useState(0);
  const [interfaceGenerationDurationMs, setInterfaceGenerationDurationMs] = useState<number | null>(null);
  const [interventionReadyDeferred, setInterventionReadyDeferred] = useState(false);
  const [interventionReadySticky, setInterventionReadySticky] = useState(false);
  const hasStartedRef = useRef(false);
  const hasHydratedRef = useRef(false);
  const [hydrationReady, setHydrationReady] = useState(false);
  const outstandingFollowUpRef = useRef<{ stepIndex: number; prompt: string } | null>(null);
  const inputValueRef = useRef("");
  const chatInstanceRef = useRef<any>(null);
  const isAtBottomRef = useRef(true);
  const messagesRef = useRef<IMessage[]>([]);
  const introRecordRef = useRef<StepRecord>({
    id: INTRO_PROMPT.id,
    title: INTRO_PROMPT.title,
    question: INTRO_PROMPT.prompt,
    answers: [] as StepAnswer[],
    followUps: [],
  });
  const stepRecordsRef = useRef<StepRecord[]>(
    QUESTIONS.map((q) => ({
      id: q.id,
      title: q.title,
      question: q.prompt,
      answers: [] as StepAnswer[],
      followUps: [],
    }))
  );
  const autoModeRef = useRef<AutoChatMode>("manual");
  const awaitingResponseRef = useRef<AutoTrigger | null>(null);
  const autoQueueRef = useRef<AutoTrigger | null>(null);
  const autoProcessingRef = useRef(false);
  const autoRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleMessageFlowRef = useRef<((msgs: IMessage[]) => void) | null>(null);
  const processAutoQueueRef = useRef<() => void>(() => {});
  const [isTyping, setIsTyping] = useState(false);
  const interventionTimerRef = useRef<number | null>(null);
  const interfaceGenerationStartedAtRef = useRef<number | null>(null);
  const layeredGenerationRef = useRef<Promise<any> | null>(null);
  const listViewRef = useRef<FlatList<IMessage> | null>(null);
  const summaryPayloadRef = useRef<any[]>([]);
  const layeredSupportRef = useRef<any>(layeredSupport);
  const layeredStatusRef = useRef(layeredStatus);
  const lastLoggedSummaryRef = useRef<string>("");
  const overlayPulseValue = useRef(new Animated.Value(0)).current;
  const canUseVoicePlayback =
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    Boolean((window as any).Audio);
  const canUseVoiceInput =
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    Boolean((navigator as any)?.mediaDevices?.getUserMedia) &&
    Boolean((window as any)?.MediaRecorder);
  const canUseNativeDriver = Platform.OS !== "web";

  const candidateRubric = intervention?.candidate_rubric ?? [];
  const selectionRubric = intervention?.selection_rubric ?? [];
  const finalScores = intervention?.scores ?? {};
  const finalScoreNotes = intervention?.score_notes ?? {};
  const summaryEdited = useMemo(() => {
    return summaryOriginal.trim() !== sessionSummary.trim();
  }, [sessionSummary, summaryOriginal]);

  const summaryTtsProfile = useMemo(
    () => ({
      guidance:
        "Choose voice, pitch, and pacing that fit the summary content. Sound like a supportive peer, not a narrator.",
    }),
    []
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    let cancelled = false;
    (async () => {
      try {
        const asset = Asset.fromModule(require("../assets/audio/piano.mp3"));
        await asset.downloadAsync();
        if (cancelled) return;
        const uri = asset.localUri || asset.uri;
        if (uri) {
          setSummaryMusicUri(uri);
        }
      } catch (err) {
        console.warn("[summary-tts] ambient music load failed", err);
      }
    })();
    return () => {
      cancelled = true;
      if (summaryMusicAudioRef.current) {
        summaryMusicAudioRef.current.pause();
        summaryMusicAudioRef.current = null;
      }
    };
  }, []);
  const handleOverlayLogEvent = useCallback(
    (eventName?: string) => {
      const normalized = typeof eventName === "string" ? eventName.trim().toLowerCase() : "";
      if (!normalized) return;
      const nextLevel = OVERLAY_EVENT_LEVEL_MAP[normalized];
      if (!nextLevel) return;
      setOverlaySaplingLevel((prev) => Math.max(prev, nextLevel));
    },
    []
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!summaryTtsUrl) return;
    try {
      if (summaryTtsAudioRef.current) {
        summaryTtsAudioRef.current.pause();
        summaryTtsAudioRef.current = null;
      }
      if (summaryMusicAudioRef.current) {
        summaryMusicAudioRef.current.pause();
        summaryMusicAudioRef.current = null;
      }
      const audioCtor = (typeof window !== "undefined" && (window as any).Audio) || null;
      if (!audioCtor) {
        setSummaryTtsError("Audio playback is not available.");
        setSummaryTtsStatus("error");
        return;
      }
      const audio = new audioCtor(summaryTtsUrl);
      audio.preload = "auto";
      let music: HTMLAudioElement | null = null;
      if (summaryMusicUri) {
        const musicAudio = new audioCtor(summaryMusicUri) as HTMLAudioElement;
        musicAudio.loop = true;
        musicAudio.volume = 0.14;
        music = musicAudio;
        summaryMusicAudioRef.current = musicAudio;
      }
      audio.onended = () => {
        setSummaryTtsStatus("ready");
        setSummaryTtsPlaying(false);
        if (music) {
          music.pause();
        }
      };
      const sentenceSnapshot = summarySentences;
      const sentenceWordCountsSnapshot = summarySentenceWordCounts;
      const totalWordsSnapshot = summaryTotalWords;
      audio.ontimeupdate = () => {
        if (!audio.duration || !sentenceSnapshot.length || !totalWordsSnapshot) return;
        const fraction = Math.max(0, Math.min(1, audio.currentTime / audio.duration));
        const wordsSpoken = fraction * totalWordsSnapshot;
        let running = 0;
        let targetIdx = sentenceSnapshot.length - 1;
        for (let i = 0; i < sentenceSnapshot.length; i += 1) {
          running += sentenceWordCountsSnapshot[i] || 1;
          if (wordsSpoken <= running) {
            targetIdx = i;
            break;
          }
        }
        setSummaryTtsSentenceIdx((prev) => (prev === targetIdx ? prev : targetIdx));
      };
      audio.onerror = () => {
        setSummaryTtsStatus("error");
        setSummaryTtsError("Could not play the narration.");
        setSummaryTtsPlaying(false);
        if (music) {
          music.pause();
        }
      };
      audio.onpause = () => {
        setSummaryTtsPlaying(false);
      };
      summaryTtsAudioRef.current = audio;
      audio
        .play()
        .then(() => {
          setSummaryTtsPlaying(true);
          if (music) {
            music.play().catch((err: any) => {
              console.warn("[summary] ambient play failed", err);
            });
          }
        })
        .catch((err: any) => {
          console.warn("[summary] TTS play failed", err);
          setSummaryTtsStatus("error");
          setSummaryTtsError("Could not play the narration.");
          setSummaryTtsPlaying(false);
          if (music) {
            music.pause();
          }
        });
    } catch (err) {
      console.warn("[summary] TTS playback init failed", err);
      setSummaryTtsStatus("error");
      setSummaryTtsError("Could not play the narration.");
    }
  }, [summaryMusicUri, summaryTtsUrl]);

  useEffect(() => {
    const currentSummaryKey = normalizeWhitespace(sessionSummary.trim()).toLowerCase();
    if (!summaryTtsSourceKey) return;
    if (summaryTtsSourceKey === currentSummaryKey) return;
    stopSummaryNarration();
    setSummaryTtsStatus("idle");
    setSummaryTtsUrl(null);
    setSummaryTtsSourceKey("");
    setSummaryTtsError(null);
  }, [sessionSummary, summaryTtsSourceKey, stopSummaryNarration]);

  useEffect(
    () => () => {
      if (summaryTtsAudioRef.current) {
        summaryTtsAudioRef.current.pause();
        summaryTtsAudioRef.current = null;
      }
      if (summaryMusicAudioRef.current) {
        summaryMusicAudioRef.current.pause();
        summaryMusicAudioRef.current = null;
      }
      setSummaryTtsSentenceIdx(-1);
    },
    []
  );

  useEffect(() => {
    if (summaryTtsSentenceIdx < 0) return;
    summaryHighlightPulse.setValue(0);
    Animated.sequence([
      Animated.timing(summaryHighlightPulse, { toValue: 1, duration: 220, useNativeDriver: canUseNativeDriver }),
      Animated.timing(summaryHighlightPulse, { toValue: 0.35, duration: 300, useNativeDriver: canUseNativeDriver }),
    ]).start();
  }, [canUseNativeDriver, summaryTtsSentenceIdx, summaryHighlightPulse]);

  useEffect(() => {
    if (!isVoiceoverActive) return;
    if (summaryTtsSentenceIdx < 0) return;
    if (!summarySentences.length) return;
    const maxScroll = Math.max(0, summaryOverlayContentHeight - summaryOverlayViewportHeight);
    if (maxScroll <= 0) return;
    const ratio = Math.min(1, Math.max(0, (summaryTtsSentenceIdx + 0.5) / summarySentences.length));
    const targetY = Math.max(
      0,
      Math.min(maxScroll, ratio * summaryOverlayContentHeight - summaryOverlayViewportHeight / 2)
    );
    summaryOverlayScrollRef.current?.scrollTo({ y: targetY, animated: true });
  }, [
    isVoiceoverActive,
    summaryTtsSentenceIdx,
    summarySentences.length,
    summaryOverlayContentHeight,
    summaryOverlayViewportHeight,
  ]);
  const logIntervention = useCallback(
    (message: string, context?: Record<string, unknown>) => {
      if (context) {
        console.log(`[layered-support] ${message}`, context);
      } else {
        console.log(`[layered-support] ${message}`);
      }
    },
    []
  );

  useEffect(() => {
    if (!sessionId || sessionIdParam) return;
    router.replace({
      pathname: "/chat",
      params: {
        ...(participantId ? { participantId } : {}),
        condition: String(conditionCode),
        sessionId,
      },
    });
  }, [conditionCode, participantId, router, sessionId, sessionIdParam]);

  useEffect(() => {
    if (!sessionId || hasHydratedRef.current) return;
    const storage = getSessionStorage();
    const storageKey = `${SESSION_STORAGE_PREFIX}${sessionId}`;
    console.log("[chat] hydrate:start", {
      sessionId,
      hasSessionParam: Boolean(sessionIdParam),
      hasStorage: Boolean(storage),
    });
    if (storage) {
      const raw = storage.getItem(storageKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.version === SESSION_STORAGE_VERSION) {
            console.log("[chat] hydrate:storage", {
              hasMessages: Array.isArray(parsed?.messages) && parsed.messages.length > 0,
              hasSummary:
                typeof parsed?.sessionSummary === "string" &&
                parsed.sessionSummary.trim().length > 0,
              hasProgress:
                Boolean(parsed?.introComplete) ||
                Boolean(parsed?.isSessionComplete) ||
                typeof parsed?.currentStepIndex === "number",
            });
            const hasStoredMessages = Array.isArray(parsed?.messages) && parsed.messages.length > 0;
            const hasStoredSummary =
              typeof parsed?.sessionSummary === "string" && parsed.sessionSummary.trim().length > 0;
            const hasStoredProgress =
              Boolean(parsed?.introComplete) ||
              Boolean(parsed?.isSessionComplete) ||
              (typeof parsed?.currentStepIndex === "number" && parsed.currentStepIndex > 0);
            const shouldRestore = hasStoredMessages || hasStoredSummary || hasStoredProgress;
            if (!shouldRestore) {
              console.log("[chat] hydrate:storage-skip");
              hasHydratedRef.current = true;
              setHydrationReady(true);
              return;
            }
            const restoredMessages = Array.isArray(parsed?.messages)
              ? parsed.messages.map(deserializeMessage)
              : [];
            setMessages(restoredMessages);
            messagesRef.current = restoredMessages;
            introRecordRef.current = parsed?.introRecord || introRecordRef.current;
            stepRecordsRef.current = Array.isArray(parsed?.stepRecords)
              ? parsed.stepRecords
              : stepRecordsRef.current;
            summaryPayloadRef.current = [
              introRecordRef.current,
              ...stepRecordsRef.current,
            ]
              .filter((record) => record?.answers?.length)
              .map(serializeStepRecord);
            setIntroComplete(Boolean(parsed?.introComplete));
            setCurrentStepIndex(
              typeof parsed?.currentStepIndex === "number" ? parsed.currentStepIndex : 0
            );
            setIsSessionComplete(Boolean(parsed?.isSessionComplete));
            setSummaryShown(Boolean(parsed?.summaryShown));
            setSessionSummary(typeof parsed?.sessionSummary === "string" ? parsed.sessionSummary : "");
            setSummaryOriginal(
              typeof parsed?.summaryOriginal === "string" ? parsed.summaryOriginal : ""
            );
            setLayeredSupport(parsed?.layeredSupport ?? null);
            setLayeredStatus(parsed?.layeredStatus || "idle");
            setLayeredError(typeof parsed?.layeredError === "string" ? parsed.layeredError : null);
            setIntervention(parsed?.intervention ?? null);
            setInterventionDurationMs(
              typeof parsed?.interventionDurationMs === "number"
                ? parsed.interventionDurationMs
                : null
            );
            setInterventionRequested(
              Boolean(
                parsed?.interventionRequested ||
                  parsed?.intervention ||
                  parsed?.layeredSupport ||
                  parsed?.layeredStatus === "pending" ||
                  parsed?.layeredStatus === "ready"
              )
            );
            setInterventionsVisible(
              Boolean(
                parsed?.interventionsVisible ||
                  parsed?.interventionRequested ||
                  parsed?.layeredSupport ||
                  parsed?.layeredStatus === "pending" ||
                  parsed?.layeredStatus === "ready"
              )
            );
            setInterventionReadySticky(Boolean(parsed?.interventionReadySticky));
            setInterventionReadyDeferred(Boolean(parsed?.interventionReadyDeferred));
            hasStartedRef.current = true;
            hasHydratedRef.current = true;
            setHydrationReady(true);
            console.log("[chat] hydrate:storage-complete", {
              restoredMessages: restoredMessages.length,
            });
            return;
          }
        } catch (err) {
          console.warn("[chat] failed to parse cached session state", err);
        }
      }
    }

    const fetchSession = async () => {
      let didRestore = false;
      try {
        console.log("[chat] hydrate:server:start", { sessionId });
        const resp = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}`);
        if (!resp.ok) return;
        const data = await resp.json();
        const restoredMessages = Array.isArray(data?.messages)
          ? data.messages.map((msg: any, idx: number) => ({
              _id: msg?.id ?? `server:${idx}`,
              text: msg?.content ?? "",
              createdAt: msg?.created_at ? new Date(msg.created_at) : new Date(),
              user: msg?.role === "assistant" || msg?.role === "system" ? BOT : USER,
            }))
          : [];
        if (restoredMessages.length) {
          setMessages(restoredMessages);
          messagesRef.current = restoredMessages;
          didRestore = true;
        }
        const summaries = Array.isArray(data?.summaries) ? data.summaries : [];
        const lastSummary =
          summaries.length > 0 ? summaries[summaries.length - 1]?.summary || "" : "";
        if (lastSummary) {
          setSessionSummary(lastSummary);
          setSummaryOriginal(lastSummary);
          setSummaryShown(true);
          setIsSessionComplete(true);
          setIntroComplete(true);
          setCurrentStepIndex(Math.max(QUESTIONS.length - 1, 0));
          didRestore = true;
        }
      } catch (err) {
        console.warn("[chat] failed to rehydrate session", err);
      } finally {
        if (didRestore) {
          hasStartedRef.current = true;
        }
        hasHydratedRef.current = true;
        setHydrationReady(true);
        console.log("[chat] hydrate:server-complete", { didRestore });
      }
    };
    if (!sessionIdParam) {
      console.log("[chat] hydrate:skip-server");
      hasHydratedRef.current = true;
      setHydrationReady(true);
      return;
    }
    void fetchSession();
  }, [participantId, sessionId, sessionIdParam]);

  useEffect(() => {
    const storage = getSessionStorage();
    if (!storage || !sessionId) return;
    const payload = {
      version: SESSION_STORAGE_VERSION,
      sessionId,
      messages: messages.map(serializeMessage),
      introComplete,
      currentStepIndex,
      isSessionComplete,
      summaryShown,
      sessionSummary,
      summaryOriginal,
      introRecord: introRecordRef.current,
      stepRecords: stepRecordsRef.current,
      layeredSupport,
      layeredStatus,
      layeredError,
      intervention,
      interventionDurationMs,
      interventionRequested,
      interventionsVisible,
      interventionReadySticky,
      interventionReadyDeferred,
    };
    try {
      storage.setItem(`${SESSION_STORAGE_PREFIX}${sessionId}`, JSON.stringify(payload));
    } catch (err) {
      console.warn("[chat] failed to persist session state", err);
    }
  }, [
    currentStepIndex,
    introComplete,
    intervention,
    interventionDurationMs,
    isSessionComplete,
    layeredError,
    layeredStatus,
    layeredSupport,
    messages,
    sessionId,
    sessionSummary,
    summaryOriginal,
    summaryShown,
    interventionRequested,
    interventionsVisible,
    interventionReadySticky,
    interventionReadyDeferred,
  ]);

  const requestSummaryTts = useCallback(async () => {
    const text = sessionSummary.trim();
    const sourceKey = normalizeWhitespace(text).toLowerCase();
    if (!text) {
      setSummaryTtsError("No summary available yet.");
      return;
    }
    if (summaryLoading) {
      setSummaryTtsError("Still drafting your summary—try again in a moment.");
      return;
    }
    if (
      summaryTtsStatus === "ready" &&
      summaryTtsUrl &&
      summaryTtsAudioRef.current &&
      summaryTtsSourceKey === sourceKey
    ) {
      summaryTtsAudioRef.current.currentTime = 0;
      summaryTtsAudioRef.current
        .play()
        .then(() => {
          setSummaryTtsPlaying(true);
          if (summaryMusicAudioRef.current) {
            summaryMusicAudioRef.current.currentTime = 0;
            summaryMusicAudioRef.current.play().catch(() => {});
          }
        })
        .catch((err) => {
          console.warn("[summary] replay failed", err);
        });
      return;
    }
    setSummaryTtsStatus("pending");
    setSummaryTtsError(null);
    setSummaryTtsUrl(null);
    setSummaryTtsSourceKey("");
    setSummaryTtsSentenceIdx(-1);
    try {
      const resp = await fetch(`${API_BASE}/dev/media/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          // Ask backend/GPT to pick the voice/pitch/tone instead of using a fixed profile.
          style: summaryTtsProfile.guidance,
          use_gpt_voice: true,
        }),
      });
      const body = await resp.text();
      const parsed = (() => {
        try {
          return JSON.parse(body);
        } catch {
          return null;
        }
      })();
      if (!resp.ok || !parsed?.audio_url) {
        throw new Error(parsed?.error || body || `TTS failed (${resp.status})`);
      }
      setSummaryTtsUrl(parsed.audio_url);
      setSummaryTtsSourceKey(sourceKey);
      setSummaryTtsStatus("ready");
    } catch (err: any) {
      setSummaryTtsStatus("error");
      setSummaryTtsError(err?.message || "Could not create narration.");
    }
  }, [sessionSummary, summaryLoading, summaryTtsProfile, summaryTtsStatus, summaryTtsUrl, summaryTtsSourceKey]);

  const requestSummaryVariant = useCallback(async () => {
    if (!sessionSummary.trim()) {
      setSummaryVariantError("No summary available yet.");
      return;
    }
    if (summaryVariantMode === "custom" && !summaryVariantCustom.trim()) {
      setSummaryVariantError("Add a custom style to continue.");
      return;
    }
    setSummaryVariantLoading(true);
    setSummaryVariantError(null);
    stopSummaryNarration();
    try {
      const payload = {
        summary: sessionSummary.trim(),
        mode: summaryVariantMode,
        custom: summaryVariantMode === "custom" ? summaryVariantCustom.trim() : "",
      };
      const res = await fetch(`${API_BASE}/summary/variant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const contentType = res.headers.get("content-type") || "";
      const rawText = await res.text();
      const data =
        contentType.includes("application/json") && rawText
          ? JSON.parse(rawText)
          : null;
      if (!res.ok) {
        throw new Error(
          data?.error ||
            `Unable to generate a variant summary (status ${res.status}).`
        );
      }
      if (!data?.text) {
        const preview = rawText?.slice(0, 120);
        throw new Error(
          preview
            ? `Unexpected response: ${preview}`
            : "Unable to generate a variant summary."
        );
      }
      setSessionSummary(String(data.text));
    } catch (err: any) {
      setSummaryVariantError(err?.message || "Unable to generate a variant summary.");
    } finally {
      setSummaryVariantLoading(false);
    }
  }, [sessionSummary, summaryVariantMode, summaryVariantCustom, stopSummaryNarration]);

  const prefetchUxPlansForSupport = useCallback(
    async (support: any) => {
      if (!support || !sessionId) return;
      const existingPrimaryKey = getUxPlanKeyForSessionStep(sessionId, 0);
      if (uxPrefetchStartedRef.current && (existingPrimaryKey || primaryUxCacheKey)) return;
      uxPrefetchStartedRef.current = true;

      const { finalInstructionSteps, combinedDescription, summaryRecap } =
        deriveSelectedInterventionPlan(support, sessionSummary);
      if (existingPrimaryKey) {
        setPrimaryUxCacheKey(existingPrimaryKey);
      }

      if (!finalInstructionSteps.length) {
        console.warn("[chat] ux prefetch skipped: no final steps");
        return;
      }

      const uxSummary = [summaryRecap || "", combinedDescription].filter(Boolean).join(" ").trim();
      if (!uxSummary) return;

      console.log("[chat] ux prefetch start", {
        steps: finalInstructionSteps.length,
        summaryPreview: uxSummary.slice(0, 160),
      });

      await Promise.all(
        finalInstructionSteps.slice(0, 1).map(async (_step: any, idx: number) => {
          const existingCacheKey = getUxPlanKeyForSessionStep(sessionId, idx);
          if (existingCacheKey) {
            if (idx === 0) setPrimaryUxCacheKey(existingCacheKey);
            return;
          }
          if (uxPrefetchingStepsRef.current.has(idx)) return;
          uxPrefetchingStepsRef.current.add(idx);

          try {
            const resp = await fetch(`${API_BASE}/dev/stress-support/intervention`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                summary: uxSummary,
                formats: ["planner"],
                sessionId,
              }),
            });
            const text = await resp.text();
            if (!resp.ok) {
              throw new Error(`Planner HTTP ${resp.status}: ${text?.slice?.(0, 160)}`);
            }
            let data: any = {};
            try {
              data = JSON.parse(text);
            } catch {
              throw new Error("Planner response not JSON");
            }
            if (Number(data?.fallback_intervention) === 1) {
              console.log("[ux-console] fallback intervention used", {
                reason: data?.fallback_reason || "unknown",
              });
            }
            if (!data?.spec) {
              throw new Error("Planner spec missing");
            }
            const specText = JSON.stringify(data.spec, null, 2);
            const spec = data.spec;
            const specModules = Array.isArray(spec?.modules) ? spec.modules : [];
            const hasAudio = specModules.some((m: any) => m?.id === "short_audio");
            const hasImage = specModules.some((m: any) => m?.id === "image");
            const hasStoryboard = specModules.some((m: any) => m?.id === "storyboard");
            const hasVideo = specModules.some((m: any) => m?.id === "dalle_video");
            const hasTimed = specModules.some((m: any) => m?.id === "timed_cues");

            const mediaBundle: Record<string, any> = {};
            const mediaJobs: Array<Promise<any>> = [];

            if (hasAudio) {
              mediaJobs.push(
                fetch(`${API_BASE}/dev/stress-support/intervention`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    summary: spec?.instruction || uxSummary,
                    formats: ["short_audio"],
                    sessionId,
                  }),
                })
                  .then(async (r) => {
                    const d = await r.json();
                    const asset =
                      (Array.isArray(d?.assets) &&
                        d.assets.find((a: any) => a.type === "audio" || a.type === "music" || a.type === "ambient")) ||
                      null;
                    if (!asset) return;
                    mediaBundle.audioScript = asset?.audio_script;
                    mediaBundle.audioTone = asset?.audio_tone;
                    mediaBundle.voicePitch = asset?.voice_pitch;
                    mediaBundle.voiceRate = asset?.voice_rate;
                    mediaBundle.musicPrompt = asset?.music_prompt;
                    mediaBundle.musicChoice = asset?.music_choice;
                    mediaBundle.audioPurpose = asset?.purpose;
                    mediaBundle.audioRationale = asset?.explanation;
                  })
                  .catch((err) => console.warn("[chat] prefetch short_audio failed", err?.message || err))
              );
            }

            if (hasTimed) {
              mediaJobs.push(
                fetch(`${API_BASE}/dev/stress-support/intervention`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    summary: spec?.instruction || uxSummary,
                    formats: ["timed_cues"],
                    sessionId,
                  }),
                })
                  .then(async (r) => {
                    const d = await r.json();
                    const timerAsset =
                      (Array.isArray(d?.assets) && d.assets.find((a: any) => a.type === "timer")) || null;
                    if (!timerAsset) return;
                    mediaBundle.timerSteps = timerAsset?.timer_steps;
                    mediaBundle.timerScript = timerAsset?.audio_script;
                    mediaBundle.timerRationale = timerAsset?.explanation;
                    if (timerAsset?.audio_script) {
                      try {
                        const timedVoiceRate =
                          typeof timerAsset?.voice_rate === "number" && Number.isFinite(timerAsset.voice_rate)
                            ? Math.min(0.7, Math.max(0.5, timerAsset.voice_rate))
                            : 0.6;
                        const ttsResp = await fetch(`${API_BASE}/dev/media/tts`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            text: timerAsset.audio_script,
                            speed: timedVoiceRate,
                            use_gpt_voice: true,
                            style: "calm, human, grounded guidance",
                          }),
                        });
                        const ttsData = await ttsResp.json();
                        if (ttsResp.ok && ttsData?.audio_url) {
                          mediaBundle.timerAudioUrl = ttsData.audio_url;
                          mediaBundle.timerAudioSource =
                            ttsData.voice_source === "gpt" || ttsData.voice_source === "generic"
                              ? ttsData.voice_source
                              : ttsData.used_gpt_voice === true
                              ? "gpt"
                              : "unknown";
                          if (
                            typeof ttsData?.duration_seconds === "number" &&
                            Number.isFinite(ttsData.duration_seconds) &&
                            ttsData.duration_seconds > 0
                          ) {
                            mediaBundle.timerAudioDurationSeconds = Math.round(ttsData.duration_seconds);
                          }
                        }
                      } catch (err: any) {
                        console.warn("[chat] prefetch timed_cues tts failed", err?.message || err);
                      }
                    }
                  })
                  .catch((err) => console.warn("[chat] prefetch timed_cues failed", err?.message || err))
              );
            }

            if (hasImage) {
              mediaJobs.push(
                fetch(`${API_BASE}/dev/media/image`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    prompt: `${spec?.instruction || uxSummary} — reflect the user’s environment and situation (desk, home, commute, office), sharp focus, concrete real-world scene, high detail, no blur or haze, no faces, no text, cinematic still`,
                  }),
                })
                  .then(async (r) => {
                    const d = await r.json();
                    if (r.ok && (d?.cached_url || d?.url || d?.image?.url)) {
                      const url = resolveCachedImageUrl(d);
                      if (url) mediaBundle.imageUrl = url;
                    }
                  })
                  .catch((err) => console.warn("[chat] prefetch image failed", err?.message || err))
              );
            }

            if (hasStoryboard) {
              mediaJobs.push(
                fetch(`${API_BASE}/dev/stress-support/intervention`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    summary: spec?.instruction || uxSummary,
                    formats: ["storyboard"],
                    sessionId,
                  }),
                })
                  .then(async (r) => {
                    const d = await r.json();
                    const asset =
                      (Array.isArray(d?.assets) && d.assets.find((a: any) => a.type === "storyboard")) || null;
                    const stepFrames = Array.isArray(d?.steps?.[0]?.asset?.frames)
                      ? d.steps[0].asset.frames
                      : Array.isArray(d?.step?.asset?.frames)
                        ? d.step.asset.frames
                        : [];
                    const frames = stepFrames.length ? stepFrames : Array.isArray(asset?.frames) ? asset.frames : [];
                    if (!frames.length) return;
                    mediaBundle.storyboardFrames = frames;
                    const imagePrompts = frames
                      .map((frame: any) =>
                        typeof frame === "object" && frame?.image_prompt
                          ? frame.image_prompt
                          : typeof frame === "string"
                            ? frame
                            : null
                      )
                      .filter(Boolean) as string[];
                    if (!imagePrompts.length) return;
                    const storyboardUrls: string[] = [];
                    for (const prompt of imagePrompts.slice(0, 3)) {
                      try {
                        const sr = await fetch(`${API_BASE}/dev/media/image`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            prompt: `${prompt} — natural light, no faces, no text, cinematic still`,
                          }),
                        });
                        const sd = await sr.json();
                        if (sr.ok && (sd?.cached_url || sd?.url || sd?.image?.url)) {
                          const url = resolveCachedImageUrl(sd);
                          if (url) storyboardUrls.push(url);
                        }
                      } catch (e) {
                        console.warn("[chat] prefetch storyboard image failed", e);
                      }
                    }
                    if (storyboardUrls.length) {
                      mediaBundle.storyboardImages = storyboardUrls;
                    }
                  })
                  .catch((err) => console.warn("[chat] prefetch storyboard failed", err?.message || err))
              );
            }

            if (hasVideo) {
              mediaJobs.push(
                fetch(`${API_BASE}/dev/stress-support/intervention`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    summary: spec?.instruction || uxSummary,
                    formats: ["dalle_video"],
                    sessionId,
                  }),
                })
                  .then(async (r) => {
                    const d = await r.json();
                    const asset =
                      (Array.isArray(d?.assets) && d.assets.find((a: any) => a.type === "video")) || null;
                    if (!asset) return;
                    const prompts = Array.isArray(asset?.prompts) ? asset.prompts : [];
                    const scriptLines = Array.isArray(asset?.script_lines)
                      ? asset.script_lines
                      : Array.isArray(asset?.script)
                        ? asset.script
                        : typeof asset?.script === "string"
                          ? asset.script.split("\n").filter(Boolean)
                          : [];
                    mediaBundle.videoPrompts = prompts;
                    mediaBundle.videoScript = scriptLines;
                    if (scriptLines.length) {
                      try {
                        const ttsResp = await fetch(`${API_BASE}/dev/media/tts`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            text: scriptLines.join(". "),
                            speed: 0.95,
                            use_gpt_voice: true,
                            style: "gentle, supportive voiceover",
                          }),
                        });
                        const ttsData = await ttsResp.json();
                        if (ttsResp.ok && ttsData?.audio_url) {
                          mediaBundle.videoAudioUrl = ttsData.audio_url;
                          mediaBundle.videoAudioSource =
                            ttsData.voice_source === "gpt" || ttsData.voice_source === "generic"
                              ? ttsData.voice_source
                              : ttsData.used_gpt_voice === true
                              ? "gpt"
                              : "unknown";
                          if (
                            typeof ttsData?.duration_seconds === "number" &&
                            Number.isFinite(ttsData.duration_seconds) &&
                            ttsData.duration_seconds > 0
                          ) {
                            mediaBundle.videoAudioDurationSeconds = Math.round(ttsData.duration_seconds);
                          }
                        }
                      } catch (e) {
                        console.warn("[chat] prefetch video voiceover failed", e);
                      }
                    }
                    if (!prompts.length) return;
                    const urls: string[] = [];
                    for (const prompt of prompts.slice(0, 4)) {
                      try {
                        const vr = await fetch(`${API_BASE}/dev/media/image`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ prompt }),
                        });
                        const vd = await vr.json();
                        if (vr.ok && (vd?.cached_url || vd?.url || vd?.image?.url)) {
                          const url = resolveCachedImageUrl(vd);
                          if (url) urls.push(url);
                        }
                      } catch (e) {
                        console.warn("[chat] prefetch video frame failed", e);
                      }
                    }
                    if (urls.length) {
                      mediaBundle.videoUrls = urls;
                    }
                  })
                  .catch((err) => console.warn("[chat] prefetch video failed", err?.message || err))
              );
            }

            if (mediaJobs.length) {
              await Promise.all(mediaJobs);
            }
            const cacheKey = cacheUxPlan({
              specText,
              description: uxSummary,
              generatedAt: new Date().toISOString(),
              media: mediaBundle,
            });
            setUxPlanKeyForSessionStep(sessionId, idx, cacheKey);
            if (idx === 0) setPrimaryUxCacheKey(cacheKey);
            console.log("[chat] ux plan prefetched", { step: idx, cacheKey });
          } catch (err: any) {
            console.warn("[chat] ux plan prefetch failed", { step: idx, error: err?.message || err });
          } finally {
            uxPrefetchingStepsRef.current.delete(idx);
          }
        })
      );
      if (!getUxPlanKeyForSessionStep(sessionId, 0) && !primaryUxCacheKey) {
        uxPrefetchStartedRef.current = false;
      }
    },
    [primaryUxCacheKey, sessionId, sessionSummary]
  );

  const prefetchSummaryImage = useCallback(
    async (summaryText: string) => {
      const prompt = buildSummaryImagePrompt(summaryText);
      if (!prompt) return null;
      const cached = getCachedLayeredImage(prompt);
      if (cached) {
        console.log("[summary-image] prefetch cache hit", {
          promptPreview: prompt.slice(0, 120),
          urlPreview: cached.slice(0, 80),
        });
        setSummaryImageUrl(cached);
        setSummaryImageReady(true);
        if (sessionId) {
          fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/intervention-card`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_url: cached, image_prompt: prompt }),
          }).catch(() => {});
        }
        return cached;
      }
      if (summaryImageRequestsRef.current.has(prompt)) {
        console.log("[summary-image] prefetch already in-flight", {
          promptPreview: prompt.slice(0, 120),
        });
        return summaryImageRequestsRef.current.get(prompt) || null;
      }
      console.log("[summary-image] prefetch start", {
        promptPreview: prompt.slice(0, 120),
      });
      const promise = fetch(`${API_BASE}/dev/media/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })
        .then(async (resp) => {
          const body = await resp.text();
          const parsed = (() => {
            try {
              return JSON.parse(body);
            } catch {
              return null;
            }
          })();
          if (!resp.ok) {
            throw new Error(parsed?.detail || parsed?.error || body || `Image failed (${resp.status})`);
          }
          const rawUrl =
            (typeof parsed?.cached_url === "string" && parsed.cached_url.trim()) ||
            (typeof parsed?.url === "string" && parsed.url.trim()) ||
            (typeof parsed?.image?.url === "string" && parsed.image.url.trim()) ||
            "";
          const url = rawUrl.startsWith("/") ? `${API_BASE}${rawUrl}` : rawUrl;
          if (!url) {
            throw new Error("Image url missing");
          }
          cacheLayeredImage(prompt, url);
          console.log("[summary-image] prefetch success", {
            promptPreview: prompt.slice(0, 120),
            urlPreview: url.slice(0, 80),
          });
          setSummaryImageUrl(url);
          setSummaryImageReady(true);
          if (sessionId) {
            fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/intervention-card`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image_url: url, image_prompt: prompt }),
            }).catch(() => {});
          }
          return url;
        })
        .catch((err) => {
          console.warn("[summary-image] prefetch failed", err);
          setSummaryImageReady(false);
          return null;
        })
        .finally(() => {
          summaryImageRequestsRef.current.delete(prompt);
        });
      summaryImageRequestsRef.current.set(prompt, promise);
      return promise;
    },
    [logIntervention, sessionId]
  );

  const formatScore = useCallback((value?: number) => {
    if (typeof value === "number" && !Number.isNaN(value)) {
      return `${value}/5`;
    }
    return "—";
  }, []);

  const renderRubricScores = useCallback(
    (
      rubric: RubricDimension[] | undefined,
      scores?: Record<string, number>,
      notes?: Record<string, string>,
      variant: "primary" | "compact" = "primary"
    ) => {
      if (!rubric || rubric.length === 0) return null;
      const hasDetail = rubric.some(
        (dim) => typeof scores?.[dim.key] === "number" || !!notes?.[dim.key]
      );
      if (!hasDetail) return null;
      const groups: { name: string; items: RubricDimension[] }[] = [];
      rubric.forEach((dim) => {
        const name = dim.group || "Rubric";
        const existing = groups.find((entry) => entry.name === name);
        if (existing) {
          existing.items.push(dim);
        } else {
          groups.push({ name, items: [dim] });
        }
      });
      return (
        <View
          style={[
            styles.scoreBlock,
            variant === "compact" && styles.scoreBlockCompact,
          ]}
        >
          {groups.map((group) => (
            <View key={group.name} style={styles.scoreGroup}>
              <Text style={styles.scoreGroupTitle}>{group.name}</Text>
              {group.items.map((dim) => (
                <View key={dim.key} style={styles.scoreRow}>
                  <View style={styles.scoreLabelColumn}>
                    <Text style={styles.scoreDimTitle}>{dim.title}</Text>
                    <Text style={styles.scoreDimDescription}>{dim.description}</Text>
                    <Text style={styles.scoreDimAnchors}>{dim.anchors}</Text>
                  </View>
                  <View style={styles.scoreValueColumn}>
                    <Text style={styles.scoreValue}>{formatScore(scores?.[dim.key])}</Text>
                    {!!notes?.[dim.key] && (
                      <Text style={styles.scoreNote}>{notes?.[dim.key]}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    },
    [formatScore]
  );

  const clearAutoRetry = useCallback(() => {
    if (autoRetryTimeoutRef.current) {
      clearTimeout(autoRetryTimeoutRef.current);
      autoRetryTimeoutRef.current = null;
    }
  }, []);

  const setAwaitingResponse = useCallback(
    (trigger: AutoTrigger | null) => {
      awaitingResponseRef.current = trigger;

      if (!trigger) {
        autoQueueRef.current = null;
        clearAutoRetry();
        return;
      }

      autoQueueRef.current = trigger;
      if (autoModeRef.current === "auto") {
        clearAutoRetry();
        requestAnimationFrame(() => {
          processAutoQueueRef.current?.();
        });
      }
    },
    [clearAutoRetry]
  );

  const requestAutoAnswer = useCallback(
    async (trigger: AutoTrigger): Promise<string | null> => {
      const prompt = trigger.prompt.trim();
      if (!prompt) return null;

      const introSnapshot = {
        ...serializeStepRecord(introRecordRef.current),
        followUps: introRecordRef.current.followUps,
      };
      const stepSnapshots = stepRecordsRef.current.map((record) => ({
        ...serializeStepRecord(record),
        followUps: record.followUps,
      }));

      try {
        const resp = await fetch(`${API_BASE}/auto-answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            mode: trigger.mode,
            step: trigger.step,
            intro: introSnapshot,
            steps: stepSnapshots,
          }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();
        const answer = (data?.answer || "").trim();
        if (!answer) {
          throw new Error("Auto answer empty");
        }
        return answer;
      } catch (err) {
        console.warn("Auto answer failed:", err);
        return null;
      }
    },
    []
  );

  const appendMessage = useCallback((incoming: Partial<IMessage>, forceScroll = false) => {
    const normalizedText =
      typeof incoming.text === "string" ? incoming.text.replace(/^\s+/, "") : incoming.text;
    setMessages((prev) =>
      GiftedChat.append(
        prev,
        [{ ...incoming, text: normalizedText, createdAt: new Date() } as IMessage],
        false
      )
    );
    if (forceScroll || isAtBottomRef.current) {
      requestAnimationFrame(() => {
        listViewRef.current?.scrollToEnd?.({ animated: true });
      });
    }
  }, []);

  const stopVoiceReplyPlayback = useCallback(() => {
    if (voiceReplyAudioRef.current) {
      voiceReplyAudioRef.current.pause();
      voiceReplyAudioRef.current.currentTime = 0;
    }
    setVoiceReplyStatus("idle");
  }, []);

  const stopAllAudioPlayback = useCallback(() => {
    if (summaryTtsAudioRef.current) {
      summaryTtsAudioRef.current.pause();
      summaryTtsAudioRef.current.currentTime = 0;
    }
    if (summaryMusicAudioRef.current) {
      summaryMusicAudioRef.current.pause();
      summaryMusicAudioRef.current.currentTime = 0;
    }
    setSummaryTtsPlaying(false);
    setSummaryTtsSentenceIdx(-1);
    stopVoiceReplyPlayback();
  }, [stopVoiceReplyPlayback]);

  const playVoiceReplyUrl = useCallback(
    async (url: string) => {
      if (!canUseVoicePlayback) {
        setVoiceReplyError("Voice playback is only available on web right now.");
        return;
      }
      stopVoiceReplyPlayback();
      const audioCtor = (typeof window !== "undefined" && (window as any).Audio) || null;
      if (!audioCtor) return;
      const audio = new audioCtor(url);
      voiceReplyAudioRef.current = audio;
      setVoiceReplyStatus("pending");
      try {
        await audio.play();
        setVoiceReplyStatus("idle");
      } catch (err) {
        console.warn("[voice-reply] autoplay blocked", err);
        setVoiceReplyStatus("error");
        setVoiceReplyError("Autoplay blocked — tap “Play last voice reply”.");
      }
    },
    [canUseVoicePlayback, stopVoiceReplyPlayback]
  );

  const requestVoiceReply = useCallback(
    async (text: string, messageId: string) => {
      if (autoModeRef.current === "auto") return;
      if (!voiceRepliesEnabled || !canUseVoicePlayback) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      if (lastSpokenMessageRef.current === messageId) return;
      lastSpokenMessageRef.current = messageId;

      setVoiceReplyError(null);
      setVoiceReplyStatus("pending");
      try {
        const resp = await fetch(`${API_BASE}/dev/media/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: trimmed.slice(0, 1600),
            use_gpt_voice: true,
          }),
        });
        const data = await resp.json();
        if (!resp.ok || !data?.audio_url) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const url = String(data.audio_url);
        setLastVoiceReplyUrl(url);
        await playVoiceReplyUrl(url);
      } catch (err) {
        console.warn("[voice-reply] tts failed", err);
        setVoiceReplyStatus("error");
        setVoiceReplyError("Couldn’t generate a voice reply.");
      }
    },
    [canUseVoicePlayback, playVoiceReplyUrl, voiceRepliesEnabled]
  );

  const sendBotMessage = useCallback(
    (text: string) => {
      const messageId = `bot-${Date.now()}-${Math.random()}`;
      requestAnimationFrame(() => {
        appendMessage(
          {
            _id: messageId,
            text,
            user: BOT,
          },
          true
        );
      });
      if (voiceRepliesEnabled && autoModeRef.current !== "auto") {
        void requestVoiceReply(text, messageId);
      }
    },
    [appendMessage, requestVoiceReply, voiceRepliesEnabled]
  );

  const sendSystemMessage = useCallback(
    (text: string, payload?: Record<string, unknown>) => {
      if (payload) {
        console.log(`[chat-log] ${text}`, payload);
      } else {
        console.log(`[chat-log] ${text}`);
      }

      // Commented out to keep logs out of the chat transcript while retaining console output.
      // appendMessage({
      //   _id: `log-${Date.now()}-${Math.random()}`,
      //   text,
      //   system: true,
      // }, true);
    },
    [appendMessage]
  );

  const persistSessionMessage = useCallback(
    async (role: "assistant" | "user" | "system", text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        const resp = await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, content: trimmed }),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (typeof data?.sessionId === "string" && data.sessionId !== sessionId) {
          setSessionId(data.sessionId);
        }
      } catch (err) {
        console.warn("Session message persist failed:", err);
      }
    },
    [sessionId, setSessionId]
  );

  const persistAssistantMessage = useCallback(
    async (text: string) => {
      await persistSessionMessage("assistant", text);
    },
    [persistSessionMessage]
  );

  const persistSummaryText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        const resp = await fetch(`${API_BASE}/sessions/${sessionId}/summary-text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (typeof data?.sessionId === "string" && data.sessionId !== sessionId) {
          setSessionId(data.sessionId);
        }
      } catch (err) {
        console.warn("Summary persist failed:", err);
      }
    },
    [sessionId, setSessionId]
  );

  const persistVoiceFlags = useCallback(
    async (flags: { voice_input_used?: boolean; ai_voice_enabled?: boolean }) => {
      try {
        await fetch(`${API_BASE}/sessions/${sessionId}/voice-flags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(flags),
        });
      } catch (err) {
        console.warn("Voice flags persist failed:", err);
      }
    },
    [sessionId]
  );

  const persistSessionTiming = useCallback(
    async (payload: { completed?: boolean; total_time_spent_ms?: number } = {}) => {
      try {
        await fetch(`${API_BASE}/sessions/${sessionId}/timing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            condition: conditionCode,
            ...(payload.completed ? { completed: true } : {}),
            ...(Number.isFinite(payload.total_time_spent_ms)
              ? { total_time_spent_ms: Math.trunc(payload.total_time_spent_ms ?? 0) }
              : {}),
          }),
        });
      } catch (err) {
        console.warn("Session timing persist failed:", err);
      }
    },
    [conditionCode, sessionId]
  );

  useEffect(() => {
    sessionTimingSubmittedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !isSessionComplete || sessionTimingSubmittedRef.current) return;
    sessionTimingSubmittedRef.current = true;
    void persistSessionTiming({ completed: true });
  }, [isSessionComplete, persistSessionTiming, sessionId]);

  const buildSafetyHistory = useCallback(() => {
    const history: string[] = [];
    introRecordRef.current.answers.forEach((entry) => {
      const snippet = entry?.text?.trim();
      if (snippet) {
        history.push(snippet);
      }
    });
    stepRecordsRef.current.forEach((record) => {
      record.answers.forEach((entry) => {
        const snippet = entry?.text?.trim();
        if (snippet) {
          history.push(snippet);
        }
      });
    });
    return history.slice(-5);
  }, []);

  const checkSafetyRisk = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return { risk: false, reason: "" };
      }
      const history = buildSafetyHistory();
      try {
        const resp = await fetch(`${API_BASE}/safety-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            text: trimmed,
            history,
          }),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (typeof data?.sessionId === "string" && data.sessionId !== sessionId) {
          setSessionId(data.sessionId);
        }
        return {
          risk: Boolean(data?.risk),
          reason: typeof data?.reason === "string" ? data.reason : "",
        };
      } catch (err) {
        console.warn("Safety check failed:", err);
        return { risk: false, reason: "" };
      }
    },
    [buildSafetyHistory, sessionId, setSessionId]
  );

  const setChatMode = useCallback(
    (mode: AutoChatMode) => {
      setAutoChatMode((prev) => {
        if (prev === mode) {
          return prev;
        }
        autoModeRef.current = mode;
        sendSystemMessage(
          `Log • Chat mode changed to ${mode === "auto" ? "Auto" : "Manual"}.`
        );
        return mode;
      });
      if (mode === "auto" && awaitingResponseRef.current) {
        autoQueueRef.current = awaitingResponseRef.current;
        clearAutoRetry();
        requestAnimationFrame(() => {
          processAutoQueueRef.current?.();
        });
      }
    },
    [clearAutoRetry, sendSystemMessage]
  );

  const engageSafetyLock = useCallback(
    (reason?: string) => {
      setSafetyLock(true);
      setSafetyDetails("");
      setAwaitingResponse(null);
      setInterventionsVisible(false);
      setInterfaceGenerationDurationMs(null);
      interfaceGenerationStartedAtRef.current = null;
      setIntervention(null);
      setInterventionDurationMs(null);
      setLayeredSupport(null);
      setLayeredStatus("idle");
      setLayeredError(null);
      setShowDecisionDetails(false);
      setSummaryShown(false);
      setSummaryLoading(false);
      setIsSessionComplete(true);
      setDecisionLoading(false);
      setSessionSummary("");
      setSummaryOriginal("");
      setInputValue("");
      inputValueRef.current = "";
      clearAutoRetry();
      setChatMode("manual");
      sendSystemMessage("Log • Safety lock engaged; session closed.", reason ? { reason } : undefined);
      void persistAssistantMessage(SAFETY_PLACEHOLDER_TEXT);
    },
    [
      clearAutoRetry,
      persistAssistantMessage,
      sendSystemMessage,
      setChatMode,
      setIntervention,
      setInterventionDurationMs,
      setInterventionsVisible,
      setLayeredError,
      setLayeredStatus,
      setLayeredSupport,
      setSummaryShown,
      setShowDecisionDetails,
    ]
  );

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const threshold = 40;
    const distanceFromBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    isAtBottomRef.current = distanceFromBottom <= threshold;
  }, []);


  const presentIntro = useCallback(() => {
    sendSystemMessage("Log • Intro: Starting point");
    const introMessage =
      "I would like to understand the stress you have been experiencing. Could you share a situation, pattern, or concern that has been causing stress for you now or in general?";
    sendBotMessage(introMessage);
    void persistAssistantMessage(introMessage);
    setAwaitingResponse({
      mode: "intro",
      prompt: INTRO_PROMPT.prompt,
      step: INTRO_PROMPT,
    });
  }, [persistAssistantMessage, sendBotMessage, sendSystemMessage, setAwaitingResponse]);

  const presentStepIntro = useCallback(
    (index: number) => {
      const step = QUESTIONS[index];
      if (!step) return;
      sendSystemMessage(
        `Log • Step ${index + 1}/${QUESTIONS.length}: ${step.title}`
      );
    },
    [sendSystemMessage]
  );

  const startLayeredGeneration = useCallback(
    (
      summaryText: string,
      payload: ReturnType<typeof serializeStepRecord>[],
      options: { reset?: boolean } = {}
    ) => {
      if (!Array.isArray(payload) || payload.length === 0) {
        const error = new Error("No reflection data available for layered generation.");
        setLayeredStatus("error");
        setLayeredError("Add a little more detail to unlock personalized interventions.");
        logIntervention("generation aborted: empty payload");
        return Promise.reject(error);
      }

      if (options.reset) {
        setLayeredSupport(null);
        setPrimaryUxCacheKey("");
        setInterfaceGenerationDurationMs(null);
        interfaceGenerationStartedAtRef.current = null;
        uxPrefetchStartedRef.current = false;
        uxPrefetchingStepsRef.current.clear();
      }

      setOverlaySaplingLevel(0);
      setLayeredStatus("pending");
      setLayeredError(null);
      logIntervention("generation started", {
        reset: Boolean(options.reset),
        summaryLength: summaryText.trim().length,
      });

      const body = {
        intro: introRecordRef.current.answers[0]?.text || "",
        steps: payload,
        summary: summaryText || "",
        sessionId,
      };

      const promise = fetch(`${API_BASE}/layered-intervention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((resp) => {
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }
          return resp.json();
        })
        .then((data) => {
          const responseSessionId =
            typeof data?.sessionId === "string" ? data.sessionId : "";
          if (responseSessionId && responseSessionId !== sessionId) {
            setSessionId(responseSessionId);
          }
          setLayeredSupport(data);
          setLayeredStatus("ready");
          setOverlaySaplingLevel((prev) => Math.max(prev, 4));
          setLayeredError(null);
          logIntervention("generation success", {
            selectedIds: data?.selected_ids || null,
          });
          return data;
        })
        .catch((err) => {
          console.warn("Layered support generation failed:", err);
          setLayeredSupport(null);
          setLayeredStatus("error");
          setLayeredError(
            err?.message ? String(err.message) : "Unable to generate interventions right now."
          );
          logIntervention("generation failure", {
            message: err?.message || String(err),
          });
          throw err;
        })
        .finally(() => {
          if (interventionTimerRef.current != null) {
            const durationMs = Date.now() - interventionTimerRef.current;
            setInterventionDurationMs(durationMs);
            console.log("[chat] intervention generation total ms", durationMs);
          }
          interventionTimerRef.current = null;
          if (layeredGenerationRef.current === promise) {
            layeredGenerationRef.current = null;
          }
          logIntervention("generation settled");
        });

      layeredGenerationRef.current = promise;
      return promise;
    },
    [
      introRecordRef,
      sessionId,
      setInterventionDurationMs,
      setLayeredError,
      setLayeredStatus,
      setLayeredSupport,
      setSessionId,
      logIntervention,
    ]
  );

  const summarizeSession = useCallback(async () => {
    if (isSessionComplete) return;

    sendSystemMessage("Log • Preparing wrap-up");

    const introRecord =
      introRecordRef.current.answers.length > 0 ? introRecordRef.current : null;
    const completedSteps = stepRecordsRef.current.filter((step) => step.answers.length > 0);
    const payloadRecords = introRecord ? [introRecord, ...completedSteps] : completedSteps;
    const payload = payloadRecords.map(serializeStepRecord);
    summaryPayloadRef.current = payload;

    if (!payload.length) {
      setSummaryShown(true);
      setSummaryLoading(false);
      setSummaryOriginal("");
      setSessionSummary("");
      setInterventionsVisible(false);
      setInterfaceGenerationDurationMs(null);
      interfaceGenerationStartedAtRef.current = null;
      setLayeredSupport(null);
      setLayeredStatus("error");
      setLayeredError("Add a little more detail to unlock personalized interventions.");
      setInterventionDurationMs(null);
      setIntervention(null);
      setShowDecisionDetails(false);
      sendBotMessage(
        "Thanks for sharing. I couldn’t produce a detailed summary this time, but you can jot your own notes in the sidebar."
      );
      setIsSessionComplete(true);
      setAwaitingResponse(null);
      return;
    }

    setSummaryShown(true);
    setSummaryLoading(true);
    setSummaryOriginal("");
    setSessionSummary("");
    setInterventionsVisible(false);
    setInterfaceGenerationDurationMs(null);
    interfaceGenerationStartedAtRef.current = null;
    setLayeredSupport(null);
    setLayeredStatus("idle");
    setLayeredError(null);
    layeredGenerationRef.current = null;
    setIntervention(null);
    setShowDecisionDetails(false);
    setInterventionDurationMs(null);
    setDecisionLoading(false);

    let generatedSummary = "";
    try {
      const resp = await fetch(`${API_BASE}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          steps: payload,
        }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const responseSessionId = typeof data?.sessionId === "string" ? data.sessionId : "";
      if (responseSessionId && responseSessionId !== sessionId) {
        setSessionId(responseSessionId);
      }
      generatedSummary = (data?.text || "").trim();
    } catch (err) {
      console.warn("Summary failed:", err);
      generatedSummary = "";
    } finally {
      setSummaryLoading(false);
    }

    setSummaryOriginal(generatedSummary);
    setSessionSummary(generatedSummary);

    if (generatedSummary) {
      sendBotMessage(
        "I’ve drafted a summary and added it to the sidebar. Thanks for walking through this reflection."
      );
    } else {
      sendBotMessage(
        "I couldn’t produce a detailed summary this time, but you can jot your own notes in the sidebar. Thanks for walking through this reflection."
      );
    }

    void prefetchSummaryImage(generatedSummary);

    interventionTimerRef.current = Date.now();
    setInterventionDurationMs(null);
    const layeredPromise = startLayeredGeneration(generatedSummary, payload, { reset: true });
    layeredPromise.catch(() => {
      /* handled via layeredStatus state */
    });

    setIsSessionComplete(true);
    setAwaitingResponse(null);
  }, [
    isSessionComplete,
    sessionId,
    setSessionId,
    sendBotMessage,
    sendSystemMessage,
    setAwaitingResponse,
    setInterventionDurationMs,
    setLayeredError,
    setLayeredStatus,
    setLayeredSupport,
    startLayeredGeneration,
    prefetchSummaryImage,
  ]);

  const handleInterventionOpen = useCallback(async () => {
    const support = layeredSupportRef.current;
    if (!support) {
      setLayeredError("Activity is not ready yet. Please wait a moment.");
      return;
    }
    const { finalInstructionSteps, combinedDescription, summaryRecap } =
      deriveSelectedInterventionPlan(support, sessionSummary);
    const step = finalInstructionSteps[0];
    if (!step) {
      setLayeredError("The selected activity is incomplete. Please regenerate once.");
      return;
    }
    const minutes =
      typeof step.durationMinutes === "number" && !Number.isNaN(step.durationMinutes)
        ? String(step.durationMinutes)
        : undefined;
    const resolvedImageUrl =
      summaryImageUrl && summaryImageUrl.trim()
        ? summaryImageUrl.trim()
        : (() => {
            const prompt = buildSummaryImagePrompt(sessionSummary);
            return prompt ? getCachedLayeredImage(prompt) : "";
          })();
    const imagePrompt = buildSummaryImagePrompt(sessionSummary);
    const currentUxCacheKey = getUxPlanKeyForSessionStep(sessionId, 0) || primaryUxCacheKey || undefined;
    logIntervention("navigating to /step1", {
      summaryEdited,
      hasUxCacheKey: Boolean(currentUxCacheKey),
    });
    setInterventionsVisible(false);
    setInterventionReadySticky(true);
    setInterventionReadyDeferred(true);
    stopAllAudioPlayback();
    router.push({
      pathname: "/step1",
      params: {
        stepIndex: "0",
        minutes,
        title: step?.title || undefined,
        description: step?.description || undefined,
        combinedDescription: combinedDescription || undefined,
        conversation: summaryRecap || sessionSummary || undefined,
        imageUrl: resolvedImageUrl || undefined,
        imagePrompt: imagePrompt || undefined,
        sessionId: sessionId || undefined,
        participantId: participantId || undefined,
        condition: String(conditionCode),
        arm: conditionCode === 2 ? "cr" : "pi",
        uxCacheKey: currentUxCacheKey,
      },
    } as any);
  }, [
    logIntervention,
    participantId,
    primaryUxCacheKey,
    router,
    conditionCode,
    sessionId,
    sessionSummary,
    setLayeredError,
    stopAllAudioPlayback,
    summaryEdited,
    summaryImageUrl,
  ]);

  const handleInterventionReveal = useCallback(async () => {
    setInterventionRequested(true);
    setInterventionsVisible(true);
    setShowDecisionDetails(false);
    interfaceGenerationStartedAtRef.current = Date.now();
    setInterfaceGenerationDurationMs(null);

    if (!summaryPayloadRef.current.length) {
      setLayeredStatus("error");
      setLayeredError("Add a little more detail to unlock personalized interventions.");
      logIntervention("blocked: missing summary payload");
      return;
    }

    const waitForSupport = async () => {
      logIntervention("awaiting existing generation", {
        hasPendingPromise: Boolean(layeredGenerationRef.current),
      });
      if (!layeredGenerationRef.current) {
        return layeredSupportRef.current;
      }
      try {
        const data = await layeredGenerationRef.current;
        return data ?? layeredSupportRef.current;
      } catch {
        logIntervention("existing generation rejected");
        return null;
      }
    };

    setDecisionLoading(true);

    const previousSupport = layeredSupportRef.current;
    let support: any = previousSupport;
    let status = layeredStatusRef.current;

    logIntervention("button press", {
      initialStatus: status,
      hasSupport: Boolean(support),
      summaryEdited,
    });

    void prefetchSummaryImage(sessionSummary);

    if (!support || status === "pending") {
      support = await waitForSupport();
      status = support ? "ready" : layeredStatusRef.current;
      logIntervention("after awaiting existing", {
        status,
        hasSupport: Boolean(support),
      });
    }

    const needsRegeneration = status === "idle" || status === "error" || !support;

    if (needsRegeneration) {
      setInterventionDurationMs(null);
      interventionTimerRef.current = Date.now();
      logIntervention("regeneration required", {
        previousStatus: status,
        hadSupport: Boolean(support),
        summaryEdited,
      });
      try {
        const data = await startLayeredGeneration(sessionSummary, summaryPayloadRef.current, {
          reset: true,
        });
        support = data ?? layeredSupportRef.current;
        status = support ? "ready" : "error";
        if (status === "ready") {
          setSummaryOriginal(sessionSummary);
          if (previousSupport) {
            logIntervention("plan regenerated", {
              previousSelected: previousSupport?.selected_ids || null,
              newSelected: support?.selected_ids || null,
              summaryChanged: summaryEdited,
            });
          } else {
            logIntervention("plan generated (no previous plan)", {
              newSelected: support?.selected_ids || null,
            });
          }
        }
        logIntervention("regeneration complete", {
          status,
          hasSupport: Boolean(support),
        });
      } catch {
        support = null;
        status = "error";
        logIntervention("regeneration failed");
      }
    }

    if (status !== "ready" || !support) {
      setDecisionLoading(false);
      setInterventionsVisible(false);
      setLayeredStatus("error");
      setLayeredError("Something interrupted the plan generation. Please try again.");
      logIntervention("navigation aborted", {
        status,
        hasSupport: Boolean(support),
      });
      return;
    }

    const finalSummary = sessionSummary.trim();
    let prefetchedImageUrl: string | null = null;
    if (finalSummary) {
      try {
        prefetchedImageUrl = await prefetchSummaryImage(finalSummary);
      } catch {
        // best-effort; navigation continues even if prefetch fails
      }
    }

    setDecisionLoading(false);
    logIntervention("plan ready", {
      selectedIds: support?.selected_ids || null,
      summaryEdited,
      diffFromPrevious:
        previousSupport && support
          ? JSON.stringify(previousSupport?.selected_ids) !==
            JSON.stringify(support?.selected_ids)
          : Boolean(previousSupport) ? false : true,
    });
    setInterventionsVisible(true);
  }, [
    sessionSummary,
    setDecisionLoading,
    setInterventionDurationMs,
    setInterventionsVisible,
    setLayeredError,
    setLayeredStatus,
    setShowDecisionDetails,
    startLayeredGeneration,
    summaryEdited,
    logIntervention,
    prefetchSummaryImage,
  ]);


  const requestStepControl = useCallback(
    async ({
      step,
      answer,
      followUps,
      nextStep,
      isFollowUp,
      introSummary,
      stepSummaries,
    }: StepControlRequestArgs): Promise<StepControlResult> => {
      const payload = {
        sessionId,
        step,
        answer,
        followUpHistory: followUps,
        nextStep,
        isFollowUp,
        introSummary,
        stepSummaries: stepSummaries.map(serializeStepRecord),
        recent_messages: formatMessagesForContext(messagesRef.current),
      };

      try {
        const resp = await fetch(`${API_BASE}/step-control`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data = (await resp.json()) as StepControlResult;
        if (
          data?.sessionId &&
          data.sessionId !== sessionId &&
          typeof data.sessionId === "string"
        ) {
          setSessionId(data.sessionId);
        }
        return data;
      } catch (err) {
        console.warn("Step control failed, using fallback decision:", err);
        return {
          decision: "advance",
          follow_up_focus: "",
          rationale: (err as Error)?.message || "step-control fallback",
        };
      }
    },
    [sessionId, setSessionId]
  );

  const requestAcknowledgement = useCallback(
    async ({
      step,
      answer,
      decision,
      followUpFocus,
      nextStep,
      introSummary,
      previousSteps,
      stepNumber,
      totalSteps,
      isFollowUp,
    }: AcknowledgeRequestArgs): Promise<AcknowledgeResult> => {
      const payload = {
        sessionId,
        step,
        answer,
        decision,
        follow_up_focus: followUpFocus,
        next_step: nextStep,
        intro_summary: introSummary,
        previous_steps: previousSteps.map((record) => {
          const serialized = serializeStepRecord(record);
          const { followUps: _remove, ...rest } = serialized;
          return {
            ...rest,
            follow_ups: record.followUps,
          };
        }),
        step_number: stepNumber,
        total_steps: totalSteps,
        is_follow_up: isFollowUp,
        recent_messages: formatMessagesForContext(messagesRef.current),
      };

      try {
        const resp = await fetch(`${API_BASE}/acknowledge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data = (await resp.json()) as AcknowledgeResult;
        if (
          data?.sessionId &&
          data.sessionId !== sessionId &&
          typeof data.sessionId === "string"
        ) {
          setSessionId(data.sessionId);
        }
        const message = (data.message || "").trim();
        const followUpQuestion = (data.follow_up_question || "").trim();

        if (!message) {
          throw new Error("Acknowledgement message was empty");
        }

        return {
          message,
          follow_up_question: followUpQuestion,
        };
      } catch (err) {
        console.warn("Acknowledgement request failed, using fallback messaging:", err);
        const fallback = composeStepMessage({
          step,
          answer,
          decision,
          followUpFocus,
          introSnippet: extractSnippet(introSummary),
          nextStep,
          currentIndex: stepNumber - 1,
          totalSteps,
          isFollowUpResponse: isFollowUp,
        });

        return {
          message: fallback.message.trim(),
          follow_up_question: (fallback.followUpQuestion || "").trim(),
        };
      }
    },
    [sessionId, setSessionId]
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const source = new EventSource(LOG_STREAM_URL);
    source.onmessage = (event) => {
      if (!event?.data) return;
      try {
        const entry = JSON.parse(event.data);
        handleOverlayLogEvent(entry?.event);
        console.log("[server-log]", entry.event || "message", entry.data || {});
      } catch (err) {
        console.log("[server-log]", event.data);
      }
    };
    source.onerror = (err) => {
      console.warn("[server-log] stream error", err);
    };
    return () => {
      source.close();
    };
  }, [handleOverlayLogEvent]);

  useEffect(() => {
    if (!hydrationReady || hasStartedRef.current) return;
    console.log("[chat] intro:start");
    sendSystemMessage("Log • Session context ready");
    hasStartedRef.current = true;
    presentIntro();
  }, [hydrationReady, presentIntro, sendSystemMessage]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      requestAnimationFrame(() => {
        listViewRef.current?.scrollToEnd?.({ animated: true });
      });
    }
  }, [messages]);

  const getLastBotMessage = useCallback(() => {
    const list = messagesRef.current || [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const msg = list[i];
      if (msg?.user?._id === BOT._id && typeof msg.text === "string" && msg.text.trim()) {
        return msg;
      }
    }
    return null;
  }, []);

  useEffect(() => {
    const wasEnabled = voiceTogglePrevRef.current;
    voiceTogglePrevRef.current = voiceRepliesEnabled;
    if (!voiceRepliesEnabled || wasEnabled) return;
    if (isTyping) return;
    const lastBot = getLastBotMessage();
    if (!lastBot) return;
    lastSpokenMessageRef.current = null;
    void requestVoiceReply(lastBot.text || "", String(lastBot._id || "bot-last"));
  }, [getLastBotMessage, isTyping, requestVoiceReply, voiceRepliesEnabled]);

  const renderBubble = useCallback(
    (props: any) => (
      <Bubble
        {...props}
        wrapperStyle={{
          left: styles.botBubble,
          right: styles.userBubble,
        }}
        textStyle={{
          left: styles.botText,
          right: styles.userText,
        }}
        containerStyle={{
          right: styles.userBubbleContainer,
        }}
      />
    ),
    []
  );

  const renderAvatar = useCallback(
    (props: any) => {
      if (props.currentMessage?.user?._id === BOT._id) {
        return (
          <View style={styles.botAvatarContainer}>
            <View style={styles.botAvatarIcon}>
              <Text style={styles.botAvatarIconText}>🪢</Text>
            </View>
          </View>
        );
      }
      return <Avatar {...props} />;
    },
    []
  );

  const renderSystem = useCallback(
    (props: any) => (
      <SystemMessage
        {...props}
        containerStyle={styles.systemMessageContainer}
        textStyle={styles.systemMessageText}
      />
    ),
    []
  );

  const renderTime = useCallback(
    (props: any) => (
      <Time
        {...props}
        timeTextStyle={{
          left: styles.timeTextLeft,
          right: styles.timeTextRight,
        }}
      />
    ),
    []
  );


  const handleMessageFlow = useCallback(
    async (newMsgs: IMessage[] = []) => {
      if (!newMsgs.length) return;
      if (summaryShown) {
        setSummaryShown(false);
        setIntervention(null);
        setInterventionDurationMs(null);
        setLayeredSupport(null);
        setSessionSummary("");
        setSummaryOriginal("");
        setSummaryLoading(false);
        setInterventionsVisible(false);
        setInterfaceGenerationDurationMs(null);
        interfaceGenerationStartedAtRef.current = null;
        setLayeredStatus("idle");
        setLayeredError(null);
        layeredGenerationRef.current = null;
        summaryPayloadRef.current = [];
        setDecisionLoading(false);
      }
      isAtBottomRef.current = true;
      setMessages((prev) => GiftedChat.append(prev, newMsgs, false));
      requestAnimationFrame(() => {
        listViewRef.current?.scrollToEnd?.({ animated: true });
      });

      const userMsg = newMsgs[0];
      const userText = userMsg?.text?.trim() ?? "";
      if (!userText) return;

      setIsTyping(true);

      try {
      if (safetyLock) {
        sendSystemMessage("Log • Safety lock active; ignoring new input.");
        return;
      }

      setAwaitingResponse(null);

      const safetyResult = await checkSafetyRisk(userText);
      if (safetyResult.risk) {
        await persistSessionMessage("user", userText);
        engageSafetyLock(safetyResult.reason);
        return;
      }

      sendSystemMessage(
        `Log • Handling user input (introComplete=${introComplete ? "yes" : "no"}, step=${
          introComplete ? currentStepIndex + 1 : 0
        }/${QUESTIONS.length}, followUpPending=${outstandingFollowUpRef.current ? "yes" : "no"})`
      );

      const outstanding = outstandingFollowUpRef.current;
      let isFollowUpResponse = false;
      if (outstanding) {
        isFollowUpResponse = true;
        if (outstanding.stepIndex === -1) {
          const followUps = introRecordRef.current.followUps;
          for (let i = followUps.length - 1; i >= 0; i -= 1) {
            if (!followUps[i].answer) {
              followUps[i].answer = userText;
              break;
            }
          }
        } else {
          const followUps =
            stepRecordsRef.current[outstanding.stepIndex]?.followUps ?? [];
          for (let i = followUps.length - 1; i >= 0; i -= 1) {
            if (!followUps[i].answer) {
              followUps[i].answer = userText;
              break;
            }
          }
        }
        outstandingFollowUpRef.current = null;
        sendSystemMessage("Log • Follow-up answer recorded; updating step context.");
      }

      if (isSessionComplete) {
        sendSystemMessage("Log • Session already complete; acknowledging additional input.");
        sendBotMessage(
          "This reflection is complete. Feel free to restart the session to explore again."
        );
        return;
      }

      const introSummary = introRecordRef.current.answers[0]?.text || "";
      if (!introComplete) {
        if (!isFollowUpResponse) {
          introRecordRef.current.answers.push({
            text: userText,
            recordedAt: new Date().toISOString(),
          });
        }

        sendSystemMessage("Log • Intro response captured. Checking if we should stay on this step.");

        const nextStep = QUESTIONS[0] ?? null;
        const controlDecision = await requestStepControl({
          step: INTRO_PROMPT,
          answer: userText,
          followUps: introRecordRef.current.followUps,
          nextStep,
          isFollowUp: isFollowUpResponse,
          introSummary:
            introRecordRef.current.answers[0]?.text || userText,
          stepSummaries: [],
        });

        let normalizedDecision =
          controlDecision.decision === "follow_up" ? "follow_up" : "advance";
        if (normalizedDecision === "follow_up") {
          normalizedDecision = "advance";
        }

        sendSystemMessage("Log • Intro routing choice", {
          decision: normalizedDecision as "follow_up" | "advance",
          followUpFocus: controlDecision.follow_up_focus || null,
          rationale: controlDecision.rationale || null,
        });

        const acknowledgement = await requestAcknowledgement({
          step: INTRO_PROMPT,
          answer: userText,
          decision: normalizedDecision as "follow_up" | "advance",
          followUpFocus: controlDecision.follow_up_focus || "",
          nextStep,
          introSummary:
            introRecordRef.current.answers[0]?.text || userText,
          previousSteps: [],
          stepNumber: 0,
          totalSteps: QUESTIONS.length,
          isFollowUp: isFollowUpResponse,
        });

        sendBotMessage(acknowledgement.message);

        if (normalizedDecision === "follow_up") {
          const followUpQuestion =
            acknowledgement.follow_up_question?.trim() ||
            buildFollowUpQuestion(
              INTRO_PROMPT,
              controlDecision.follow_up_focus || ""
            );

          if (followUpQuestion) {
            introRecordRef.current.followUps.push({
              question: followUpQuestion,
              answer: null,
            });
            outstandingFollowUpRef.current = {
              stepIndex: -1,
              prompt: followUpQuestion,
            };
            sendSystemMessage("Log • Follow-up requested for intro.");
            setAwaitingResponse({
              mode: "follow_up",
              prompt: followUpQuestion,
              step: INTRO_PROMPT,
            });
            return;
          }
        }

        setIntroComplete(true);
        sendSystemMessage("Log • Intro satisfied; preparing the first step prompt.");
        if (nextStep) {
          presentStepIntro(0);
          setAwaitingResponse({
            mode: "step",
            prompt: nextStep.prompt,
            step: nextStep,
          });
        } else {
          sendSystemMessage("Log • No further steps defined; preparing summary.");
          setAwaitingResponse(null);
          await summarizeSession();
        }
        return;
      }

      const currentStep = QUESTIONS[currentStepIndex];
      if (!currentStep) {
        sendSystemMessage("Log • No further steps defined; preparing summary.");
        setAwaitingResponse(null);
        await summarizeSession();
        return;
      }

      const record = stepRecordsRef.current[currentStepIndex];
      if (!isFollowUpResponse) {
        record.answers.push({
          text: userText,
          recordedAt: new Date().toISOString(),
        });
      }

        sendSystemMessage(
          `Log • Step ${currentStepIndex + 1} response stored. Evaluating whether to stay on this prompt.`
        );

      const nextStep = QUESTIONS[currentStepIndex + 1] ?? null;
      const controlDecision = await requestStepControl({
        step: currentStep,
        answer: userText,
        followUps: record.followUps,
        nextStep,
        isFollowUp: isFollowUpResponse,
        introSummary,
        stepSummaries: stepRecordsRef.current.slice(0, currentStepIndex),
      });

      const normalizedDecision =
        controlDecision.decision === "follow_up" ? "follow_up" : "advance";

      sendSystemMessage(`Log • Step ${currentStepIndex + 1} routing choice`, {
        decision: normalizedDecision,
        followUpFocus: controlDecision.follow_up_focus || null,
        rationale: controlDecision.rationale || null,
      });

      const acknowledgement = await requestAcknowledgement({
        step: currentStep,
        answer: userText,
        decision: normalizedDecision,
        followUpFocus: controlDecision.follow_up_focus || "",
        nextStep,
        introSummary,
        previousSteps: stepRecordsRef.current.slice(0, currentStepIndex),
        stepNumber: currentStepIndex + 1,
        totalSteps: QUESTIONS.length,
        isFollowUp: isFollowUpResponse,
      });

      const isFinalStep = !nextStep;
      const acknowledgementMessage =
        isFinalStep && normalizedDecision === "advance"
          ? ""
          : acknowledgement.message;

      if (acknowledgementMessage) {
        sendBotMessage(acknowledgementMessage);
      }

      if (normalizedDecision === "follow_up") {
        const followUpQuestion =
          acknowledgement.follow_up_question?.trim() ||
          buildFollowUpQuestion(
            currentStep,
            controlDecision.follow_up_focus || ""
          );

        if (followUpQuestion) {
          record.followUps.push({
            question: followUpQuestion,
            answer: null,
          });
          outstandingFollowUpRef.current = {
            stepIndex: currentStepIndex,
            prompt: followUpQuestion,
          };

          sendSystemMessage(
            `Log • Follow-up requested for Step ${currentStepIndex + 1}.`
          );
          setAwaitingResponse({
            mode: "follow_up",
            prompt: followUpQuestion,
            step: currentStep,
          });
          return;
        }
      }

      const nextIndex = currentStepIndex + 1;
      if (nextIndex < QUESTIONS.length) {
        setCurrentStepIndex(nextIndex);
        sendSystemMessage(
          `Log • Advancing to Step ${nextIndex + 1}: ${QUESTIONS[nextIndex].title}`
        );
        presentStepIntro(nextIndex);
        setAwaitingResponse({
          mode: "step",
          prompt: QUESTIONS[nextIndex].prompt,
          step: QUESTIONS[nextIndex],
        });
      } else {
        sendSystemMessage("Log • Final step complete; preparing wrap-up.");
        sendBotMessage(
          "Thanks for everything you shared. I’ll pull together a summary for you now and pop it into the sidebar."
        );
        setAwaitingResponse(null);
        await summarizeSession();
      }
      } finally {
        setIsTyping(false);
      }
    },
    [
      currentStepIndex,
      engageSafetyLock,
      introComplete,
      isSessionComplete,
      persistSessionMessage,
      presentStepIntro,
      requestStepControl,
      requestAcknowledgement,
      safetyLock,
      checkSafetyRisk,
      sendBotMessage,
      sendSystemMessage,
      setAwaitingResponse,
      summarizeSession,
    ]
  );

  useEffect(() => {
    handleMessageFlowRef.current = handleMessageFlow;
    return () => {
      if (handleMessageFlowRef.current === handleMessageFlow) {
        handleMessageFlowRef.current = null;
      }
    };
  }, [handleMessageFlow]);

  useEffect(() => {
    layeredStatusRef.current = layeredStatus;
  }, [layeredStatus]);

  useEffect(() => {
    layeredSupportRef.current = layeredSupport;
  }, [layeredSupport]);

  useEffect(() => {
    if (!summaryEdited) return;
    const trimmed = sessionSummary.trim();
    if (!trimmed || lastLoggedSummaryRef.current === trimmed) return;
    logIntervention("summary edited", {
      previousSummary: summaryOriginal.trim(),
      updatedSummary: trimmed,
    });
    lastLoggedSummaryRef.current = trimmed;
  }, [summaryEdited, sessionSummary, summaryOriginal, logIntervention]);

  const processAutoQueue = useCallback(async () => {
    if (autoProcessingRef.current) return;
    if (autoModeRef.current !== "auto") return;
    if (safetyLock) return;

    const trigger = autoQueueRef.current;
    if (!trigger) return;

    const prompt = trigger.prompt.trim();
    if (!prompt) {
      autoQueueRef.current = null;
      return;
    }

    autoProcessingRef.current = true;
    autoQueueRef.current = null;
    clearAutoRetry();

    if (inputValueRef.current.trim()) {
      autoProcessingRef.current = false;
      autoQueueRef.current = trigger;
      autoRetryTimeoutRef.current = setTimeout(() => {
        if (autoModeRef.current === "auto") {
          processAutoQueueRef.current?.();
        }
      }, 1200);
      return;
    }

    sendSystemMessage("Log • Auto-chat requesting answer", {
      mode: trigger.mode,
      stepId: trigger.step?.id || null,
    });

    const answer = await requestAutoAnswer(trigger);

    autoProcessingRef.current = false;

    if (autoModeRef.current !== "auto") {
      return;
    }

    if (!answer) {
      sendSystemMessage("Log • Auto-chat unavailable; switching to manual.");
      setChatMode("manual");
      return;
    }

    if (inputValueRef.current.trim()) {
      return;
    }

    const flowHandler = handleMessageFlowRef.current;
    if (flowHandler) {
      isAtBottomRef.current = true;
      flowHandler([
        {
          _id: `auto-${Date.now()}`,
          text: answer,
          createdAt: new Date(),
          user: USER,
        },
      ]);
    }

    if (autoQueueRef.current && autoModeRef.current === "auto") {
      requestAnimationFrame(() => {
        processAutoQueueRef.current?.();
      });
    }
  }, [clearAutoRetry, requestAutoAnswer, safetyLock, sendSystemMessage, setChatMode]);

  useEffect(() => {
    processAutoQueueRef.current = () => {
      void processAutoQueue();
    };
    return () => {
      processAutoQueueRef.current = () => {};
    };
  }, [processAutoQueue]);

  useEffect(() => {
    autoModeRef.current = autoChatMode;
    if (autoChatMode === "manual") {
      clearAutoRetry();
      return;
    }
    if (awaitingResponseRef.current) {
      autoQueueRef.current = awaitingResponseRef.current;
      requestAnimationFrame(() => {
        processAutoQueueRef.current?.();
      });
    }
  }, [autoChatMode, clearAutoRetry]);

  useEffect(() => {
    if (!voiceRepliesEnabled) {
      stopVoiceReplyPlayback();
    }
  }, [stopVoiceReplyPlayback, voiceRepliesEnabled]);

  useEffect(
    () => () => {
      clearAutoRetry();
    },
    [clearAutoRetry]
  );

  const handleManualSend = useCallback(() => {
    if (safetyLock) return;
    const pending = inputValueRef.current.trim();
    if (!pending) return;

    isAtBottomRef.current = true;
    const outgoing: IMessage = {
      _id: `user-${Date.now()}`,
      text: pending,
      createdAt: new Date(),
      user: USER,
    };

    setInputValue("");
    inputValueRef.current = "";
    handleMessageFlow([outgoing]);
  }, [handleMessageFlow, safetyLock]);

  const transcribeAndSendVoice = useCallback(
    async (blob: Blob) => {
      if (safetyLock) return;
      setVoiceRecordError(null);
      setVoiceDraftPending(true);
      try {
        const resp = await fetch(TRANSCRIBE_URL, {
          method: "POST",
          headers: {
            "Content-Type": blob.type || "audio/webm",
          },
          body: blob,
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const transcript = typeof data?.text === "string" ? data.text.trim() : "";
        if (!transcript) {
          throw new Error("empty transcript");
        }
        setVoiceDraftText(transcript);
      } catch (err) {
        console.warn("[voice-input] transcription failed", err);
        setVoiceRecordError("Voice transcription failed. Please try again.");
      } finally {
        setVoiceDraftPending(false);
      }
    },
    [handleMessageFlow, safetyLock]
  );

  const confirmVoiceDraft = useCallback(() => {
    if (safetyLock) return;
    const transcript = voiceDraftText.trim();
    if (!transcript) return;
    void persistVoiceFlags({ voice_input_used: true });
    const outgoing: IMessage = {
      _id: `user-${Date.now()}`,
      text: transcript,
      createdAt: new Date(),
      user: USER,
    };
    setVoiceDraftText("");
    handleMessageFlow([outgoing]);
  }, [handleMessageFlow, persistVoiceFlags, safetyLock, voiceDraftText]);

  const renderInputToolbar = useCallback(
    (props: any) => (
      <View>
        <InputToolbar
          {...props}
          containerStyle={styles.inputToolbar}
          primaryStyle={{ alignItems: "center", flexDirection: "row", flex: 1 }}
        />
        {voiceDraftPending ? (
          <Text style={styles.voiceHintText}>Transcribing voice note…</Text>
        ) : null}
        {voiceDraftText ? (
          <View style={styles.voiceDraftCard}>
            <Text style={styles.voiceDraftTitle}>Voice message ready</Text>
            <Text style={styles.voiceDraftText}>{voiceDraftText}</Text>
            <View style={styles.voiceDraftActions}>
              <Pressable
                accessibilityRole="button"
                onPress={confirmVoiceDraft}
                style={({ pressed }) => [
                  styles.voiceDraftButton,
                  styles.voiceDraftButtonPrimary,
                  pressed && styles.voiceDraftButtonPressed,
                ]}
              >
                <Text style={styles.voiceDraftButtonLabelPrimary}>Send voice message</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setVoiceDraftText("")}
                style={({ pressed }) => [
                  styles.voiceDraftButton,
                  pressed && styles.voiceDraftButtonPressed,
                ]}
              >
                <Text style={styles.voiceDraftButtonLabel}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {voiceRecordError ? (
          <Text style={styles.voiceErrorText}>{voiceRecordError}</Text>
        ) : null}
      </View>
    ),
    [confirmVoiceDraft, voiceDraftPending, voiceDraftText, voiceRecordError]
  );

  const startVoiceRecording = useCallback(async () => {
    if (autoModeRef.current === "auto") {
      setVoiceRecordError("Voice recording is disabled in Auto mode.");
      return;
    }
    if (!canUseVoiceInput) {
      setVoiceRecordError("Voice input is only available on web right now.");
      return;
    }
    if (isRecordingVoice) return;
    setVoiceRecordError(null);
    try {
      const stream = await (navigator as any).mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const preferredType =
        (window as any).MediaRecorder?.isTypeSupported?.("audio/webm")
          ? "audio/webm"
          : undefined;
      const recorder = new (window as any).MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      mediaRecorderRef.current = recorder;
      recordChunksRef.current = [];

      recorder.ondataavailable = (event: any) => {
        if (event?.data?.size) {
          recordChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        const chunks = recordChunksRef.current;
        recordChunksRef.current = [];
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (recordingStreamRef.current) {
          recordingStreamRef.current.getTracks?.().forEach((track: any) => track.stop());
          recordingStreamRef.current = null;
        }
        if (blob.size) {
          await transcribeAndSendVoice(blob);
        }
      };

      recorder.start();
      setIsRecordingVoice(true);
    } catch (err) {
      console.warn("[voice-input] recording failed", err);
      setVoiceRecordError("Microphone access failed.");
      setIsRecordingVoice(false);
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks?.().forEach((track: any) => track.stop());
        recordingStreamRef.current = null;
      }
    }
  }, [canUseVoiceInput, isRecordingVoice, transcribeAndSendVoice]);

  const stopVoiceRecording = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    try {
      mediaRecorderRef.current.stop();
    } catch (err) {
      console.warn("[voice-input] stop failed", err);
    } finally {
      setIsRecordingVoice(false);
    }
  }, []);

  useEffect(() => {
    if (autoChatMode !== "auto") return;
    if (voiceRepliesEnabled) {
      setVoiceRepliesEnabled(false);
      stopVoiceReplyPlayback();
    }
    if (isRecordingVoice) {
      stopVoiceRecording();
    }
  }, [
    autoChatMode,
    isRecordingVoice,
    stopVoiceRecording,
    stopVoiceReplyPlayback,
    voiceRepliesEnabled,
  ]);

  const renderSend = useCallback(() => {
    const disabled = safetyLock || isSessionComplete || !inputValue.trim();
    const voiceDisabled =
      !canUseVoiceInput || safetyLock || isSessionComplete || autoChatMode === "auto";
    return (
      <View style={styles.sendRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (isRecordingVoice) {
              stopVoiceRecording();
            } else {
              startVoiceRecording();
            }
          }}
          disabled={voiceDisabled}
          style={({ pressed }) => [
            styles.voiceButton,
            (pressed || isRecordingVoice) && styles.voiceButtonPressed,
            voiceDisabled && styles.voiceButtonDisabled,
          ]}
        >
          <Text style={styles.voiceButtonLabel}>
            {isRecordingVoice ? "Stop recording" : "Start recording"}
          </Text>
        </Pressable>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.sendButton, disabled && styles.sendButtonDisabled]}
          onPress={handleManualSend}
          disabled={disabled}
        >
          <Text style={[styles.sendLabel, disabled && styles.sendLabelDisabled]}>Send</Text>
        </TouchableOpacity>
      </View>
    );
  }, [
    autoChatMode,
    canUseVoiceInput,
    handleManualSend,
    inputValue,
    isRecordingVoice,
    isSessionComplete,
    safetyLock,
    startVoiceRecording,
    stopVoiceRecording,
  ]);

  const totalStages = QUESTIONS.length + 1;
  const activeStep = introComplete ? QUESTIONS[currentStepIndex] : INTRO_PROMPT;
  const nextStep =
    introComplete && currentStepIndex + 1 < QUESTIONS.length
      ? QUESTIONS[currentStepIndex + 1]
      : !introComplete
      ? QUESTIONS[0]
      : null;
  const completedStages = isSessionComplete
    ? totalStages
    : introComplete
    ? currentStepIndex + 1
    : 0;
  const progressValue = Math.max(0, Math.min(1, completedStages / totalStages));
  const progressPercent = Math.round(progressValue * 100);

  const timeline = [
    { id: INTRO_PROMPT.id, title: INTRO_PROMPT.title },
    ...QUESTIONS.map((item) => ({ id: item.id, title: item.title })),
  ].map((entry, index) => {
    let state: "pending" | "active" | "done" = "pending";
    if (isSessionComplete || index < completedStages) {
      state = "done";
    } else if (
      (!introComplete && index === 0) ||
      (introComplete && index === currentStepIndex + 1)
    ) {
      state = "active";
    }
    return { ...entry, state };
  });
  const hasSidePanel = summaryShown || showDecisionDetails;
  const hasPrimaryUxPlan =
    Boolean(primaryUxCacheKey) || Boolean(sessionId && getUxPlanKeyForSessionStep(sessionId, 0));
  const isInterfacePreparing =
    interventionRequested &&
    (decisionLoading ||
      layeredStatus === "pending" ||
      (layeredStatus === "ready" && Boolean(layeredSupportRef.current) && !hasPrimaryUxPlan));
  const overlayCardOpacity = overlayPulseValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });
  useEffect(() => {
    if (!isInterfacePreparing) {
      setOverlaySaplingLevel(0);
    }
  }, [isInterfacePreparing]);
  const interventionOverlayContent = useMemo(() => {
    if (!isInterfacePreparing) return null;
    const footer =
      "Generating your interface may take 2-3 minutes. We may generate multimodal elements, which can add time. Meanwhile, you can do the optional activities.";
    const seconds = Math.max(0, Math.floor(interventionLoadingElapsedMs / 1000));
    if (seconds <= 15) {
      return {
        headline: "Gathering what you shared…",
        body: "",
        footer,
      };
    }
    if (seconds <= 45) {
      const variantIndex = Math.max(0, Math.floor((seconds - 16) / 10)) % THINKING_VARIATIONS.length;
      return {
        headline:
          "I’m thinking through your reflections — the situation, what happened, how it felt.",
        body: "",
        extra: THINKING_VARIATIONS[variantIndex],
        footer,
      };
    }
    if (seconds <= 90) {
      return {
        headline: "Still processing your responses carefully.",
        body: "",
        footer,
      };
    }
    return {
      headline: "Almost ready.",
      body: "",
      footer,
    };
  }, [interventionLoadingElapsedMs, isInterfacePreparing]);
  const showInterventionReady =
    interventionRequested &&
    !isInterfacePreparing &&
    layeredStatus === "ready" &&
    hasPrimaryUxPlan &&
    Boolean(layeredSupportRef.current);

  useEffect(() => {
    if (
      layeredStatus === "idle" ||
      layeredStatus === "error"
    ) {
      setInterventionReadySticky(false);
      setInterventionReadyDeferred(false);
    }
  }, [layeredStatus]);

  useEffect(() => {
    if (showInterventionReady) {
      setInterventionReadySticky(true);
    }
  }, [showInterventionReady]);

  useEffect(() => {
    if (!sessionId) return;
    const existingKey = getUxPlanKeyForSessionStep(sessionId, 0);
    if (existingKey) {
      setPrimaryUxCacheKey(existingKey);
    }
  }, [sessionId, layeredStatus]);

  useEffect(() => {
    if (layeredStatus !== "ready" || !interventionRequested) return;
    const support = layeredSupportRef.current;
    if (!support) return;
    if (sessionSummary.trim()) {
      void prefetchSummaryImage(sessionSummary.trim());
    }
    void prefetchUxPlansForSupport(support);
  }, [interventionRequested, layeredStatus, prefetchUxPlansForSupport, prefetchSummaryImage, sessionSummary]);

  useEffect(() => {
    if (!interfaceGenerationStartedAtRef.current) return;
    if (interfaceGenerationDurationMs != null) return;
    if (layeredStatus !== "ready" || !hasPrimaryUxPlan) return;
    const totalMs = Date.now() - interfaceGenerationStartedAtRef.current;
    setInterfaceGenerationDurationMs(totalMs);
    console.log("[ux-console] total interface generation ms", totalMs);
    sendSystemMessage(`Log • Interface generation completed in ${Math.max(1, Math.round(totalMs / 1000))}s`);
  }, [hasPrimaryUxPlan, interfaceGenerationDurationMs, layeredStatus, sendSystemMessage]);

  useEffect(() => {
    if (!isInterfacePreparing) {
      setInterventionLoadingElapsedMs(0);
      return;
    }
    const baseStart = interfaceGenerationStartedAtRef.current ?? Date.now();
    if (!interfaceGenerationStartedAtRef.current) {
      interfaceGenerationStartedAtRef.current = baseStart;
    }
    setInterventionLoadingElapsedMs(Date.now() - baseStart);
    const interval = setInterval(() => {
      const start = interfaceGenerationStartedAtRef.current ?? baseStart;
      setInterventionLoadingElapsedMs(Date.now() - start);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [isInterfacePreparing]);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isInterfacePreparing) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(overlayPulseValue, {
            toValue: 1,
            duration: 1600,
            useNativeDriver: canUseNativeDriver,
          }),
          Animated.timing(overlayPulseValue, {
            toValue: 0,
            duration: 1600,
            useNativeDriver: canUseNativeDriver,
          }),
        ])
      );
      animation.start();
    } else {
      overlayPulseValue.stopAnimation?.();
      overlayPulseValue.setValue(0);
    }
    return () => {
      animation?.stop();
    };
  }, [canUseNativeDriver, isInterfacePreparing, overlayPulseValue]);

  useEffect(() => {
    if (!messages.length || !isAtBottomRef.current) return;
    requestAnimationFrame(() => {
      listViewRef.current?.scrollToEnd?.({ animated: true });
    });
  }, [messages]);

  return (
    <SafeAreaView style={styles.safe}>
      <LinearGradient
        colors={["#e8f0ff", "#f6f9ff"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.backgroundGradient}
        pointerEvents="none"
      />
      {interventionOverlayContent ? (
        <View pointerEvents="box-none" style={styles.interventionOverlay}>
          <Animated.View
            pointerEvents="auto"
            style={[styles.interventionOverlayCard, { opacity: overlayCardOpacity }]}
          >
            <>
              <View style={styles.interventionHeaderRow}>
                <ActivityIndicator size="large" color="#93c5fd" style={styles.interventionSpinner} />
                <Text style={styles.interventionOverlayHeadline}>
                  {interventionOverlayContent.headline}
                </Text>
              </View>
              {interventionOverlayContent.body ? (
                <Text style={styles.interventionOverlayBody}>
                  {interventionOverlayContent.body}
                </Text>
              ) : null}
              {interventionOverlayContent.extra ? (
                <Text style={styles.interventionOverlayExtra}>
                  {interventionOverlayContent.extra}
                </Text>
              ) : null}
              {interventionOverlayContent.footer ? (
                <Text style={styles.interventionOverlayFooter}>
                  {interventionOverlayContent.footer}
                </Text>
              ) : null}
            </>
          </Animated.View>
        </View>
      ) : null}
      {interventionReadySticky && interventionReadyDeferred ? (
        <View pointerEvents="box-none" style={styles.interventionOverlay}>
          <View pointerEvents="auto" style={styles.interventionOverlayCard}>
            <Text style={styles.interventionOverlayLabel}>Your interface is ready</Text>
            <Text style={styles.interventionOverlayHeadline}>
              Your personalized interface is ready whenever you want to open it.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={handleInterventionOpen}
              style={({ pressed }) => [
                styles.interventionReadyButton,
                pressed && styles.interventionReadyButtonPressed,
              ]}
            >
              <Text style={styles.interventionReadyButtonText}>Open interface</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {interventionReadySticky && !interventionReadyDeferred ? (
        <View pointerEvents="box-none" style={styles.interventionReadyOverlay}>
          <View pointerEvents="auto" style={styles.interventionReadyCard}>
            <Text style={styles.interventionOverlayLabel}>Your interface is ready</Text>
            <Text style={styles.interventionOverlayHeadline}>
              Your personalized interface is ready whenever you want to open it.
            </Text>
            <View style={styles.interventionReadyActions}>
              <Pressable
                accessibilityRole="button"
                onPress={handleInterventionOpen}
                style={({ pressed }) => [
                  styles.interventionReadyButton,
                  styles.interventionReadyButtonInline,
                  pressed && styles.interventionReadyButtonPressed,
                ]}
              >
                <Text style={styles.interventionReadyButtonText}>Open interface</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setInterventionReadySticky(true);
                  setInterventionReadyDeferred(true);
                }}
                style={({ pressed }) => [
                  styles.interventionLaterButton,
                  pressed && styles.interventionReadyButtonPressed,
                ]}
              >
                <Text style={styles.interventionLaterButtonText}>Later</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      <View
        style={[styles.wrapper]}
      >
        {!isSessionComplete ? (
          <View style={styles.expectationBanner}>
            <Text style={styles.expectationBannerText}>
              We’ll ask a short set of questions to better understand your situation and stress context. Expect about 5-8 messages. You can respond by typing or using voice, and AI voice messages are available if you prefer.
            </Text>
          </View>
        ) : null}


        <View
          style={[
            styles.chatDecisionContainer,
            hasSidePanel && styles.chatDecisionSplit,
          ]}
        >
        {Platform.OS === "web" && !isSessionComplete ? (
          <View style={styles.chatLeftRail}>
            <View style={styles.modeToggleGroup}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setChatMode("manual")}
                style={({ pressed }) => [
                  styles.modeToggleOption,
                  autoChatMode === "manual" && styles.modeToggleOptionActive,
                  pressed && styles.modeToggleOptionPressed,
                ]}
              >
                <Text
                  style={[
                    styles.modeToggleLabel,
                    autoChatMode === "manual" && styles.modeToggleLabelActive,
                  ]}
                >
                  Manual
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setChatMode("auto")}
                style={({ pressed }) => [
                  styles.modeToggleOption,
                  autoChatMode === "auto" && styles.modeToggleOptionActive,
                  pressed && styles.modeToggleOptionPressed,
                ]}
              >
                <Text
                  style={[
                    styles.modeToggleLabel,
                    autoChatMode === "auto" && styles.modeToggleLabelActive,
                  ]}
                >
                  Auto
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <View
          style={[
            styles.chatColumn,
            hasSidePanel && styles.chatColumnSplit,
          ]}
        >
          <View style={styles.chatCard}>
            <View style={styles.chatCardProgress}>
              <View style={styles.segmentRow}>
                {timeline.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.segmentPill,
                      item.state === "done" && styles.segmentPillDone,
                      item.state === "active" && styles.segmentPillActive,
                    ]}
                  />
                ))}
              </View>
              <View style={styles.aiVoiceRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={autoChatMode === "auto"}
                  onPress={() => {
                    if (autoChatMode === "auto") {
                      setVoiceReplyError("AI voice is disabled in Auto mode.");
                      return;
                    }
                    if (!canUseVoicePlayback) {
                      setVoiceReplyError("Voice replies are only available on web right now.");
                      return;
                    }
                    setVoiceReplyError(null);
                    setVoiceRepliesEnabled((prev) => {
                      const next = !prev;
                      if (next) {
                        void persistVoiceFlags({ ai_voice_enabled: true });
                      }
                      return next;
                    });
                  }}
                  style={({ pressed }) => [
                    styles.aiVoiceToggle,
                    voiceRepliesEnabled && styles.aiVoiceToggleActive,
                    autoChatMode === "auto" && styles.aiVoiceToggleDisabled,
                    pressed && styles.aiVoiceTogglePressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.aiVoiceToggleLabel,
                      voiceRepliesEnabled && styles.aiVoiceToggleLabelActive,
                      autoChatMode === "auto" && styles.aiVoiceToggleLabelDisabled,
                    ]}
                  >
                    AI voice message: {voiceRepliesEnabled ? "On" : "Off"}
                  </Text>
                </Pressable>
              </View>
            </View>
            {voiceReplyError ? (
              <Text style={styles.voiceErrorText}>{voiceReplyError}</Text>
            ) : null}
            <View style={styles.chatContent}>
              <GiftedChat
                messages={messages}
                isTyping={isTyping}
                onSend={(msgs) => handleMessageFlow(msgs)}
                user={USER}
                renderUsernameOnMessage={false}
                placeholder="Share a few words..."
                alwaysShowSend
                keyboardShouldPersistTaps="handled"
                inverted={false}
                text={inputValue}
                onInputTextChanged={(text) => {
                  setInputValue(text);
                  inputValueRef.current = text;
                }}
                messagesContainerStyle={styles.messagesContainer}
                renderTime={renderTime}
                listViewProps={{
                  ref: (ref: FlatList<IMessage> | null) => {
                    listViewRef.current = ref;
                  },
                  style: styles.listView,
                  onScroll: handleScroll,
                  scrollEventThrottle: 16,
                  showsVerticalScrollIndicator: true,
                } as any}
                textInputProps={{
                  style: styles.composer,
                placeholderTextColor: "#64748b",
                multiline: true,
                blurOnSubmit: false,
                editable: !safetyLock,
                    onKeyPress: (event: any) => {
                      if (
                        Platform.OS === "web" &&
                        event.nativeEvent.key === "Enter" &&
                        !event.nativeEvent.shiftKey
                      ) {
                        event.preventDefault();
                        handleManualSend();
                      }
                    },
                    onSubmitEditing: () => {
                      if (Platform.OS !== "web") {
                        handleManualSend();
                      }
                    },
                  }}
                renderBubble={renderBubble}
                renderAvatar={renderAvatar}
                renderSystemMessage={renderSystem}
                renderInputToolbar={renderInputToolbar}
                renderSend={renderSend}
              />
              {safetyLock && (
                <View style={styles.safetyOverlay}>
                  <View style={styles.safetyCard}>
                    <View style={styles.safetyIconBubble}>
                      <Text style={styles.safetyIcon}>!</Text>
                    </View>
                    <Text style={styles.safetyHeading}>{SAFETY_HEADLINE}</Text>
                    <Text style={styles.safetyDescription}>{SAFETY_DESCRIPTION}</Text>
                    <View style={styles.safetyList}>
                      {SAFETY_RESOURCES.map((entry) => (
                        <View key={entry.label} style={styles.safetyListItem}>
                          <Text style={styles.safetyListLabel}>{entry.label}</Text>
                          <Text style={styles.safetyListValue}>{entry.value}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.safetyFooter}>{SAFETY_FOOTER}</Text>
                  </View>
                </View>
              )}
              </View>
            </View>
          </View>
          {hasSidePanel && (
            <View style={styles.sideColumn}>
              <ScrollView
                style={styles.sideScroll}
                contentContainerStyle={styles.sideScrollContent}
                showsVerticalScrollIndicator
              >
                {summaryShown && (
                  <View style={styles.summaryPanel}>
                    <View style={styles.summaryHeader}>
                      <View style={styles.summaryHeaderText}>
                        <Text style={styles.summaryTitle}>Summary</Text>
                        <Text style={styles.summarySubtitle}>
                          You can engage with an AI-written summary of your situation, then edit and refine it,
                          or listen to it out loud. After you engage with the summary, click the button below
                          to get a personalized activity for you.
                        </Text>
                        {summaryLoading ? (
                          <Text style={styles.summarySubtitle}>Drafting your summary…</Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.summaryEditor}>
                      <View style={styles.summaryHeaderRow}>
                        <Text style={styles.summaryLabel}></Text>
                        <View style={styles.summaryHeaderRight}>
                          <Text style={styles.summaryNote}>
                            Want to listen to your summary? Tap “Play narration.”
                          </Text>
                          {summaryTtsStatus === "pending" ? (
                            <Text style={styles.summaryNotePending}>
                              Creating narration now — this can take a few seconds.
                            </Text>
                          ) : null}
                          <View style={styles.summaryControlRow}>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                              const isPause = summaryTtsPlaying;
                              if (isPause && summaryTtsAudioRef.current) {
                                summaryTtsAudioRef.current.pause();
                                if (summaryMusicAudioRef.current) {
                                  summaryMusicAudioRef.current.pause();
                                }
                                setSummaryTtsPlaying(false);
                                return;
                              }
                              const currentSummaryKey = normalizeWhitespace(sessionSummary.trim()).toLowerCase();
                              const canReplayCurrent =
                                summaryTtsStatus === "ready" &&
                                summaryTtsUrl &&
                                summaryTtsAudioRef.current &&
                                summaryTtsSourceKey === currentSummaryKey;
                              if (canReplayCurrent) {
                                const summaryAudio = summaryTtsAudioRef.current;
                                if (!summaryAudio) return;
                                summaryAudio
                                  .play()
                                  .then(() => {
                                    setSummaryTtsPlaying(true);
                                    if (summaryMusicAudioRef.current) {
                                      summaryMusicAudioRef.current.play().catch(() => {});
                                    }
                                  })
                                  .catch((err) => {
                                    console.warn("[summary] replay failed", err);
                                  });
                              } else {
                                requestSummaryTts();
                              }
                            }}
                            disabled={summaryLoading || summaryTtsStatus === "pending"}
                            style={({ pressed }) => [
                              styles.summaryTextButton,
                              pressed && summaryTtsStatus !== "pending" && styles.summaryTextButtonPressed,
                              (summaryLoading || summaryTtsStatus === "pending") && styles.summaryButtonDisabled,
                            ]}
                          >
                            <Text style={styles.summaryTextButtonLabel}>
                              {summaryTtsPlaying ? "Pause narration" : "Play narration"}
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                              if (summaryTtsAudioRef.current) {
                                summaryTtsAudioRef.current.pause();
                                summaryTtsAudioRef.current.currentTime = 0;
                              }
                              if (summaryMusicAudioRef.current) {
                                summaryMusicAudioRef.current.pause();
                                summaryMusicAudioRef.current.currentTime = 0;
                              }
                              setSummaryTtsPlaying(false);
                              setSummaryTtsSentenceIdx(-1);
                            }}
                            disabled={summaryLoading || summaryTtsStatus === "pending" || !summaryTtsUrl}
                            style={({ pressed }) => [
                              styles.summaryTextButton,
                              pressed && summaryTtsStatus !== "pending" && styles.summaryTextButtonPressed,
                              (summaryLoading || summaryTtsStatus === "pending" || !summaryTtsUrl) &&
                                styles.summaryButtonDisabled,
                            ]}
                          >
                            <Text style={styles.summaryTextButtonLabel}>Restart narration</Text>
                          </Pressable>
                          </View>
                        </View>
                      </View>

                      <View style={styles.summaryInputWrapper}>
                        <TextInput
                          style={[
                            styles.summaryInput,
                            isVoiceoverActive && styles.summaryInputHiddenText,
                          ]}
                          multiline
                          placeholder={
                            summaryLoading
                              ? "Drafting your summary…"
                              : "Edit your summary here."
                          }
                          value={sessionSummary}
                          onChangeText={(text) => setSessionSummary(text)}
                          editable={!summaryLoading && !summaryTtsPlaying}
                          placeholderTextColor="#94a3b8"
                          textAlignVertical="top"
                        />
                        {isVoiceoverActive && (
                          <View pointerEvents="none" style={styles.summaryOverlay}>
                            <ScrollView
                              ref={summaryOverlayScrollRef}
                              style={styles.summaryOverlayScroll}
                              contentContainerStyle={styles.summaryOverlayScrollContent}
                              onLayout={(event) =>
                                setSummaryOverlayViewportHeight(event.nativeEvent.layout.height)
                              }
                              onContentSizeChange={(_, height) => setSummaryOverlayContentHeight(height)}
                              showsVerticalScrollIndicator={false}
                            >
                              <Text style={styles.summaryOverlayText}>
                                {summaryParts.map((part, idx) =>
                                  part.isSentence ? (
                                    <Text
                                      key={`summary-part-${idx}`}
                                      style={
                                        part.index === summaryTtsSentenceIdx
                                          ? styles.summaryOverlayHighlight
                                          : styles.summaryOverlayText
                                      }
                                    >
                                      {part.text}
                                    </Text>
                                  ) : (
                                    <Text key={`summary-part-${idx}`} style={styles.summaryOverlayText}>
                                      {part.text}
                                    </Text>
                                  )
                                )}
                              </Text>
                            </ScrollView>
                          </View>
                        )}
                      </View>
                      <Text style={styles.summaryHint}>
                        Edit anything you’d like before we craft a personalized activity.
                      </Text>

                      <Pressable
                        accessibilityRole="button"
                        onPress={handleInterventionReveal}
                        disabled={summaryLoading || decisionLoading || interventionRequested}
                        style={({ pressed }) => [
                          styles.summaryPrimaryButton,
                          pressed &&
                            !summaryLoading &&
                            !decisionLoading &&
                            !interventionRequested &&
                            styles.summaryButtonPressed,
                          (summaryLoading || decisionLoading || interventionRequested) &&
                            styles.summaryButtonDisabled,
                        ]}
                      >
                        <Text style={styles.summaryPrimaryButtonText}>
                          Create a personalized activity for me
                        </Text>
                      </Pressable>
                      <View style={styles.summaryOptional}>
                        <Text style={styles.summaryOptionalTitle}>Optional activities</Text>
                        <Text style={styles.summaryOptionalSubtitle}>
                          Try a different way of telling your summary while you wait.
                        </Text>
                        <View style={styles.summaryVariantRow}>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setSummaryVariantMode("third_person")}
                            style={[
                              styles.summaryVariantChip,
                              summaryVariantMode === "third_person" && styles.summaryVariantChipActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.summaryVariantChipText,
                                summaryVariantMode === "third_person" && styles.summaryVariantChipTextActive,
                              ]}
                            >
                              From a third-person perspective
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setSummaryVariantMode("movie")}
                            style={[
                              styles.summaryVariantChip,
                              summaryVariantMode === "movie" && styles.summaryVariantChipActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.summaryVariantChipText,
                                summaryVariantMode === "movie" && styles.summaryVariantChipTextActive,
                              ]}
                            >
                              Like a movie scene
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setSummaryVariantMode("character")}
                            style={[
                              styles.summaryVariantChip,
                              summaryVariantMode === "character" && styles.summaryVariantChipActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.summaryVariantChipText,
                                summaryVariantMode === "character" && styles.summaryVariantChipTextActive,
                              ]}
                            >
                              Like a short story
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setSummaryVariantMode("custom")}
                            style={[
                              styles.summaryVariantChip,
                              summaryVariantMode === "custom" && styles.summaryVariantChipActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.summaryVariantChipText,
                                summaryVariantMode === "custom" && styles.summaryVariantChipTextActive,
                              ]}
                            >
                              Custom style
                            </Text>
                          </Pressable>
                        </View>
                        {summaryVariantMode === "custom" ? (
                          <TextInput
                            value={summaryVariantCustom}
                            onChangeText={setSummaryVariantCustom}
                            placeholder="Describe the style you want (e.g., concise and objective)"
                            placeholderTextColor="#94a3b8"
                            style={styles.summaryVariantInput}
                          />
                        ) : null}
                        <View style={styles.summaryVariantActions}>
                          <Pressable
                            accessibilityRole="button"
                            onPress={requestSummaryVariant}
                            disabled={summaryVariantLoading || summaryLoading}
                            style={({ pressed }) => [
                              styles.summaryVariantButton,
                              pressed &&
                                !summaryVariantLoading &&
                                !summaryLoading &&
                                styles.summaryVariantButtonPressed,
                              (summaryVariantLoading || summaryLoading) && styles.summaryButtonDisabled,
                            ]}
                          >
                            <Text style={styles.summaryVariantButtonText}>
                              {summaryVariantLoading ? "Generating…" : "Generate this version"}
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                              if (summaryOriginal.trim()) {
                                setSessionSummary(summaryOriginal);
                              }
                            }}
                            disabled={summaryLoading || !summaryOriginal.trim()}
                            style={({ pressed }) => [
                              styles.summaryGhostButton,
                              pressed && !summaryLoading && styles.summaryGhostButtonPressed,
                              (summaryLoading || !summaryOriginal.trim()) && styles.summaryButtonDisabled,
                            ]}
                          >
                            <Text style={styles.summaryGhostButtonText}>Back to original summary</Text>
                          </Pressable>
                        </View>
                        {summaryVariantError ? (
                          <Text style={styles.summaryStatusError}>{summaryVariantError}</Text>
                        ) : null}
                      </View>
                    </View>

                    {summaryTtsStatus === "error" && summaryTtsError ? (
                      <Text style={styles.summaryStatusError}>{summaryTtsError}</Text>
                    ) : null}

                    {interventionsVisible && layeredStatus === "error" ? (
                      <Text style={styles.summaryStatusError}>
                        {layeredError || "Unable to generate interventions. Try again in a moment."}
                      </Text>
                    ) : null}
                  </View>
                )}
                {showDecisionDetails && !!intervention?.candidates?.length && (
                <View
                  style={[
                    styles.decisionPanel,
                    styles.decisionPanelActive,
                  ]}
                >
                  <ScrollView
                    style={styles.decisionScrollView}
                    contentContainerStyle={styles.decisionScroll}
                  >
                    <View style={styles.decisionHeader}>
                      <Text style={styles.decisionTitle}>How this plan was chosen</Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setShowDecisionDetails(false)}
                        style={({ pressed }) => [
                          styles.decisionCloseChip,
                          pressed && styles.decisionCloseChipPressed,
                        ]}
                      >
                        <Text style={styles.decisionCloseChipLabel}>Close</Text>
                      </Pressable>
                    </View>
                    {intervention?.selection_reasoning ? (
                      <Text style={styles.decisionParagraph}>{intervention.selection_reasoning}</Text>
                    ) : null}

                    {selectionRubric.length > 0
                      ? renderRubricScores(
                          selectionRubric,
                          finalScores,
                          finalScoreNotes,
                          "compact"
                        )
                      : null}

                    {!!intervention?.source_plan_ids?.length && (
                      <Text style={styles.decisionTagline}>
                        Final plan draws from: {intervention.source_plan_ids.join(", ")}
                      </Text>
                    )}

                    <Text style={styles.decisionSubtitle}>Candidate Plans Considered</Text>
                    {intervention?.candidates?.map((candidate, candidateIdx) => (
                      <View
                        key={candidate.plan_id || candidate.plan_title || `candidate-${candidateIdx}`}
                        style={styles.candidateCard}
                      >
                        <Text style={styles.candidateTitle}>
                          {candidate.plan_title || candidate.plan_id || "Candidate"}
                        </Text>
                        {candidate.summary ? (
                          <Text style={styles.candidateSummary}>{candidate.summary}</Text>
                        ) : null}
                        {candidate.rationale ? (
                          <Text style={styles.candidateRationale}>{candidate.rationale}</Text>
                        ) : null}
                        {candidateRubric.length > 0
                          ? renderRubricScores(
                              candidateRubric,
                              candidate.scores,
                              candidate.score_notes,
                              "compact"
                            )
                          : null}
                        {candidate.activities?.length ? (
                          <View style={styles.candidateActivities}>
                            {candidate.activities.map((activity, idx) => (
                              <View
                                key={`${candidate.plan_id || "candidate"}-activity-${idx}`}
                                style={styles.candidateActivityItem}
                              >
                                <Text style={styles.candidateActivityLabel}>{activity.label}</Text>
                                <Text style={styles.candidateActivityDescription}>
                                  {activity.description}
                                </Text>
                                {typeof activity.duration_minutes === "number" && (
                                  <Text style={styles.candidateActivityDuration}>
                                    {activity.duration_minutes} min
                                  </Text>
                                )}
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f1f5ff",
  },
  backgroundGradient: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
  },
  wrapper: {
    flex: 1,
    alignSelf: "stretch",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
  },
  wrapperWithOverlayOffset: {
    paddingTop: 148,
  },
  interventionOverlay: {
    position: "absolute",
    top: 12,
    left: 20,
    right: 20,
    zIndex: 30,
  },
  interventionOverlayCard: {
    borderRadius: 28,
    paddingVertical: 18,
    paddingHorizontal: 20,
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.45)",
    shadowColor: "#0f172a",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  interventionReadyOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 28,
    paddingHorizontal: 20,
  },
  interventionReadyCard: {
    width: "100%",
    maxWidth: 640,
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 20,
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.45)",
    shadowColor: "#0f172a",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  interventionReadyButton: {
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#2563eb",
    alignSelf: "flex-start",
  },
  interventionReadyButtonPressed: {
    opacity: 0.9,
  },
  interventionReadyButtonText: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
  },
  interventionReadyButtonInline: {
    marginTop: 0,
  },
  interventionReadyActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },
  interventionLaterButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(191, 219, 254, 0.8)",
    backgroundColor: "rgba(30, 41, 59, 0.7)",
    alignSelf: "flex-start",
  },
  interventionLaterButtonText: {
    color: "#dbeafe",
    fontSize: 14,
    fontWeight: "600",
  },
  interventionOverlayLabel: {
    fontSize: 12,
    color: "#93c5fd",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "700",
  },
  interventionOverlayHeadline: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f8fafc",
    lineHeight: 24,
  },
  interventionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  interventionOverlayBody: {
    marginTop: 6,
    fontSize: 15,
    color: "#e0f2fe",
    lineHeight: 21,
  },
  interventionOverlayExtra: {
    marginTop: 4,
    fontSize: 14,
    color: "#bfdbfe",
    fontStyle: "italic",
  },
  interventionOverlayFooter: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: "#dbeafe",
  },
  interventionSpinner: {
    alignSelf: "center",
  },
  interventionOverlayTimer: {
    position: "absolute",
    top: 18,
    right: 20,
    fontSize: 14,
    fontWeight: "600",
    color: "#e2e8f0",
  },
  overlaySapling: {
    marginTop: 10,
    marginBottom: 12,
    alignSelf: "stretch",
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    borderRadius: 14,
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 12,
    overflow: "hidden",
  },
  overlayStem: {
    position: "absolute",
    left: 24,
    top: 12,
    bottom: 10,
    width: 8,
    borderRadius: 6,
    backgroundColor: "rgba(148, 163, 184, 0.4)",
  },
  overlayStemFill: {
    position: "absolute",
    left: 25,
    bottom: 10,
    width: 6,
    borderRadius: 6,
    backgroundColor: "#60a5fa",
  },
  overlayNodeRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 34,
    paddingLeft: 12,
    paddingRight: 16,
    justifyContent: "center",
  },
  overlayNode: {
    width: 18,
    height: 18,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "rgba(15, 23, 42, 0.4)",
    backgroundColor: "rgba(148, 163, 184, 0.55)",
  },
  overlayNodeActive: {
    backgroundColor: "#38bdf8",
    borderColor: "#0ea5e9",
    ...Platform.select({
      web: {
        boxShadow: "0 0 0 8px rgba(56, 189, 248, 0.14)",
      },
      default: {
        shadowColor: "#38bdf8",
        shadowOpacity: 0.45,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      },
    }),
  },
  overlayLeaf: {
    position: "absolute",
    top: 8,
    width: 14,
    height: 8,
    borderRadius: 8,
    backgroundColor: "rgba(34, 197, 94, 0.82)",
  },
  overlayLeafLeft: {
    left: 56,
    transform: [{ rotate: "-16deg" }],
  },
  overlayLeafRight: {
    left: 74,
    transform: [{ rotate: "16deg" }],
  },
  overlayCanopy: {
    position: "absolute",
    left: 52,
    right: 40,
    top: 8,
    height: 32,
    borderRadius: 20,
    backgroundColor: "rgba(190, 242, 100, 0.08)",
    opacity: 0,
  },
  overlayCanopyVisible: {
    opacity: 1,
    backgroundColor: "rgba(74, 222, 128, 0.22)",
  },
  overlayRoots: {
    position: "absolute",
    left: 10,
    bottom: 4,
    width: 84,
    height: 6,
    borderRadius: 6,
    backgroundColor: "rgba(14, 165, 233, 0.26)",
  },
  sessionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sessionMeta: {
    flex: 1,
  },
  sessionControls: {
    alignItems: "center",
    flexShrink: 0,
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  sessionTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#132f74",
  },
  sessionSubtitle: {
    fontSize: 0,
  },
  expectationBadge: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(14, 165, 233, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(14, 165, 233, 0.35)",
  },
  expectationBanner: {
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "rgba(148, 163, 184, 0.12)",
  },
  expectationBannerText: {
    fontSize: 15,
    color: "#475569",
    fontWeight: "500",
    lineHeight: 26,
  },
  expectationSubtext: {
    fontSize: 12,
    color: "#1e3a8a",
    lineHeight: 17,
  },
  expectationText: {
    fontSize: 13,
    color: "#0c4a6e",
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  sessionPersona: {
    fontSize: 12,
    color: "#1d4ed8",
    marginTop: 4,
  },
  modeToggleGroup: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(30, 64, 175, 0.08)",
    borderRadius: 999,
    padding: 4,
  },
  modeToggleOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginHorizontal: 2,
  },
  modeToggleOptionActive: {
    backgroundColor: "#1d4ed8",
  },
  modeToggleOptionPressed: {
    opacity: 0.8,
  },
  modeToggleLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1e3a8a",
  },
  modeToggleLabelActive: {
    color: "#ffffff",
  },
  voiceToggleGroup: {
    marginTop: 10,
    gap: 8,
  },
  voiceToggleButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.35)",
  },
  voiceToggleButtonActive: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  voiceToggleButtonPressed: {
    opacity: 0.85,
  },
  voiceToggleLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1e3a8a",
  },
  voiceToggleLabelActive: {
    color: "#ffffff",
  },
  voiceHintText: {
    marginTop: 6,
    fontSize: 12,
    color: "#475569",
  },
  voiceErrorText: {
    marginTop: 6,
    fontSize: 12,
    color: "#b91c1c",
  },
  voiceDraftCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.2)",
  },
  voiceDraftTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1e3a8a",
    marginBottom: 6,
  },
  voiceDraftText: {
    fontSize: 13,
    color: "#0f172a",
    lineHeight: 18,
  },
  voiceDraftActions: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  voiceDraftButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(148, 163, 184, 0.2)",
  },
  voiceDraftButtonPrimary: {
    backgroundColor: "#2563eb",
  },
  voiceDraftButtonPressed: {
    opacity: 0.85,
  },
  voiceDraftButtonLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1e3a8a",
  },
  voiceDraftButtonLabelPrimary: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },
  progressBadge: {
    marginLeft: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "rgba(79, 70, 229, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.35)",
    alignItems: "center",
    minWidth: 84,
  },
  progressValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#312e81",
  },
  progressCaption: {
    fontSize: 11,
    color: "#475569",
    letterSpacing: 0.4,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: "rgba(99, 102, 241, 0.12)",
    marginBottom: 12,
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: "rgba(37, 99, 235, 0.7)",
  },
  segmentRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "space-between",
  },
  segmentPill: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(148, 163, 184, 0.35)",
  },
  segmentPillDone: {
    backgroundColor: "#3b82f6",
  },
  segmentPillActive: {
    backgroundColor: "#93c5fd",
  },
  aiVoiceRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  aiVoiceToggle: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(148, 163, 184, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.4)",
  },
  aiVoiceToggleActive: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  aiVoiceTogglePressed: {
    opacity: 0.85,
  },
  aiVoiceToggleDisabled: {
    opacity: 0.45,
  },
  aiVoiceToggleLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
  },
  aiVoiceToggleLabelActive: {
    color: "#ffffff",
  },
  aiVoiceToggleLabelDisabled: {
    color: "#64748b",
  },
  promptBanner: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.12)",
    marginBottom: 12,
    ...Platform.select({
      web: {
        boxShadow: "0px 16px 32px rgba(31, 41, 55, 0.08)",
      },
      default: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 12 },
        elevation: 6,
      },
    }),
  },
  promptBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
  },
  promptBadgeText: {
    fontSize: 12,
    color: "#1d4ed8",
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  promptTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1e293b",
    marginTop: 8,
  },
  promptCopy: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
    marginTop: 4,
  },
  nextHint: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 4,
  },
  timeline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    flex: 1,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    marginBottom: 12,
  },
  timelineItem: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "rgba(148, 163, 184, 0.15)",
    marginRight: 8,
    marginBottom: 8,
  },
  timelineItemActive: {
    backgroundColor: "rgba(59, 130, 246, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.45)",
  },
  timelineItemDone: {
    backgroundColor: "rgba(22, 163, 74, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(21, 128, 61, 0.35)",
  },
  timelineText: {
    fontSize: 12,
    color: "#475569",
  },
  timelineTextActive: {
    color: "#1d4ed8",
    fontWeight: "600",
  },
  timelineTextDone: {
    color: "#14532d",
    fontWeight: "600",
  },
  chatDecisionContainer: {
    width: "100%",
    flex: 1,
    flexDirection: "column",
    gap: 16,
    ...Platform.select({
      web: {
        flexDirection: "row",
        alignItems: "stretch",
        columnGap: 16,
      },
      default: {},
    }),
  },
  chatLeftRail: {
    gap: 12,
    alignItems: "flex-start",
    ...Platform.select({
      web: {
        width: 240,
        flexShrink: 0,
      },
      default: {},
    }),
  },
  chatDecisionSplit: {
    ...Platform.select({
      web: {
        flexDirection: "row",
        alignItems: "stretch",
        columnGap: 16,
      },
      default: {},
    }),
  },
  chatColumn: {
    flex: 1,
    minHeight: 0,
  },
  sideColumn: {
    minHeight: 0,
    flexShrink: 0,
    alignSelf: "stretch",
    ...Platform.select({
      web: {
        width: 840,
      },
      default: {
        width: "100%",
      },
    }),
  },
  sideScroll: {
    flex: 1,
  },
  sideScrollContent: {
    gap: 16,
    paddingBottom: 16,
    paddingTop: 80,
  },
  chatColumnSplit: {
    ...Platform.select({
      web: {
        minWidth: 0,
      },
      default: {},
    }),
  },
  chatCard: {
    flex: 1,
    width: "100%",
    maxWidth: 880,
    alignSelf: "center",
    marginTop: 4,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    ...Platform.select({
      web: {
        alignSelf: "flex-start",
        boxShadow: "0px 6px 12px rgba(15, 23, 42, 0.08)",
      },
      default: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 4,
      },
    }),
  },
  chatCardProgress: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(15, 23, 42, 0.06)",
    backgroundColor: "rgba(248, 250, 252, 0.9)",
    gap: 8,
  },
  chatCardHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    alignSelf: "stretch",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(15, 23, 42, 0.06)",
    backgroundColor: "rgba(248, 250, 252, 0.9)",
  },
  chatCardHeaderTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1e293b",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  chatCardToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(148, 163, 184, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    alignSelf: "flex-end",
  },
  chatCardToggleActive: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  chatCardTogglePressed: {
    opacity: 0.85,
  },
  chatCardToggleLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
  },
  chatCardToggleLabelActive: {
    color: "#ffffff",
  },
  chatContent: {
    flex: 1,
    position: "relative",
    pointerEvents: Platform.OS === "web" ? "auto" : "box-none",
  },
  safetyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(241, 245, 255, 0.92)",
    borderRadius: 24,
    padding: 20,
    alignItems: "stretch",
    justifyContent: "center",
    zIndex: 20,
  },
  safetyCard: {
    backgroundColor: "#fff",
    borderRadius: 28,
    padding: 28,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 18 },
    alignItems: "center",
  },
  safetyIconBubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(79, 70, 229, 0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  safetyIcon: {
    fontSize: 28,
    fontWeight: "700",
    color: "#4338ca",
  },
  safetyHeading: {
    fontSize: 22,
    lineHeight: 30,
    color: "#0f172a",
    fontWeight: "700",
    textAlign: "center",
  },
  safetyDescription: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 22,
    color: "#1e293b",
    textAlign: "center",
  },
  safetyList: {
    marginTop: 20,
    width: "100%",
    rowGap: 12,
  },
  safetyListItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(59, 130, 246, 0.08)",
  },
  safetyListLabel: {
    fontSize: 13,
    color: "#1d4ed8",
    fontWeight: "700",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  safetyListValue: {
    fontSize: 15,
    color: "#0f172a",
    lineHeight: 20,
  },
  safetyFooter: {
    marginTop: 18,
    fontSize: 14,
    color: "#0f172a",
    textAlign: "center",
    fontWeight: "600",
  },
  safetyReason: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
    textAlign: "center",
    fontStyle: "italic",
  },
  listView: {
    backgroundColor: "#f8fafc",
  },
  messagesContainer: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  inputToolbar: {
    borderTopColor: "transparent",
    backgroundColor: "#ffffff",
    paddingHorizontal: 6,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  },
  composer: {
    flexGrow: 1,
    flexShrink: 1,
    width: "auto",
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: "#eef2ff",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.45)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    fontSize: 16,
    color: "#0f172a",
  },
  sendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  voiceButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.35)",
  },
  voiceButtonPressed: {
    backgroundColor: "rgba(37, 99, 235, 0.2)",
  },
  voiceButtonDisabled: {
    opacity: 0.4,
  },
  voiceButtonLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1e3a8a",
  },
  sendButton: {
    minWidth: 44,
    paddingHorizontal: 6,
    justifyContent: "center",
    alignItems: "center",
    paddingRight: 4,
    paddingBottom: 4,
    backgroundColor: "transparent",
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2563eb",
  },
  sendLabelDisabled: {
    color: "#94a3b8",
  },
  botBubble: {
    backgroundColor: "#2563eb",
    padding: 10,
    borderRadius: 18,
    marginBottom: 4,
  },
  userBubble: {
    backgroundColor: "#e2e8f0",
    padding: 10,
    borderRadius: 18,
    marginBottom: 4,
  },
  userBubbleContainer: {
    marginLeft: 28,
  },
  botText: {
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 20,
    marginLeft: 0,
    paddingLeft: 0,
    textAlign: "left",
    ...Platform.select({
      android: {
        includeFontPadding: false,
      },
      default: {},
    }),
  },
  userText: {
    color: "#0f172a",
    fontSize: 15,
    lineHeight: 20,
    marginLeft: 0,
    paddingLeft: 0,
    textAlign: "left",
    ...Platform.select({
      android: {
        includeFontPadding: false,
      },
      default: {},
    }),
  },
  systemMessageContainer: {
    marginBottom: 6,
  },
  systemMessageText: {
    fontSize: 12,
    color: "#475569",
    textAlign: "center",
  },
  timeTextLeft: {
    textAlign: "right",
    alignSelf: "flex-end",
    color: "rgba(255, 255, 255, 0.7)",
  },
  timeTextRight: {
    textAlign: "right",
    alignSelf: "flex-end",
    color: "rgba(15, 23, 42, 0.55)",
  },
  scrollToBottomIndicator: {
    backgroundColor: "#1d4ed8",
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      web: {
        boxShadow: "0px 4px 6px rgba(15, 23, 42, 0.15)",
      },
      default: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.15,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      },
    }),
  },
  scrollToBottomText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },
  botAvatarContainer: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  botAvatarIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(37, 99, 235, 0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  botAvatarIconText: {
    fontSize: 16,
  },
  summaryPanel: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    padding: 16,
    backgroundColor: "#ffffff",
    gap: 16,
    marginTop: 10,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryHeaderText: {
    flex: 1,
    gap: 4,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1e293b",
  },
  summarySubtitle: {
    fontSize: 12,
    color: "#64748b",
  },
  summaryEditor: {
    gap: 8,
  },
  summaryLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  summaryInputWrapper: {
    position: "relative",
    borderRadius: 14,
    overflow: "hidden",
  },
  summaryInput: {
    minHeight: 240,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.55)",
    backgroundColor: "rgba(248, 250, 252, 0.95)",
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 15,
    lineHeight: 22,
    color: "#0f172a",
    letterSpacing: 0.1,
  },
  summaryInputHiddenText: {
    color: "transparent",
  },
  summaryOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 14,
    overflow: "hidden",
  },
  summaryOverlayScroll: {
    flex: 1,
  },
  summaryOverlayScrollContent: {
    paddingBottom: 8,
  },
  summaryOverlayText: {
    fontSize: 15,
    lineHeight: 22,
    color: "#0f172a",
    letterSpacing: 0.1,
  },
  summaryOverlayHighlight: {
    backgroundColor: "rgba(125, 211, 252, 0.35)",
    color: "#0f172a",
    fontWeight: "700",
  },
  summaryHint: {
    fontSize: 12,
    color: "#475569",
    lineHeight: 18,
  },
  summaryNote: {
    marginTop: 2,
    fontSize: 12,
    color: "#334155",
  },
  summaryNotePending: {
    fontSize: 12,
    color: "#64748b",
  },
  summaryReadOnly: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.35)",
    backgroundColor: "transparent",
    padding: 14,
    overflow: "hidden",
    shadowColor: "rgba(15, 23, 42, 0.18)",
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  summaryReadOnlyBg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
  },
  summaryReadOnlyText: {
    fontSize: 16,
    color: "#e2e8f0",
    lineHeight: 24,
    letterSpacing: 0.3,
    fontFamily: "System",
  },
  summarySentenceWrap: {
    marginBottom: 6,
    position: "relative",
  },
  summarySentenceGlow: {
    position: "absolute",
    top: -4,
    bottom: -4,
    left: -4,
    right: -4,
    borderRadius: 12,
    backgroundColor: "rgba(124, 58, 237, 0.3)",
    shadowColor: "rgba(34, 211, 238, 0.7)",
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  summarySentenceGradient: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: "rgba(37, 99, 235, 0.35)",
    shadowOpacity: 0.8,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.3)",
  },
  summaryActiveText: {
    fontSize: 17,
    color: "#f8fafc",
    lineHeight: 24,
    fontWeight: "800",
    letterSpacing: 0.2,
    fontFamily: "System",
  },
  summarySentenceMuted: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 0,
    shadowColor: "rgba(124, 58, 237, 0.25)",
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  summaryEmptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    padding: 12,
    overflow: "hidden",
  },
  summaryEmptyBg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
  },
  summaryEmptyText: {
    fontSize: 15,
    color: "#475569",
    lineHeight: 22,
  },
  summaryHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  summaryHeaderRight: {
    alignItems: "flex-end",
    gap: 6,
  },
  summaryControlRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 6,
  },
  summaryTextButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.35)",
    backgroundColor: "rgba(15,23,42,0.65)",
  },
  summaryTextButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  summaryTextButtonLabel: {
    color: "#e0e7ff",
    fontSize: 14,
    fontWeight: "600",
  },
  summaryIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  summaryIconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.35)",
    backgroundColor: "rgba(15,23,42,0.65)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "rgba(124, 58, 237, 0.4)",
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  summaryIconPrimary: {
    backgroundColor: "rgba(34,211,238,0.2)",
    borderColor: "rgba(34,211,238,0.5)",
  },
  summaryIconButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.96 }],
  },
  summaryIconGlyph: {
    fontSize: 18,
    color: "#e0e7ff",
  },
  summaryEditedTag: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "600",
    color: "#0f172a",
    backgroundColor: "rgba(148, 163, 184, 0.25)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  summaryActions: {
    gap: 10,
  },
  summaryButton: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryPrimaryButton: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1d4ed8",
    marginTop: 6,
  },
  summarySecondaryButton: {
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.35)",
  },
  summaryButtonPressed: {
    opacity: 0.9,
  },
  summaryButtonDisabled: {
    opacity: 0.6,
  },
  summaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  summaryPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  summaryNavRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 10,
  },
  summaryNavButton: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  summaryNavPrevButton: {
    backgroundColor: "#e2e8f0",
    borderColor: "#cbd5e1",
  },
  summaryNavNextButton: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  summaryNavPrevText: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "700",
  },
  summaryNavNextText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  summaryOptional: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    gap: 8,
  },
  summaryOptionalTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0f172a",
  },
  summaryOptionalSubtitle: {
    fontSize: 12,
    color: "#475569",
  },
  summaryVariantRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  summaryVariantChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
  },
  summaryVariantChipActive: {
    backgroundColor: "#dbeafe",
    borderWidth: 1,
    borderColor: "#93c5fd",
  },
  summaryVariantChipText: {
    fontSize: 11,
    color: "#475569",
    fontWeight: "700",
  },
  summaryVariantChipTextActive: {
    color: "#1d4ed8",
  },
  summaryVariantInput: {
    borderWidth: 1,
    borderColor: "#d6dee8",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#0f172a",
    backgroundColor: "#ffffff",
    fontSize: 12,
  },
  summaryVariantActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
  },
  summaryVariantButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#2563eb",
  },
  summaryVariantButtonPressed: {
    opacity: 0.85,
  },
  summaryVariantButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 12,
  },
  summaryGhostButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#c7ddf9",
    backgroundColor: "#edf4ff",
  },
  summaryGhostButtonPressed: {
    opacity: 0.85,
  },
  summaryGhostButtonText: {
    color: "#1e3a8a",
    fontWeight: "700",
    fontSize: 12,
  },
  summarySecondaryLabel: {
    color: "#1d4ed8",
    fontSize: 14,
    fontWeight: "600",
  },
  summaryStatus: {
    fontSize: 12,
    color: "#475569",
    fontStyle: "italic",
  },
  summaryStatusError: {
    fontSize: 12,
    color: "#dc2626",
  },
  summaryScores: {
    width: "100%",
    gap: 12,
  },
  layerCandidatesSection: {
    gap: 12,
  },
  layerCandidatesTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1d4ed8",
    letterSpacing: 0.3,
  },
  layerCandidateCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.35)",
    backgroundColor: "rgba(219, 234, 254, 0.45)",
    padding: 14,
    gap: 10,
  },
  layerCandidateCardSelected: {
    borderColor: "#1d4ed8",
    backgroundColor: "rgba(191, 219, 254, 0.6)",
  },
  layerCandidateSelectedTag: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "700",
    color: "#0f1f4b",
    backgroundColor: "rgba(147, 197, 253, 0.55)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  layerCandidateHeading: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f1f4b",
  },
  layerCandidateTheme: {
    fontSize: 13,
    color: "#1e3a8a",
    fontStyle: "italic",
  },
  layerCandidateGoal: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  layerCandidateAlignment: {
    fontSize: 12,
    color: "#1f2937",
  },
  layerCandidateMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  layerCandidateDuration: {
    fontSize: 12,
    color: "#1f2937",
    fontWeight: "600",
  },
  layerCandidateId: {
    fontSize: 12,
    color: "#475569",
  },
  layerCandidateOptions: {
    gap: 8,
  },
  layerCandidateOptionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1d2a6b",
  },
  layerCandidateOptionDescription: {
    fontSize: 13,
    color: "#1f2937",
    lineHeight: 18,
  },
  layerCandidateOptionWhy: {
    fontSize: 12,
    color: "#2563eb",
  },
  layerCandidateOptionPrinciple: {
    fontSize: 12,
    color: "#0f172a",
    fontStyle: "italic",
  },
  layerCandidateScores: {
    gap: 6,
  },
  layerCandidateScoreRow: {
    gap: 4,
  },
  layerCandidateScoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  layerCandidateScoreLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  layerCandidateScoreValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
  },
  layerCandidateScoreNote: {
    fontSize: 12,
    color: "#1f2937",
    marginTop: 2,
  },
  scoreBlock: {
    width: "100%",
    maxWidth: 700,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    borderRadius: 20,
    padding: 16,
    gap: 12,
    backgroundColor: "#f8fbff",
  },
  scoreBlockCompact: {
    maxWidth: undefined,
    borderRadius: 16,
    padding: 12,
  },
  scoreGroup: {
    gap: 8,
  },
  scoreGroupTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  scoreLabelColumn: {
    flex: 1,
    gap: 4,
  },
  scoreValueColumn: {
    width: 120,
    alignItems: "flex-end",
    gap: 4,
  },
  scoreDimTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1e3a8a",
  },
  scoreDimDescription: {
    fontSize: 13,
    color: "#334155",
  },
  scoreDimAnchors: {
    fontSize: 12,
    color: "#64748b",
    fontStyle: "italic",
  },
  scoreValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  scoreNote: {
    fontSize: 12,
    color: "#475569",
    textAlign: "right",
  },
  decisionPanel: {
    marginTop: 0,
    width: "100%",
    maxHeight: 420,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(30, 64, 175, 0.18)",
    ...Platform.select({
      web: {
        boxShadow: "0px 18px 34px rgba(30, 41, 59, 0.16)",
      },
      default: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.15,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 12 },
        elevation: 12,
      },
    }),
  },
  decisionPanelActive: {
    ...Platform.select({
      web: {
        flex: 1,
        maxHeight: "100%",
        marginTop: 0,
      },
      default: {},
    }),
    alignSelf: "stretch",
    minHeight: 0,
  },
  decisionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  decisionCloseChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(30, 64, 175, 0.12)",
  },
  decisionCloseChipPressed: {
    opacity: 0.85,
  },
  decisionCloseChipLabel: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: "600",
  },
  decisionScrollView: {
    flex: 1,
    minHeight: 0,
  },
  decisionScroll: {
    padding: 18,
    gap: 14,
  },
  decisionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1e293b",
  },
  decisionParagraph: {
    fontSize: 14,
    lineHeight: 20,
    color: "#334155",
  },
  decisionTagline: {
    fontSize: 13,
    color: "#475569",
    fontStyle: "italic",
  },
  decisionSubtitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  candidateCard: {
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.18)",
    borderRadius: 14,
    padding: 14,
    gap: 6,
    backgroundColor: "rgba(241, 245, 255, 0.65)",
  },
  candidateTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1e40af",
  },
  candidateSummary: {
    fontSize: 14,
    color: "#475569",
  },
  candidateRationale: {
    fontSize: 13,
    color: "#1f2937",
    lineHeight: 18,
  },
  candidateActivities: {
    marginTop: 6,
    gap: 6,
  },
  candidateActivityItem: {
    borderRadius: 10,
    padding: 10,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
  },
  candidateActivityLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  candidateActivityDescription: {
    fontSize: 13,
    color: "#1f2937",
    marginTop: 2,
  },
  candidateActivityDuration: {
    fontSize: 12,
    color: "#475569",
    marginTop: 2,
  },
  decisionLoadingBanner: {
    width: "100%",
    borderRadius: 14,
    backgroundColor: "rgba(30, 64, 175, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(30, 64, 175, 0.18)",
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  decisionLoadingLabel: {
    fontSize: 13,
    color: "#1e3a8a",
    fontWeight: "600",
    textAlign: "center",
  },
});
