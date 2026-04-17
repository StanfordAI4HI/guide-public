import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  Platform,
  ActivityIndicator,
  Animated,
  Image,
} from "react-native";
import { Asset } from "expo-asset";
import { LinearGradient } from "expo-linear-gradient";
import { getFlowState, updateFlowState } from "../layered-store";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:8787";
const TTS_URL = `${API_BASE}/dev/media/tts`;
const TRANSCRIBE_URL = `${API_BASE}/dev/media/transcribe`;
const PIANO_AMBIENT = require("../../assets/audio/piano.mp3");
const CHAT_URL = `${API_BASE}/dev/ux-chat`;
const toAbsoluteMediaUrl = (raw?: string) => {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  if (value.startsWith("/")) return `${API_BASE}${value}`;
  return value;
};

const sampleInput = `Step A + Step B (combined, shown in two sequential screens)
Modalities: mix of guided breathing, short audio, textbox, storyboard, slides, image
Instruction: Combine both steps into one flow, but break the UX into two sequential steps/screens. Each screen should have at least 6 distinct UX elements and at least one multimodal path (e.g., audio + text, visual + text). Use diverse UX types across the two screens, and make every element feel personalized to the user conversation. Add framing, 3–4 micro-prompts, progress cues, a short audio or voice option, a visual (image/storyboard/slides), and a closing reflection. Each screen should feel complete and guide the user forward.
Elements to include: a voice input element and a photo input/upload element (call these out clearly).
Minutes: 8–12
Evidence requirement: Specify if photo is needed or if a text note is enough.
Modules: heading, timed_cues, short_audio, textbox, storyboard, image, timer, mcq`;

type UxSpec = {
  title: string;
  modalities: string[];
  instruction: string;
  minutes: number | null;
  evidence: string;
  modules: string[];
  steps?: string[];
  moduleInputs?: Array<Record<string, any>>;
  candidates?: Array<any>;
};

type ModuleConfig = {
  id: string;
  label: string;
  role: string;
  params: string[];
};
type ModuleInstance = ModuleConfig & Record<string, any> & { _idx: number };

type GeneratedMedia = {
  audioUrl?: string;
  audioSource?: string;
  audioDurationSeconds?: number;
  audioScript?: string;
  audioTone?: string;
  voicePitch?: number;
  voiceRate?: number;
  musicPrompt?: string;
  musicChoice?: string;
  audioPurpose?: string;
  audioRationale?: string;
  imageUrl?: string;
  videoUrls?: string[];
  videoScript?: string[];
  videoPrompts?: string[];
  videoRationale?: string;
  videoAudioUrl?: string;
  videoAudioDurationSeconds?: number;
  timerSteps?: Array<{ label?: string; duration_seconds?: number }>;
  timerScript?: string;
  timerAudioUrl?: string;
  timerAudioSource?: string;
  timerAudioDurationSeconds?: number;
  timerRationale?: string;
  storyboardFrames?: string[];
  storyboardImages?: string[];
  storyboardRationale?: string;
  textQuestion?: string;
  textPlaceholder?: string;
  mcqQuestion?: string;
  mcqOptions?: string[];
  mcqAllowMultiple?: boolean;
  qaRationale?: string;
};

const normalizeGeneratedMedia = (media?: Partial<GeneratedMedia> | null): Partial<GeneratedMedia> => {
  if (!media || typeof media !== "object") return {};
  const next: Partial<GeneratedMedia> = { ...media };
  if (typeof next.imageUrl === "string") next.imageUrl = toAbsoluteMediaUrl(next.imageUrl);
  if (typeof next.audioUrl === "string") next.audioUrl = toAbsoluteMediaUrl(next.audioUrl);
  if (typeof next.videoAudioUrl === "string") next.videoAudioUrl = toAbsoluteMediaUrl(next.videoAudioUrl);
  if (typeof next.timerAudioUrl === "string") next.timerAudioUrl = toAbsoluteMediaUrl(next.timerAudioUrl);
  if (Array.isArray(next.videoUrls)) {
    next.videoUrls = next.videoUrls.map((url) => toAbsoluteMediaUrl(url)).filter(Boolean);
  }
  if (Array.isArray(next.storyboardImages)) {
    next.storyboardImages = next.storyboardImages.map((url) => toAbsoluteMediaUrl(url)).filter(Boolean);
  }
  return next;
};

const MODULES: ModuleConfig[] = [
  { id: "heading", label: "Heading text", role: "Context/section title", params: ["Text"] },
  { id: "textbox", label: "Textbox", role: "User input (text or voice capture)", params: ["Placeholder", "Helper text", "Allow voice input"] },
  { id: "list_textbox", label: "List textbox", role: "Repeatable text inputs", params: ["Prompt", "Items (label + placeholder)"] },
  { id: "mcq", label: "Multiple choice question", role: "Single or multi select", params: ["Question", "Options", "Allow multiple"] },
  { id: "short_audio", label: "Short audio", role: "Play a clip", params: ["Prompt/script", "Tone", "Voice", "Allow user recording"] },
  { id: "voice_input", label: "Voice input", role: "Capture spoken reflections", params: ["Prompt"] },
  { id: "photo_input", label: "Photo input", role: "Upload/attach a photo", params: ["Prompt", "Accept camera/gallery"] },
  { id: "chatbot", label: "Chatbot", role: "Guided GPT chat", params: ["Persona", "First prompt", "Conversation state"] },
  { id: "image", label: "Image", role: "Visual cue", params: ["Prompt", "Alt text"] },
  { id: "storyboard", label: "Storyboard slides", role: "2–4 cards", params: ["Card prompts", "Overlay text"] },
  { id: "dalle_video", label: "Dalle video", role: "4-beat visual + captions", params: ["Per-beat prompts", "Captions"] },
  { id: "timer", label: "Timer", role: "Countdown with chimes", params: ["Seconds"] },
  { id: "timed_cues", label: "Timed cues", role: "Paced steps", params: ["Steps (label+seconds)", "Script text"] },
];

const numberWords = ["one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen"];
const splitScriptWords = (text: string) => {
  const tokens: Array<{ word: string; start: number }> = [];
  const regex = /(\d+|[A-Za-z']+)/g;
  let match;
  while ((match = regex.exec(text))) {
    tokens.push({ word: match[0], start: match.index });
  }
  return tokens;
};

const parseSteps = (instruction?: string, explicit?: string[]): string[] => {
  if (explicit && explicit.length) return explicit;
  if (!instruction) return [];
  const lines = instruction
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const numbered = lines
    .filter((l) => /^\d+[\).\s]/.test(l))
    .map((l) => l.replace(/^\d+[\).\s]*/, "").trim())
    .filter(Boolean);
  if (numbered.length) return numbered;
  const bullets = lines
    .filter((l) => /^[-•]/.test(l))
    .map((l) => l.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
  if (bullets.length) return bullets;
  const sentences = instruction
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6);
  return sentences.slice(0, 6);
};

const sanitizeQaSummary = (text?: string) => {
  if (!text) return "";
  const stripped = text.replace(/^\(\d+\)\s*/, "").replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();
  const firstClause = stripped.split(/ or | and | then | to /i)[0] || stripped;
  return (firstClause || stripped).slice(0, 120);
};

const formatSeconds = (secs: number) => {
  if (!Number.isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(1, "0");
  const s = Math.floor(secs % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
};

const parseMinutesFromText = (text: string) => {
  const match = text.match(/(\d+(\.\d+)?)\s*(min|minutes?)/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
};

const relativeLuminance = (r: number, g: number, b: number) => {
  const normalize = (v: number) => {
    const srgb = v / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * normalize(r) + 0.7152 * normalize(g) + 0.0722 * normalize(b);
};

const contrastRatio = (l1: number, l2: number) => {
  const high = Math.max(l1, l2);
  const low = Math.min(l1, l2);
  return (high + 0.05) / (low + 0.05);
};

const buildStructuredFromDescription = (desc: string): string => {
  const trimmed = desc.trim();
  const steps = parseSteps(trimmed);
  const minutes = parseMinutesFromText(trimmed) || 3;
  const evidence = (() => {
    const match = trimmed.match(/evidence\s*:\s*(.+)$/i);
    return match ? match[1].trim() : "One short note on what changed.";
  })();
  const title = (() => {
    const line = trimmed.split(/\n/).map((l) => l.trim()).find(Boolean) || "UX concept";
    return line.replace(/^[#*\d\.\-\s]+/, "").slice(0, 80) || "UX concept";
  })();
  const lower = trimmed.toLowerCase();
  const modules: Array<Record<string, any>> = [{ id: "heading", text: title }];
  const wantsVideo = /video|visual|dalle/.test(lower);
  const wantsStoryboard = /storyboard|slide/.test(lower);
  const wantsAudio = /audio|voice|tts/.test(lower);
  const wantsTimer = /timer|countdown/.test(lower);
  const wantsTimedCues = /breathe|cue|inhale|exhale/.test(lower);
  const wantsChoice = /choose|select|pick/.test(lower);
  const wantsActions = /action|option|tap/.test(lower);
  const wantsText = /question|reflect|note|journal/.test(lower);

  if (wantsVideo) {
    modules.push({
      id: "dalle_video",
      prompts: steps.slice(0, 4).map((s, idx) => `Frame ${idx + 1}: ${s}`),
      script: steps.slice(0, 4).map((s) => s.slice(0, 140)),
    });
  }
  if (wantsStoryboard) {
    modules.push({
      id: "storyboard",
      frames: steps.slice(0, 4).map((s, idx) => `Card ${idx + 1}: ${s}`),
    });
  }
  if (wantsTimedCues) modules.push({ id: "timed_cues" });
  if (wantsAudio) modules.push({ id: "short_audio" });
  if (wantsTimer) modules.push({ id: "timer", seconds: minutes * 60 });
  if (wantsText || (!wantsChoice && !wantsActions)) {
    modules.push({ id: "textbox", question: "What stood out for you?", placeholder: "Write one line…" });
  }
  if (wantsChoice) {
    modules.push({
      id: "mcq",
      question: "Pick a focus",
      options: ["Breath", "Thought", "Move"],
      allow_multiple: false,
    });
  }
  if (wantsActions) {
    modules.push({
      id: "mcq",
      question: "Try one action",
      options: ["Quick breath", "Rephrase thought", "Stretch neck"],
      allow_multiple: true,
    });
  }

  const spec = {
    title,
    minutes,
    evidence,
    instruction: trimmed.slice(0, 800),
    modules,
    steps: steps,
  };
  return JSON.stringify(spec, null, 2);
};

const parseSpec = (text: string): UxSpec => {
  // allow structured JSON-like input for reliability
  try {
    const parsedJson = JSON.parse(text);
    if (parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)) {
      const title = (parsedJson.title || parsedJson.name || "UX concept").toString();
      const instruction = (parsedJson.instruction || parsedJson.description || parsedJson.brief || "Describe the task briefly.").toString();
      const minutes = Number.isFinite(parsedJson.minutes) ? Number(parsedJson.minutes) : null;
      const evidence = (parsedJson.evidence || parsedJson.evidence_requirement || "No evidence required.").toString();
      const candidates = Array.isArray((parsedJson as any).candidates) ? (parsedJson as any).candidates : [];
      const modalities = Array.isArray(parsedJson.modalities)
        ? parsedJson.modalities.map((m: any) => String(m)).filter(Boolean)
        : ((parsedJson.modality || parsedJson.modalities || "") as string)
            .split(/[,/]| or | OR /i)
            .map((m: string) => m.trim())
            .filter(Boolean);
      const normalizeModuleId = (raw: any) => {
        const id = String(raw || "").toLowerCase();
        if (id === "radiobutton") return "mcq";
        if (id === "multi_button") return "mcq";
        return id;
      };
      const modules = Array.isArray(parsedJson.modules)
        ? parsedJson.modules
            .map((m: any) => (m && typeof m === "object" && "id" in m ? (m as any).id : m))
            .map((m: any) => normalizeModuleId(m))
            .filter(Boolean)
        : ((parsedJson.modules || "") as string)
            .split(/[,/]/)
            .map((m: string) => normalizeModuleId(m.trim()))
            .filter(Boolean);
      const activityGoalFallback = instruction || title || "complete this step with practical support";
      const moduleInputs = Array.isArray(parsedJson.modules)
        ? parsedJson.modules
            .map((m: any) => {
              if (!(m && typeof m === "object" && "id" in m)) return null;
              const rawId = String((m as any).id || "").toLowerCase();
              if (rawId === "radiobutton") {
                console.log("[ux-generator] mcq normalize", { from: "radiobutton", allow_multiple: false });
                return { ...m, id: "mcq", allow_multiple: false };
              }
              if (rawId === "multi_button") {
                console.log("[ux-generator] mcq normalize", { from: "multi_button", allow_multiple: true });
                return { ...m, id: "mcq", allow_multiple: true };
              }
              if (rawId === "chatbot") {
                const goalText = String(
                  (m as any).goal ||
                    (m as any).purpose ||
                    (m as any).prompt ||
                    activityGoalFallback ||
                    ""
                )
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 220);
                const hasPersona =
                  typeof (m as any).persona === "string" && (m as any).persona.trim().length > 0;
                const hasFirstPrompt =
                  typeof (m as any).first_prompt === "string" &&
                  (m as any).first_prompt.trim().length > 0;
                return {
                  ...m,
                  id: "chatbot",
                  persona: hasPersona
                    ? (m as any).persona
                    : `You are a calm, concise helper focused on this activity goal: ${goalText || "help the user complete the step"}. Keep guidance practical, brief, and supportive.`,
                  first_prompt: hasFirstPrompt
                    ? (m as any).first_prompt
                    : `Greet the user briefly, state your role for this activity, and offer the first concrete step toward this goal: ${goalText || "help the user complete the step"}.`,
                };
              }
              return m;
            })
            .filter(Boolean)
        : undefined;
      const steps = Array.isArray(parsedJson.steps)
        ? parsedJson.steps
            .map((s: any) => (s && typeof s === "object" && "text" in s ? (s as any).text : s))
            .map((s: any) => String(s).trim())
            .filter(Boolean)
        : undefined;
      return {
        title: title || "UX concept",
        modalities: modalities.length ? modalities : ["Any"],
        instruction,
        minutes,
        evidence,
        modules,
        steps,
        candidates,
        moduleInputs,
      };
    }
  } catch {}

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const titleLine = lines.find((l) => /^\d+\./.test(l)) || lines[0] || "UX concept";
  const title = titleLine.replace(/^\d+\.\s*/, "").trim();
  const modalitiesLine = lines.find((l) => /^Modalities:/i.test(l)) || "";
  const modulesLine = lines.find((l) => /^Modules:/i.test(l)) || "";
  const instructionLine = lines.find((l) => /^Instruction:/i.test(l)) || "";
  const minutesLine = lines.find((l) => /^Minutes:/i.test(l)) || "";
  const evidenceLine = lines.find((l) => /^Evidence requirement:/i.test(l)) || "";
  const modalities = modalitiesLine
    .replace(/^Modalities:/i, "")
    .split(/[,/]| or | OR /i)
    .map((m) => m.trim())
    .filter(Boolean);
  const minutes = (() => {
    const match = minutesLine.match(/(\d+(\.\d+)?)/);
    if (!match) return null;
    const num = Number(match[1]);
    return Number.isFinite(num) ? num : null;
  })();
  return {
    title: title || "UX concept",
    modalities: modalities.length ? modalities : ["Any"],
    instruction: instructionLine.replace(/^Instruction:/i, "").trim() || "Describe the task briefly.",
    minutes,
    evidence: evidenceLine.replace(/^Evidence requirement:/i, "").trim() || "No evidence required.",
    modules: modulesLine
      .replace(/^Modules:/i, "")
      .split(/[,/]/)
      .map((m) => {
        const id = m.trim().toLowerCase();
        if (id === "radiobutton") return "mcq";
        if (id === "multi_button") return "mcq";
        return id;
      })
      .filter(Boolean),
  };
};

const SpokenCounter = ({
  word,
  number,
  displayCount,
  pulse,
  icon,
  showMotion,
}: {
  word: string | null;
  number: number | null;
  displayCount: number;
  pulse: Animated.Value;
  icon: string;
  showMotion?: boolean;
}) => {
  const motionScale = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(motionScale, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(motionScale, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    if (showMotion) {
      loop.start();
    } else {
      motionScale.setValue(0);
      loop.stop();
    }
    return () => loop.stop();
  }, [motionScale, showMotion]);
  const blobScale = motionScale.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.05] });
  const blobOpacity = motionScale.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.35] });
  return (
    <View style={styles.spokenCounter}>
      <View style={styles.spokenMotionWrap}>
        <Animated.View
          style={[
            styles.spokenMotionBlob,
            {
              transform: [{ scale: blobScale }],
              opacity: blobOpacity,
            },
          ]}
        />
        <Animated.View style={[styles.spokenNumberWrap, { transform: [{ scale: pulse }] }]}>
          <Text style={styles.spokenNumberIcon}>{icon}</Text>
          <Text style={styles.spokenNumber}>{displayCount}</Text>
        </Animated.View>
      </View>
      <Text style={styles.spokenWord}>{word || "—"}</Text>
      <Text style={styles.spokenHeard}>Heard: {number != null ? number : "—"}</Text>
    </View>
  );
};

// Simple calming motion for the pared-down timed_cues view
const CalmingMotionLite = ({ active = false }: { active?: boolean }) => {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      pulse.stopAnimation?.();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [active, pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.5] });
  return (
    <View style={styles.calmingMotion}>
      <Animated.View style={[styles.calmingBlob, { transform: [{ scale }], opacity }]} />
      <Animated.View style={[styles.calmingBlobInner, { transform: [{ scale }], opacity: opacity.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.22] }) }]} />
      <Text style={styles.calmingMotionLabel}>
        {active ? "Breathe with this rhythm" : "Press Play to begin"}
      </Text>
    </View>
  );
};

export default function UxGeneratorScreen({
  showInputs = false,
  onToggleInputs,
  onComplete,
  defaultDescription,
  backgroundImage,
  conversationContext,
  sessionId,
  stepIndex,
  preStructuredSpec,
  autoGenerate = false,
  onMediaReady,
  preGeneratedMedia,
  onPrevExit,
  moodEmotions,
  moodOther,
  paperMode = false,
}: {
  showInputs?: boolean;
  onToggleInputs?: () => void;
  onComplete?: () => void;
  defaultDescription?: string;
  backgroundImage?: string;
  conversationContext?: string;
  sessionId?: string;
  stepIndex?: number;
  preStructuredSpec?: string;
  autoGenerate?: boolean;
  onMediaReady?: () => void;
  preGeneratedMedia?: Partial<GeneratedMedia>;
  onPrevExit?: () => void;
  moodEmotions?: string;
  moodOther?: string;
  paperMode?: boolean;
}) {
  const stopAllAudio = useCallback(() => {
    // Top-level screen doesn't own child audio refs; stop any active web audio tags.
    if (Platform.OS === "web" && typeof document !== "undefined") {
      try {
        const nodes = document.querySelectorAll("audio");
        nodes.forEach((node) => {
          try {
            node.pause();
            node.currentTime = 0;
          } catch {}
        });
      } catch {}
    }
    if (typeof window !== "undefined" && (window as any).speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
  }, []);
  const [specText, setSpecText] = useState<string>(preStructuredSpec || sampleInput);
  const [descriptionText, setDescriptionText] = useState<string>(defaultDescription || sampleInput);
  const [version, setVersion] = useState<number>(0);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [media, setMedia] = useState<GeneratedMedia>(normalizeGeneratedMedia(preGeneratedMedia) as GeneratedMedia);
  const [generating, setGenerating] = useState<boolean>(false);
  const [userTriggeredGenerate, setUserTriggeredGenerate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moduleResponsesByKey, setModuleResponsesByKey] = useState<Record<number, any>>({});
  const moduleResponsesRef = useRef<Record<number, any>>({});
  const hasHydratedRef = useRef(false);
  const [flowStateReady, setFlowStateReady] = useState(false);
  const withSession = useCallback(
    (body: Record<string, any>) =>
      sessionId && sessionId.trim() ? { ...body, sessionId: sessionId.trim() } : body,
    [sessionId]
  );
  const handleModuleInputCapture = useCallback((key: number, payload: any) => {
    setModuleResponsesByKey((prev) => {
      if (prev[key] === payload) return prev;
      return { ...prev, [key]: payload };
    });
  }, []);

  useEffect(() => {
    moduleResponsesRef.current = moduleResponsesByKey;
  }, [moduleResponsesByKey]);
  const handleAutoStructure = useCallback(() => {
    const structured = buildStructuredFromDescription(descriptionText || specText);
    console.log("[ux-generator] auto-structured spec", structured);
    setSpecText(structured);
    setVersion((v) => v + 1);
  }, [descriptionText, specText]);
  const handleAutoStructureWithGpt = useCallback(async () => {
    try {
      const summary = (descriptionText || specText || "").slice(0, 800);
      console.log("[ux-generator] llm-structure start", { summary });
      const resp = await fetch(`${API_BASE}/dev/stress-support/intervention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withSession({
          summary,
          formats: ["planner"],
        })),
      });
      console.log("[ux-generator] llm-structure status", resp.status);
      const dataText = await resp.text();
      if (!resp.ok) {
        console.warn("[ux-generator] planner response not ok", resp.status, dataText?.slice?.(0, 200));
        throw new Error(`Planner request failed ${resp.status}: ${dataText?.slice?.(0, 200)}`);
      }
      let data: any = {};
      try {
        data = JSON.parse(dataText);
      } catch (e) {
        throw new Error("Planner response not JSON");
      }
      if (data?.debug_log) {
        console.log("[ux-generator] planner debug", data.debug_log);
      }
      const spec = data?.spec;
      if (spec && typeof spec === "object") {
        const structured = JSON.stringify(spec, null, 2);
        console.log("[ux-generator] llm-structure spec", structured);
        setSpecText(structured);
        setVersion((v) => v + 1);
        return;
      }
      console.warn("[ux-generator] planner spec missing", data);
      throw new Error("Planner spec missing");
    } catch (err: any) {
      console.warn("[ux-generator] llm-structure failed", err);
      // do not silently fallback; surface the error in structured spec for debugging
      const structured = JSON.stringify(
        {
          title: "Planner error",
          instruction: descriptionText || specText,
          explanation: err?.message || "Planner request failed",
        },
        null,
        2
      );
      setSpecText(structured);
      setVersion((v) => v + 1);
    }
  }, [descriptionText, specText]);

  const parsed = useMemo(() => parseSpec(specText), [specText, version]);
  useEffect(() => {
    console.log("[ux-generator] parsed spec", {
      title: parsed.title,
      minutes: parsed.minutes,
      modules: parsed.modules,
      moduleInputs: parsed.moduleInputs,
      steps: parsed.steps,
    });
  }, [parsed.title, parsed.minutes, parsed.modules, parsed.moduleInputs, parsed.steps]);
  useEffect(() => {
    // keep description seeded from provided default or parsed when using defaults
    if (!descriptionText || descriptionText === sampleInput) {
      if (defaultDescription) {
        setDescriptionText(defaultDescription);
      } else {
        setDescriptionText(parsed.instruction || parsed.title || sampleInput);
      }
    }
  }, [defaultDescription, parsed.instruction, parsed.title]);
  useEffect(() => {
    if (preStructuredSpec && preStructuredSpec !== specText) {
      console.log("[ux-generator] preStructuredSpec received", {
        length: preStructuredSpec.length,
      });
      setSpecText(preStructuredSpec);
      setVersion((v) => v + 1);
    }
  }, [preStructuredSpec, specText]);
  useEffect(() => {
    if (preGeneratedMedia && Object.keys(preGeneratedMedia).length) {
      setMedia((prev) => ({ ...normalizeGeneratedMedia(preGeneratedMedia), ...prev }));
    }
  }, [preGeneratedMedia]);
  const [useLightOnImageText, setUseLightOnImageText] = useState(false);
  useEffect(() => {
    const src = toAbsoluteMediaUrl(backgroundImage);
    if (!src || Platform.OS !== "web") {
      setUseLightOnImageText(false);
      return;
    }
    let cancelled = false;
    const HtmlImage = (globalThis as any).Image;
    if (!HtmlImage) {
      setUseLightOnImageText(false);
      return;
    }
    const img = new HtmlImage();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const sampleW = 64;
        const sampleH = 48;
        const canvas = document.createElement("canvas");
        canvas.width = sampleW;
        canvas.height = sampleH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setUseLightOnImageText(false);
          return;
        }
        ctx.drawImage(img, 0, 0, sampleW, sampleH);
        const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
        let lumSum = 0;
        let count = 0;
        // Sample top-biased region where most instruction text appears.
        for (let y = 0; y < sampleH; y += 2) {
          for (let x = 0; x < sampleW; x += 2) {
            if (y > sampleH * 0.72) continue;
            const i = (y * sampleW + x) * 4;
            lumSum += relativeLuminance(data[i], data[i + 1], data[i + 2]);
            count += 1;
          }
        }
        const avgLum = count > 0 ? lumSum / count : 0.65;
        const lightContrast = contrastRatio(0.97, avgLum); // near-white text
        const darkContrast = contrastRatio(0.05, avgLum); // near-black text
        // Bias toward light text for image-backed screens unless contrast would be too weak.
        const preferLight = lightContrast >= 3.2 || lightContrast + 0.9 >= darkContrast;
        setUseLightOnImageText(preferLight);
      } catch {
        // If sampling fails (CORS/canvas restrictions), use light-on-image fallback.
        setUseLightOnImageText(true);
      }
    };
    img.onerror = () => {
      if (!cancelled) setUseLightOnImageText(true);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [backgroundImage]);
  const imageOverlayColors = useMemo<readonly [string, string, ...string[]]>(() => {
    if (!backgroundImage) {
      return ["rgba(244,248,255,0.28)", "rgba(247,251,255,0.36)", "rgba(250,252,255,0.44)"];
    }
    // Keep the background image consistently darker, closer to the intervention-card look.
    return ["rgba(2,6,23,0.7)", "rgba(2,6,23,0.62)", "rgba(2,6,23,0.52)"];
  }, [backgroundImage]);
  const suggestedModules = useMemo(() => {
    const ensureCore = (arr: string[]) => {
      const next = [...arr];
      if (!next.includes("voice_input")) next.push("voice_input");
      if (!next.includes("photo_input")) next.push("photo_input");
      return next;
    };

    if (parsed.modules.length) return ensureCore(parsed.modules);
    const hits: string[] = [];
    const text = specText.toLowerCase();
    MODULES.forEach((m) => {
      const key = m.id;
      if (text.includes(key) || text.includes(m.label.toLowerCase())) hits.push(key);
    });
    const base = hits.length ? hits : ["heading", "textbox"];
    return ensureCore(base);
  }, [parsed.modules, specText]);
  const mediaReady = useMemo(() => {
    const needsAudio = suggestedModules.includes("short_audio");
    const needsImage = suggestedModules.includes("image");
    const needsStoryboard = suggestedModules.includes("storyboard");
    const needsVideo = suggestedModules.includes("dalle_video");
    const needsTimed = suggestedModules.includes("timed_cues");

    const audioReady = !needsAudio || Boolean(media.audioScript || media.audioUrl);
    const imageReady = !needsImage || Boolean(media.imageUrl);
    const storyboardReady =
      !needsStoryboard ||
      Boolean((media.storyboardFrames && media.storyboardFrames.length) || (media.storyboardImages && media.storyboardImages.length));
    const videoReady =
      !needsVideo || Boolean((media.videoUrls && media.videoUrls.length) || (media.videoPrompts && media.videoPrompts.length));
    const timedReady =
      !needsTimed || Boolean((media.timerSteps && media.timerSteps.length) || media.timerAudioUrl || media.timerScript);

    return audioReady && imageReady && storyboardReady && videoReady && timedReady;
  }, [suggestedModules, media]);
  const mediaReadyRef = useRef(false);
  useEffect(() => {
    if (!mediaReady || mediaReadyRef.current) return;
    if (generating) return;
    mediaReadyRef.current = true;
    console.log("[ux-generator] media ready");
    onMediaReady?.();
  }, [mediaReady, generating, onMediaReady]);
  const moduleStack = useMemo<ModuleInstance[]>(() => {
    const base =
      parsed.moduleInputs && parsed.moduleInputs.length
        ? parsed.moduleInputs
        : parsed.modules && parsed.modules.length
        ? parsed.modules.map((id) => ({ id }))
        : suggestedModules.map((id) => ({ id }));
    return base.map((m: any, idx) => ({
      id: typeof m?.id === "string" ? m.id : "",
      ...m,
      _idx: idx,
    }));
  }, [parsed.moduleInputs, parsed.modules, suggestedModules]);
  const moduleScreens = useMemo(() => {
    const split = Math.ceil(moduleStack.length / 2) || 1;
    return [moduleStack.slice(0, split), moduleStack.slice(split)].filter((group) => group.length);
  }, [moduleStack]);
  const stepDescriptions = useMemo(() => {
    const steps = Array.isArray(parsed.steps) ? parsed.steps.filter((s) => typeof s === "string" && s.trim()) : [];
    if (steps.length) return steps;
    if (parsed.instruction) return [parsed.instruction];
    return ["Follow the guided flow below to complete this activity."];
  }, [parsed.steps, parsed.instruction]);
  const includeTags = useMemo(() => {
    const tags: string[] = [];
    const ids = new Set(moduleStack.map((m) => m.id));
    if (ids.has("short_audio") || ids.has("timed_cues")) tags.push("Audio");
    if (ids.has("voice_input") || ids.has("textbox") || ids.has("list_textbox")) tags.push("Reflection");
    if (ids.has("image") || ids.has("storyboard") || ids.has("dalle_video")) tags.push("Visual");
    if (ids.has("timer")) tags.push("Timer");
    return tags.slice(0, 3);
  }, [moduleStack]);
  const autoCompleteIds = useMemo(
    () => new Set(["heading", "stepper", "instruction", "text", "paragraph", "label"]),
    []
  );
  const isAutoComplete = useCallback((id?: string) => (id ? autoCompleteIds.has(id) : false), [
    autoCompleteIds,
  ]);
  const [moduleCompletion, setModuleCompletion] = useState<Record<number, boolean>>({});
  const [showErrors, setShowErrors] = useState(false);
  useEffect(() => {
    setModuleCompletion({});
    setShowErrors(false);
  }, [version, parsed.title, parsed.instruction, parsed.modules, parsed.moduleInputs]);
  const handleModuleCompletion = useCallback((idx: number, complete: boolean) => {
    setModuleCompletion((prev) => (prev[idx] === complete ? prev : { ...prev, [idx]: complete }));
  }, []);
  const [activeScreen, setActiveScreen] = useState(0);
  useEffect(() => {
    setActiveScreen(0);
  }, [version, parsed.title, parsed.instruction, parsed.modules, parsed.moduleInputs]);
  useEffect(() => {
    setActiveScreen((s) => {
      const maxIdx = Math.max(0, (moduleScreens.length || 1) - 1);
      return Math.min(s, maxIdx);
    });
  }, [moduleScreens.length]);
  useEffect(() => {
    hasHydratedRef.current = false;
    setFlowStateReady(false);
  }, [sessionId, stepIndex]);
  useEffect(() => {
    if (hasHydratedRef.current) return;
    if (!sessionId || stepIndex == null) {
      hasHydratedRef.current = true;
      setFlowStateReady(true);
      return;
    }
    const cached = getFlowState(sessionId);
    const entry =
      cached?.uxByStepIndex && cached.uxByStepIndex[String(stepIndex)]
        ? cached.uxByStepIndex[String(stepIndex)]
        : null;
    if (entry) {
      if (entry.moduleResponsesByKey && typeof entry.moduleResponsesByKey === "object") {
        const normalized: Record<number, any> = {};
        Object.entries(entry.moduleResponsesByKey).forEach(([key, value]) => {
          const num = Number(key);
          if (!Number.isNaN(num)) normalized[num] = value;
        });
        setModuleResponsesByKey(normalized);
      }
      if (entry.moduleCompletion && typeof entry.moduleCompletion === "object") {
        const normalized: Record<number, boolean> = {};
        Object.entries(entry.moduleCompletion).forEach(([key, value]) => {
          const num = Number(key);
          if (!Number.isNaN(num)) normalized[num] = Boolean(value);
        });
        setModuleCompletion(normalized);
      }
      if (typeof entry.activeScreen === "number") {
        setActiveScreen((s) => {
          const maxIdx = Math.max(0, (moduleScreens.length || 1) - 1);
          return Math.min(Math.max(0, entry.activeScreen), maxIdx);
        });
      }
    }
    hasHydratedRef.current = true;
    setFlowStateReady(true);
  }, [moduleScreens.length, sessionId, stepIndex]);
  useEffect(() => {
    if (!flowStateReady) return;
    if (!sessionId || stepIndex == null) return;
    updateFlowState(sessionId, {
      uxByStepIndex: {
        [String(stepIndex)]: {
          activeScreen,
          moduleResponsesByKey,
          moduleCompletion,
        },
      },
    });
  }, [activeScreen, flowStateReady, moduleCompletion, moduleResponsesByKey, sessionId, stepIndex]);
  const currentScreenComplete = useMemo(() => {
    const current = moduleScreens[activeScreen] || [];
    if (!current.length) return true;
    return current.every((m: any) => isAutoComplete(m.id) || moduleCompletion[m._idx]);
  }, [moduleCompletion, moduleScreens, activeScreen, isAutoComplete]);
  useEffect(() => {
    setShowErrors(false);
  }, [activeScreen]);
  useEffect(() => {
    if (currentScreenComplete) setShowErrors(false);
  }, [currentScreenComplete]);
  const validateCurrentScreen = useCallback(() => {
    const current = moduleScreens[activeScreen] || [];
    const hasIncomplete = current.some((m: any) => {
      if (isAutoComplete(m.id)) return false;
      return !moduleCompletion[m._idx];
    });
    setShowErrors(hasIncomplete);
    if (hasIncomplete) {
      console.log("[ux-generator] screen incomplete", {
        screen: activeScreen,
        incomplete_modules: current
          .filter((m: any) => (isAutoComplete(m.id) ? false : !moduleCompletion[m._idx]))
          .map((m: any) => m.id),
      });
    }
    return !hasIncomplete;
  }, [moduleScreens, activeScreen, moduleCompletion, isAutoComplete]);

  const buildUxSubmission = useCallback(() => {
    const responses = moduleStack.map((mod) => {
      const entry = moduleResponsesRef.current[mod._idx] || {};
      return {
        module_index: mod._idx,
        module_id: mod.id,
        ...entry,
      };
    });
    const resolvePrompt = (mod: any) => {
      if (typeof mod?.question === "string" && mod.question.trim()) return mod.question.trim();
      if (mod.id === "textbox") return media.textQuestion || "Your response";
      if (mod.id === "mcq") return media.mcqQuestion || "Choose one option";
      if (mod.id === "voice_input") return mod.prompt || "Record a short voice note.";
      if (mod.id === "photo_input") return mod.prompt || "Upload a photo.";
      if (mod.id === "chatbot") return mod.prompt || "Chat here.";
      if (mod.id === "timer") return mod.prompt || "Complete the timer and reflect.";
      if (mod.id === "timed_cues") return mod.prompt || "Follow the timed cues.";
      return mod.label || mod.id || "";
    };
    const resolveOptions = (mod: any) => {
      if (Array.isArray(mod?.options) && mod.options.length) return mod.options;
      if (mod.id === "mcq" && Array.isArray(media.mcqOptions)) return media.mcqOptions;
      if (mod.id === "list_textbox" && Array.isArray(mod?.items)) return mod.items.map((i: any) => i?.label).filter(Boolean);
      return [];
    };
    const modules = moduleStack.map((mod) => ({
      module_index: mod._idx,
      id: mod.id,
      prompt: resolvePrompt(mod),
      options: resolveOptions(mod),
      placeholder: mod?.placeholder || null,
      raw: mod,
    }));
    const mediaPayload = {
      audio_script: media.audioScript,
      audio_url: media.audioUrl,
      audio_tone: media.audioTone,
      image_url: media.imageUrl,
      storyboard_frames: media.storyboardFrames,
      storyboard_images: media.storyboardImages,
      video_prompts: media.videoPrompts,
      video_script: media.videoScript,
      video_urls: media.videoUrls,
      video_audio_url: media.videoAudioUrl,
      timer_steps: media.timerSteps,
      timer_script: media.timerScript,
      timer_audio_url: media.timerAudioUrl,
    };
    return {
      spec: parsed,
      modules,
      responses,
      media: mediaPayload,
      mood_emotions: moodEmotions
        ? (() => {
            try {
              return JSON.parse(moodEmotions);
            } catch {
              return moodEmotions;
            }
          })()
        : null,
      mood_other: moodOther || null,
    };
  }, [moduleStack, media, parsed, moodEmotions, moodOther]);

  const submissionInFlightRef = useRef(false);
  const submitUxSubmission = useCallback(async () => {
    if (!sessionId || !sessionId.trim()) {
      console.warn("[ux-generator] ux submission skipped: missing sessionId");
      return;
    }
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    try {
      const payload = buildUxSubmission();
      console.log("[ux-generator] ux submission POST", {
        sessionId,
        modules: Array.isArray(payload.modules) ? payload.modules.length : 0,
        responses: Array.isArray(payload.responses) ? payload.responses.length : 0,
      });
      await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/ux-submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn("[ux-generator] ux submission save failed", err);
    } finally {
      submissionInFlightRef.current = false;
    }
  }, [buildUxSubmission, sessionId]);

  const handleGenerate = useCallback(async () => {
    console.log("[ux-generator] generate start", {
      hasSpec: Boolean(parsed.title || parsed.modules?.length),
      modules: parsed.modules,
    });
    const steps = parseSteps(parsed.instruction, parsed.steps);
    const stepFor = (id: string) => {
      const idx = suggestedModules.findIndex((m) => m === id);
      if (idx >= 0 && steps[idx]) return steps[idx];
      if (steps.length) return steps[Math.min(steps.length - 1, Math.max(0, idx))] || steps[0];
      return parsed.instruction || parsed.title;
    };
    const getModuleInput = (id: string) => parsed.moduleInputs?.find((m) => (m as any).id === id) || null;
    const buildAudioScript = () => {
      const minutes = parsed.minutes || 2;
      const contextSnippet = conversationContext
        ? conversationContext.replace(/\s+/g, " ").trim().slice(0, 220)
        : "";
      const intro = contextSnippet
        ? `Based on what you shared (${contextSnippet}), take a slow breath. For about ${minutes} minutes, let's reset together.`
        : `Take a slow breath. For about ${minutes} minutes, let's reset together.`;
      const body = parsed.instruction || "Here's a short reassurance to help you unwind.";
      const evidence = parsed.evidence ? `When we're done, jot: ${parsed.evidence}` : "";
      const close = "You're doing enough. Take the next small step when you feel ready.";
      return [intro, body, evidence, close].filter(Boolean).join(" ");
    };

    setVersion((v) => v + 1);
    const now = new Date();
    setGeneratedAt(now);
    setError(null);
    setGenerating(true);
    setMedia({});
    console.log("[ux-generator] generate", {
      generatedAt: now.toISOString(),
      modalities: parsed.modalities,
      modules: suggestedModules,
      title: parsed.title,
      minutes: parsed.minutes,
      steps: steps,
      instruction: parsed.instruction?.slice?.(0, 160),
      moduleInputs: parsed.moduleInputs,
    });
    try {
      const next: GeneratedMedia = {};
      const needsAudio = suggestedModules.includes("short_audio");
      const needsImage = suggestedModules.some((m) => ["image", "storyboard"].includes(m));
      const needsVideo = suggestedModules.includes("dalle_video");
      const needsStoryboard = suggestedModules.includes("storyboard");
      const needsTimed = suggestedModules.includes("timed_cues");
      const moduleInputEntries: Array<[string, any]> = (parsed.moduleInputs || [])
        .filter((m: any) => typeof m?.id === "string")
        .map((m: any) => [m.id, m]);
      const moduleInputMap = new Map<string, any>(moduleInputEntries);
      const hasPlannerQa =
        Boolean(preStructuredSpec) ||
        moduleInputMap.has("textbox") ||
        moduleInputMap.has("mcq");
      const needsQa =
        !hasPlannerQa &&
        suggestedModules.some((m) => ["textbox", "mcq"].includes(m));

      if (needsQa) {
        const friendlyFallbackQuestion =
          "Which option fits best right now?";
        const fallbackOptions = [
          "Pause and breathe",
          "Write one sentence",
          "Pick one next step",
        ];
        const fetchQa = async (stepText: string | undefined, needOptions: boolean, needText: boolean) => {
          const summaryRaw = stepText || parsed.instruction || parsed.title || "Ask a quick check-in question";
          const summary = sanitizeQaSummary(summaryRaw);
          console.log("[ux-generator] qa fetch start", { summary, needOptions, needText, focus_step: stepText });
          const resp = await fetch(`${API_BASE}/dev/stress-support/intervention`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(withSession({
              summary,
              formats: ["text_prompt", "choices"],
              hints: {
                mode: "questions_and_choices",
                need_options: needOptions,
                need_text: needText,
                tone: "warm, brief, conversational",
                avoid_restating: true,
                ask_one_question: true,
                option_style: "concise, 3-5 words",
                focus_step: stepText || undefined,
              },
            })),
          });
          console.log("[ux-generator] qa intervention status", resp.status, { summary });
          if (!resp.ok) {
            throw new Error(`qa request failed ${resp.status}`);
          }
          const data = await resp.json();
          console.log("[ux-generator] qa raw assets", Array.isArray(data?.assets) ? data.assets.length : 0);
          const assets: any[] = Array.isArray(data?.assets) ? data.assets : [];
          const questionAsset = assets.find((a) => a.type === "text" || a.type === "prompt");
          const choiceAsset = assets.find((a) => a.type === "choices" || a.type === "options");
          const mergedQuestionRaw =
            questionAsset?.question ||
            questionAsset?.prompt ||
            questionAsset?.content ||
            choiceAsset?.question ||
            null;
          const mergedQuestion = (() => {
            const q = (mergedQuestionRaw || "").trim();
            if (!q) return friendlyFallbackQuestion;
            const generic = /^(choose|select|pick)\s+(one|an|a)\b/i;
            if (generic.test(q) || q.length < 12) return friendlyFallbackQuestion;
            const inst = (parsed.instruction || "").trim();
            const title = (parsed.title || "").trim();
            const looksLikeInstruction =
              !!inst && (q.toLowerCase() === inst.toLowerCase() || q.toLowerCase().includes(inst.toLowerCase()));
            const looksLikeTitle = !!title && q.toLowerCase().includes(title.toLowerCase());
            if (looksLikeInstruction || looksLikeTitle) return friendlyFallbackQuestion;
            return q;
          })();
          const options =
            choiceAsset?.options ||
            choiceAsset?.choices ||
            (Array.isArray(choiceAsset?.labels) ? choiceAsset.labels : null);
          const normalizedOptions =
            Array.isArray(options) ? options.map((opt: any) => String(opt || "").trim()).filter(Boolean) : [];
          const finalOptions = normalizedOptions.length >= 3 ? normalizedOptions.slice(0, 4) : fallbackOptions;
          const source = {
            question: mergedQuestion,
            options: finalOptions,
            placeholder: questionAsset?.placeholder || "Write a one-line note (optional)",
            rationale: questionAsset?.explanation || choiceAsset?.explanation,
            source: questionAsset || choiceAsset ? "llm" : "fallback",
          };
          console.log("[ux-generator] qa fetch resolved", {
            question_source: source.source,
            question: source.question,
            options: source.options,
          });
          return {
            question: mergedQuestion,
            options: finalOptions,
            placeholder: questionAsset?.placeholder || "Write a one-line note (optional)",
            rationale: questionAsset?.explanation || choiceAsset?.explanation,
          };
        };
        try {
          if (suggestedModules.includes("textbox")) {
            const stepText = stepFor("textbox");
            const provided = getModuleInput("textbox");
            if (provided?.question) next.textQuestion = String(provided.question);
            if (provided?.placeholder) next.textPlaceholder = String(provided.placeholder);
            const needsFetch = !next.textQuestion || !next.textPlaceholder;
            if (needsFetch) {
              const qa = await fetchQa(stepText, false, true);
              console.log("[ux-generator] qa textbox", qa);
              next.textQuestion = next.textQuestion || qa.question;
              next.textPlaceholder = next.textPlaceholder || qa.placeholder;
              if (qa.rationale) next.qaRationale = qa.rationale;
            } else {
              console.log("[ux-generator] qa textbox using planner-provided prompt", {
                question: next.textQuestion,
                placeholder: next.textPlaceholder,
              });
            }
          }
          if (suggestedModules.includes("mcq")) {
            const stepText = stepFor("mcq");
            const provided = getModuleInput("mcq");
            if (provided?.question) next.mcqQuestion = String(provided.question);
            if (Array.isArray(provided?.options)) {
              next.mcqOptions = provided.options.map((o: any) => String(o));
            }
            if (typeof provided?.allow_multiple === "boolean") {
              next.mcqAllowMultiple = provided.allow_multiple;
            }
            console.log("[ux-generator] mcq planner input", {
              question: next.mcqQuestion || null,
              options: next.mcqOptions || null,
              allow_multiple: next.mcqAllowMultiple,
            });
            const needsFetch = !next.mcqQuestion || !next.mcqOptions?.length;
            if (needsFetch) {
              const qa = await fetchQa(stepText, true, false);
              console.log("[ux-generator] qa mcq", qa);
              next.mcqQuestion = next.mcqQuestion || qa.question;
              next.mcqOptions = next.mcqOptions?.length ? next.mcqOptions : qa.options;
              if (qa.rationale && !next.qaRationale) next.qaRationale = qa.rationale;
              console.log("[ux-generator] mcq source", { module: "mcq", source: "llm" });
            } else {
              console.log("[ux-generator] qa mcq using planner-provided prompt", {
                question: next.mcqQuestion,
                options: next.mcqOptions,
                allow_multiple: next.mcqAllowMultiple,
              });
              console.log("[ux-generator] mcq source", { module: "mcq", source: "planner" });
            }
          }
        } catch (err) {
          console.warn("[ux-generator] qa generation failed", err);
          next.textQuestion = stepFor("textbox") || friendlyFallbackQuestion;
          next.mcqQuestion = stepFor("mcq") || friendlyFallbackQuestion;
          next.mcqOptions = fallbackOptions;
          next.textPlaceholder = "Write a one-line note (optional)";
          console.log("[ux-generator] qa fallback applied", {
            textQuestion: next.textQuestion,
            mcqQuestion: next.mcqQuestion,
            options: fallbackOptions,
          });
          console.log("[ux-generator] mcq source", { module: "mcq", source: "fallback" });
        }
      }
      if (needsAudio) {
        try {
          const contextSummary = conversationContext
            ? `User context: ${conversationContext}\nInstruction: Write a short audio script that explicitly acknowledges the user's situation and mentions at least one concrete detail from their context before offering support. End with a slightly longer, fully spoken closing sentence rather than a very short final line like "You've got this."\n${parsed.instruction || parsed.title || ""}`.trim()
            : `Instruction: Write a short audio script that explicitly acknowledges the user's situation and mentions at least one concrete detail from their context before offering support. End with a slightly longer, fully spoken closing sentence rather than a very short final line like "You've got this."\n${parsed.instruction || parsed.title || ""}`.trim();
          const resp = await fetch(`${API_BASE}/dev/stress-support/intervention`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(withSession({
              summary: contextSummary || "Calming reassurance",
              formats: ["short_audio"],
            })),
          });
          console.log("[ux-generator] short_audio intervention status", resp.status);
          const data = await resp.json();
          const asset =
            (Array.isArray(data?.assets) &&
              data.assets.find((a: any) => a.type === "audio" || a.type === "music" || a.type === "ambient")) ||
            null;
          const script = asset?.audio_script || buildAudioScript();
          console.log("[ux-generator] short_audio script source", {
            source: asset?.audio_script ? "asset" : "fallback",
            preview: script.slice(0, 200),
          });
          next.audioScript = script;
          next.audioTone = asset?.audio_tone;
          next.voicePitch = asset?.voice_pitch;
          next.voiceRate = asset?.voice_rate;
          next.musicPrompt = asset?.music_prompt;
          next.musicChoice = asset?.music_choice;
          next.audioPurpose = asset?.purpose;
          next.audioRationale = asset?.explanation;
          console.log("[ux-generator] short_audio asset", {
            hasScript: Boolean(script),
            tone: next.audioTone,
            pitch: next.voicePitch,
            rate: next.voiceRate,
            music: next.musicChoice,
          });
          const ttsResp = await fetch(TTS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: script,
              use_gpt_voice: true,
              style: "calm, human, grounded guidance",
              speed:
                typeof asset?.voice_rate === "number" && Number.isFinite(asset.voice_rate)
                  ? Math.min(1.3, Math.max(0.7, asset.voice_rate))
                  : 0.98,
            }),
          });
          console.log("[ux-generator] short_audio tts status", ttsResp.status);
          const ttsData = await ttsResp.json();
          if (ttsResp.ok && ttsData?.audio_url) {
            next.audioUrl = ttsData.audio_url;
            next.audioSource =
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
              next.audioDurationSeconds = Math.round(ttsData.duration_seconds);
            }
            console.log("[ux-generator] short_audio tts url", ttsData.audio_url?.slice?.(0, 80));
          console.log("[ux-generator] short_audio tts source", {
            voice_source: next.audioSource || "unknown",
            used_gpt_voice: Boolean(ttsData.used_gpt_voice),
            tts_api_version: ttsData?.tts_api_version || "missing",
          });
          }
        } catch (err) {
          console.warn("[ux-generator] short_audio generation failed", err);
          const script = buildAudioScript();
          console.log("[ux-generator] short_audio fallback script", {
            preview: script.slice(0, 200),
          });
          const resp = await fetch(TTS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: script,
              speed: 0.94,
              use_gpt_voice: true,
              style: "calm, human, grounded guidance",
            }),
          });
          const data = await resp.json();
          if (resp.ok && data?.audio_url) {
            next.audioUrl = data.audio_url;
            next.audioSource =
              data.voice_source === "gpt" || data.voice_source === "generic"
                ? data.voice_source
                : data.used_gpt_voice === true
                ? "gpt"
                : "unknown";
            if (
              typeof data?.duration_seconds === "number" &&
              Number.isFinite(data.duration_seconds) &&
              data.duration_seconds > 0
            ) {
              next.audioDurationSeconds = Math.round(data.duration_seconds);
            }
            next.audioScript = script;
            console.log("[ux-generator] short_audio fallback tts source", {
              voice_source: next.audioSource || "unknown",
              used_gpt_voice: Boolean(data?.used_gpt_voice),
              tts_api_version: data?.tts_api_version || "missing",
            });
          }
        }
      }
      if (needsImage) {
        const imageModuleInput =
          (parsed.moduleInputs || []).find((m: any) => m && m.id === "image") || null;
        const modulePrompt =
          typeof imageModuleInput?.prompt === "string" && imageModuleInput.prompt.trim()
            ? imageModuleInput.prompt.trim()
            : "";
        const chosenPrompt =
          modulePrompt ||
          "Create a supportive calming visual for this intervention activity with soft natural light and gentle color balance.";
        const imagePrompt = `${chosenPrompt} Keep it supportive for the intervention activity. No text, letters, words, logos, symbols, or watermarks. No faces or people.`;
        console.log("[ux-generator] image prompt source", {
          source: modulePrompt ? "module_prompt" : "fallback",
          preview: imagePrompt.slice(0, 220),
        });
        const resp = await fetch(`${API_BASE}/dev/media/image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: imagePrompt,
          }),
        });
        const data = await resp.json();
        if (resp.ok && (data?.url || data?.image?.url)) {
          next.imageUrl = data.url || data.image.url;
        }
      }
      if (needsVideo) {
        try {
          const contextSummary = conversationContext
            ? `User context: ${conversationContext}\nInstruction: Write a four-beat supportive video script and image prompts. Acknowledge one concrete detail from the user's context, then guide grounding, release, reframe, and a gentle next step. Keep visuals calm and practical.\n${parsed.instruction || parsed.title || ""}`.trim()
            : `Instruction: Write a four-beat supportive video script and image prompts that guide grounding, release, reframe, and a gentle next step. Keep visuals calm and practical.\n${parsed.instruction || parsed.title || ""}`.trim();
          const resp = await fetch(`${API_BASE}/dev/stress-support/intervention`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(withSession({
              summary: contextSummary || "Visual calming",
              formats: ["dalle_video"],
            })),
          });
          console.log("[ux-generator] dalle_video intervention status", resp.status);
          const data = await resp.json();
          const videoAsset =
            (Array.isArray(data?.assets) && data.assets.find((a: any) => a.type === "video")) || null;
          const prompts: string[] = Array.isArray(videoAsset?.prompts) ? videoAsset.prompts : [];
          const scriptLines: string[] = Array.isArray(videoAsset?.script_lines) ? videoAsset.script_lines : [];
          next.videoPrompts = prompts;
          next.videoScript = scriptLines;
          next.videoRationale = videoAsset?.purpose || videoAsset?.explanation;
          if (scriptLines.length) {
            try {
              const ttsResp = await fetch(TTS_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: scriptLines.join(". "),
                  speed: 0.98,
                  use_gpt_voice: true,
                  style: "gentle, supportive voiceover",
                }),
              });
              const ttsData = await ttsResp.json();
              if (ttsResp.ok && ttsData?.audio_url) {
                next.videoAudioUrl = ttsData.audio_url;
                if (
                  typeof ttsData?.duration_seconds === "number" &&
                  Number.isFinite(ttsData.duration_seconds) &&
                  ttsData.duration_seconds > 0
                ) {
                  next.videoAudioDurationSeconds = Math.round(ttsData.duration_seconds);
                }
                console.log("[ux-generator] dalle_video voiceover url", ttsData.audio_url?.slice?.(0, 80));
              }
            } catch (e) {
              console.warn("[ux-generator] dalle_video voiceover tts failed", e);
            }
          }
          const urls: string[] = [];
          for (const p of prompts.slice(0, 4)) {
            try {
              const r = await fetch(`${API_BASE}/dev/media/image`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: p }),
              });
              console.log("[ux-generator] dalle_video frame status", r.status);
              const d = await r.json();
              if (r.ok && (d?.url || d?.image?.url)) {
                urls.push(d.url || d.image.url);
              }
            } catch (e) {
              console.warn("[ux-generator] dalle frame failed", e);
            }
          }
          if (urls.length) next.videoUrls = urls;
        } catch (err) {
          console.warn("[ux-generator] dalle_video generation failed", err);
        }
      }
      if (needsStoryboard) {
        try {
          const contextSummary = conversationContext
            ? `${conversationContext}\n${parsed.instruction || parsed.title || ""}`.trim()
            : parsed.instruction || parsed.title || "";
          const resp = await fetch(`${API_BASE}/dev/stress-support/intervention`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(withSession({
              summary: contextSummary || "Storyboard calming",
              formats: ["storyboard"],
            })),
          });
          const data = await resp.json();
          const storyboardAsset =
            (Array.isArray(data?.assets) && data.assets.find((a: any) => a.type === "storyboard")) || null;
          const stepFrames = Array.isArray(data?.steps?.[0]?.asset?.frames)
            ? data.steps[0].asset.frames
            : Array.isArray(data?.step?.asset?.frames)
              ? data.step.asset.frames
              : [];
          const frames: any[] = stepFrames.length ? stepFrames : Array.isArray(storyboardAsset?.frames) ? storyboardAsset.frames : [];
          next.storyboardFrames = frames.slice(0, 3);
          next.storyboardRationale = storyboardAsset?.explanation;
          const urls: string[] = [];
          const imageAssets = (data?.assets || []).filter((a: any) => a.type === "image");
          const imagePrompts = frames
            .map((frame: any) =>
              typeof frame === "object" && frame?.image_prompt
                ? frame.image_prompt
                : typeof frame === "string"
                  ? frame
                  : null
            )
            .filter(Boolean) as string[];
          const promptSource = imagePrompts.length ? imagePrompts : imageAssets.map((img: any) => img?.prompt || img?.content).filter(Boolean);
          for (const prompt of promptSource.slice(0, frames.length || 3)) {
            if (!prompt) continue;
            try {
              const r = await fetch(`${API_BASE}/dev/media/image`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  prompt: `${prompt} — natural light, no faces, no text, cinematic still`,
                }),
              });
              const d = await r.json();
              if (r.ok && (d?.url || d?.image?.url)) {
                urls.push(d.url || d.image.url);
              }
            } catch (e) {
              console.warn("[ux-generator] storyboard image fetch failed", e);
            }
          }
          next.storyboardImages = urls;
        } catch (err) {
          console.warn("[ux-generator] storyboard generation failed", err);
        }
      }
      if (needsTimed) {
        try {
          const contextSummary = conversationContext
            ? `${conversationContext}\n${parsed.instruction || parsed.title || ""}`.trim()
            : parsed.instruction || parsed.title || "";
          const resp = await fetch(`${API_BASE}/dev/stress-support/intervention`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(withSession({
              summary: contextSummary || "Guided breathing",
              formats: ["timed_cues"],
            })),
          });
          console.log("[ux-generator] timed_cues intervention status", resp.status);
          const data = await resp.json();
          const timerAsset =
            (Array.isArray(data?.assets) && data.assets.find((a: any) => a.type === "timer")) || null;
          if (timerAsset?.timer_steps) next.timerSteps = timerAsset.timer_steps;
          if (timerAsset?.audio_script) next.timerScript = timerAsset.audio_script;
          if (timerAsset?.explanation) next.timerRationale = timerAsset.explanation;
          if (timerAsset?.audio_script) {
            const timedVoiceRate =
              typeof timerAsset?.voice_rate === "number" && Number.isFinite(timerAsset.voice_rate)
                ? Math.min(0.7, Math.max(0.5, timerAsset.voice_rate))
                : 0.6;
            const ttsResp = await fetch(TTS_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: timerAsset.audio_script,
                speed: timedVoiceRate,
                use_gpt_voice: true,
                style: "calm, human, grounded guidance",
              }),
            });
            console.log("[ux-generator] timed_cues tts status", ttsResp.status);
        const ttsData = await ttsResp.json();
          if (ttsResp.ok && ttsData?.audio_url) {
            next.timerAudioUrl = ttsData.audio_url;
            next.timerAudioSource =
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
              next.timerAudioDurationSeconds = Math.round(ttsData.duration_seconds);
            }
            console.log("[ux-generator] timed_cues tts url", ttsData.audio_url?.slice?.(0, 80));
          console.log("[ux-generator] timed_cues tts source", {
            voice_source: next.timerAudioSource || "unknown",
            used_gpt_voice: Boolean(ttsData.used_gpt_voice),
            tts_api_version: ttsData?.tts_api_version || "missing",
          });
            if (next.timerAudioSource === "unknown") {
              console.warn(
                "[ux-generator] timed_cues tts source metadata missing; verify server build includes voice_source"
              );
            }
          }
          }
        } catch (err) {
          console.warn("[ux-generator] timed_cues generation failed", err);
        }
      }
      setMedia(normalizeGeneratedMedia(next) as GeneratedMedia);
    } catch (e: any) {
      console.warn("[ux-generator] generate failed", e);
      setError(e?.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [parsed, suggestedModules]);

  const autoRunRef = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoRunRef.current) return;
    console.log("[ux-generator] autoGenerate armed", {
      hasPreStructuredSpec: Boolean(preStructuredSpec),
    });
    if (preStructuredSpec) {
      if (specText !== preStructuredSpec) {
        console.log("[ux-generator] autoGenerate waiting for preStructuredSpec to sync");
        return;
      }
      autoRunRef.current = true;
      console.log("[ux-generator] autoGenerate using preStructuredSpec");
      if (preGeneratedMedia && Object.keys(preGeneratedMedia).length) {
        console.log("[ux-generator] autoGenerate using preGeneratedMedia; skipping generate");
        return;
      }
      void handleGenerate();
      return;
    }
    autoRunRef.current = true;
    const run = async () => {
      console.log("[ux-generator] autoGenerate starting planner step");
      await handleAutoStructureWithGpt();
      console.log("[ux-generator] autoGenerate planner done, starting generate");
      setTimeout(() => {
        void handleGenerate();
      }, 0);
    };
    void run();
  }, [autoGenerate, preStructuredSpec, specText, handleAutoStructureWithGpt, handleGenerate]);

  useEffect(() => {
    if (!generating) {
      setUserTriggeredGenerate(false);
    }
  }, [generating]);

  return (
    <SafeAreaView style={styles.safe}>
      {backgroundImage ? (
        <Image source={{ uri: toAbsoluteMediaUrl(backgroundImage) }} style={styles.bgImage} blurRadius={3} />
      ) : null}
      <LinearGradient
        colors={imageOverlayColors}
        style={styles.bgOverlay}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.grid, !showInputs && styles.gridSingle]}>
          {showInputs ? (
            <View style={[styles.card, styles.inputCard]}>
              <Text style={styles.label}>Natural description (combine Step 1 & 2; ask for 8–10 UX elements)</Text>
              <TextInput
                multiline
                value={descriptionText}
                onChangeText={setDescriptionText}
                style={styles.input}
                placeholder="Write a freeform description combining Step 1 & 2. Ask for 8–10 UX elements (framing, micro-prompts, progress, audio/voice, storyboard/slides/image, reflection, evidence)."
                placeholderTextColor="#94a3b8"
              />
              <Pressable
                accessibilityRole="button"
                onPress={handleAutoStructureWithGpt}
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              >
                <Text style={styles.buttonLabel}>Generate structured with GPT</Text>
              </Pressable>
              <Text style={[styles.label, { marginTop: 16 }]}>Structured input (editable)</Text>
              <TextInput
                multiline
                value={specText}
                onChangeText={setSpecText}
                style={styles.input}
                placeholder="Describe the activity, modalities, instruction, minutes, and evidence."
                placeholderTextColor="#94a3b8"
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setUserTriggeredGenerate(true);
                  handleGenerate();
                }}
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              >
                <Text style={styles.buttonLabel}>
                  {generating && userTriggeredGenerate ? "Generating..." : "Generate UX"}
                </Text>
              </Pressable>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
          ) : null}

          <View style={[styles.card, styles.previewCard, !showInputs && styles.previewCardFull]}>
            <View style={styles.previewTopRow} />
            {generating && !mediaReady ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#22d3ee" />
                <Text style={styles.status}>Generating media...</Text>
              </View>
            ) : null}
            <View style={styles.section}>
              <View style={styles.modulesStack}>
                {moduleScreens.map((screenMods, screenIdx) => {
                  const isActive = screenIdx === activeScreen;
                  return (
                    <View
                      key={`screen-${screenIdx}`}
                      style={isActive ? styles.screenVisible : styles.screenHidden}
                    >
                      {(screenMods || [])
                        .filter((m: any) => m.id !== "heading")
                        .map((m: any, idx: number) => {
                          const mod = MODULES.find((mm) => mm.id === m.id);
                          if (!mod) return null;
                          const prev = idx > 0 ? (screenMods || []).filter((x: any) => x.id !== "heading")[idx - 1] : null;
                          const showModuleBreak =
                            paperMode && prev?.id === "timer" && m?.id !== "timer";
                          return (
                            <React.Fragment key={`mod-preview-${m.id}-${screenIdx}-${idx}`}>
                              {showModuleBreak ? <View style={styles.moduleBreak} /> : null}
                              <View style={styles.block}>
                                <ModuleRenderer
                                  mod={{ ...mod, ...(m || {}) }}
                                  spec={parsed}
                                  media={media}
                                  conversationContext={conversationContext}
                                  useLightOnImageText={useLightOnImageText}
                                  moduleKey={m._idx}
                                  initialResponse={moduleResponsesByKey[m._idx]}
                                  onCompleteChange={handleModuleCompletion}
                                  onInputCapture={handleModuleInputCapture}
                                  showError={
                                    isActive && showErrors && !isAutoComplete(m.id) && !moduleCompletion[m._idx]
                                  }
                                  paperMode={paperMode}
                                />
                              </View>
                            </React.Fragment>
                          );
                        })}
                    </View>
                  );
                })}
              </View>
            </View>
            <View style={styles.screenNavBottom}>
              {(() => {
                const canGoPrev = activeScreen > 0 || Boolean(onPrevExit);
                return (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  stopAllAudio();
                  if (activeScreen <= 0) {
                    if (!onPrevExit) return;
                    onPrevExit?.();
                    return;
                  }
                  setActiveScreen((s) => Math.max(0, s - 1));
                }}
                disabled={!canGoPrev}
                style={({ pressed }) => [
                  styles.bottomBtn,
                  !canGoPrev && styles.bottomBtnDisabled,
                  pressed && canGoPrev && styles.bottomBtnPressed,
                ]}
              >
                <Text style={styles.bottomBtnText}>Prev</Text>
              </Pressable>
                );
              })()}
              <Pressable
                accessibilityRole="button"
                onPress={async () => {
                  const isLast = activeScreen >= (moduleScreens.length || 1) - 1;
                  if (!validateCurrentScreen()) return;
                  if (isLast) {
                    if (!onComplete) return;
                    stopAllAudio();
                    await submitUxSubmission();
                    onComplete?.();
                    return;
                  }
                  stopAllAudio();
                  setActiveScreen((s) => Math.min((moduleScreens.length || 1) - 1, s + 1));
                }}
                style={({ pressed }) => [
                  styles.bottomBtnPrimary,
                  pressed && styles.bottomBtnPressed,
                ]}
              >
                <Text style={styles.bottomBtnPrimaryText}>
                  {activeScreen >= (moduleScreens.length || 1) - 1 ? "Complete" : "Next"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ModuleRenderer({
  mod,
  spec,
  media,
  conversationContext,
  useLightOnImageText = false,
  moduleKey,
  initialResponse,
  onCompleteChange,
  onInputCapture,
  showError,
  paperMode = false,
}: {
  mod: ModuleConfig & Record<string, any>;
  spec: UxSpec;
  media: GeneratedMedia;
  conversationContext?: string;
  useLightOnImageText?: boolean;
  moduleKey: number;
  initialResponse?: any;
  onCompleteChange?: (idx: number, complete: boolean) => void;
  onInputCapture?: (idx: number, payload: any) => void;
  showError?: boolean;
  paperMode?: boolean;
}) {
  const normalizeOptions = useCallback((raw: any, fallback: string[]) => {
    const list = Array.isArray(raw)
      ? raw.map((opt) => String(opt || "").trim()).filter(Boolean)
      : [];
    const genericRe = /^(option|choice)\s*\d+$/i;
    const filtered = list.filter((opt) => !genericRe.test(opt) && !/^[A-C]$/i.test(opt));
    if (filtered.length >= 2) return filtered;
    if (list.length >= 2 && filtered.length >= 1) return list;
    return fallback;
  }, []);
  const defaultChoiceOptions = useMemo(
    () => ["Take a breath and reset", "Name one worry", "Plan one next step"],
    []
  );
  const fetchShortAudioHeader = useCallback(
    async (scriptText: string) => {
      const contextSnippet = conversationContext
        ? conversationContext.replace(/\s+/g, " ").trim().slice(0, 360)
        : "";
      const summary = [
        "Write a single-sentence header for a short, personalized audio message.",
        "The header should acknowledge the user's situation and invite them to listen.",
        contextSnippet ? `User context: ${contextSnippet}` : "",
        `Audio script: ${scriptText.slice(0, 400)}`,
      ]
        .filter(Boolean)
        .join("\n");
      const resp = await fetch(`${API_BASE}/dev/stress-support/intervention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary,
          formats: ["short_audio"],
        }),
      });
      const data = await resp.json();
      const asset =
        (Array.isArray(data?.assets) &&
          data.assets.find((a: any) => a.type === "audio" || a.type === "music" || a.type === "ambient")) ||
        null;
      const headerRaw =
        (asset?.purpose || asset?.explanation || data?.purpose || data?.explanation || "").toString().trim();
      if (!headerRaw) {
        return "";
      }
      return headerRaw.replace(/\s+/g, " ").trim();
    },
    [conversationContext]
  );
  const [spokenWord, setSpokenWord] = useState<string | null>(null);
  const [spokenNumber, setSpokenNumber] = useState<number | null>(null);
  const [spokenDisplayCount, setSpokenDisplayCount] = useState<number>(0);
  const [spokenSentenceIdx, setSpokenSentenceIdx] = useState<number | null>(null);
  const [shortAudioHeader, setShortAudioHeader] = useState<string>("");
  const [shortAudioHeaderLoading, setShortAudioHeaderLoading] = useState(false);
  const shortAudioHeaderKeyRef = useRef<string>("");
  const shortAudioHeaderLoadingRef = useRef(false);
  const spokenPulse = useRef(new Animated.Value(1)).current;
  const [shortTtsUrl, setShortTtsUrl] = useState<string | null>(null);
  const [shortTtsSource, setShortTtsSource] = useState<"gpt" | "generic" | "unknown">("unknown");
  const shortTtsSourceRef = useRef<"gpt" | "generic" | "unknown">("unknown");
  const shortTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  const shortTtsTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [shortTtsCurrent, setShortTtsCurrent] = useState(0);
  const [shortTtsDuration, setShortTtsDuration] = useState(0);
  const [scrubWidth, setScrubWidth] = useState(0);
  const timedCuesTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [timedCuesCurrent, setTimedCuesCurrent] = useState(0);
  const [timedCuesDuration, setTimedCuesDuration] = useState(0);
  const [timedCuesAudioLoading, setTimedCuesAudioLoading] = useState(false);
  const [shortAudioLoading, setShortAudioLoading] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerRemaining, setTimerRemaining] = useState(
    media.timerSteps && media.timerSteps.length
      ? media.timerSteps.reduce((sum, t) => sum + (t.duration_seconds || 0), 0)
      : 60
  );
  const [timerTotal, setTimerTotal] = useState(
    media.timerSteps && media.timerSteps.length
      ? media.timerSteps.reduce((sum, t) => sum + (t.duration_seconds || 0), 0)
      : 60
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerCountRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [videoIdx, setVideoIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerAudioRef = useRef<HTMLAudioElement | null>(null);
  const videoAudioRef = useRef<HTMLAudioElement | null>(null);
  const videoAmbientRef = useRef<HTMLAudioElement | null>(null);
  const videoSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoSyncMode, setVideoSyncMode] = useState<"audio" | "speech" | null>(null);
  const spokenAmbientRef = useRef<HTMLAudioElement | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [timerAudioPlaying, setTimerAudioPlaying] = useState(false);
  const [timedCuesPlaying, setTimedCuesPlaying] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceRecorded, setVoiceRecorded] = useState(false);
  const [voiceAudioUrl, setVoiceAudioUrl] = useState<string | null>(null);
  const [photoAttached, setPhotoAttached] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoConfirmed, setPhotoConfirmed] = useState(false);
  const [chatLog, setChatLog] = useState<Array<{ from: "bot" | "user"; text: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatAiVoiceEnabled, setChatAiVoiceEnabled] = useState(false);
  const [chatVoiceError, setChatVoiceError] = useState<string | null>(null);
  const [chatVoiceDraftText, setChatVoiceDraftText] = useState("");
  const [chatVoiceDraftPending, setChatVoiceDraftPending] = useState(false);
  const [chatVoiceRecording, setChatVoiceRecording] = useState(false);
  const [chatVoiceReplyPending, setChatVoiceReplyPending] = useState(false);
  const [chatVoiceReplyUrl, setChatVoiceReplyUrl] = useState<string | null>(null);
  const chatVoiceRecorderRef = useRef<MediaRecorder | null>(null);
  const chatVoiceChunksRef = useRef<any[]>([]);
  const chatVoiceStreamRef = useRef<any>(null);
  const chatVoiceReplyAudioRef = useRef<HTMLAudioElement | null>(null);
  const [textboxValuesByKey, setTextboxValuesByKey] = useState<Record<number, string>>({});
  const [listTextboxValuesByKey, setListTextboxValuesByKey] = useState<Record<number, string[]>>({});
  const [timerReportValue, setTimerReportValue] = useState("");
  const [timerCompleted, setTimerCompleted] = useState(false);
  const [shortAudioCompleted, setShortAudioCompleted] = useState(false);
  const [timedCuesCompleted, setTimedCuesCompleted] = useState(false);
  const [dalleVideoCompleted, setDalleVideoCompleted] = useState(false);
  const [imageViewed, setImageViewed] = useState(false);
  const [storyboardViewed, setStoryboardViewed] = useState(false);
  const cleanVideoLine = useCallback(
    (line: any) =>
      String(line || "")
        .replace(/^beat\s*\d+\s*[:\-]\s*/i, "")
        .replace(/^frame\s*\d+\s*[:\-]\s*/i, "")
        .trim(),
    []
  );
  const effectiveVideoFrameCount = useMemo(() => {
    const imageCount = Array.isArray(media.videoUrls) ? media.videoUrls.length : 0;
    if (imageCount > 0) return imageCount;
    const scriptCount = Array.isArray(media.videoScript) ? media.videoScript.length : 0;
    if (scriptCount > 0) return scriptCount;
    return Array.isArray(media.videoPrompts) ? media.videoPrompts.length : 0;
  }, [media.videoUrls, media.videoScript, media.videoPrompts]);
  const effectiveVideoScript = useMemo(() => {
    const cleaned = Array.isArray(media.videoScript)
      ? media.videoScript.map(cleanVideoLine).filter(Boolean)
      : [];
    if (!cleaned.length) return [];
    if (!effectiveVideoFrameCount) return cleaned;
    return cleaned.slice(0, effectiveVideoFrameCount);
  }, [media.videoScript, cleanVideoLine, effectiveVideoFrameCount]);
  useEffect(() => {
    if (!effectiveVideoFrameCount) return;
    const rawScriptCount = Array.isArray(media.videoScript) ? media.videoScript.length : 0;
    console.log("[ux-generator] dalle_video beats", {
      frames: effectiveVideoFrameCount,
      script_used: effectiveVideoScript.length,
      script_raw: rawScriptCount,
    });
  }, [effectiveVideoFrameCount, effectiveVideoScript.length, media.videoScript]);
  useEffect(() => {
    return () => {
      try {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
        if (shortTtsAudioRef.current) {
          shortTtsAudioRef.current.pause();
          shortTtsAudioRef.current.currentTime = 0;
          shortTtsAudioRef.current = null;
        }
        if (timerAudioRef.current) {
          timerAudioRef.current.pause();
          timerAudioRef.current.currentTime = 0;
        }
        if (videoAudioRef.current) {
          videoAudioRef.current.pause();
          videoAudioRef.current.currentTime = 0;
        }
        if (videoAmbientRef.current) {
          videoAmbientRef.current.pause();
          videoAmbientRef.current.currentTime = 0;
        }
        if (spokenAmbientRef.current) {
          spokenAmbientRef.current.pause();
          spokenAmbientRef.current.currentTime = 0;
        }
        if (chatVoiceReplyAudioRef.current) {
          chatVoiceReplyAudioRef.current.pause();
          chatVoiceReplyAudioRef.current.currentTime = 0;
          chatVoiceReplyAudioRef.current = null;
        }
        if (chatVoiceStreamRef.current?.getTracks) {
          chatVoiceStreamRef.current.getTracks().forEach((track: any) => track.stop());
          chatVoiceStreamRef.current = null;
        }
      } catch {}
      if (typeof window !== "undefined" && (window as any).speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
    };
  }, []);
  const clearVideoSync = useCallback(() => {
    if (videoSyncRef.current) {
      clearInterval(videoSyncRef.current);
      videoSyncRef.current = null;
    }
  }, []);
  useEffect(() => {
    setVideoIdx((prev) => {
      if (!effectiveVideoFrameCount) return 0;
      return prev % effectiveVideoFrameCount;
    });
  }, [effectiveVideoFrameCount]);
  useEffect(() => {
    clearVideoSync();
    if (!media.videoUrls || media.videoUrls.length <= 1) return;
    if (!videoPlaying || videoSyncMode !== "audio") return;
    const lineCount = effectiveVideoFrameCount || media.videoUrls.length;
    const duration = videoDuration || videoAudioRef.current?.duration || 0;
    const sliceMs = duration && lineCount ? Math.max(800, (duration / lineCount) * 1000) : 3200;
    videoSyncRef.current = setInterval(() => {
      setVideoIdx((prev) => (prev + 1) % media.videoUrls!.length);
    }, sliceMs);
    return () => clearVideoSync();
  }, [videoPlaying, media.videoUrls, videoDuration, videoSyncMode, clearVideoSync, effectiveVideoFrameCount]);
  const handlePhotoSelect = useCallback((useCamera: boolean) => {
    if (Platform.OS !== "web") {
      console.warn("[ux-generator] photo capture not implemented for native in this view");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (useCamera) (input as any).capture = "environment";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) {
        try {
          if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
        } catch {}
        const name = file.name || "Selected photo";
        const url = URL.createObjectURL(file);
        setPhotoAttached(name);
        setPhotoPreviewUrl(url);
        setPhotoConfirmed(false);
      }
    };
    input.click();
  }, [photoPreviewUrl]);
  const timerModuleInput = useMemo(
    () => (spec.moduleInputs || []).find((m: any) => m && (m as any).id === "timer") || null,
    [spec.moduleInputs]
  );
  const [selectedRadio, setSelectedRadio] = useState<number | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<Set<string>>(new Set());
  const hydratedInputRef = useRef(false);
  const playChime = useCallback((freq: number, durationMs: number = 260) => {
    if (Platform.OS !== "web") return;
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch (err) {
      console.warn("[ux-generator] playChime failed", err);
    }
  }, []);

  const highlightWord = (text: string) => {
    const parts = text.split(/(\s+)/);
    const active = spokenWord?.toLowerCase().replace(/[^a-z0-9]/g, "");
    return (
      <Text style={styles.renderBody}>
        {parts.map((part, i) => {
          const clean = part.toLowerCase().replace(/[^a-z0-9]/g, "");
          const isActive = active && clean && clean === active;
          return (
            <Text key={`p-${i}`} style={isActive ? styles.spokenHighlight : undefined}>
              {part}
            </Text>
          );
        })}
      </Text>
    );
  };

  const playSpeech = (script: string) => {
    if (!script) return;
    if (typeof window === "undefined" || !(window as any).speechSynthesis) {
      console.warn("[ux-generator] SpeechSynthesis not available");
      return;
    }
    const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);
    const synth = window.speechSynthesis;
    synth.cancel();
    const tokens = splitScriptWords(script);
    const handleNumber = (num: number | null) => {
      if (!Number.isFinite(num)) {
        setSpokenDisplayCount(0);
        return;
      }
      const n = num as number;
      setSpokenDisplayCount(n);
      spokenPulse.setValue(0.85);
      Animated.spring(spokenPulse, {
        toValue: 1.1,
        friction: 3,
        useNativeDriver: true,
      }).start(() => {
        Animated.spring(spokenPulse, {
          toValue: 1,
          friction: 4,
          useNativeDriver: true,
        }).start();
      });
    };
    const speakSentence = (idx: number) => {
      if (idx >= sentences.length) {
        setSpokenWord(null);
        setSpokenNumber(null);
        setSpokenDisplayCount(0);
        return;
      }
      const sentence = sentences[idx];
      const localTokens = splitScriptWords(sentence);
      const utter = new SpeechSynthesisUtterance(sentence);
      utter.rate = 0.55;
      utter.pitch = 0.95;
      utter.onstart = () => {
        setSpokenDisplayCount(0);
      };
      utter.onboundary = (ev: any) => {
        const charIdx = ev.charIndex || 0;
        const tokenIdx = localTokens.findIndex(
          (t, i) => charIdx >= t.start && (i === localTokens.length - 1 || charIdx < localTokens[i + 1].start)
        );
        if (tokenIdx >= 0) {
          const w = localTokens[tokenIdx].word;
          const normalized = w.toLowerCase().replace(/[^a-z0-9]/g, "");
          const numIdx = numberWords.findIndex((n) => n === normalized);
          const num = numIdx >= 0 ? numIdx + 1 : Number(normalized);
          setSpokenWord(w);
          setSpokenNumber(Number.isFinite(num) ? num : null);
          handleNumber(Number.isFinite(num) ? (num as number) : null);
        }
      };
      utter.onend = () => {
        setTimeout(() => speakSentence(idx + 1), 2000);
      };
      synth.speak(utter);
    };
    speakSentence(0);
  };

  const clearTimerInterval = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  };
  const clearTimerCounter = () => {
    if (timerCountRef.current) clearInterval(timerCountRef.current);
    timerCountRef.current = null;
  };

  const startSimpleTimer = (seconds: number, opts?: { resume?: boolean }) => {
    clearTimerInterval();
    const isResume = !!opts?.resume;
    const secs = Math.max(1, seconds);
    const total = isResume ? (timerTotal || secs) : secs;
    setTimerTotal(total);
    setTimerRemaining(isResume ? secs : total);
    setTimerRunning(true);
    setTimerCompleted(false);
    playChime(880);
    intervalRef.current = setInterval(() => {
      setTimerRemaining((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0) {
          clearTimerInterval();
          setTimerRunning(false);
          setTimerCompleted(true);
          playChime(440);
          console.log("[ux-generator] timer complete");
        }
        return next;
      });
    }, 1000);
  };

  const handleSpokenNumber = (num: number | null) => {
    if (!Number.isFinite(num)) {
      setSpokenDisplayCount(0);
      return;
    }
    const n = num as number;
    setSpokenDisplayCount(n);
    spokenPulse.setValue(0.85);
    Animated.spring(spokenPulse, {
      toValue: 1.1,
      friction: 3,
      useNativeDriver: true,
    }).start(() => {
      Animated.spring(spokenPulse, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }).start();
    });
  };

  const pauseTimer = () => {
    clearTimerInterval();
    setTimerRunning(false);
  };

  const resetTimer = () => {
    clearTimerInterval();
    const secs = timerTotal || 60;
    setTimerRemaining(secs);
    setTimerRunning(false);
    setTimerCompleted(false);
  };

  const startVideoAmbient = async () => {
    if (Platform.OS !== "web") return;
    try {
      const asset = Asset.fromModule(PIANO_AMBIENT);
      await asset.downloadAsync();
      const uri = asset.localUri || asset.uri;
      if (!uri) return;
      const AudioCtor = (window as any).Audio;
      const ambient = new AudioCtor(uri);
      ambient.loop = true;
      ambient.volume = 0.15;
      videoAmbientRef.current = ambient;
      await ambient.play();
    } catch (e) {
      console.warn("[ux-generator] video ambient start failed", e);
    }
  };

  const stopVideoAmbient = () => {
    try {
      if (videoAmbientRef.current) {
        videoAmbientRef.current.pause();
        videoAmbientRef.current.currentTime = 0;
      }
    } catch {}
    videoAmbientRef.current = null;
  };

  const ensureSpokenAmbientUri = useCallback(async () => {
    const asset = Asset.fromModule(PIANO_AMBIENT);
    await asset.downloadAsync();
    return asset.localUri || asset.uri;
  }, []);

  const startSpokenAmbient = useCallback(async () => {
    try {
      if (Platform.OS !== "web") return;
      const audioCtor = (typeof window !== "undefined" && (window as any).Audio) || null;
      if (!audioCtor) return;
      const uri = await ensureSpokenAmbientUri();
      if (!uri) return;
      const audio = new audioCtor(uri);
      audio.loop = true;
      audio.volume = 0.12;
      spokenAmbientRef.current = audio;
      await audio.play().catch(() => {});
    } catch (err) {
      console.warn("[ux-generator] spoken ambient error", err);
    }
  }, [ensureSpokenAmbientUri]);

  const stopSpokenAmbient = useCallback(() => {
    try {
      if (spokenAmbientRef.current) {
        spokenAmbientRef.current.pause();
        spokenAmbientRef.current.currentTime = 0;
        spokenAmbientRef.current = null;
      }
    } catch (err) {
      console.warn("[ux-generator] stop spoken ambient error", err);
    }
  }, []);

  const ensureShortTtsUrl = useCallback(
    async (text: string) => {
      if (!text.trim()) return null;
      if (shortTtsUrl) return shortTtsUrl;
      try {
        const resp = await fetch(TTS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            speed: 0.94,
            use_gpt_voice: true,
            style: "calm, human, grounded guidance",
          }),
        });
        const data = await resp.json();
        if (resp.ok && typeof data?.audio_url === "string") {
          const source =
            data?.voice_source === "gpt" || data?.voice_source === "generic"
              ? data.voice_source
              : data?.used_gpt_voice === true
              ? "gpt"
              : "unknown";
          if (source === "unknown") {
            console.warn("[ux-generator] short_audio tts source metadata missing; verify server build includes voice_source");
          }
          setShortTtsSource(source);
          shortTtsSourceRef.current = source;
          if (
            typeof data?.duration_seconds === "number" &&
            Number.isFinite(data.duration_seconds) &&
            data.duration_seconds > 0
          ) {
            setShortTtsDuration(Math.round(data.duration_seconds));
          }
          console.log("[ux-generator] short_audio tts source", {
            voice_source: source,
            duration_seconds:
              typeof data?.duration_seconds === "number" && Number.isFinite(data.duration_seconds)
                ? data.duration_seconds
                : null,
            used_gpt_voice: Boolean(data?.used_gpt_voice),
            tts_api_version: data?.tts_api_version || "missing",
          });
          setShortTtsUrl(data.audio_url);
          return data.audio_url;
        }
      } catch (err) {
        console.warn("[ux-generator] short_tts fetch failed", err);
      }
      return null;
    },
    [shortTtsUrl]
  );

  const clearShortTtsTick = useCallback(() => {
    if (shortTtsTickRef.current) {
      clearInterval(shortTtsTickRef.current);
      shortTtsTickRef.current = null;
    }
  }, []);
  const clearTimedCuesTick = useCallback(() => {
    if (timedCuesTickRef.current) {
      clearInterval(timedCuesTickRef.current);
      timedCuesTickRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearShortTtsTick();
      clearTimedCuesTick();
      clearTimerCounter();
      stopSpokenAmbient();
      if (voiceRecorderRef.current && voiceRecorderRef.current.state !== "inactive") {
        voiceRecorderRef.current.stop();
      }
            if (voiceAudioRef.current) {
              try {
                voiceAudioRef.current.pause();
              } catch {}
              voiceAudioRef.current = null;
            }
      if (voiceAudioUrl) {
        try {
          URL.revokeObjectURL(voiceAudioUrl);
        } catch {}
      }
    };
  }, [clearShortTtsTick, clearTimedCuesTick, stopSpokenAmbient, voiceAudioUrl]);

  const setCompletion = useCallback(
    (complete: boolean) => {
      if (typeof moduleKey === "number" && onCompleteChange) {
        onCompleteChange(moduleKey, complete);
      }
    },
    [moduleKey, onCompleteChange]
  );
  const listTextboxItems = useMemo(() => {
    if (mod.id !== "list_textbox") return [];
    const items = Array.isArray((mod as any).items) ? (mod as any).items : [];
    return items.length
      ? items
      : [
          { label: "Item 1", placeholder: "Type here..." },
          { label: "Item 2", placeholder: "Type here..." },
          { label: "Item 3", placeholder: "Type here..." },
        ];
  }, [mod.id, (mod as any).items]);
  const textboxValue = textboxValuesByKey[moduleKey] || "";
  const listTextboxValues = listTextboxValuesByKey[moduleKey] || [];
  useEffect(() => {
    if (mod.id !== "list_textbox") return;
    setListTextboxValuesByKey((prev) => {
      const next = { ...prev };
      const current = next[moduleKey] ? [...next[moduleKey]] : [];
      while (current.length < listTextboxItems.length) current.push("");
      next[moduleKey] = current.slice(0, listTextboxItems.length);
      return next;
    });
  }, [mod.id, listTextboxItems.length, moduleKey]);
  useEffect(() => {
    if (hydratedInputRef.current) return;
    if (!initialResponse) return;
    hydratedInputRef.current = true;
    switch (mod.id) {
      case "textbox":
        if (typeof initialResponse.text === "string") {
          setTextboxValuesByKey((prev) => ({ ...prev, [moduleKey]: initialResponse.text }));
        }
        break;
      case "list_textbox":
        if (Array.isArray(initialResponse.values)) {
          setListTextboxValuesByKey((prev) => ({ ...prev, [moduleKey]: initialResponse.values }));
        }
        break;
      case "mcq": {
        const allowMultiple = Boolean(initialResponse.allow_multiple);
        if (allowMultiple) {
          if (Array.isArray(initialResponse.selected)) {
            setSelectedMulti(new Set(initialResponse.selected));
          }
        } else if (typeof initialResponse.selectedIndex === "number") {
          setSelectedRadio(initialResponse.selectedIndex);
        }
        break;
      }
      case "short_audio":
        if (typeof initialResponse.completed === "boolean") {
          setShortAudioCompleted(initialResponse.completed);
        }
        break;
      case "voice_input":
        if (typeof initialResponse.audioUrl === "string") {
          setVoiceAudioUrl(initialResponse.audioUrl);
          setVoiceRecorded(true);
        } else if (initialResponse.hasRecording) {
          setVoiceRecorded(true);
        }
        break;
      case "photo_input":
        if (typeof initialResponse.photoAttached === "string") {
          setPhotoAttached(initialResponse.photoAttached);
        }
        if (typeof initialResponse.photoConfirmed === "boolean") {
          setPhotoConfirmed(initialResponse.photoConfirmed);
        }
        break;
      case "chatbot":
        if (Array.isArray(initialResponse.messages)) {
          setChatLog(initialResponse.messages);
        }
        break;
      case "image":
        if (typeof initialResponse.viewed === "boolean") {
          setImageViewed(initialResponse.viewed);
        }
        break;
      case "storyboard":
        if (typeof initialResponse.viewedAll === "boolean") {
          setStoryboardViewed(initialResponse.viewedAll);
        }
        break;
      case "dalle_video":
        if (typeof initialResponse.voiceoverPlayed === "boolean") {
          setDalleVideoCompleted(initialResponse.voiceoverPlayed);
        }
        break;
      case "timer":
        if (typeof initialResponse.reportValue === "string") {
          setTimerReportValue(initialResponse.reportValue);
        }
        if (typeof initialResponse.timerCompleted === "boolean") {
          setTimerCompleted(initialResponse.timerCompleted);
        }
        break;
      case "timed_cues":
        if (typeof initialResponse.completed === "boolean") {
          setTimedCuesCompleted(initialResponse.completed);
        }
        break;
      default:
        break;
    }
  }, [initialResponse, mod.id, moduleKey]);
  const userMessageCount = useMemo(
    () => chatLog.filter((m) => m.from === "user").length,
    [chatLog]
  );
  const completionValue = useMemo(() => {
    switch (mod.id) {
      case "heading":
        return true;
      case "stepper":
        return true;
      case "textbox":
        return textboxValue.trim().length >= 3;
      case "list_textbox":
        return listTextboxValues.some((v) => v.trim().length >= 3);
      case "mcq": {
        const allowMultiple = Boolean((mod as any).allow_multiple ?? media.mcqAllowMultiple);
        return allowMultiple ? selectedMulti.size > 0 : selectedRadio != null;
      }
      case "short_audio":
        return shortAudioCompleted;
      case "voice_input":
        return Boolean(voiceAudioUrl);
      case "photo_input":
        return photoConfirmed;
      case "chatbot":
        return userMessageCount >= 2;
      case "image":
        return imageViewed;
      case "storyboard":
        return storyboardViewed;
      case "dalle_video":
        return dalleVideoCompleted;
      case "timer":
        return timerCompleted && timerReportValue.trim().length >= 3;
      case "timed_cues":
        return timedCuesCompleted;
      default:
        return true;
    }
  }, [
    mod.id,
    textboxValue,
    listTextboxValues,
    selectedRadio,
    selectedMulti,
    shortAudioCompleted,
    voiceAudioUrl,
    photoConfirmed,
    userMessageCount,
    imageViewed,
    storyboardViewed,
    dalleVideoCompleted,
    timerCompleted,
    timerReportValue,
    timedCuesCompleted,
  ]);
  const loggedModuleCompleteRef = useRef(false);
  const loggedTextboxCompleteRef = useRef(false);
  const loggedListTextboxCompleteRef = useRef(false);
  useEffect(() => {
    setCompletion(completionValue);
    if (completionValue && !loggedModuleCompleteRef.current) {
      loggedModuleCompleteRef.current = true;
      console.log("[ux-generator] module complete", { module: mod.id, key: moduleKey });
    } else if (!completionValue) {
      loggedModuleCompleteRef.current = false;
    }
  }, [completionValue, setCompletion, mod.id, moduleKey]);
  useEffect(() => {
    const isComplete = textboxValue.trim().length >= 3;
    if (isComplete && !loggedTextboxCompleteRef.current) {
      loggedTextboxCompleteRef.current = true;
      console.log("[ux-generator] textbox complete", { module: mod.id, key: moduleKey });
    } else if (!isComplete) {
      loggedTextboxCompleteRef.current = false;
    }
  }, [textboxValue, mod.id, moduleKey]);
  useEffect(() => {
    const isComplete = listTextboxValues.some((v) => v.trim().length >= 3);
    if (isComplete && !loggedListTextboxCompleteRef.current) {
      loggedListTextboxCompleteRef.current = true;
      console.log("[ux-generator] list_textbox complete", { module: mod.id, key: moduleKey });
    } else if (!isComplete) {
      loggedListTextboxCompleteRef.current = false;
    }
  }, [listTextboxValues, mod.id, moduleKey]);
  useEffect(() => {
    const allowMultiple = Boolean((mod as any).allow_multiple ?? media.mcqAllowMultiple);
    if (allowMultiple) {
      if (selectedMulti.size > 0) {
        console.log("[ux-generator] mcq complete", { selected: Array.from(selectedMulti) });
      }
      return;
    }
    if (selectedRadio != null) {
      console.log("[ux-generator] mcq complete", { selectedIndex: selectedRadio });
    }
  }, [media.mcqAllowMultiple, mod, selectedMulti, selectedRadio]);
  useEffect(() => {
    if (shortAudioCompleted) {
      console.log("[ux-generator] short_audio complete flag", { completed: true });
    }
  }, [shortAudioCompleted]);
  useEffect(() => {
    if (voiceAudioUrl) {
      console.log("[ux-generator] voice_input complete flag", { hasRecording: true });
    }
  }, [voiceAudioUrl]);
  useEffect(() => {
    if (photoConfirmed) {
      console.log("[ux-generator] photo_input complete flag", { confirmed: true });
    }
  }, [photoConfirmed]);
  useEffect(() => {
    if (userMessageCount >= 2) {
      console.log("[ux-generator] chatbot complete flag", { userMessages: userMessageCount });
    }
  }, [userMessageCount]);
  useEffect(() => {
    if (imageViewed) {
      console.log("[ux-generator] image complete flag", { viewed: true });
    }
  }, [imageViewed]);
  useEffect(() => {
    if (storyboardViewed) {
      console.log("[ux-generator] storyboard complete flag", { viewedAll: true });
    }
  }, [storyboardViewed]);
  useEffect(() => {
    if (dalleVideoCompleted) {
      console.log("[ux-generator] dalle_video complete flag", { voiceoverPlayed: true });
    }
  }, [dalleVideoCompleted]);
  useEffect(() => {
    if (timerCompleted) {
      console.log("[ux-generator] timer complete flag", { completed: true });
    }
  }, [timerCompleted]);
  useEffect(() => {
    if (timerReportValue.trim().length >= 3) {
      console.log("[ux-generator] timer report complete", { value: timerReportValue });
    }
  }, [timerReportValue]);
  useEffect(() => {
    if (timedCuesCompleted) {
      console.log("[ux-generator] timed_cues complete flag", { completed: true });
    }
  }, [timedCuesCompleted]);
  const errorText = useMemo(() => {
    if (!showError || completionValue) return null;
    switch (mod.id) {
      case "textbox":
        return "Please enter at least 3 characters.";
      case "list_textbox":
        return "Please fill at least one item (3+ characters).";
      case "mcq": {
        const allowMultiple = Boolean((mod as any).allow_multiple ?? media.mcqAllowMultiple);
        return allowMultiple ? "Please select at least one option." : "Please choose one option.";
      }
      case "short_audio":
        return "Please play the audio to the end.";
      case "voice_input":
        return "Please record a voice note.";
      case "photo_input":
        return "Please confirm a photo.";
      case "chatbot":
        return "Please send at least two messages.";
      case "image":
        return "Please mark this as viewed.";
      case "storyboard":
        return "Please mark all cards as viewed.";
      case "dalle_video":
        return "Please play the voiceover once.";
      case "timer":
        return "Please finish the timer and write a brief note.";
      case "timed_cues":
        return "Please play the cues to the end.";
      case "stepper":
        return null;
      default:
        return "Please complete this item.";
    }
  }, [showError, completionValue, mod.id]);
  useEffect(() => {
    if (!showError || completionValue) return;
    const details = (() => {
      switch (mod.id) {
        case "textbox":
          return { value: textboxValue };
        case "list_textbox":
          return { values: listTextboxValues };
        case "mcq": {
          const allowMultiple = Boolean((mod as any).allow_multiple ?? media.mcqAllowMultiple);
          return allowMultiple
            ? { selected: Array.from(selectedMulti) }
            : { selectedIndex: selectedRadio };
        }
        case "short_audio":
          return { completed: shortAudioCompleted };
        case "voice_input":
          return { hasRecording: Boolean(voiceAudioUrl) };
        case "photo_input":
          return { photoConfirmed };
        case "chatbot":
          return { userMessages: userMessageCount };
        case "image":
          return { viewed: imageViewed };
        case "storyboard":
          return { viewedAll: storyboardViewed };
        case "dalle_video":
          return { voiceoverPlayed: dalleVideoCompleted };
        case "timer":
          return { timerCompleted, reportValue: timerReportValue };
        case "timed_cues":
          return { completed: timedCuesCompleted };
        default:
          return {};
      }
    })();
    console.log("[ux-generator] module incomplete", { module: mod.id, details });
  }, [
    showError,
    completionValue,
    mod.id,
    textboxValue,
    listTextboxValues,
    selectedRadio,
    selectedMulti,
    shortAudioCompleted,
    voiceAudioUrl,
    photoConfirmed,
    userMessageCount,
    imageViewed,
    storyboardViewed,
    dalleVideoCompleted,
    timerCompleted,
    timerReportValue,
    timedCuesCompleted,
  ]);

  const lastInputCaptureRef = useRef<string>("");
  useEffect(() => {
    if (!onInputCapture) return;
    const payload = (() => {
      switch (mod.id) {
        case "textbox":
          return { text: textboxValue };
        case "list_textbox":
          return { values: listTextboxValues };
        case "mcq": {
          const allowMultiple = Boolean((mod as any).allow_multiple ?? media.mcqAllowMultiple);
          if (allowMultiple) {
            return { allow_multiple: true, selected: Array.from(selectedMulti) };
          }
          const options = Array.isArray(mod?.options)
            ? mod.options
            : Array.isArray(media.mcqOptions)
            ? media.mcqOptions
            : [];
          return {
            allow_multiple: false,
            selectedIndex: selectedRadio,
            selectedValue: selectedRadio != null ? options[selectedRadio] : null,
          };
        }
        case "short_audio":
          return { completed: shortAudioCompleted };
        case "voice_input":
          return { hasRecording: Boolean(voiceAudioUrl), audioUrl: voiceAudioUrl || null };
        case "photo_input":
          return { photoAttached, photoConfirmed };
        case "chatbot":
          return { messages: chatLog };
        case "image":
          return { viewed: imageViewed };
        case "storyboard":
          return { viewedAll: storyboardViewed };
        case "dalle_video":
          return { voiceoverPlayed: dalleVideoCompleted };
        case "timer":
          return { timerCompleted, reportValue: timerReportValue };
        case "timed_cues":
          return { completed: timedCuesCompleted };
        default:
          return {};
      }
    })();
    const nextKey = JSON.stringify(payload);
    if (nextKey === lastInputCaptureRef.current) return;
    lastInputCaptureRef.current = nextKey;
    onInputCapture(moduleKey, payload);
  }, [
    chatLog,
    dalleVideoCompleted,
    imageViewed,
    listTextboxValues,
    mod.id,
    moduleKey,
    onInputCapture,
    photoAttached,
    photoConfirmed,
    selectedMulti,
    selectedRadio,
    shortAudioCompleted,
    storyboardViewed,
    textboxValue,
    timedCuesCompleted,
    timerCompleted,
    timerReportValue,
    voiceAudioUrl,
  ]);

  // Keep timer synced to provided seconds unless currently running
  useEffect(() => {
    const timerInputSeconds =
      timerModuleInput && typeof (timerModuleInput as any).seconds === "number"
        ? (timerModuleInput as any).seconds
        : null;
    const targetSeconds = Math.max(1, Math.round(timerInputSeconds ?? (spec.minutes || 1) * 60));
    if (!timerRunning) {
      setTimerTotal(targetSeconds);
      setTimerRemaining(targetSeconds);
    }
  }, [spec.minutes, timerModuleInput, timerRunning]);

  const ensurePurposeLine = (value: any, fallback: string) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text || fallback;
  };
  const onImageHeadingTone = styles.onImageTextLight;
  const themedModuleClusterCard = paperMode
    ? [styles.moduleClusterCard, styles.paperModuleClusterCard]
    : styles.moduleClusterCard;
  const themedRenderLabel = paperMode
    ? [styles.renderLabel, styles.paperRenderLabel]
    : [styles.renderLabel, onImageHeadingTone];
  const themedRenderBody = paperMode
    ? [styles.renderBody, styles.paperRenderBody]
    : styles.renderBody;
  const themedRenderInput = paperMode
    ? [styles.renderInput, styles.paperRenderInput]
    : styles.renderInput;
  const themedListItemLabel = paperMode
    ? [styles.listItemLabel, styles.paperListItemLabel]
    : styles.listItemLabel;
  const themedViewedBox = paperMode
    ? [styles.viewedBox, styles.paperViewedBox]
    : styles.viewedBox;
  const themedViewedLabel = paperMode
    ? [styles.viewedLabel, styles.paperViewedLabel]
    : styles.viewedLabel;
  const themedRadioOuter = paperMode
    ? [styles.radioOuter, styles.paperRadioOuter]
    : styles.radioOuter;
  const themedRadioInner = paperMode
    ? [styles.radioInner, styles.paperRadioInner]
    : styles.radioInner;
  const themedRenderChip = paperMode
    ? [styles.renderChip, styles.paperRenderChip]
    : styles.renderChip;
  const themedRenderChipSelected = paperMode
    ? [styles.renderChipSelected, styles.paperRenderChipSelected]
    : styles.renderChipSelected;
  const themedRenderChipText = paperMode
    ? [styles.renderChipText, styles.paperRenderChipText]
    : styles.renderChipText;
  const themedTimerInputLabel = paperMode
    ? [styles.timerInputLabel, styles.paperTimerInputLabel]
    : styles.timerInputLabel;
  const themedTimerInput = paperMode
    ? [styles.timerInput, styles.paperTimerInput]
    : styles.timerInput;
  const themedPreviewHint = paperMode
    ? [styles.previewHint, styles.paperPreviewHint]
    : styles.previewHint;
  const themedTimerCard = paperMode
    ? [themedModuleClusterCard, styles.timerCard, styles.paperTimerCard]
    : [themedModuleClusterCard, styles.timerCard];
  const themedTimerCountdown = paperMode
    ? [styles.timerCountdown, styles.paperTimerCountdown]
    : styles.timerCountdown;
  const themedTimerSubtitle = paperMode
    ? [styles.timerSubtitle, styles.paperTimerSubtitle]
    : styles.timerSubtitle;
  const themedTimerActionBox = paperMode
    ? [styles.timerActionBox, styles.paperTimerActionBox]
    : styles.timerActionBox;
  const themedTimerActionLabel = paperMode
    ? [styles.timerActionLabel, styles.paperTimerActionLabel]
    : styles.timerActionLabel;
  const themedTimerActionText = paperMode
    ? [styles.timerActionText, styles.paperTimerActionText]
    : styles.timerActionText;

  switch (mod.id) {
    case "heading":
      return <Text style={[styles.renderHeading, onImageHeadingTone]}>{spec.title || "Section Heading"}</Text>;
    case "textbox":
      return (
        <View style={styles.renderField}>
          <View style={themedModuleClusterCard}>
            <Text style={themedRenderLabel}>{(mod as any).question || media.textQuestion || "Your response"}</Text>
            <TextInput
              style={themedRenderInput}
              placeholder={(mod as any).placeholder || media.textPlaceholder || spec.evidence || "Type here..."}
              placeholderTextColor="#94a3b8"
              value={textboxValue}
              onChangeText={(text) => {
                setTextboxValuesByKey((prev) => ({ ...prev, [moduleKey]: text }));
              }}
              multiline
            />
            {media.qaRationale ? <Text style={themedPreviewHint}>{media.qaRationale}</Text> : null}
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    case "list_textbox": {
      const prompt = (mod as any).prompt || "Write your responses below.";
      const safeItems = listTextboxItems;
      return (
        <View style={styles.renderField}>
          <View style={themedModuleClusterCard}>
            <Text style={themedRenderLabel}>{prompt}</Text>
            <View style={styles.listField}>
              {safeItems.map((item: any, idx: number) => (
                <View key={`list-item-${idx}`} style={styles.listItem}>
                  <Text style={themedListItemLabel}>{item.label || `Item ${idx + 1}`}</Text>
                  <TextInput
                    style={themedRenderInput}
                    placeholder={item.placeholder || "Type here..."}
                    placeholderTextColor="#94a3b8"
                    value={listTextboxValues[idx] || ""}
                    onChangeText={(text) => {
                      setListTextboxValuesByKey((prev) => {
                        const next = { ...prev };
                        const current = next[moduleKey] ? [...next[moduleKey]] : [];
                        while (current.length <= idx) current.push("");
                        current[idx] = text;
                        next[moduleKey] = current;
                        return next;
                      });
                    }}
                    multiline
                  />
                </View>
              ))}
            </View>
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    }
    case "mcq": {
      const allowMultiple = Boolean((mod as any).allow_multiple ?? media.mcqAllowMultiple);
      const question =
        (mod as any).question || media.mcqQuestion || "Choose an option";
      const options = normalizeOptions(
        (mod as any).options && (mod as any).options.length
          ? (mod as any).options
          : media.mcqOptions && media.mcqOptions.length
          ? media.mcqOptions
          : [],
        defaultChoiceOptions
      );
      console.log("[ux-generator] mcq render", {
        question,
        options,
        allow_multiple: allowMultiple,
        module_key: moduleKey,
      });
      return (
        <View style={styles.renderField}>
          <View style={themedModuleClusterCard}>
            <Text style={themedRenderLabel}>{question}</Text>
            {allowMultiple ? (
              <View style={styles.renderChips}>
                {options.map((opt) => {
                  const active = selectedMulti.has(opt);
                  return (
                    <Pressable
                      key={opt}
                      style={[themedRenderChip, active ? themedRenderChipSelected : null]}
                      onPress={() => {
                        setSelectedMulti((prev) => {
                          const next = new Set(prev);
                          if (next.has(opt)) next.delete(opt);
                          else next.add(opt);
                          return next;
                        });
                      }}
                    >
                      <Text style={themedRenderChipText}>{opt}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              options.map((opt, idx) => {
                const active = selectedRadio === idx;
                return (
                  <Pressable key={`mcq-${idx}`} style={styles.radioRow} onPress={() => setSelectedRadio(idx)}>
                    <View style={themedRadioOuter}>
                      {active ? <View style={themedRadioInner} /> : null}
                    </View>
                    <Text style={themedRenderBody}>{opt}</Text>
                  </Pressable>
                );
              })
            )}
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    }
    case "short_audio":
      const script = (media.audioScript || spec.instruction || "A short calming reassurance.").trim();
      const rawPurpose =
        (mod as any).purpose || media.audioPurpose || (mod as any).rationale || media.audioRationale || "";
      const purposeLine = ensurePurposeLine(
        rawPurpose || shortAudioHeader,
        "A personalized voice note to help you settle, reset, and get ready for the next step."
      );
      const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);
      const sentenceWordCounts = sentences.map((s) => s.split(/\s+/).filter(Boolean).length || 1);
      const totalWords = sentenceWordCounts.reduce((sum, n) => sum + n, 0) || 1;

      const updateShortAudioHighlight = (audio: HTMLAudioElement) => {
        const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const duration =
          Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : shortTtsDuration;
        setShortTtsCurrent(current || 0);
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setShortTtsDuration(audio.duration);
        }
        if (!sentences.length) {
          setSpokenSentenceIdx(null);
          return;
        }
        // Some preloaded audio URLs may not expose duration metadata immediately.
        // Keep transcript visible by pinning to the first sentence until timing is known.
        if (!duration || !Number.isFinite(duration) || duration <= 0) {
          if (audioPlaying) {
            setSpokenSentenceIdx((prev) => (prev == null ? 0 : prev));
          }
          return;
        }
        const fraction = Math.max(0, Math.min(1, current / duration));
        const wordsSpoken = fraction * totalWords;
        let running = 0;
        let targetIdx = sentences.length - 1;
        for (let i = 0; i < sentenceWordCounts.length; i += 1) {
          running += sentenceWordCounts[i];
          if (wordsSpoken <= running) {
            targetIdx = i;
            break;
          }
        }
        setSpokenSentenceIdx((prev) => (prev === targetIdx ? prev : targetIdx));
      };

      const bindShortAudioHandlers = (audio: HTMLAudioElement) => {
        audio.onloadedmetadata = () => {
          const d = audio.duration || 0;
          if (Number.isFinite(d) && d > 0) {
            setShortTtsDuration(d);
          }
          setShortAudioLoading(false);
          updateShortAudioHighlight(audio);
        };
        audio.ondurationchange = () => {
          const d = audio.duration || 0;
          if (Number.isFinite(d) && d > 0) {
            setShortTtsDuration(d);
            updateShortAudioHighlight(audio);
          }
        };
        audio.onloadeddata = () => {
          const d = audio.duration || 0;
          if (Number.isFinite(d) && d > 0) {
            setShortTtsDuration(d);
            updateShortAudioHighlight(audio);
          }
        };
        audio.oncanplaythrough = () => setShortAudioLoading(false);
        audio.onerror = () => {
          setShortAudioLoading(false);
          setAudioPlaying(false);
          clearShortTtsTick();
          stopSpokenAmbient();
        };
        audio.onplay = () => {
          setAudioPlaying(true);
          if (sentences.length) {
            setSpokenSentenceIdx((prev) => (prev == null ? 0 : prev));
          }
          updateShortAudioHighlight(audio);
          clearShortTtsTick();
          shortTtsTickRef.current = setInterval(() => updateShortAudioHighlight(audio), 180);
          startSpokenAmbient();
        };
        audio.ontimeupdate = () => updateShortAudioHighlight(audio);
        audio.onpause = () => {
          setAudioPlaying(false);
          clearShortTtsTick();
          stopSpokenAmbient();
        };
        audio.onended = () => {
          updateShortAudioHighlight(audio);
          setAudioPlaying(false);
          clearShortTtsTick();
          stopSpokenAmbient();
          setShortAudioCompleted(true);
        };
      };

      useEffect(() => {
        if (!script) return;
        let cancelled = false;
        const preload = async () => {
          if (shortTtsAudioRef.current || shortTtsUrl) return;
          setShortAudioLoading(true);
          const ttsUrl = await ensureShortTtsUrl(script);
          if (cancelled) return;
          if (ttsUrl && typeof window !== "undefined" && (window as any).Audio) {
            try {
              const audioCtor = (window as any).Audio;
              const audio = new audioCtor(ttsUrl);
              shortTtsAudioRef.current = audio;
              bindShortAudioHandlers(audio);
              audio.preload = "auto";
              setShortTtsUrl(ttsUrl);
            } catch {
              setShortAudioLoading(false);
            }
          } else {
            setShortAudioLoading(false);
          }
        };
        void preload();
        return () => {
          cancelled = true;
        };
      }, [script, shortTtsUrl]);
      useEffect(() => {
        if (shortTtsUrl) return;
        if (!media.audioUrl) return;
        setShortTtsUrl(media.audioUrl);
        if (
          typeof media.audioDurationSeconds === "number" &&
          Number.isFinite(media.audioDurationSeconds) &&
          media.audioDurationSeconds > 0
        ) {
          setShortTtsDuration(media.audioDurationSeconds);
        }
        const source =
          media.audioSource === "gpt" || media.audioSource === "generic"
            ? (media.audioSource as "gpt" | "generic")
            : "unknown";
        setShortTtsSource(source);
        shortTtsSourceRef.current = source;
        console.log("[ux-generator] short_audio preloaded source", {
          voice_source: source,
          duration_seconds:
            typeof media.audioDurationSeconds === "number" && Number.isFinite(media.audioDurationSeconds)
              ? media.audioDurationSeconds
              : null,
          has_audio_url: true,
        });
      }, [media.audioDurationSeconds, media.audioUrl, media.audioSource, shortTtsUrl]);

      useEffect(() => {
        if (rawPurpose) {
          if (shortAudioHeader) setShortAudioHeader("");
          return;
        }
        if (!script) return;
        const key = script.slice(0, 240);
        if (shortAudioHeaderKeyRef.current === key && shortAudioHeader) return;
        if (shortAudioHeaderLoadingRef.current) return;
        shortAudioHeaderLoadingRef.current = true;
        setShortAudioHeaderLoading(true);
        fetchShortAudioHeader(script)
          .then((header) => {
            if (!header) return;
            shortAudioHeaderKeyRef.current = key;
            setShortAudioHeader(header);
          })
          .catch((err) => {
            console.warn("[ux-generator] short_audio header fetch failed", err);
          })
          .finally(() => {
            shortAudioHeaderLoadingRef.current = false;
            setShortAudioHeaderLoading(false);
          });
      }, [fetchShortAudioHeader, rawPurpose, script, shortAudioHeader]);

      const resetSpeech = () => {
        try {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
          }
          if (shortTtsAudioRef.current) {
            shortTtsAudioRef.current.pause();
            shortTtsAudioRef.current.currentTime = 0;
            shortTtsAudioRef.current = null;
          }
        } catch {}
        if (typeof window !== "undefined" && (window as any).speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        clearShortTtsTick();
        stopSpokenAmbient();
        setAudioPlaying(false);
        setSpokenWord(null);
        setSpokenNumber(null);
        setSpokenDisplayCount(0);
        setSpokenSentenceIdx(null);
        setShortTtsCurrent(0);
        setShortTtsDuration(0);
      };

      const speakWithHighlight = async () => {
        if (!script) {
          console.warn("[ux-generator] short_audio no script to read");
          return;
        }
        const ttsUrl = await ensureShortTtsUrl(script);
        if (ttsUrl && typeof window !== "undefined" && (window as any).Audio) {
          const source = shortTtsSourceRef.current === "unknown" ? shortTtsSource : shortTtsSourceRef.current;
          console.log("[ux-generator] short_audio voice_source", {
            source,
            mode: "audio_url",
          });
          try {
            if (shortTtsAudioRef.current) {
              shortTtsAudioRef.current.pause();
              shortTtsAudioRef.current = null;
            }
            const audioCtor = (window as any).Audio;
            const audio = new audioCtor(ttsUrl);
            shortTtsAudioRef.current = audio;
            bindShortAudioHandlers(audio);
            await audio.play().catch(() => {});
            return;
          } catch (err) {
            console.warn("[ux-generator] remote short_tts play failed, falling back", err);
          }
        }
        console.log("[ux-generator] short_audio voice_source", { source: "none", mode: "tts_unavailable" });
        console.warn("[ux-generator] short_audio TTS unavailable, skipping highlight");
      };

      return (
        <View style={styles.renderField}>
          <View style={themedModuleClusterCard}>
            <Text style={themedRenderLabel}>{purposeLine}</Text>
            {shortAudioHeaderLoading ? (
              <Text style={themedPreviewHint}>Generating audio header…</Text>
            ) : null}
            {shortAudioLoading ? (
              <Text style={themedPreviewHint}>Loading AI voiceover…</Text>
            ) : null}
            <View style={styles.renderAudioCard}>
            <View style={styles.audioHeader}>
              <Text style={styles.audioInstruction}>
               Please click the  ▶︎  button to listen to a personalized voice note.
              </Text>
              <View style={{ flex: 1 }} />
              <View style={styles.audioControls}>
                <Pressable
                  style={[styles.audioIconBtn, audioPlaying && styles.audioIconActive]}
                  onPress={() => {
                    if (shortTtsAudioRef.current) {
                      const source =
                        shortTtsSourceRef.current === "unknown" ? shortTtsSource : shortTtsSourceRef.current;
                      console.log("[ux-generator] short_audio voice_source", {
                        source,
                        mode: "preloaded_audio",
                        action: audioPlaying ? "pause" : "play",
                      });
                      if (audioPlaying) {
                        shortTtsAudioRef.current.pause();
                      } else {
                        shortTtsAudioRef.current.play().catch(() => {});
                      }
                      return;
                    }
                    speakWithHighlight();
                  }}
                >
                  <Text style={styles.audioIconText}>{audioPlaying ? "⏸️" : "▶️"}</Text>
                </Pressable>
                <Pressable style={styles.audioIconBtn} onPress={resetSpeech}>
                  <Text style={styles.audioIconText}>⏮️</Text>
                </Pressable>
              </View>
            </View>
            <LinearGradient
              colors={["#f8fafc", "#eef2f7"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.audioGradient}
            >
              <Text style={styles.audioScriptText}>
                {(() => {
                  if (!audioPlaying) return "";
                  if (!script) return "";
                  if (spokenSentenceIdx != null) {
                    return sentences[Math.max(0, spokenSentenceIdx)] || "";
                  }
                  return sentences[0] || "";
                })()}
              </Text>
            </LinearGradient>
          <View
            style={styles.audioScrubWrap}
            onLayout={(e) => setScrubWidth(e.nativeEvent.layout.width)}
          >
                <Pressable
                  style={styles.audioScrubTrack}
                  onPress={(e) => {
                    const player = shortTtsAudioRef.current;
                    if (!player) return;
                    const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : shortTtsDuration;
                    if (!duration || !Number.isFinite(duration) || duration <= 0) return;
                    if (!scrubWidth || !Number.isFinite(scrubWidth) || scrubWidth <= 0) return;
                    const x = e.nativeEvent.locationX;
                    const frac = Math.max(0, Math.min(1, x / scrubWidth));
                    const target = frac * duration;
                    if (!Number.isFinite(target)) return;
                    if (Number.isFinite(player.currentTime)) {
                      player.currentTime = target;
                    }
                    setShortTtsCurrent(target);
                  }}
                >
                <View
                  style={[
                    styles.audioScrubFill,
                    { width: `${shortTtsDuration ? Math.min(100, (shortTtsCurrent / shortTtsDuration) * 100) : 0}%` },
                  ]}
                />
              </Pressable>
              <View style={styles.audioTimeRow}>
                <Text style={styles.audioTimeText}>{formatSeconds(shortTtsCurrent)}</Text>
                <Text style={styles.audioTimeText}>{formatSeconds(shortTtsDuration)}</Text>
              </View>
            </View>
            </View>
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    case "voice_input":
      const voicePurpose = ensurePurposeLine(
        (mod as any).purpose,
        "Say what you are feeling in your own words. Record a short voice note now."
      );
      const startRecording = async () => {
        if (Platform.OS !== "web") {
          console.warn("[ux-generator] voice recording only supported on web");
          return;
        }
        if (voiceRecorderRef.current && voiceRecorderRef.current.state === "recording") return;
        try {
          const mediaDevices = (navigator as any)?.mediaDevices;
          if (!mediaDevices?.getUserMedia) {
            console.warn("[ux-generator] mediaDevices.getUserMedia not available");
            return;
          }
          const stream = await mediaDevices.getUserMedia({ audio: true });
          const RecorderCtor = (window as any).MediaRecorder;
          if (!RecorderCtor) {
            console.warn("[ux-generator] MediaRecorder not available");
            stream.getTracks().forEach((t: any) => t.stop());
            return;
          }
          const recorder = new RecorderCtor(stream);
          voiceRecorderRef.current = recorder;
          voiceChunksRef.current = [];
          if (voiceAudioRef.current) {
            try {
              voiceAudioRef.current.pause();
            } catch {}
            voiceAudioRef.current = null;
          }
          recorder.ondataavailable = (ev: any) => {
            if (ev?.data && ev.data.size > 0) {
              voiceChunksRef.current.push(ev.data);
            }
          };
          recorder.onstop = () => {
            stream.getTracks().forEach((t: any) => t.stop());
            voiceRecorderRef.current = null;
            const blob = new Blob(voiceChunksRef.current, {
              type: recorder.mimeType || "audio/webm",
            });
            if (voiceAudioUrl) {
              try {
                URL.revokeObjectURL(voiceAudioUrl);
              } catch {}
            }
            const url = URL.createObjectURL(blob);
            setVoiceAudioUrl(url);
            setVoiceRecorded(true);
            setVoiceRecording(false);
            console.log("[ux-generator] voice_input complete", { hasRecording: true });
          };
          recorder.start();
          setVoiceRecording(true);
          setVoiceRecorded(false);
        } catch (err) {
          console.warn("[ux-generator] voice recording failed", err);
        }
      };
      const stopRecording = () => {
        const recorder = voiceRecorderRef.current;
        if (!recorder) return;
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      };
      return (
        <View style={styles.renderField}>
          <View style={themedModuleClusterCard}>
            <Text style={themedRenderLabel}>{voicePurpose}</Text>
            <Text style={themedPreviewHint}>
              {(mod as any).prompt || media.textQuestion || "Record a short voice note (15–60s). We’ll save it as evidence."}
            </Text>
            <View style={styles.voiceButtonRow}>
              <Pressable
                style={[styles.voiceButtonPrimary, voiceRecording && styles.voiceButtonActive]}
                onPress={() => {
                  if (voiceRecording) {
                    stopRecording();
                  } else {
                    startRecording();
                  }
                }}
              >
                <Text style={styles.voiceButtonText}>
                  {voiceRecording
                    ? "Stop recording"
                    : voiceRecorded
                    ? "Record a new voice note"
                    : "Record voice note"}
                </Text>
              </Pressable>
            </View>
            {voiceAudioUrl && Platform.OS === "web" ? (
              <View style={styles.voicePlayer}>
                <audio controls src={voiceAudioUrl} style={{ width: "100%" }} />
              </View>
            ) : null}
            <Text style={styles.voiceStatus}>
              {voiceRecording ? "Recording…" : voiceRecorded ? "Recording ready." : "Ready to record."}
            </Text>
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    case "photo_input":
      const photoPurpose = ensurePurposeLine(
        (mod as any).purpose,
        "Capture one photo that matches this moment. Upload it here to save your evidence."
      );
      return (
        <View style={styles.renderField}>
          <View style={themedModuleClusterCard}>
            <Text style={themedRenderLabel}>{photoPurpose}</Text>
            <Text style={themedPreviewHint}>
              {(mod as any).prompt || "Snap or upload a photo that represents how this feels right now."}
            </Text>
            <View style={styles.photoBox}>
              {photoPreviewUrl ? (
                <View style={{ gap: 6, alignItems: "flex-start" }}>
                  <Image source={{ uri: photoPreviewUrl }} style={styles.photoPreview} resizeMode="cover" />
                  <Text style={themedPreviewHint}>Attached: {photoAttached || "Selected photo"}</Text>
                </View>
              ) : photoAttached ? (
                <Text style={themedPreviewHint}>Attached: {photoAttached}</Text>
              ) : (
                <Text style={styles.photoHint}>
                  Take a quick photo with the camera app on your device, then tap “Upload photo” to attach it.
                </Text>
              )}
            </View>
            <View style={styles.renderButtonsRow}>
              <Pressable
                style={styles.renderButton}
                onPress={() => handlePhotoSelect(false)}
                disabled={Boolean(photoAttached && !photoConfirmed)}
              >
                <Text style={styles.renderButtonText}>
                  {photoAttached && !photoConfirmed ? "Change photo" : "Upload photo"}
                </Text>
              </Pressable>
              {photoAttached ? (
                <>
                  <Pressable
                    style={[styles.renderButton, photoConfirmed ? styles.renderButtonGhost : styles.renderButtonActive]}
                    onPress={() => setPhotoConfirmed(true)}
                  >
                    <Text
                      style={[
                        styles.renderButtonText,
                        photoConfirmed ? styles.renderButtonGhostText : undefined,
                      ]}
                    >
                      {photoConfirmed ? "Confirmed" : "Confirm photo"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.renderButton, styles.renderButtonGhost]}
                    onPress={() => {
                      if (photoPreviewUrl) {
                        try {
                          URL.revokeObjectURL(photoPreviewUrl);
                        } catch {}
                        setPhotoPreviewUrl(null);
                      }
                      setPhotoAttached(null);
                      setPhotoConfirmed(false);
                    }}
                  >
                    <Text style={[styles.renderButtonText, styles.renderButtonGhostText]}>Remove</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
            {photoAttached ? (
              <Text style={themedPreviewHint}>
                {photoConfirmed ? "Attachment confirmed for this step." : "Please confirm the photo before moving on."}
              </Text>
            ) : null}
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    case "chatbot": {
      const chatbotPurpose = ensurePurposeLine(
        (mod as any).purpose,
        "Use this chat for quick guidance on this step. Share one concrete thing you need help with."
      );
      const personaText = (mod as any).persona || "You are a calm, concise helper.";
      const firstPromptText =
        (mod as any).first_prompt ||
        "Greet the user briefly, name your role, and state how you can help on this step.";

      const sendChat = async (userText?: string, opts?: { initial?: boolean }) => {
        const msg = (userText || chatInput).trim();
        const isInitial = Boolean(opts?.initial);
        if (!isInitial && (!msg || chatLoading)) return;
        setChatLoading(true);
        setChatVoiceError(null);
        if (!isInitial) {
          setChatLog((log) => [...log, { from: "user", text: msg }]);
          setChatInput("");
        }
        try {
          const history = [...chatLog, ...(isInitial ? [] : [{ from: "user", text: msg }])].map((m) => ({
            role: m.from === "bot" ? "assistant" : "user",
            content: m.text,
          }));
          const kickoff = isInitial
            ? [
                {
                  role: "user",
                  content:
                    "Using the conversation context, greet the user, state your purpose/identity, and invite them to share the next thing that would help. Personalize it but do not repeat their exact words.",
                },
              ]
            : [];
          const resp = await fetch(CHAT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              persona: personaText,
              first_prompt: firstPromptText,
              conversation_context: conversationContext || "",
              conversation: [...kickoff, ...history],
            }),
          });
          const text = await resp.text();
          let data: any = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            console.warn("[ux-generator] chatbot non-JSON response", { status: resp.status, text: text?.slice?.(0, 120) });
          }
          if (resp.ok && data && typeof data?.reply === "string") {
            setChatLog((log) => [...log, { from: "bot", text: data.reply }]);
            if (chatAiVoiceEnabled && Platform.OS === "web" && (window as any).Audio) {
              setChatVoiceReplyPending(true);
              try {
                const ttsResp = await fetch(TTS_URL, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    text: data.reply,
                    speed: 0.97,
                    use_gpt_voice: true,
                    style: "calm, concise, supportive activity coach",
                  }),
                });
                const ttsData = await ttsResp.json();
                if (ttsResp.ok && typeof ttsData?.audio_url === "string") {
                  const audioUrl = toAbsoluteMediaUrl(ttsData.audio_url);
                  setChatVoiceReplyUrl(audioUrl);
                  try {
                    if (chatVoiceReplyAudioRef.current) {
                      chatVoiceReplyAudioRef.current.pause();
                      chatVoiceReplyAudioRef.current.currentTime = 0;
                    }
                  } catch {}
                  const audioCtor = (window as any).Audio;
                  const audio = new audioCtor(audioUrl);
                  chatVoiceReplyAudioRef.current = audio;
                  try {
                    await audio.play();
                  } catch (err) {
                    console.warn("[ux-generator] chatbot voice autoplay blocked", err);
                    setChatVoiceError("Autoplay blocked. Tap “Play last voice reply”.");
                  }
                } else {
                  setChatVoiceError("Couldn’t generate chatbot voice reply.");
                }
              } catch (err) {
                console.warn("[ux-generator] chatbot voice reply failed", err);
                setChatVoiceError("Couldn’t generate chatbot voice reply.");
              } finally {
                setChatVoiceReplyPending(false);
              }
            }
          } else {
            setChatLog((log) => [
              ...log,
              { from: "bot", text: data?.error || "Hmm, I couldn’t reply. Try again." },
            ]);
          }
        } catch (err) {
          console.warn("[ux-generator] chatbot send failed", err);
          setChatLog((log) => [...log, { from: "bot", text: "Error talking to the chatbot. Please retry." }]);
        } finally {
          setChatLoading(false);
        }
      };

      useEffect(() => {
        if (!chatLog.length) {
          sendChat("", { initial: true });
        }
      }, [personaText, firstPromptText, conversationContext]);

      const transcribeChatVoice = async (blob: Blob) => {
        setChatVoiceDraftPending(true);
        setChatVoiceError(null);
        try {
          const resp = await fetch(TRANSCRIBE_URL, {
            method: "POST",
            headers: { "Content-Type": blob.type || "audio/webm" },
            body: blob,
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const transcript = typeof data?.text === "string" ? data.text.trim() : "";
          if (!transcript) throw new Error("empty transcript");
          setChatVoiceDraftText(transcript);
        } catch (err) {
          console.warn("[ux-generator] chatbot voice transcription failed", err);
          setChatVoiceError("Voice transcription failed. Please try again.");
        } finally {
          setChatVoiceDraftPending(false);
        }
      };

      const startChatVoiceRecording = async () => {
        if (Platform.OS !== "web") {
          setChatVoiceError("Voice input is only available on web.");
          return;
        }
        if (chatVoiceRecording) return;
        setChatVoiceError(null);
        try {
          const mediaDevices = (navigator as any)?.mediaDevices;
          if (!mediaDevices?.getUserMedia) {
            setChatVoiceError("Microphone is not available in this browser.");
            return;
          }
          const stream = await mediaDevices.getUserMedia({ audio: true });
          chatVoiceStreamRef.current = stream;
          const RecorderCtor = (window as any).MediaRecorder;
          if (!RecorderCtor) {
            setChatVoiceError("MediaRecorder is not supported in this browser.");
            stream.getTracks().forEach((track: any) => track.stop());
            chatVoiceStreamRef.current = null;
            return;
          }
          const preferredType = RecorderCtor?.isTypeSupported?.("audio/webm") ? "audio/webm" : undefined;
          const recorder = new RecorderCtor(stream, preferredType ? { mimeType: preferredType } : undefined);
          chatVoiceRecorderRef.current = recorder;
          chatVoiceChunksRef.current = [];
          recorder.ondataavailable = (event: any) => {
            if (event?.data?.size) {
              chatVoiceChunksRef.current.push(event.data);
            }
          };
          recorder.onstop = async () => {
            const chunks = chatVoiceChunksRef.current;
            chatVoiceChunksRef.current = [];
            try {
              if (chatVoiceStreamRef.current?.getTracks) {
                chatVoiceStreamRef.current.getTracks().forEach((track: any) => track.stop());
              }
            } catch {}
            chatVoiceStreamRef.current = null;
            chatVoiceRecorderRef.current = null;
            const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            if (blob.size) {
              await transcribeChatVoice(blob);
            }
          };
          recorder.start();
          setChatVoiceRecording(true);
        } catch (err) {
          console.warn("[ux-generator] chatbot voice recording failed", err);
          setChatVoiceError("Microphone access failed.");
          setChatVoiceRecording(false);
          try {
            if (chatVoiceStreamRef.current?.getTracks) {
              chatVoiceStreamRef.current.getTracks().forEach((track: any) => track.stop());
            }
          } catch {}
          chatVoiceStreamRef.current = null;
          chatVoiceRecorderRef.current = null;
        }
      };

      const stopChatVoiceRecording = () => {
        const recorder = chatVoiceRecorderRef.current;
        if (!recorder) return;
        try {
          recorder.stop();
        } catch (err) {
          console.warn("[ux-generator] chatbot voice stop failed", err);
        } finally {
          setChatVoiceRecording(false);
        }
      };

      return (
        <View style={styles.renderField}>
          <View style={themedModuleClusterCard}>
            <Text style={themedRenderLabel}>{chatbotPurpose}</Text>
            <View style={styles.chatBox}>
              {chatLog.map((m, idx) => (
                <View
                  key={`chat-${idx}`}
                  style={[styles.chatBubble, m.from === "bot" ? styles.chatBot : styles.chatUser]}
                >
                  <Text style={styles.chatBubbleText}>{m.text}</Text>
                </View>
              ))}
            </View>
            <View style={styles.chatControlRow}>
              <Pressable
                style={[styles.chatAuxBtn, chatAiVoiceEnabled && styles.chatAuxBtnActive]}
                onPress={() => setChatAiVoiceEnabled((v) => !v)}
              >
                <Text style={styles.chatAuxBtnText}>AI voice: {chatAiVoiceEnabled ? "On" : "Off"}</Text>
              </Pressable>
              <Pressable
                style={[styles.chatAuxBtn, chatVoiceRecording && styles.chatAuxBtnActive]}
                onPress={() => {
                  if (chatVoiceRecording) {
                    stopChatVoiceRecording();
                  } else {
                    startChatVoiceRecording();
                  }
                }}
                disabled={chatLoading}
              >
                <Text style={styles.chatAuxBtnText}>{chatVoiceRecording ? "Stop recording" : "Record voice"}</Text>
              </Pressable>
              <Pressable
                style={[styles.chatAuxBtn, !chatVoiceReplyUrl && styles.chatAuxBtnDisabled]}
                onPress={() => {
                  if (!chatVoiceReplyUrl || Platform.OS !== "web") return;
                  try {
                    if (chatVoiceReplyAudioRef.current) {
                      chatVoiceReplyAudioRef.current.pause();
                      chatVoiceReplyAudioRef.current.currentTime = 0;
                    }
                  } catch {}
                  const AudioCtor = (window as any).Audio;
                  if (!AudioCtor) return;
                  const audio = new AudioCtor(chatVoiceReplyUrl);
                  chatVoiceReplyAudioRef.current = audio;
                  audio.play().catch(() => {
                    setChatVoiceError("Unable to play voice reply in this browser.");
                  });
                }}
                disabled={!chatVoiceReplyUrl}
              >
                <Text style={styles.chatAuxBtnText}>Play last voice reply</Text>
              </Pressable>
            </View>
            <View style={styles.renderButtonsRow}>
              <View style={styles.chatInputRow}>
                <TextInput
                  style={styles.chatInput}
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder="Type a message..."
                  placeholderTextColor="#94a3b8"
                  onSubmitEditing={() => sendChat()}
                  blurOnSubmit={false}
                />
                <Pressable style={styles.chatSendBtn} onPress={() => sendChat()} disabled={chatLoading}>
                  <Text style={styles.chatSendText}>{chatLoading ? "…" : "Send"}</Text>
                </Pressable>
              </View>
            </View>
            {chatVoiceDraftPending ? <Text style={themedPreviewHint}>Transcribing voice note…</Text> : null}
            {chatVoiceReplyPending ? <Text style={themedPreviewHint}>Generating AI voice reply…</Text> : null}
            {chatVoiceDraftText ? (
              <View style={styles.chatVoiceDraftCard}>
                <Text style={styles.chatVoiceDraftTitle}>Voice message ready</Text>
                <Text style={styles.chatVoiceDraftText}>{chatVoiceDraftText}</Text>
                <View style={styles.chatVoiceDraftActions}>
                  <Pressable
                    style={[styles.chatAuxBtn, styles.chatAuxBtnActive]}
                    onPress={() => {
                      const draft = chatVoiceDraftText.trim();
                      if (!draft) return;
                      setChatVoiceDraftText("");
                      sendChat(draft);
                    }}
                  >
                    <Text style={styles.chatAuxBtnText}>Send voice message</Text>
                  </Pressable>
                  <Pressable style={styles.chatAuxBtn} onPress={() => setChatVoiceDraftText("")}>
                    <Text style={styles.chatAuxBtnText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {chatVoiceError ? <Text style={styles.errorText}>{chatVoiceError}</Text> : null}
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    }
    case "image":
      const imagePurpose = ensurePurposeLine(
        (mod as any).purpose,
        "Look at this image for a few seconds. Notice one detail that helps you feel steadier."
      );
      return (
        <View style={styles.renderField}>
          <View style={themedModuleClusterCard}>
            <Text style={themedRenderLabel}>{imagePurpose}</Text>
            <View style={styles.renderImage}>
              {media.imageUrl ? (
                <Image source={{ uri: media.imageUrl }} style={styles.renderImageMedia} resizeMode="cover" />
              ) : (
                <Text style={themedPreviewHint}>Generated image placeholder</Text>
              )}
            </View>
            <Pressable style={styles.viewedRow} onPress={() => setImageViewed((v) => !v)}>
              <View style={[themedViewedBox, imageViewed && styles.viewedBoxChecked]} />
              <Text style={themedViewedLabel}>Viewed</Text>
            </Pressable>
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    case "storyboard":
      const storyboardFrames =
        media.storyboardFrames && media.storyboardFrames.length
          ? media.storyboardFrames
          : ["Card 1", "Card 2", "Card 3"];
      const storyboardCardCount = storyboardFrames.length;
      const storyboardPurposeRaw = ensurePurposeLine(
        (mod as any).purpose || media.storyboardRationale,
        "Use these cards to walk through the step. Read each card and apply it to your situation."
      );
      let storyboardPurposeText =
        storyboardCardCount > 0
          ? storyboardPurposeRaw.replace(
              /\b(?:one|two|three|four|five|\d+)\s+cards?\b/gi,
              `${storyboardCardCount} card${storyboardCardCount === 1 ? "" : "s"}`
            )
          : storyboardPurposeRaw;
      storyboardPurposeText = storyboardPurposeText
        .replace(/\bswipe through\b/gi, "Review")
        .replace(/\bswipe\b/gi, "Review");
      return (
        <View style={styles.renderField}>
          <View style={themedModuleClusterCard}>
            <Text style={themedRenderLabel}>{storyboardPurposeText}</Text>
            <View style={styles.storyboardRow}>
              {storyboardFrames.map(
                (frame, i) => {
                  const img = media.storyboardImages && media.storyboardImages[i];
                  const frameObj = frame && typeof frame === "object" ? (frame as any) : null;
                  const rawTitle =
                    (frameObj && typeof frameObj.title === "string" && frameObj.title.trim()) ||
                    (typeof frame === "string" ? frame.split(":")[0]?.trim() : "");
                  const rawBody =
                    (frameObj && typeof frameObj.line === "string" && frameObj.line.trim()) ||
                    (frameObj && typeof frameObj.description === "string" && frameObj.description.trim()) ||
                    (frameObj && typeof frameObj.content === "string" && frameObj.content.trim()) ||
                    (typeof frame === "string" ? frame.split(":").slice(1).join(":").trim() : "");
                  const headline = String(rawTitle || `Card ${i + 1}`).replace(/\s+/g, " ").trim();
                  const body = String(rawBody || "").replace(/\s+/g, " ").trim();
                  return (
                    <View key={`card-${i}`} style={styles.storyCard}>
                      {img ? <Image source={{ uri: img }} style={styles.storyImage} resizeMode="cover" /> : <View style={styles.storyImage} />}
                      <View style={styles.storyOverlay}>
                        <Text style={styles.storyTitle}>{headline}</Text>
                        {body ? <Text style={styles.storyBody}>{body}</Text> : null}
                      </View>
                    </View>
                  );
                }
              )}
            </View>
            <Pressable style={styles.viewedRow} onPress={() => setStoryboardViewed((v) => !v)}>
              <View style={[themedViewedBox, storyboardViewed && styles.viewedBoxChecked]} />
              <Text style={themedViewedLabel}>Viewed all cards</Text>
            </Pressable>
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    case "dalle_video":
      const videoPurposeText = ensurePurposeLine(
        (mod as any).purpose || media.videoRationale,
        "Watch this video to reset your focus. Follow the pacing and stay with each beat."
      );
      const bindVideoAudioHandlers = (audio: HTMLAudioElement) => {
        audio.onloadedmetadata = () => {
          setVideoDuration(audio.duration || 0);
        };
        audio.onplay = () => {
          setVideoPlaying(true);
          setVideoSyncMode("audio");
          startVideoAmbient();
        };
        audio.onpause = () => {
          setVideoPlaying(false);
          stopVideoAmbient();
          clearVideoSync();
          setVideoSyncMode(null);
        };
        audio.onended = () => {
          setVideoPlaying(false);
          stopVideoAmbient();
          setDalleVideoCompleted(true);
          clearVideoSync();
          setVideoSyncMode(null);
        };
        audio.onerror = () => {
          setVideoPlaying(false);
          stopVideoAmbient();
          clearVideoSync();
          setVideoSyncMode(null);
        };
      };
      return (
        <View style={styles.renderField}>
          <View style={themedModuleClusterCard}>
            <Text style={themedRenderLabel}>{videoPurposeText}</Text>
            {media.videoUrls && media.videoUrls.length ? (
              <>
              <View style={styles.videoFrame}>
                <Image source={{ uri: media.videoUrls[videoIdx] }} style={styles.videoImage} resizeMode="cover" />
                {effectiveVideoScript[videoIdx] ? (
                  <View style={styles.videoCaption}>
                    <Text style={styles.videoCaptionText}>
                      {effectiveVideoScript[videoIdx]}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6, alignItems: "center" }}>
                {(media.videoAudioUrl || effectiveVideoScript.length) ? (
                  <Pressable
                    style={styles.renderButton}
                    onPress={() => {
                      if (Platform.OS !== "web") return;
                      if (media.videoAudioUrl) {
                        try {
                          const AudioCtor = (window as any).Audio;
                        if (!videoAudioRef.current) {
                          const audio = new AudioCtor(media.videoAudioUrl) as HTMLAudioElement;
                          videoAudioRef.current = audio;
                          bindVideoAudioHandlers(audio);
                          console.log("[ux-generator] dalle_video voiceover element created");
                        }
                        if (videoPlaying) {
                          videoAudioRef.current.pause();
                          console.log("[ux-generator] dalle_video voiceover paused");
                        } else {
                          console.log("[ux-generator] dalle_video voiceover play attempt", media.videoAudioUrl);
                          videoAudioRef.current.play().catch(() => {
                            setVideoPlaying(false);
                          });
                        }
                      } catch (e) {
                        console.warn("[ux-generator] dalle_video voiceover play failed", e);
                      }
                    } else if (effectiveVideoScript.length) {
                      const synth = (typeof window !== "undefined" && (window as any).speechSynthesis) || null;
                      if (!synth) return;
                      if (synth.speaking && !synth.paused) {
                        synth.pause();
                        stopVideoAmbient();
                        setVideoPlaying(false);
                        clearVideoSync();
                        setVideoSyncMode(null);
                        console.log("[ux-generator] dalle_video speech paused");
                      } else {
                        if (synth.paused) {
                          synth.resume();
                          startVideoAmbient();
                          setVideoPlaying(true);
                          setVideoSyncMode("speech");
                          console.log("[ux-generator] dalle_video speech resume");
                        } else {
                          const lines = effectiveVideoScript;
                          if (!lines.length) return;
                          synth.cancel();
                          let idx = 0;
                          const speakLine = () => {
                            if (idx >= lines.length) {
                              setVideoPlaying(false);
                              stopVideoAmbient();
                              setDalleVideoCompleted(true);
                              clearVideoSync();
                              setVideoSyncMode(null);
                              return;
                            }
                            const utter = new SpeechSynthesisUtterance(lines[idx]);
                            utter.rate = 0.95;
                            utter.pitch = 1.0;
                            utter.onstart = () => {
                              setVideoIdx(idx);
                            };
                            utter.onend = () => {
                              idx += 1;
                              setTimeout(speakLine, 150);
                            };
                            synth.speak(utter);
                          };
                          startVideoAmbient();
                          setVideoPlaying(true);
                          setVideoSyncMode("speech");
                          console.log("[ux-generator] dalle_video speech play");
                          speakLine();
                        }
                      }
                    }
                  }}
                >
                    <Text style={styles.renderButtonText}>{videoPlaying ? "Pause" : "Play"}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.renderButton}
                  onPress={() => {
                    if (Platform.OS !== "web") return;
                    if (videoAudioRef.current) {
                      videoAudioRef.current.pause();
                      videoAudioRef.current.currentTime = 0;
                    }
                    if (typeof window !== "undefined" && (window as any).speechSynthesis) {
                      try {
                        window.speechSynthesis.cancel();
                      } catch {}
                    }
                    stopVideoAmbient();
                    setVideoIdx(0);
                    setVideoPlaying(false);
                    clearVideoSync();
                    setVideoSyncMode(null);
                  }}
                >
                  <Text style={styles.renderButtonText}>Reset</Text>
                </Pressable>
              </View>
              </>
            ) : (
              <View style={styles.renderImage}>
                <Text style={themedPreviewHint}>Frame with caption overlay</Text>
              </View>
            )}
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    case "timer":
      return (
        <View style={styles.renderField}>
          {(() => {
            const timerInput = timerModuleInput as any;
            const timerInputSeconds =
              timerInput && typeof timerInput.seconds === "number" ? timerInput.seconds : null;
            const timerActionText =
              (timerInput && (timerInput.action || timerInput.activity || timerInput.task)) ||
              spec.instruction ||
              "Pick one calming action to do while the timer runs.";
            const defaultSeconds = Math.max(1, Math.round(timerInputSeconds ?? (spec.minutes || 1) * 60));
            const durationLabel =
              defaultSeconds >= 60
                ? `${Math.round(defaultSeconds / 60)} minute${Math.round(defaultSeconds / 60) === 1 ? "" : "s"}`
                : `${defaultSeconds} seconds`;
            const timerPurposeFallback = `Use this timer for ${durationLabel}. Start when ready, and continue longer if you want.`;
            const rawTimerPurpose = typeof (mod as any).purpose === "string" ? (mod as any).purpose : "";
            const durationMatch = rawTimerPurpose.match(/\b(\d+)\s*(minute|min|second|sec)\b/i);
            const purposeDurationSeconds = durationMatch
              ? Number(durationMatch[1]) * (/^m/i.test(durationMatch[2]) ? 60 : 1)
              : null;
            const hasDurationMismatch =
              typeof purposeDurationSeconds === "number" &&
              Number.isFinite(purposeDurationSeconds) &&
              Math.abs(purposeDurationSeconds - defaultSeconds) >= 30;
            const timerPurpose = ensurePurposeLine(
              hasDurationMismatch ? "" : rawTimerPurpose,
              timerPurposeFallback
            );
            const total = timerTotal || defaultSeconds;
            const remaining = typeof timerRemaining === "number" ? timerRemaining : total;
            const pct = Math.max(0, Math.min(1, total ? remaining / total : 0));
            const timerPaused = !timerRunning && remaining < total && remaining > 0;
            const primaryLabel = timerRunning ? "Pause" : timerPaused ? "Resume" : "Start";
            const fmt = (secs: number) => {
              const m = Math.floor(secs / 60)
                .toString()
                .padStart(2, "0");
              const s = Math.floor(secs % 60)
                .toString()
                .padStart(2, "0");
              return `${m}:${s}`;
            };
            return (
              <>
                <View style={themedTimerCard}>
                  <Text style={themedRenderLabel}>{timerPurpose}</Text>
                  <View style={styles.timerPulseWrap}>
                    <View style={[styles.timerPulse, { opacity: timerRunning ? 0.28 : 0.16, transform: [{ scale: timerRunning ? 1.05 : 1 }] }]} />
                    <View style={[styles.timerPulse, styles.timerPulseInner, { opacity: timerRunning ? 0.5 : 0.25 }]} />
                  </View>
                  <View style={styles.timerDial}>
                    <Text style={styles.timerIcon}>⏳</Text>
                    <Text style={themedTimerCountdown}>{fmt(remaining)}</Text>
                    <Text style={themedTimerSubtitle}>
                      {timerRunning ? "Counting down..." : timerPaused ? "Paused" : "Ready to begin"}
                    </Text>
                  </View>
                  <View style={themedTimerActionBox}>
                    <Text style={themedTimerActionLabel}>Press Start when ready. This is a minimum duration, and you can keep going longer.</Text>
                    <Text style={themedTimerActionText}>{timerActionText}</Text>
                  </View>
                  <View style={styles.timerProgressTrack}>
                    <View style={[styles.timerProgressFill, { width: `${Math.max(6, pct * 100)}%` }]} />
                  </View>
                  <View style={styles.renderTimer}>
                    <Pressable
                      style={styles.renderButton}
                      onPress={() => {
                        if (timerRunning) {
                          pauseTimer();
                        } else if (timerPaused) {
                          startSimpleTimer(remaining, { resume: true });
                        } else {
                          startSimpleTimer(defaultSeconds);
                        }
                      }}
                    >
                      <Text style={styles.renderButtonText}>{primaryLabel}</Text>
                    </Pressable>
                    <Pressable style={styles.renderButton} onPress={resetTimer}>
                      <Text style={styles.renderButtonText}>Reset</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={[themedModuleClusterCard, styles.timerFollowupCard]}>
                  <View style={styles.timerInputBox}>
                    <Text style={themedTimerInputLabel}>
                      {timerInput?.report_prompt || "Quick note after the timer:"}
                    </Text>
                    <TextInput
                      style={themedTimerInput}
                      placeholder={timerInput?.report_placeholder || "What did you notice or complete?"}
                      placeholderTextColor="#94a3b8"
                      value={timerReportValue}
                      onChangeText={setTimerReportValue}
                      multiline
                    />
                  </View>
                  <Text style={themedPreviewHint}>Targets {defaultSeconds}s</Text>
                  {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
                </View>
              </>
            );
          })()}
        </View>
      );
    case "timed_cues":
      const timedScript = (media.timerScript || spec.instruction || "Follow these calming cues at your own pace.").trim();
      const timedFallbackDurationEstimate = Math.max(
        12,
        Math.round(
          timedScript
            .split(/\s+/)
            .filter(Boolean).length / 2.1
        )
      );
      const timedCueSteps =
        (Array.isArray(media.timerSteps) && media.timerSteps.length
          ? media.timerSteps
          : Array.isArray((mod as any).timer_steps)
          ? (mod as any).timer_steps
          : []) || [];
      const timedCueSecondsFromSteps = timedCueSteps.reduce(
        (sum: number, step: any) =>
          sum + (Number.isFinite(Number(step?.duration_seconds)) ? Number(step.duration_seconds) : 0),
        0
      );
      const timedCueTotalSeconds = Math.max(
        0,
        Number.isFinite(timedCueSecondsFromSteps) ? timedCueSecondsFromSteps : 0
      );
      const timedCuePattern = timedCueSteps
        .slice(0, 4)
        .map((step: any) => {
          const label = String(step?.label || "").trim();
          const secs = Number(step?.duration_seconds);
          if (!label) return "";
          if (Number.isFinite(secs) && secs > 0) return `${label.toLowerCase()} ${Math.round(secs)}s`;
          return label.toLowerCase();
        })
        .filter(Boolean)
        .join(", ");
      const timedCueDurationText =
        timedCueTotalSeconds >= 60
          ? `${Math.round(timedCueTotalSeconds / 60)} minute${Math.round(timedCueTotalSeconds / 60) === 1 ? "" : "s"}`
          : `${Math.max(10, Math.round(timedCueTotalSeconds || timedFallbackDurationEstimate))} seconds`;
      const timedCuesPurpose = ensurePurposeLine(
        (mod as any).purpose,
        `Now we will do a short breathing reset to settle your body and mind. Press Play and follow each cue${timedCuePattern ? ` (${timedCuePattern})` : ""} for about ${timedCueDurationText}.`
      );
      const timedTimelineDuration =
        timedCuesDuration || timedCueTotalSeconds || timedFallbackDurationEstimate;
      const updateTimedCuesProgress = (audio: HTMLAudioElement) => {
        const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const duration =
          Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : timedCuesDuration;
        setTimedCuesCurrent(current || 0);
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setTimedCuesDuration(audio.duration);
        } else if (duration && Number.isFinite(duration)) {
          setTimedCuesDuration(duration);
        }
      };
      const bindTimedCuesAudioHandlers = (audio: HTMLAudioElement) => {
        audio.oncanplaythrough = () => setTimedCuesAudioLoading(false);
        audio.onloadedmetadata = () => {
          setTimedCuesAudioLoading(false);
          updateTimedCuesProgress(audio);
        };
        audio.onerror = () => {
          setTimedCuesAudioLoading(false);
          setTimedCuesPlaying(false);
          clearTimedCuesTick();
          stopSpokenAmbient();
        };
        audio.onplay = () => {
          setTimedCuesPlaying(true);
          updateTimedCuesProgress(audio);
          clearTimedCuesTick();
          timedCuesTickRef.current = setInterval(() => updateTimedCuesProgress(audio), 180);
          startSpokenAmbient();
        };
        audio.ontimeupdate = () => updateTimedCuesProgress(audio);
        audio.onpause = () => {
          setTimedCuesPlaying(false);
          clearTimedCuesTick();
          stopSpokenAmbient();
        };
        audio.onended = () => {
          updateTimedCuesProgress(audio);
          setTimedCuesPlaying(false);
          clearTimedCuesTick();
          stopSpokenAmbient();
          setTimedCuesCompleted(true);
          console.log("[ux-generator] timed_cues complete (audio)");
        };
      };
      useEffect(() => {
        if (!media.timerAudioUrl || timerAudioRef.current) return;
        if (Platform.OS !== "web") return;
        try {
          const AudioCtor = (window as any).Audio;
          setTimedCuesAudioLoading(true);
          const audio = new AudioCtor(media.timerAudioUrl);
          timerAudioRef.current = audio;
          bindTimedCuesAudioHandlers(audio);
          audio.loop = false;
          audio.volume = 0.9;
          audio.preload = "auto";
        } catch {
          setTimedCuesAudioLoading(false);
        }
      }, [media.timerAudioUrl, clearTimedCuesTick, timedCuesDuration]);
      useEffect(() => {
        if (media.timerAudioUrl) return;
        if (!timedCuesPlaying) {
          clearTimedCuesTick();
          return;
        }
        const duration = timedCuesDuration || timedFallbackDurationEstimate;
        if (!duration || !Number.isFinite(duration) || duration <= 0) return;
        clearTimedCuesTick();
        timedCuesTickRef.current = setInterval(() => {
          setTimedCuesCurrent((prev) => {
            const next = Math.min(duration, prev + 0.2);
            if (next >= duration) {
              clearTimedCuesTick();
              stopSpokenAmbient();
              setTimedCuesPlaying(false);
              setTimedCuesCompleted(true);
              console.log("[ux-generator] timed_cues complete");
            }
            return next;
          });
        }, 200);
        return () => {
          clearTimedCuesTick();
        };
      }, [
        media.timerAudioUrl,
        timedCuesPlaying,
        timedCuesDuration,
        timedFallbackDurationEstimate,
        clearTimedCuesTick,
      ]);
      return (
        <View style={styles.renderField}>
          <View style={[styles.timedCuesAlignedWidth, themedModuleClusterCard]}>
            <Text style={[themedRenderLabel, styles.timedCuesLead]}>{timedCuesPurpose}</Text>
            <View style={styles.timedCuesTopRow}>
              <View style={styles.timedCuesMotionPane}>
                <CalmingMotionLite active={timedCuesPlaying} />
              </View>
            </View>
            {timedCuesAudioLoading ? (
              <Text style={themedPreviewHint}>Loading AI voiceover...</Text>
            ) : null}
            <View style={styles.audioScrubWrap}>
            <View style={styles.audioScrubTrack}>
              <View
                style={[
                  styles.audioScrubFill,
                  {
                    width: `${timedTimelineDuration ? Math.min(100, (timedCuesCurrent / timedTimelineDuration) * 100) : 0}%`,
                  },
                ]}
              />
            </View>
            <View style={styles.audioTimeRow}>
              <Text style={styles.audioTimeText}>{formatSeconds(timedCuesCurrent)}</Text>
              <Text style={styles.audioTimeText}>{formatSeconds(timedTimelineDuration)}</Text>
            </View>
            </View>
            <View style={styles.renderButtonsRow}>
            <Pressable
              style={styles.renderButton}
              onPress={() => {
                if (media.timerAudioUrl) {
                  if (media.timerAudioSource === "unknown") {
                    console.warn(
                      "[ux-generator] timed_cues playback source is unknown; server metadata may be missing"
                    );
                  }
                  console.log("[ux-generator] timed_cues voice_source", {
                    source: media.timerAudioSource || "unknown",
                    mode: "audio_url",
                  });
                  if (Platform.OS !== "web") {
                    console.warn("[ux-generator] timed_cues audio playback only on web");
                    return;
                  }
                  const AudioCtor = (window as any).Audio;
                  if (!timerAudioRef.current) {
                    setTimedCuesAudioLoading(true);
                    const audio = new AudioCtor(media.timerAudioUrl) as HTMLAudioElement;
                    timerAudioRef.current = audio;
                    bindTimedCuesAudioHandlers(audio);
                    audio.loop = false;
                    audio.volume = 0.9;
                    audio.preload = "auto";
                  }
                  if (timedCuesPlaying) {
                    timerAudioRef.current.pause();
                  } else {
                    timerAudioRef.current.play().catch((e: any) =>
                      console.warn("[ux-generator] timed_cues audio play err", e)
                    );
                  }
                  return;
                }
                console.log("[ux-generator] timed_cues voice_source", { source: "none", mode: "no_audio_url" });
                if (timedCuesPlaying) {
                  clearTimedCuesTick();
                  stopSpokenAmbient();
                  setTimedCuesPlaying(false);
                  return;
                }
                const duration = timedCuesDuration || timedFallbackDurationEstimate;
                if (!timedCuesDuration) setTimedCuesDuration(duration);
                if (timedCuesCurrent >= duration) setTimedCuesCurrent(0);
                clearTimedCuesTick();
                startSpokenAmbient();
                setTimedCuesPlaying(true);
              }}
            >
              <Text style={styles.renderButtonText}>{timedCuesPlaying ? "Pause" : "Play"}</Text>
            </Pressable>
            <Pressable
              style={[styles.renderButton, styles.renderButtonGhost]}
              onPress={() => {
                if (timerAudioRef.current) {
                  try {
                    timerAudioRef.current.pause();
                    timerAudioRef.current.currentTime = 0;
                  } catch {}
                }
                setTimedCuesCurrent(0);
                setTimedCuesDuration(0);
                clearTimedCuesTick();
                stopSpokenAmbient();
                setSpokenWord(null);
                setTimedCuesPlaying(false);
                console.log("[ux-generator] timed_cues reset");
              }}
            >
              <Text style={[styles.renderButtonText, styles.renderButtonGhostText]}>Reset</Text>
            </Pressable>
            </View>
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );
    default:
      return <Text style={themedRenderBody}>{mod.label}</Text>;
  }
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "transparent",
  },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    padding: 12,
    gap: 4,
    backgroundColor: "transparent",
  },
  heading: {
    fontSize: 24,
    color: "#0f172a",
    fontWeight: "800",
  },
  subheading: {
    fontSize: 14,
    color: "#475569",
  },
  errorText: { color: "#f87171", fontSize: 12 },
  grid: {
    flexDirection: "row",
    gap: 14,
  },
  gridSingle: {
    flexDirection: "column",
  },
  card: {
    flex: 1,
    backgroundColor: "transparent",
    borderRadius: 0,
    padding: 0,
    borderWidth: 0,
    borderColor: "transparent",
    gap: 10,
  },
  inputCard: {
    flex: 0.7,
  },
  previewCard: {
    flex: 1.3,
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    shadowOpacity: 0,
  },
  previewCardFull: {
    flex: 1,
    backgroundColor: "transparent",
  },
  label: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 13,
  },
  input: {
    minHeight: 240,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d6dee8",
    color: "#0f172a",
    padding: 10,
    textAlignVertical: "top",
    fontSize: 14,
    backgroundColor: "#ffffff",
  },
  button: {
    alignSelf: "flex-start",
    backgroundColor: "#1f8ef1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { color: "#ffffff", fontWeight: "800", fontSize: 13 },
  previewHeader: { gap: 6 },
  previewTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
  },
  inputToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#c7ddf9",
    backgroundColor: "#e9f2ff",
  },
  inputToggleText: { color: "#0f172a", fontWeight: "700", fontSize: 12 },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#e9f2ff",
    borderWidth: 1,
    borderColor: "#c7ddf9",
  },
  badgeText: { color: "#0f172a", fontWeight: "700", fontSize: 12 },
  screenCount: { color: "#475569", fontSize: 13, fontWeight: "700" },
  title: { color: "#0f172a", fontSize: 21, fontWeight: "800" },
  status: { color: "#475569", fontSize: 13 },
  completionHint: { color: "#c2410c", fontSize: 12 },
  metaText: { color: "#64748b", fontSize: 13, fontWeight: "600" },
  stepList: { gap: 4 },
  stepText: { color: "#0f172a", fontSize: 15, lineHeight: 21 },
  screenNavBottom: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  screenHidden: {
    position: "absolute",
    opacity: 0,
    height: 0,
    overflow: "hidden",
    pointerEvents: "none",
  },
  screenVisible: {
    position: "relative",
  },
  bottomBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#c7ddf9",
    backgroundColor: "#e9f2ff",
  },
  bottomBtnPrimary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#1f8ef1",
  },
  bottomBtnPressed: { opacity: 0.85 },
  bottomBtnDisabled: { opacity: 0.5 },
  bottomBtnText: { color: "#0f172a", fontWeight: "800", fontSize: 12 },
  bottomBtnPrimaryText: { color: "#ffffff", fontWeight: "800", fontSize: 12 },
  section: { gap: 6 },
  body: { color: "#0f172a", fontSize: 15, lineHeight: 21 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#e9f2ff",
    borderWidth: 1,
    borderColor: "#c7ddf9",
  },
  chipLabel: { color: "#0f172a", fontWeight: "700", fontSize: 12 },
  screenNav: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  navButtons: { flexDirection: "row", gap: 8 },
  navBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d6dee8",
    backgroundColor: "#edf2f7",
  },
  navBtnPressed: { opacity: 0.85 },
  navBtnDisabled: { opacity: 0.45 },
  navBtnText: { color: "#0f172a", fontWeight: "700", fontSize: 12 },
  previewBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#dfe6ef",
    backgroundColor: "#f8fafc",
    padding: 12,
  },
  previewHint: { color: "#e2e8f0", fontSize: 16, lineHeight: 24 },
  candidateList: { gap: 10 },
  candidateGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  candidateCard: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 220,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dfe6ef",
    padding: 12,
    backgroundColor: "#f8fafc",
    gap: 6,
  },
  candidateHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  candidateTitle: { color: "#0f172a", fontWeight: "800", fontSize: 14 },
  candidateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#e9f2ff",
    borderWidth: 1,
    borderColor: "#c7ddf9",
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 12,
  },
  candidateInstruction: { color: "#334155", fontSize: 13 },
  candidateModules: { color: "#0f172a", fontSize: 12, fontWeight: "600" },
  candidateScores: { gap: 4, marginTop: 4 },
  candidateScoreRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  candidateScoreKey: { color: "#0f172a", fontSize: 12, fontWeight: "700" },
  candidateScoreVal: { color: "#0f172a", fontSize: 12 },
  candidateNote: { color: "#334155", fontSize: 12, marginLeft: 4, flexShrink: 1 },
  scoreTable: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dfe6ef",
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  scoreRowHeader: {
    flexDirection: "row",
    backgroundColor: "#eef5ff",
    borderBottomWidth: 1,
    borderBottomColor: "#dfe6ef",
  },
  scoreRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#dfe6ef",
  },
  scoreCell: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    fontSize: 11,
    color: "#0f172a",
    textAlign: "center",
  },
  scoreHeaderCell: {
    fontWeight: "800",
  },
  scoreCandidateCell: {
    flex: 1.6,
    textAlign: "left",
    fontWeight: "700",
  },
  modulesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  moduleCard: {
    width: "48%",
    minWidth: 220,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dfe6ef",
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 4,
  },
  moduleTitle: { color: "#0f172a", fontWeight: "800", fontSize: 14 },
  moduleRole: { color: "#0f172a", fontSize: 13 },
  moduleParams: { color: "#0f172a", fontSize: 12 },
  modulePills: { flexDirection: "row", gap: 6, marginTop: 4 },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#e9f2ff",
    borderWidth: 1,
    borderColor: "#c7ddf9",
  },
  pillText: { color: "#0f172a", fontWeight: "700", fontSize: 11 },
  modulesStack: { gap: 10, marginTop: 0 },
  block: {
    borderRadius: 0,
    borderWidth: 0,
    borderColor: "transparent",
    padding: 0,
    backgroundColor: "transparent",
  },
  moduleBreak: {
    height: 20,
  },
  renderHeading: { color: "#f8fafc", fontSize: 28, fontWeight: "800", lineHeight: 36 },
  renderLabel: {
    color: "#f8fafc",
    fontWeight: "700",
    fontSize: 18,
    lineHeight: 25,
    alignSelf: "flex-start",
    marginBottom: 6,
    textShadowColor: "rgba(2,6,23,0.72)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  onImageTextDark: {
    color: "#0b1224",
    textShadowColor: "rgba(255,255,255,0.24)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  onImageTextLight: {
    color: "#f8fafc",
    textShadowColor: "rgba(2,6,23,0.64)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  renderBody: { color: "#e2e8f0", fontSize: 18, lineHeight: 26 },
  renderField: {
    gap: 10,
    marginBottom: 8,
    width: "100%",
    maxWidth: 1220,
    alignSelf: "center",
  },
  moduleClusterCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.45)",
    backgroundColor: "rgba(2,6,23,0.72)",
    padding: 18,
    gap: 12,
    shadowColor: "#020617",
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
  },
  listField: { gap: 10 },
  listItem: { gap: 6 },
  listItemLabel: { color: "#f1f5f9", fontSize: 17, fontWeight: "700", lineHeight: 24 },
  viewedRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  viewedBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    backgroundColor: "rgba(15,23,42,0.35)",
  },
  viewedBoxChecked: {
    backgroundColor: "#1f8ef1",
    borderColor: "#1f8ef1",
  },
  viewedLabel: { color: "#f1f5f9", fontSize: 16, fontWeight: "700", lineHeight: 22 },
  renderInput: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.42)",
    padding: 14,
    color: "#f8fafc",
    backgroundColor: "rgba(15,23,42,0.5)",
    minHeight: 96,
    fontSize: 18,
    lineHeight: 26,
    textAlignVertical: "top",
  },
  radioRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#f8fafc" },
  renderChips: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  renderChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(15,23,42,0.36)",
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.55)",
  },
  renderChipSelected: {
    backgroundColor: "rgba(37,99,235,0.35)",
    borderColor: "rgba(147,197,253,0.85)",
  },
  renderChipText: { color: "#f8fafc", fontWeight: "700", fontSize: 17, lineHeight: 22 },
  counterPreview: {
    marginTop: 8,
    gap: 4,
  },
  counterText: {
    color: "#0f172a",
    fontSize: 13,
  },
  renderAudio: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d6dee8",
    padding: 10,
  },
  renderAudioCard: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.42)",
    backgroundColor: "rgba(15,23,42,0.46)",
    gap: 10,
    padding: 14,
    alignSelf: "stretch",
  },
  audioHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  audioInstruction: {
    fontSize: 12,
    color: "#cbd5e1",
    lineHeight: 18,
    flexShrink: 1,
  },
  audioControls: { flexDirection: "row", gap: 10 },
  audioIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.42)",
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.35)",
  },
  audioIconActive: { backgroundColor: "rgba(37,99,235,0.5)", borderColor: "#93c5fd" },
  audioIconText: { color: "#f8fafc", fontSize: 20, fontWeight: "800" },
  audioGradient: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.35)",
    width: "100%",
  },
  audioScrubWrap: {
    gap: 6,
    marginTop: 6,
  },
  audioScrubTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: "rgba(148,163,184,0.4)",
    overflow: "hidden",
  },
  audioScrubFill: {
    height: "100%",
    backgroundColor: "#1f8ef1",
  },
  audioTimeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  audioTimeText: {
    color: "#e2e8f0",
    fontSize: 14,
  },
  renderButton: {
    backgroundColor: "#1f8ef1",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  renderButtonGhost: {
    backgroundColor: "rgba(15,23,42,0.42)",
  },
  renderButtonGhostText: { color: "#f8fafc" },
  renderButtonActive: { backgroundColor: "#10b981" },
  renderButtonsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  renderButtonDisabled: {
    opacity: 0.5,
  },
  renderButtonText: { color: "#f8fafc", fontWeight: "800", fontSize: 17 },
  renderImage: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.4)",
    backgroundColor: "rgba(15,23,42,0.46)",
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 120,
  },
  renderImageMedia: {
    width: "100%",
    aspectRatio: 4 / 3,
    minHeight: 220,
    maxHeight: 520,
    borderRadius: 10,
    backgroundColor: "transparent",
  },
  voiceStatus: { color: "#e2e8f0", fontSize: 15, lineHeight: 22, marginTop: 6 },
  voiceButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  voiceButtonPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#22d3ee",
    borderWidth: 1,
    borderColor: "#18b4c8",
  },
  voiceButtonActive: {
    backgroundColor: "#0ea5e9",
    borderColor: "#1d9bd7",
  },
  voiceButtonDisabled: {
    opacity: 0.55,
  },
  voiceButtonText: {
    color: "#f8fafc",
    fontWeight: "800",
    fontSize: 16,
  },
  voicePlayer: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.45)",
    backgroundColor: "rgba(15,23,42,0.32)",
  },
  photoBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.45)",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "rgba(15,23,42,0.24)",
  },
  photoPreview: {
    width: 180,
    height: 120,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d6dee8",
  },
  photoHint: {
    color: "#cbd5e1",
    fontSize: 16,
    lineHeight: 24,
  },
  chatBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.45)",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "rgba(15,23,42,0.26)",
    gap: 6,
    alignSelf: "stretch",
  },
  chatBubble: {
    padding: 8,
    borderRadius: 10,
    maxWidth: "90%",
  },
  chatBot: {
    backgroundColor: "rgba(59,130,246,0.2)",
    alignSelf: "flex-start",
  },
  chatUser: {
    backgroundColor: "rgba(16,185,129,0.2)",
    alignSelf: "flex-end",
  },
  chatBubbleText: { color: "#f8fafc", fontSize: 16, lineHeight: 24 },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.45)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#f8fafc",
    backgroundColor: "rgba(15,23,42,0.38)",
    fontSize: 16,
    lineHeight: 22,
  },
  chatInputRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "100%",
    alignSelf: "stretch",
  },
  chatControlRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  chatAuxBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.45)",
    backgroundColor: "rgba(15,23,42,0.4)",
  },
  chatAuxBtnActive: {
    backgroundColor: "rgba(37,99,235,0.38)",
    borderColor: "rgba(96,165,250,0.8)",
  },
  chatAuxBtnDisabled: {
    opacity: 0.55,
  },
  chatAuxBtnText: {
    color: "#f8fafc",
    fontWeight: "700",
    fontSize: 13,
  },
  chatVoiceDraftCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.45)",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "rgba(15,23,42,0.28)",
    width: "100%",
  },
  chatVoiceDraftTitle: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 6,
  },
  chatVoiceDraftText: {
    color: "#e2e8f0",
    fontSize: 14,
    lineHeight: 20,
  },
  chatVoiceDraftActions: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chatSendBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#1f8ef1",
  },
  chatSendText: { color: "#f8fafc", fontWeight: "800", fontSize: 16 },
  spokenSentenceActive: {
    color: "#1f8ef1",
    fontWeight: "800",
  },
  storyboardRow: {
    flexDirection: "row",
    gap: 8,
  },
  storyCard: {
    flex: 1,
    minWidth: 180,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6dee8",
    backgroundColor: "#f8fafc",
    overflow: "hidden",
    position: "relative",
    height: 250,
  },
  storyTitle: {
    color: "#f8fafc",
    fontWeight: "900",
    fontSize: 20,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  storyBody: {
    color: "#e2e8f0",
    fontSize: 16,
    lineHeight: 22,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  storyImage: {
    width: "100%",
    height: "100%",
  },
  storyOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    padding: 14,
    backgroundColor: "rgba(0,0,0,0.58)",
    gap: 6,
    justifyContent: "flex-start",
    alignItems: "flex-start",
  },
  renderTimer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  timerCard: {
    position: "relative",
    padding: 16,
    borderRadius: 14,
    backgroundColor: "rgba(15,23,42,0.28)",
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.45)",
    overflow: "hidden",
    gap: 10,
    marginBottom: 14,
  },
  timerPulseWrap: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  timerPulse: { width: 220, height: 220, borderRadius: 110, backgroundColor: "rgba(56,189,248,0.16)" },
  timerPulseInner: { width: 150, height: 150, borderRadius: 75, backgroundColor: "rgba(56,189,248,0.12)" },
  timerHeader: { gap: 4 },
  timerBadgeLabel: { color: "#7dd3fc", fontWeight: "800", fontSize: 12 },
  timerDial: { alignItems: "center", gap: 6 },
  timerIcon: { fontSize: 24 },
  timerCountdown: { fontSize: 44, fontWeight: "800", color: "#f8fafc" },
  timerSubtitle: { color: "#cbd5e1", fontSize: 18, lineHeight: 24 },
  timerProgressTrack: { height: 8, backgroundColor: "rgba(148,163,184,0.35)", borderRadius: 999, overflow: "hidden" },
  timerProgressFill: { height: "100%", backgroundColor: "#38bdf8" },
  timerActionBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(15,23,42,0.26)",
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.45)",
    gap: 4,
  },
  timerInputBox: {
    gap: 6,
  },
  timerFollowupCard: {
    marginTop: 12,
  },
  timerInputLabel: {
    color: "#f1f5f9",
    fontWeight: "700",
    fontSize: 18,
    lineHeight: 26,
  },
  timerInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.45)",
    padding: 14,
    minHeight: 120,
    color: "#f8fafc",
    backgroundColor: "rgba(15,23,42,0.36)",
    textAlignVertical: "top",
    fontSize: 18,
    lineHeight: 26,
  },
  paperModuleClusterCard: {
    borderColor: "rgba(148,163,184,0.55)",
    backgroundColor: "rgba(255,255,255,0.68)",
    shadowColor: "#64748b",
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  paperRenderLabel: {
    color: "#0f172a",
    textShadowColor: "rgba(255,255,255,0.65)",
    textShadowRadius: 1,
  },
  paperRenderBody: {
    color: "#1e293b",
  },
  paperRenderInput: {
    borderColor: "rgba(100,116,139,0.45)",
    color: "#0f172a",
    backgroundColor: "rgba(255,255,255,0.62)",
  },
  paperListItemLabel: {
    color: "#0f172a",
  },
  paperViewedBox: {
    borderColor: "#64748b",
    backgroundColor: "#f8fafc",
  },
  paperViewedLabel: {
    color: "#0f172a",
  },
  paperRadioOuter: {
    borderColor: "#64748b",
  },
  paperRadioInner: {
    backgroundColor: "#2563eb",
  },
  paperRenderChip: {
    backgroundColor: "rgba(248,250,252,0.95)",
    borderColor: "rgba(148,163,184,0.55)",
  },
  paperRenderChipSelected: {
    backgroundColor: "rgba(219,234,254,0.9)",
    borderColor: "rgba(59,130,246,0.6)",
  },
  paperRenderChipText: {
    color: "#0f172a",
  },
  paperTimerInputLabel: {
    color: "#0f172a",
  },
  paperTimerInput: {
    borderColor: "rgba(148,163,184,0.45)",
    color: "#0f172a",
    backgroundColor: "rgba(255,255,255,0.62)",
  },
  paperPreviewHint: {
    color: "#334155",
  },
  paperTimerCard: {
    backgroundColor: "rgba(255,255,255,0.62)",
    borderColor: "rgba(148,163,184,0.45)",
  },
  paperTimerCountdown: {
    color: "#0f172a",
  },
  paperTimerSubtitle: {
    color: "#334155",
  },
  paperTimerActionBox: {
    backgroundColor: "rgba(255,255,255,0.74)",
    borderColor: "rgba(148,163,184,0.45)",
  },
  paperTimerActionLabel: {
    color: "#0f172a",
  },
  paperTimerActionText: {
    color: "#334155",
  },
  timerActionLabel: { color: "#f1f5f9", fontWeight: "800", fontSize: 18, lineHeight: 24 },
  timerActionText: { color: "#e2e8f0", fontSize: 18, lineHeight: 26 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  videoFrame: {
    width: "100%",
    maxWidth: 980,
    aspectRatio: 16 / 9,
    minHeight: 240,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#d6dee8",
    marginRight: 0,
    backgroundColor: "#f8fafc",
    alignSelf: "center",
  },
  videoImage: { width: "100%", height: "100%" },
  videoCaption: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  videoCaptionText: { color: "#e2e8f0", fontSize: 16, lineHeight: 22, fontWeight: "700" },
  spokenCounter: {
    marginTop: 12,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#e0f2fe",
    borderWidth: 1,
    borderColor: "#93c5fd",
    minHeight: 140,
    width: "100%",
  },
  spokenNumber: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0f172a",
  },
  spokenNumberWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#dbeafe",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#93c5fd",
  },
  spokenNumberIcon: { fontSize: 20 },
  spokenWord: {
    marginTop: 6,
    fontSize: 16,
    color: "#0f172a",
    fontWeight: "600",
  },
  spokenHeard: {
    fontSize: 13,
    color: "#0f172a",
    marginTop: 4,
  },
  calmingMotion: {
    marginTop: 12,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#eef6ff",
    borderWidth: 1,
    borderColor: "#d6e3f2",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    height: "100%",
    minHeight: 120,
    width: "100%",
    overflow: "hidden",
  },
  calmingBlob: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "#93c5fd",
  },
  calmingBlobInner: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "#60a5fa",
  },
  calmingMotionLabel: {
    color: "#f1f5f9",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
    zIndex: 1,
  },
  spokenMotionWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: 90,
    marginBottom: 8,
    position: "relative",
    overflow: "hidden",
    borderRadius: 12,
  },
  spokenMotionBlob: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "#bae6fd",
  },
  spokenHighlight: {
    backgroundColor: "#dbeafe",
    color: "#0f172a",
    borderRadius: 4,
  },
  audioScriptText: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 28,
    marginBottom: 6,
  },
  timedCuesTopRow: {
    alignItems: "flex-start",
    marginBottom: 2,
  },
  timedCuesAlignedWidth: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "flex-start",
  },
  timedCuesMotionPane: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "stretch",
  },
  timedCuesLead: {
    color: "#f8fafc",
    fontWeight: "700",
    textShadowColor: "rgba(2,6,23,0.64)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
