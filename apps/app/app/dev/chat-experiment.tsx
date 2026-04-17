// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
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
} from "react-native-gifted-chat";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  deserializeDemographics,
  DemographicProfile,
  describeDemographicProfile,
} from "../lib/demographics";
import {
  buildSummaryImagePrompt,
  cacheLayeredImage,
  cacheLayeredPayload,
  getCachedLayeredImage,
} from "../layered-store";
import { Asset } from "expo-asset";
import { LinearGradient } from "expo-linear-gradient";

const BOT = { _id: "bot", name: "AI Support" };
const USER = { _id: "user", name: "You" };
const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:8787";
const LOG_STREAM_URL = `${API_BASE}/logs/stream`;

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

const INTRO_PROMPT: Prompt = {
  id: "intro",
  title: "Starting Point",
  prompt:
    "To begin, could you share a stressful situation from recent times that’s been weighing on you or pulling at your attention?",
};

const QUESTIONS: Prompt[] = [
  {
    id: "situation_snapshot",
    title: "Situation Snapshot",
    prompt:
      "What was going on around you at the time this situation started to stand out for you?",
  },
  {
    id: "notice_point",
    title: "Moment of Notice",
    prompt:
      "Was there a moment when you realized this situation was affecting you, even if nothing dramatic happened? What made you notice it?",
  },
  {
    id: "initial_interpretation",
    title: "Initial Interpretation",
    prompt:
      "What did you find yourself telling yourself about the situation at that point?",
  },
  {
    id: "response_experience",
    title: "Response Experience",
    prompt:
      "How did this show up for you, for example in your mood, thoughts, energy, or focus?",
  },
  {
    id: "persistence",
    title: "What Lingers",
    prompt:
      "As you think about it now, what part of this situation still feels unfinished or keeps returning to mind?",
  },
  {
    id: "current_context",
    title: "Current Context",
    prompt:
      "Before the system suggests you an activity, where are you right now and what are you currently doing? Knowing your setting (phone, desk, outside, etc.) will help us suggest an activity that actually fits.",
  },
];

const SUMMARY_INVITATION_PATTERNS = [
  /feel free/i,
  /wrap things up/i,
  /include any parting thoughts/i,
  /share .*before we wrap/i,
  /looking at what stands out/i,
];

const SAFETY_HEADLINE = "Thank you for sharing with me.";
const SAFETY_DESCRIPTION =
  "I need to pause this conversation now. If you’re thinking about self-harm or suicide, please reach out right away:";
const SAFETY_RESOURCES = [
  {
    label: "United States & Canada",
    value: "Dial or text 988 (24/7 Suicide & Crisis Lifeline)",
  },
  {
    label: "UK & Ireland",
    value: "Call Samaritans at +44 116 123",
  },
  {
    label: "Worldwide",
    value: "Find local options: https://www.opencounseling.com/suicide-hotlines",
  },
];
const SAFETY_FOOTER = "When you’re ready, you can close this app.";

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

const sanitizeSummaryTransitionMessage = (message: string): string => {
  if (!message) return "";
  const sentences = message.match(/[^.!?]+[.!?]?/g);
  if (!sentences) {
    return message.trim().endsWith("?") ? "" : message.trim();
  }
  const filtered = sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter(
      (sentence) =>
        !sentence.endsWith("?") &&
        !SUMMARY_INVITATION_PATTERNS.some((pattern) => pattern.test(sentence))
    );
  return filtered.join(" ").trim();
};

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
const SAMPLE_SUMMARY =
  "I described how a tense meeting with my manager keeps looping in my head and how I still feel the stress sitting in my shoulders hours later. My body went into fight-or-flight, and the more I tried to defend myself the more unheard I felt.\n\nI want to reset tonight by going for a walk, jotting down what I wish I had said, and planning a calmer follow-up conversation later this week.";
const SAMPLE_INTRO_ANSWER =
  "I had a tense video call with my manager yesterday and I can’t stop replaying how defensive I felt.";
const SAMPLE_STEP_ANSWERS: Record<string, string> = {
  situation_snapshot:
    "It was late afternoon after back-to-back meetings, and I was still at my kitchen table trying to finish work from home while Slacks kept pinging.",
  notice_point:
    "It peaked when my manager said my roadmap sounded naive in front of another director on the call, and my face was right there on camera.",
  initial_interpretation:
    "My first thought was, ‘everyone can see I’m failing at this,’ and I wanted to disappear off screen.",
  response_experience:
    "My shoulders locked up, my breathing went shallow, and I felt heat flooding my cheeks while my hands got shaky.",
  persistence:
    "I keep drafting imaginary follow-up emails in my head and cringe when I remember the tone I used.",
  current_context:
    "Right now I’m on my laptop at the dining table trying to wind down but I’m still basically in work mode.",
};
type SampleScriptEntry = { role: "system" | "bot" | "user"; text: string };
const SAMPLE_ACK_SNIPPETS: Record<string, string> = {
  intro: "replaying that meeting",
  situation_snapshot: "feeling anxious at your kitchen table",
  notice_point: "hearing your roadmap called naive",
  initial_interpretation: "that “I’m failing” thought",
  response_experience: "your shoulders locking up",
  persistence: "drafting those imaginary emails",
  current_context: "being on your laptop at the dining table",
};
const SAMPLE_ACK_TONES: Record<string, string> = {
  initial_interpretation: "thanks for clarifying that.",
};
const SAMPLE_CHAT_SCRIPT: SampleScriptEntry[] = (() => {
  const script: SampleScriptEntry[] = [
    { role: "system", text: "Log • Intro: Starting point" },
    {
      role: "bot",
      text:
        "I’d like to understand what you’ve been experiencing. To begin, could you share the situation that’s been on your mind recently?",
    },
    { role: "user", text: SAMPLE_INTRO_ANSWER },
  ];

  if (QUESTIONS.length > 0) {
    const firstStep = QUESTIONS[0];
    script.push({
      role: "bot",
      text: `Thinking back to what you shared about ${SAMPLE_ACK_SNIPPETS.intro}, thanks for sharing that.\n\nStep 1 of ${QUESTIONS.length} — ${firstStep.title}\n${firstStep.prompt}`,
    });
  }

  QUESTIONS.forEach((step, index) => {
    const nextStep = QUESTIONS[index + 1] ?? null;
    const continuation = nextStep
      ? `Step ${index + 2} of ${QUESTIONS.length} — ${nextStep.title}\n${nextStep.prompt}`
      : "Let me gather everything you’ve shared and pull a summary together next.";
    const snippet = SAMPLE_ACK_SNIPPETS[step.id] || step.title.toLowerCase();
    const tone = SAMPLE_ACK_TONES[step.id] || "thanks for sharing that.";

    script.push(
      { role: "system", text: `Log • Step ${index + 1}/${QUESTIONS.length}: ${step.title}` },
      { role: "user", text: SAMPLE_STEP_ANSWERS[step.id] },
      {
        role: "bot",
        text: `Thinking back to what you shared about ${snippet}, ${tone}\n\n${continuation}`,
      }
    );
  });

  script.push(
    { role: "system", text: "Log • Final step complete; preparing wrap-up." },
    {
      role: "bot",
      text: "Thanks for everything you shared. I’ll pull together a summary for you now and pop it into the sidebar.",
    },
    { role: "system", text: "Log • Preparing wrap-up" },
    { role: "bot", text: "I’ve drafted a summary and added it to the sidebar—feel free to tweak it." },
    { role: "bot", text: "Thanks for walking through this reflection. This completes our check-in for now." },
    { role: "system", text: "Log • Sample chat injected" }
  );

  return script;
})();

function createSampleMessages(): IMessage[] {
  const total = SAMPLE_CHAT_SCRIPT.length;
  const baseTime = Date.now() - total * 2000;

  return SAMPLE_CHAT_SCRIPT.filter((entry) => entry.role === "bot" || entry.role === "user").map((entry, index) => {
    const createdAt = new Date(baseTime + index * 2000);
    return {
      _id: `sample-${index}-${entry.role}`,
      text: entry.text,
      createdAt,
      user: entry.role === "bot" ? BOT : USER,
    } as IMessage;
  });
}

function buildSampleRecords(): { intro: StepRecord; steps: StepRecord[] } {
  const now = Date.now();
  const minute = 60 * 1000;
  const recordTime = (offset: number) => new Date(now - offset * minute).toISOString();

  const introRecord: StepRecord = {
    id: INTRO_PROMPT.id,
    title: INTRO_PROMPT.title,
    question: INTRO_PROMPT.prompt,
    answers: [
      {
        text: SAMPLE_INTRO_ANSWER,
        recordedAt: recordTime(QUESTIONS.length + 2),
      },
    ],
    followUps: [],
  };

  const steps = QUESTIONS.map((step, index) => {
    const answer = SAMPLE_STEP_ANSWERS[step.id];
    return {
      id: step.id,
      title: step.title,
      question: step.prompt,
      answers: answer
        ? [
            {
              text: answer,
              recordedAt: recordTime(Math.max(1, QUESTIONS.length - index)),
            },
          ]
        : [],
      followUps: [],
    };
  });

  return { intro: introRecord, steps };
}

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

function formatElapsedClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
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
  const params = useLocalSearchParams<{ profile?: string; participantId?: string }>();
  const demographicProfile = useMemo(
    () => deserializeDemographics(params.profile),
    [params.profile]
  );
  const participantId =
    typeof params.participantId === "string" && params.participantId.trim()
      ? params.participantId.trim()
      : "";
  const demographicDescription = useMemo(
    () => describeDemographicProfile(demographicProfile),
    [demographicProfile]
  );
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [introComplete, setIntroComplete] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  const [summaryShown, setSummaryShown] = useState(false);
  const [intervention, setIntervention] = useState<InterventionResult | null>(null);
  const [layeredSupport, setLayeredSupport] = useState<any>(null);
  const [showDecisionDetails, setShowDecisionDetails] = useState(false);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [interventionDurationMs, setInterventionDurationMs] = useState<number | null>(null);
  const [sessionSummary, setSessionSummary] = useState("");
  const [summaryOriginal, setSummaryOriginal] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [interventionsVisible, setInterventionsVisible] = useState(false);
  const [layeredStatus, setLayeredStatus] = useState<"idle" | "pending" | "ready" | "error">("idle");
  const [layeredError, setLayeredError] = useState<string | null>(null);
  const [summaryTtsStatus, setSummaryTtsStatus] = useState<"idle" | "pending" | "ready" | "error">(
    "idle"
  );
  const [summaryTtsUrl, setSummaryTtsUrl] = useState<string | null>(null);
  const [summaryTtsError, setSummaryTtsError] = useState<string | null>(null);
  const summaryTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  const summaryMusicAudioRef = useRef<HTMLAudioElement | null>(null);
const [summaryMusicUri, setSummaryMusicUri] = useState<string | null>(null);
  const [summaryTtsSentenceIdx, setSummaryTtsSentenceIdx] = useState<number>(-1);
  const [summaryTtsPlaying, setSummaryTtsPlaying] = useState(false);
  const summaryImageRequestsRef = useRef<Map<string, Promise<string | null>>>(new Map());
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
  const [overlaySaplingLevel, setOverlaySaplingLevel] = useState(0);
  const [safetyLock, setSafetyLock] = useState(false);
  const [safetyDetails, setSafetyDetails] = useState("");
  const [sessionId, setSessionId] = useState<string>(() => createSessionIdentifier());
  const [autoChatMode, setAutoChatMode] = useState<AutoChatMode>("manual");
  const [interventionLoadingElapsedMs, setInterventionLoadingElapsedMs] = useState(0);
  const hasStartedRef = useRef(false);
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
  const layeredGenerationRef = useRef<Promise<any> | null>(null);
  const listViewRef = useRef<FlatList<IMessage> | null>(null);
  const demographicsRef = useRef<DemographicProfile>(demographicProfile);
  const postedDemographicsRef = useRef<string | null>(null);
  const summaryPayloadRef = useRef<any[]>([]);
  const layeredSupportRef = useRef<any>(layeredSupport);
  const layeredStatusRef = useRef(layeredStatus);
  const lastLoggedSummaryRef = useRef<string>("");
  const overlayPulseValue = useRef(new Animated.Value(0)).current;

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
        music = new audioCtor(summaryMusicUri);
        music.loop = true;
        music.volume = 0.14;
        summaryMusicAudioRef.current = music;
      }
      audio.onended = () => {
        setSummaryTtsStatus("ready");
        setSummaryTtsPlaying(false);
        if (music) {
          music.pause();
        }
      };
      audio.ontimeupdate = () => {
        if (!audio.duration || !summarySentences.length || !summaryTotalWords) return;
        const fraction = Math.max(0, Math.min(1, audio.currentTime / audio.duration));
        const wordsSpoken = fraction * summaryTotalWords;
        let running = 0;
        let targetIdx = summarySentences.length - 1;
        for (let i = 0; i < summarySentences.length; i += 1) {
          running += summarySentenceWordCounts[i] || 1;
          if (wordsSpoken <= running) {
            targetIdx = i;
            break;
          }
        }
        setSummaryTtsSentenceIdx((prev) => (prev === targetIdx ? prev : targetIdx));
      };
      audio.onerror = () => {
        setSummaryTtsStatus("error");
        setSummaryTtsError("Could not play the voiceover.");
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
          setSummaryTtsError("Could not play the voiceover.");
          setSummaryTtsPlaying(false);
          if (music) {
            music.pause();
          }
        });
    } catch (err) {
      console.warn("[summary] TTS playback init failed", err);
      setSummaryTtsStatus("error");
      setSummaryTtsError("Could not play the voiceover.");
    }
  }, [summaryTtsUrl, summarySentences, summarySentenceWordCounts, summaryTotalWords]);

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
      Animated.timing(summaryHighlightPulse, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(summaryHighlightPulse, { toValue: 0.35, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [summaryTtsSentenceIdx, summaryHighlightPulse]);
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

  const requestSummaryTts = useCallback(async () => {
    const text = sessionSummary.trim();
    if (!text) {
      setSummaryTtsError("No summary available yet.");
      return;
    }
    if (summaryLoading) {
      setSummaryTtsError("Still drafting your summary—try again in a moment.");
      return;
    }
    if (summaryTtsStatus === "ready" && summaryTtsUrl && summaryTtsAudioRef.current) {
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
      setSummaryTtsStatus("ready");
    } catch (err: any) {
      setSummaryTtsStatus("error");
      setSummaryTtsError(err?.message || "Could not create voiceover.");
    }
  }, [sessionSummary, summaryLoading, summaryTtsProfile]);

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
          const url = typeof parsed?.url === "string" ? parsed.url.trim() : "";
          if (!url) {
            throw new Error("Image url missing");
          }
          cacheLayeredImage(prompt, url);
          console.log("[summary-image] prefetch success", {
            promptPreview: prompt.slice(0, 120),
            urlPreview: url.slice(0, 80),
          });
          return url;
        })
        .catch((err) => {
          console.warn("[summary-image] prefetch failed", err);
          return null;
        })
        .finally(() => {
          summaryImageRequestsRef.current.delete(prompt);
        });
      summaryImageRequestsRef.current.set(prompt, promise);
      return promise;
    },
    [logIntervention]
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

  const formatDuration = useCallback((value: number | null) => {
    if (value == null || Number.isNaN(value)) return "";
    if (value < 1000) {
      return `${Math.max(1, Math.round(value))} ms`;
    }
    const seconds = value / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  }, []);

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
            demographics: demographicsRef.current,
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
    [demographicsRef]
  );

  const appendMessage = useCallback((incoming: Partial<IMessage>, forceScroll = false) => {
    setMessages((prev) =>
      GiftedChat.append(
        prev,
        [{ ...incoming, createdAt: new Date() } as IMessage],
        false
      )
    );
    if (forceScroll || isAtBottomRef.current) {
      requestAnimationFrame(() => {
        listViewRef.current?.scrollToEnd?.({ animated: true });
      });
    }
  }, []);

  const sendBotMessage = useCallback(
    (text: string) => {
      requestAnimationFrame(() => {
        appendMessage(
          {
            _id: `bot-${Date.now()}-${Math.random()}`,
            text,
            user: BOT,
          },
          true
        );
      });
    },
    [appendMessage]
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

  const persistSampleTranscript = useCallback(
    async (entries: IMessage[], summaryText: string) => {
      const summaryTrimmed = summaryText.trim();
      if ((!entries || entries.length === 0) && !summaryTrimmed) {
        return;
      }
      try {
        for (const entry of entries) {
          const text = (entry?.text || "").trim();
          if (!text) continue;
          let role: "assistant" | "user" | "system" = "system";
          if (!entry?.system) {
            role = entry?.user?._id === BOT._id ? "assistant" : "user";
          }
          await persistSessionMessage(role, text);
        }
        if (summaryTrimmed) {
          await persistSummaryText(summaryTrimmed);
        }
      } catch (err) {
        console.warn("Sample transcript persist failed:", err);
      }
    },
    [persistSessionMessage, persistSummaryText]
  );

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
    },
    [sendSystemMessage]
  );

  const engageSafetyLock = useCallback(
    (reason?: string) => {
      setSafetyLock(true);
      setSafetyDetails(reason?.trim() || "");
      setAwaitingResponse(null);
      setInterventionsVisible(false);
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
      "I’d like to understand what you’ve been experiencing. To begin, could you share the situation that’s been on your mind recently?";
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
        demographics: demographicsRef.current,
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
            setInterventionDurationMs(Date.now() - interventionTimerRef.current);
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
      demographicsRef,
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
      setLayeredSupport(null);
      setLayeredStatus("error");
      setLayeredError("Add a little more detail to unlock personalized interventions.");
      setInterventionDurationMs(null);
      setIntervention(null);
      setShowDecisionDetails(false);
      sendBotMessage(
        "I appreciate you sharing. A detailed summary isn’t available right now, but you can jot your own notes in the sidebar."
      );
      sendBotMessage(
        "Thanks for walking through this reflection. This completes our check-in for now."
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
          demographics: demographicsRef.current,
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
      sendBotMessage("I’ve drafted a summary and added it to the sidebar—feel free to tweak it.");
    } else {
      sendBotMessage(
        "I couldn’t produce a detailed summary this time, but you can jot your own notes in the sidebar."
      );
    }

    void prefetchSummaryImage(generatedSummary);

    interventionTimerRef.current = Date.now();
    setInterventionDurationMs(null);
    const layeredPromise = startLayeredGeneration(generatedSummary, payload, { reset: true });
    layeredPromise.catch(() => {
      /* handled via layeredStatus state */
    });

    sendBotMessage(
      "Thanks for walking through this reflection. This completes our check-in for now."
    );
    setIsSessionComplete(true);
    setAwaitingResponse(null);
  }, [
    demographicsRef,
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

  const handleInterventionReveal = useCallback(async () => {
    setInterventionsVisible(true);
    setShowDecisionDetails(false);

    if (!summaryPayloadRef.current.length) {
      setLayeredStatus("error");
      setLayeredError("Add a little more detail to unlock personalized interventions.");
      logIntervention("blocked: missing summary payload");
      return;
    }

    const goToLayers = (support: any, imageUrl?: string | null) => {
      if (!support) return;
      setInterventionsVisible(false);
      logIntervention("navigating to /layers", {
        summaryEdited,
      });
      const resolvedImageUrl =
        typeof imageUrl === "string" && imageUrl.trim()
          ? imageUrl.trim()
          : (() => {
              const prompt = buildSummaryImagePrompt(sessionSummary);
              return prompt ? getCachedLayeredImage(prompt) : "";
            })();
      const payload = {
        layered: support,
        summary: support?.summary_recap || sessionSummary,
        userSummary: sessionSummary,
        intro: introRecordRef.current.answers[0]?.text || "",
        steps: stepRecordsRef.current.map(serializeStepRecord),
        summaryImageUrl: resolvedImageUrl,
        sessionId,
      };
      const cacheKey = cacheLayeredPayload(payload);
      router.push({
        pathname: "/layers",
        params: {
          cacheKey,
        },
      });
    };

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

    const needsRegeneration =
      summaryEdited || status === "idle" || status === "error" || !support;

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
    goToLayers(support, prefetchedImageUrl);
  }, [
    router,
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
        demographics: demographicsRef.current,
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
    [demographicsRef, sessionId, setSessionId]
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
        demographics: demographicsRef.current,
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
    [demographicsRef, sessionId, setSessionId]
  );

  useEffect(() => {
    demographicsRef.current = demographicProfile;
  }, [demographicProfile]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!sessionId) return;
    const payload = demographicsRef.current;
    const key = `${sessionId}:${JSON.stringify(payload)}:${participantId}`;
    if (postedDemographicsRef.current === key) {
      return;
    }
    postedDemographicsRef.current = key;
    const persist = async () => {
      try {
        await fetch(`${API_BASE}/sessions/${sessionId}/demographics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: payload, participant_id: participantId }),
        });
      } catch (err) {
        console.warn("Failed to persist demographics:", err);
      }
    };
    persist();
  }, [sessionId, demographicProfile, participantId]);

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
    if (hasStartedRef.current) return;
    sendSystemMessage("Log • Demographics recorded", demographicProfile);
    hasStartedRef.current = true;
    presentIntro();
  }, [demographicProfile, presentIntro, sendSystemMessage]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      requestAnimationFrame(() => {
        listViewRef.current?.scrollToEnd?.({ animated: true });
      });
    }
  }, [messages]);

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
      />
    ),
    []
  );

  const renderAvatar = useCallback(
    (props: any) => {
      if (props.currentMessage?.user?._id === BOT._id) {
        return (
          <View style={styles.botAvatarContainer}>
            <View style={styles.botAvatarHead}>
              <View style={styles.botAvatarEyes}>
                <View style={styles.botAvatarEye} />
                <View style={styles.botAvatarEye} />
              </View>
              <View style={styles.botAvatarMouth} />
            </View>
            <View style={styles.botAntenna}>
              <View style={styles.botAntennaStem} />
              <View style={styles.botAntennaTip} />
            </View>
          </View>
        );
      }
      return <Avatar {...props} />;
    },
    []
  );

  const renderInputToolbar = useCallback(
    (props: any) => (
      <InputToolbar
        {...props}
        containerStyle={styles.inputToolbar}
        primaryStyle={{ alignItems: "center", flexDirection: "row", flex: 1 }}
      />
    ),
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
          decision: normalizedDecision,
          followUpFocus: controlDecision.follow_up_focus || null,
          rationale: controlDecision.rationale || null,
        });

        const acknowledgement = await requestAcknowledgement({
          step: INTRO_PROMPT,
          answer: userText,
          decision: normalizedDecision,
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
          ? sanitizeSummaryTransitionMessage(acknowledgement.message)
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
      text: inputValueRef.current,
      createdAt: new Date(),
      user: USER,
    };

    setInputValue("");
    inputValueRef.current = "";
    handleMessageFlow([outgoing]);
  }, [handleMessageFlow, safetyLock]);

  const handleLoadSampleContent = useCallback(() => {
    if (safetyLock) {
      sendSystemMessage("Log • Sample data request ignored due to safety lock.");
      return;
    }
    sendSystemMessage("Log • Sample data requested; preparing transcript.");

    const messages = createSampleMessages();
    const { intro, steps } = buildSampleRecords();
    const payload = [intro, ...steps]
      .filter((record) => record.answers.length > 0)
      .map(serializeStepRecord);

    introRecordRef.current = intro;
    stepRecordsRef.current = steps;
    summaryPayloadRef.current = payload;
    layeredGenerationRef.current = null;
    outstandingFollowUpRef.current = null;

    setAwaitingResponse(null);
    clearAutoRetry();

    setMessages(messages);
    isAtBottomRef.current = true;
    requestAnimationFrame(() => {
      listViewRef.current?.scrollToEnd?.({ animated: false });
    });

    setInputValue("");
    inputValueRef.current = "";

    setIntroComplete(true);
    setCurrentStepIndex(Math.max(QUESTIONS.length - 1, 0));
    setIsSessionComplete(true);

    setSummaryShown(true);
    setSummaryLoading(false);
    setSummaryOriginal(SAMPLE_SUMMARY.trim());
    setSessionSummary(SAMPLE_SUMMARY.trim());

    setInterventionsVisible(false);
    setIntervention(null);
    setInterventionDurationMs(null);
    setDecisionLoading(false);
    setShowDecisionDetails(false);

    setLayeredSupport(null);
    setLayeredStatus("pending");
    setLayeredError(null);

    interventionTimerRef.current = Date.now();
    layeredGenerationRef.current = startLayeredGeneration(SAMPLE_SUMMARY.trim(), payload, {
      reset: true,
    }).catch(() => {
      /* errors surfaced via layeredStatus */
    });

    void persistSampleTranscript(messages, SAMPLE_SUMMARY.trim());
    sendSystemMessage("Log • Sample chat ready with summary and layered generation.");
  }, [
    clearAutoRetry,
    persistSampleTranscript,
    sendSystemMessage,
    setAwaitingResponse,
    setDecisionLoading,
    setInterventionDurationMs,
    setLayeredError,
    setLayeredStatus,
    setLayeredSupport,
    safetyLock,
  ]);

  const renderSend = useCallback(() => {
    const disabled = safetyLock || !inputValue.trim();
    return (
      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.sendButton, disabled && styles.sendButtonDisabled]}
        onPress={handleManualSend}
        disabled={disabled}
      >
        <Text style={[styles.sendLabel, disabled && styles.sendLabelDisabled]}>Send</Text>
      </TouchableOpacity>
    );
  }, [handleManualSend, inputValue, safetyLock]);

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
  const generationTimeLabel = formatDuration(interventionDurationMs);
  const isInterventionLoading =
    decisionLoading || (interventionsVisible && layeredStatus === "pending");
  const overlayCardOpacity = overlayPulseValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });
  useEffect(() => {
    if (!isInterventionLoading) {
      setOverlaySaplingLevel(0);
    }
  }, [isInterventionLoading]);
  const interventionOverlayContent = useMemo(() => {
    if (!isInterventionLoading) return null;
    const seconds = Math.max(0, Math.floor(interventionLoadingElapsedMs / 1000));
    if (seconds <= 15) {
      return {
        headline: "Gathering what you shared…",
        body: "Take a quiet moment while I put things together.",
      };
    }
    if (seconds <= 45) {
      const variantIndex = Math.max(0, Math.floor((seconds - 16) / 10)) % THINKING_VARIATIONS.length;
      return {
        headline:
          "I’m thinking through your reflections — the situation, what happened, how it felt.",
        body: "This may take a little time.",
        extra: THINKING_VARIATIONS[variantIndex],
      };
    }
    if (seconds <= 90) {
      return {
        headline: "Still processing your responses carefully.",
        body: "Thank you for your patience — your next step will appear soon.",
      };
    }
    return {
      headline: "Almost ready.",
      body: "I’m preparing something based on what you shared.",
    };
  }, [interventionLoadingElapsedMs, isInterventionLoading]);
  const interventionOverlayTimer = interventionOverlayContent
    ? formatElapsedClock(interventionLoadingElapsedMs)
    : null;

  useEffect(() => {
    if (!isInterventionLoading) {
      setInterventionLoadingElapsedMs(0);
      return;
    }
    const baseStart = interventionTimerRef.current ?? Date.now();
    setInterventionLoadingElapsedMs(Date.now() - baseStart);
    const interval = setInterval(() => {
      const start = interventionTimerRef.current ?? baseStart;
      setInterventionLoadingElapsedMs(Date.now() - start);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [isInterventionLoading]);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isInterventionLoading) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(overlayPulseValue, {
            toValue: 1,
            duration: 1600,
            useNativeDriver: true,
          }),
          Animated.timing(overlayPulseValue, {
            toValue: 0,
            duration: 1600,
            useNativeDriver: true,
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
  }, [isInterventionLoading, overlayPulseValue]);

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
        <View pointerEvents="none" style={styles.interventionOverlay}>
          <Animated.View
            style={[styles.interventionOverlayCard, { opacity: overlayCardOpacity }]}
          >
            <Text style={styles.interventionOverlayLabel}>Preparing your plan</Text>
            <Text style={styles.interventionOverlayHeadline}>
              {interventionOverlayContent.headline}
            </Text>
            <Text style={styles.interventionOverlayBody}>{interventionOverlayContent.body}</Text>
            {interventionOverlayContent.extra ? (
              <Text style={styles.interventionOverlayExtra}>
                {interventionOverlayContent.extra}
              </Text>
            ) : null}
            {interventionOverlayTimer ? (
              <Text style={styles.interventionOverlayTimer}>{interventionOverlayTimer}</Text>
            ) : null}
          </Animated.View>
        </View>
      ) : null}
      <View
        style={[
          styles.wrapper,
          interventionOverlayContent && styles.wrapperWithOverlayOffset,
        ]}
      >
        <View style={styles.sessionHeader}>
          <View style={styles.sessionMeta}>
            {!isSessionComplete ? (
              <View style={styles.expectationBanner}>
                <Text style={styles.expectationBannerText}>
                  You’ll get around 7 messages, plus occasional follow-ups/clarifications.
                </Text>
                <Text style={styles.expectationSubtext}>
                  We ask a few specific questions to better understand your context and surroundings. Feel free to answer in as much detail as you like.                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.sessionControls}>
            <View style={styles.progressBadge}>
              <Text style={styles.progressValue}>{progressPercent}%</Text>
              <Text style={styles.progressCaption}>complete</Text>
            </View>
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
            <Pressable
              accessibilityRole="button"
              onPress={handleLoadSampleContent}
              style={({ pressed }) => [
                styles.sampleButton,
                pressed && styles.sampleButtonPressed,
              ]}
            >
              <Text style={styles.sampleButtonLabel}>Load sample data</Text>
              <Text style={styles.sampleButtonHint}>Loads a sample chat transcript</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.max(progressValue * 100, 6)}%` },
            ]}
          />
        </View>

        <View style={styles.promptBanner}>
          <View style={styles.promptBadge}>
            <Text style={styles.promptBadgeText}>
              {introComplete ? `Step ${currentStepIndex + 1} of ${QUESTIONS.length}` : "Warm-up"}
            </Text>
          </View>
          <Text style={styles.promptTitle}>{activeStep.title}</Text>
          <Text style={styles.promptCopy} numberOfLines={2}>
            {activeStep.prompt}
          </Text>
          {nextStep && (
            <Text style={styles.nextHint}>
              Up next: {nextStep.title}
            </Text>
          )}
        </View>

        <View style={styles.timeline}>
        {timeline.map((item) => (
          <View
            key={item.id}
            style={[
              styles.timelineItem,
              item.state === "active" && styles.timelineItemActive,
              item.state === "done" && styles.timelineItemDone,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.timelineText,
                item.state === "active" && styles.timelineTextActive,
                item.state === "done" && styles.timelineTextDone,
              ]}
            >
              {item.title}
            </Text>
          </View>
        ))}
        </View>

        {decisionLoading && (
          <View style={styles.decisionLoadingBanner}>
            <Text style={styles.decisionLoadingLabel}>
              Generating intervention options…
            </Text>
          </View>
        )}

        <View
          style={[
            styles.chatDecisionContainer,
            hasSidePanel && styles.chatDecisionSplit,
          ]}
        >
        <View
          style={[
            styles.chatColumn,
            hasSidePanel && styles.chatColumnSplit,
          ]}
        >
          <View style={styles.chatCard}>
            <View style={styles.chatContent}>
              <GiftedChat
                ref={(instance) => {
                  chatInstanceRef.current = instance;
                }}
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
                listViewProps={{
                  ref: (ref: FlatList<IMessage> | null) => {
                    listViewRef.current = ref;
                  },
                  style: styles.listView,
                  onScroll: handleScroll,
                  scrollEventThrottle: 16,
                  showsVerticalScrollIndicator: true,
                }}
                textInputProps={{
                  style: styles.composer,
                placeholderTextColor: "#64748b",
                multiline: true,
                blurOnSubmit: false,
                editable: !safetyLock,
                    onKeyPress: (event) => {
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
                    scrollToBottom
                    scrollToBottomComponent={() => (
                      <View style={styles.scrollToBottomIndicator}>
                        <Text style={styles.scrollToBottomText}>↓</Text>
                      </View>
                    )}
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
                    {safetyDetails ? (
                      <Text style={styles.safetyReason}>{safetyDetails}</Text>
                    ) : null}
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
                        <Text style={styles.summaryTitle}>Session Wrap-Up</Text>
                        {summaryLoading ? (
                          <Text style={styles.summarySubtitle}>Drafting your summary…</Text>
                        ) : null}
                      </View>
                      {interventionsVisible && layeredStatus === "ready" && generationTimeLabel ? (
                        <Text style={styles.summaryTiming}>
                          Interventions ready in {generationTimeLabel}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.summaryEditor}>
                      <View style={styles.summaryHeaderRow}>
                        <Text style={styles.summaryLabel}>Summary</Text>
                        <View style={styles.summaryHeaderRight}>
                          <Text style={styles.summaryNote}>
                            Want a gentle AI voiceover of your summary? Tap “Play AI voiceover.”
                          </Text>
                          {summaryTtsStatus === "pending" ? (
                            <Text style={styles.summaryNotePending}>
                              Creating the voiceover now — this can take a few seconds.
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
                              if (summaryTtsStatus === "ready" && summaryTtsUrl && summaryTtsAudioRef.current) {
                                summaryTtsAudioRef.current
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
                              {summaryTtsPlaying ? "Pause AI voiceover" : "Play AI voiceover"}
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
                            <Text style={styles.summaryTextButtonLabel}>Restart voiceover</Text>
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
                          editable={!summaryLoading && !decisionLoading && !summaryTtsPlaying}
                          placeholderTextColor="#94a3b8"
                          textAlignVertical="top"
                        />
                        {isVoiceoverActive && (
                          <View pointerEvents="none" style={styles.summaryOverlay}>
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
                          </View>
                        )}
                      </View>
                      <Text style={styles.summaryHint}>
                        Edit anything you’d like before we craft a personalized activity.
                      </Text>

                      <Pressable
                        accessibilityRole="button"
                        onPress={handleInterventionReveal}
                        disabled={summaryLoading || decisionLoading}
                        style={({ pressed }) => [
                          styles.summaryPrimaryButton,
                          pressed && !summaryLoading && !decisionLoading && styles.summaryButtonPressed,
                          (summaryLoading || decisionLoading) && styles.summaryButtonDisabled,
                        ]}
                      >
                        <Text style={styles.summaryPrimaryButtonText}>
                          Create a personalized activity for me
                        </Text>
                      </Pressable>
                    </View>

                    {summaryTtsStatus === "error" && summaryTtsError ? (
                      <Text style={styles.summaryStatusError}>{summaryTtsError}</Text>
                    ) : null}

                    {interventionsVisible && isInterventionLoading ? (
                      <Text style={styles.summaryStatus}>Preparing layered support…</Text>
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
                    {intervention?.candidates?.map((candidate) => (
                      <View
                        key={candidate.plan_id || candidate.plan_title || Math.random().toString(36)}
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
  interventionOverlayLabel: {
    fontSize: 12,
    color: "#93c5fd",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "700",
  },
  interventionOverlayHeadline: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: "700",
    color: "#f8fafc",
    lineHeight: 24,
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
  sampleButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(15, 23, 42, 0.08)",
    alignItems: "flex-start",
  },
  sampleButtonPressed: {
    opacity: 0.85,
  },
  sampleButtonLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
  },
  sampleButtonHint: {
    fontSize: 11,
    color: "#475569",
    marginTop: 1,
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
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
    backgroundColor: "rgba(14, 165, 233, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(14, 165, 233, 0.45)",
    shadowColor: "rgba(14, 165, 233, 0.35)",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  expectationBannerText: {
    fontSize: 16,
    color: "#0b1530",
    fontWeight: "900",
    letterSpacing: 0.35,
    marginBottom: 4,
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
    maxWidth: 700,
    alignSelf: "center",
    marginTop: 4,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    ...Platform.select({
      web: {
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
  botText: {
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 20,
  },
  userText: {
    color: "#0f172a",
    fontSize: 15,
    lineHeight: 20,
  },
  systemMessageContainer: {
    marginBottom: 6,
  },
  systemMessageText: {
    fontSize: 12,
    color: "#475569",
    textAlign: "center",
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
  botAvatarHead: {
    width: 32,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#1d4ed8",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  botAvatarEyes: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
  botAvatarEye: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ffffff",
  },
  botAvatarMouth: {
    marginTop: 4,
    width: "60%",
    height: 4,
    borderRadius: 2,
    backgroundColor: "#93c5fd",
  },
  botAntenna: {
    position: "absolute",
    top: -10,
    alignItems: "center",
  },
  botAntennaStem: {
    width: 2,
    height: 10,
    backgroundColor: "#1d4ed8",
  },
  botAntennaTip: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#60a5fa",
    marginTop: 2,
  },
  summaryPanel: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    padding: 16,
    backgroundColor: "#ffffff",
    gap: 16,
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
  summaryTiming: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2563eb",
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
