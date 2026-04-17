import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Animated,
  TextInput,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Audio as ExpoAudio } from "expo-av";
import { Asset } from "expo-asset";

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:8787";
const TTS_URL = `${API_BASE}/dev/media/tts`;
const AMBIENT_LOOPS: Record<string, string> = {
  piano: require("../../assets/audio/piano.mp3"),
  rain: require("../../assets/audio/rain.mp3"),
  ocean: require("../../assets/audio/ocean.mp3"),
  white: require("../../assets/audio/white.mp3"),
};

const resolveAmbientUri = (prompt?: string, choice?: string) => {
  const normalizedChoice = (choice || "").toLowerCase();
  if (normalizedChoice === "rain") return AMBIENT_LOOPS.rain;
  if (normalizedChoice === "piano") return AMBIENT_LOOPS.piano;
  if (normalizedChoice === "ocean") return AMBIENT_LOOPS.ocean;
  if (normalizedChoice === "white_noise") return AMBIENT_LOOPS.white;

  if (!prompt) return null;
  const lower = prompt.toLowerCase();
  if (lower.includes("rain")) return AMBIENT_LOOPS.rain;
  if (lower.includes("piano") || lower.includes("soft")) return AMBIENT_LOOPS.piano;
  if (lower.includes("ocean") || lower.includes("wave")) return AMBIENT_LOOPS.ocean;
  if (lower.includes("white") || lower.includes("noise")) return AMBIENT_LOOPS.white;
  return null;
};

type SummaryPayload = {
  summary: string;
  seed?: string;
  source?: string;
};

type SupportStep = {
  title?: string;
  instruction?: string;
  minutes?: number;
};

type SupportAssetType =
  | "animation"
  | "audio"
  | "video"
  | "image"
  | "music"
  | "ambient"
  | "slide"
  | "timer"
  | "storyboard"
  | "motion";

type SupportAsset = {
  type: SupportAssetType;
  label?: string;
  content?: string;
  audio_tone?: string;
  voice_pitch?: number;
  voice_rate?: number;
  duration_seconds?: number;
  step?: number;
  slides?: string[];
  frames?: string[];
  timer_steps?: Array<{ label?: string; duration_seconds?: number; audio_segment?: string }>;
  prompt?: string;
  prompts?: string[];
  script_lines?: string[];
  overlay?: string[];
  explanation?: string;
  music_prompt?: string;
  music_choice?: string;
  audio_script?: string;
};

type SupportPlan = {
  title?: string;
  focus?: string;
  duration_minutes?: number;
  format?: string;
  step_formats?: string[];
  steps?: SupportStep[];
  assets?: SupportAsset[];
  wrap_up?: string;
  encouragement?: string;
  source?: string;
};

export const options = {
  headerShown: false,
};

const formatMinutes = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "--";
  return `${Math.round(value)} min`;
};

const formatSeconds = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return null;
  return `${Math.round(value)} sec`;
};

type DeckTheme = {
  id: string;
  name: string;
  gradient: [string, string];
  accent: string;
  accentSecondary: string;
  icons: string[];
};

const DECK_THEMES: DeckTheme[] = [
  {
    id: "lagoon",
    name: "Midnight Lagoon",
    gradient: ["#0ea5e9", "#22d3ee"],
    accent: "#22d3ee",
    accentSecondary: "#0ea5e9",
    icons: ["🌊", "✨", "🌿", "🌙"],
  },
  {
    id: "neon",
    name: "Neon Bloom",
    gradient: ["#a855f7", "#6366f1"],
    accent: "#a855f7",
    accentSecondary: "#22d3ee",
    icons: ["⚡️", "🌸", "🌠", "🌈"],
  },
  {
    id: "dusk",
    name: "Warm Dusk",
    gradient: ["#f59e0b", "#f97316"],
    accent: "#f59e0b",
    accentSecondary: "#fb7185",
    icons: ["🌅", "🔥", "🪄", "⭐️"],
  },
];

const randomFromArray = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)] || arr[0];

const splitContentLines = (text?: string) => {
  if (!text) return [];
  return text
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
};

const SlideDeck = ({
  slides,
  theme,
  imageUrls = [],
}: {
  slides: string[];
  theme: DeckTheme;
  imageUrls?: (string | null | undefined)[];
}) => {
  const limited = Array.isArray(slides) ? slides.slice(0, 4) : [];
  const animated = useRef(limited.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    limited.forEach((_, idx) => {
      Animated.timing(animated[idx], {
        toValue: 1,
        duration: 280,
        delay: idx * 100,
        useNativeDriver: true,
      }).start();
    });
  }, [animated, limited]);

  if (!limited.length) return null;

  return (
    <View style={styles.deckShell}>
      <LinearGradient
        colors={[`${theme.gradient[0]}44`, `${theme.gradient[1]}44`, "rgba(14,165,233,0.08)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.deckBackground}
      />
      <LinearGradient
        colors={[`${theme.accent}33`, `${theme.accentSecondary}33`]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.deckHero}
      />
      <View style={styles.deckHeader}>
        <Text style={styles.deckEyebrow}>{theme.name}</Text>
        <View style={styles.deckProgress}>
          {limited.map((_, idx) => (
            <View
              key={`dot-${idx}`}
              style={[
                styles.deckDot,
                idx === 0 ? styles.deckDotActive : null,
                { backgroundColor: idx === 0 ? theme.accent : "rgba(148, 163, 184, 0.45)" },
              ]}
            />
          ))}
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.slideRow}
      >
        {limited.map((entry, idx) => {
          const opacity = animated[idx];
          const translateY = animated[idx].interpolate({
            inputRange: [0, 1],
            outputRange: [12, 0],
          });
          const icon = theme.icons[idx % theme.icons.length];
          const imageUrl = imageUrls[idx] || null;
          return (
            <Animated.View
              key={`slide-${idx}`}
              style={[
                styles.slideCard,
                {
                  opacity,
                  transform: [{ translateY }],
                },
              ]}
            >
              {imageUrl ? (
                <ExpoImage source={{ uri: imageUrl }} style={styles.slideImage} contentFit="cover" />
              ) : (
                <LinearGradient
                  colors={[theme.gradient[0], theme.gradient[1]]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.slideGlow}
                />
              )}
              <LinearGradient
                colors={["rgba(11,18,36,0.8)", "rgba(11,18,36,0.5)"]}
                style={styles.slideMask}
              />
              <View style={styles.slideTopRow}>
                <View style={styles.microBadge}>
                  <Text style={styles.microIcon}>{icon}</Text>
                </View>
                <Text style={styles.slideIndex}>Slide {idx + 1}</Text>
              </View>
              <Text style={styles.slideText}>{entry}</Text>
            </Animated.View>
          );
        })}
        {!imageUrls.length ? (
          <View style={styles.slideFallback}>
            <Text style={styles.errorText}>No image returned for slides.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
};

const Storyboard = ({
  frames,
  imageUrls = [],
}: {
  frames: string[];
  imageUrls?: (string | null | undefined)[];
}) => {
  const limited = Array.isArray(frames) ? frames.slice(0, 3) : [];
  if (!limited.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyboardRow}>
      {limited.map((frame, idx) => {
        const parts = frame.split(":");
        const headline = parts.length > 1 ? parts[0].trim() : `Beat ${idx + 1}`;
        const body = parts.length > 1 ? parts.slice(1).join(":").trim() : frame;
        const imageUrl = imageUrls[idx] || null;
        return (
          <View key={`frame-${idx}`} style={styles.frameCard}>
            {imageUrl ? (
              <ExpoImage source={{ uri: imageUrl }} style={styles.frameImage} contentFit="cover" />
            ) : (
              <LinearGradient colors={["#0f172a", "#0f172a"]} style={styles.frameImage} />
            )}
            <LinearGradient colors={["rgba(6,12,26,0.85)", "rgba(6,12,26,0.65)"]} style={styles.frameMask} />
            <View style={styles.frameHeader}>
              <View style={styles.framePill}>
                <Text style={styles.framePillText}>{`Card ${idx + 1}`}</Text>
              </View>
            </View>
            <Text style={styles.frameIndex}>{headline || `Beat ${idx + 1}`}</Text>
            <Text style={styles.frameText}>{body}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
};

const GeneratedImage = ({
  prompt,
  cache,
  blurRadius = 0,
}: {
  prompt: string;
  cache: Record<string, { status: "idle" | "loading" | "ready" | "error"; url?: string; error?: string }>;
  blurRadius?: number;
}) => {
  if (!prompt) return null;
  const entry = cache[prompt];
  if (!entry || entry.status === "loading") {
    return (
      <View style={styles.generatedImageCard}>
        <LinearGradient colors={["#0ea5e944", "#22d3ee33"]} style={styles.generatedImageShimmer} />
        <Text style={styles.imagePromptLabel}>Generating image...</Text>
      </View>
    );
  }
  if (entry.status === "error") {
    return (
      <Text style={styles.errorText}>
        Image failed to load{entry.error ? `: ${entry.error}` : "."}
      </Text>
    );
  }
  if (entry.status === "ready" && entry.url) {
    return (
      <View style={styles.generatedImageCard}>
        <ExpoImage
          source={{ uri: entry.url }}
          style={styles.generatedImage}
          contentFit="contain"
          blurRadius={blurRadius}
        />
      </View>
    );
  }
  return null;
};

const DallePseudoVideo = ({
  prompts,
  cache,
  captions,
  onFrameChange,
  activeIndex,
  auto = true,
}: {
  prompts: string[];
  cache: Record<string, { status: "idle" | "loading" | "ready" | "error"; url?: string; error?: string }>;
  captions?: string[];
  onFrameChange?: (idx: number) => void;
  activeIndex?: number;
  auto?: boolean;
}) => {
  const readyFrames = prompts
    .map((p) => {
      const entry = cache[p];
      if (entry?.status === "ready" && entry.url) return { prompt: p, url: entry.url };
      return null;
    })
    .filter(Boolean) as { prompt: string; url: string }[];

  const [idx, setIdx] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (typeof activeIndex === "number" && activeIndex >= 0 && activeIndex < readyFrames.length) {
      setIdx(activeIndex);
    }
  }, [activeIndex, readyFrames.length]);

  useEffect(() => {
    if (!readyFrames.length) return;
    if (!auto) return;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      const next = (idx + 1) % readyFrames.length;
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.98, duration: 300, useNativeDriver: true }),
      ]).start(() => {
        setIdx(next);
        onFrameChange?.(next);
        Animated.parallel([
          Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.04, duration: 1200, useNativeDriver: true }),
        ]).start();
      });
    };
    const interval = setInterval(tick, 3200);
    console.log("[dalle_video] starting pseudo-video", { frames: readyFrames.length });
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [readyFrames.length, idx, fade, scale, onFrameChange, auto]);

  if (!readyFrames.length) {
    return <Text style={styles.errorText}>Waiting for video frames...</Text>;
  }

  const frame = readyFrames[idx];
  const caption = captions && captions.length ? captions[idx % captions.length] : undefined;

  return (
    <View style={styles.pseudoVideo}>
      <Animated.View style={[styles.pseudoVideoFrame, { opacity: fade, transform: [{ scale }] }]}>
        <ExpoImage source={{ uri: frame.url }} style={styles.pseudoVideoImage} contentFit="cover" />
        {caption ? (
          <View style={styles.pseudoVideoCaptionWrap}>
            <View style={styles.microBadge}>
              <Text style={styles.microIcon}>🎬</Text>
            </View>
            <Text style={styles.pseudoVideoCaption}>{caption}</Text>
          </View>
        ) : null}
      </Animated.View>
      <Text style={styles.promptLine}>Frame {idx + 1} of {readyFrames.length}</Text>
    </View>
  );
};

const imageUrlsForSlidesMissing = (
  slides: string[] | undefined,
  assets: SupportAsset[],
  cache: Record<string, { status: "idle" | "loading" | "ready" | "error"; url?: string; error?: string }>
) => {
  const count = slides?.length || 0;
  if (count === 0) return false;
  const urls = assets
    .filter((a) => a.type === "image")
    .map((img) => {
      const prompt = img.prompt || img.content || "";
      const entry = prompt ? cache[prompt] : null;
      if (entry?.status === "ready") return entry.url;
      return null;
    })
    .filter(Boolean);
  return urls.length < count;
};

const numberWords = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
];

const splitScriptWords = (text: string) => {
  const tokens: Array<{ word: string; start: number }> = [];
  const regex = /(\d+|[A-Za-z']+)/g;
  let match;
  while ((match = regex.exec(text))) {
    tokens.push({ word: match[0], start: match.index });
  }
  return tokens;
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
  useEffect(() => {
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

const CalmingMotion = ({
  lines,
  prompt,
}: {
  lines: string[];
  prompt?: string;
}) => {
  const pulse = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ])
    );
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    pulseLoop.start();
    glowLoop.start();
    return () => {
      pulseLoop.stop();
      glowLoop.stop();
    };
  }, [pulse, glow]);
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.06],
  });
  const opacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.75],
  });
  return (
    <View style={styles.motionCard}>
      <LinearGradient
        colors={["#0ea5e933", "#10b98122", "#6366f125"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.motionBg}
      />
      <Animated.View style={[styles.motionBlob, { transform: [{ scale }], opacity }]} />
      <View style={styles.motionTextWrap}>
        {lines.slice(0, 3).map((line, idx) => (
          <Text key={`mline-${idx}`} style={styles.motionLine}>
            {line}
          </Text>
        ))}
        {prompt ? <Text style={styles.motionPrompt}>{prompt}</Text> : null}
      </View>
    </View>
  );
};

const buildTimerGuidedScript = (
  steps: Array<{ label?: string; duration_seconds?: number }>,
  intro?: string
) => {
  const safeIntro = intro?.trim() ? `${intro.trim()}\n` : "";
  const body = steps
    .map((step) => {
      const label = step.label || "Step";
      const dur = typeof step.duration_seconds === "number" && step.duration_seconds > 0 ? step.duration_seconds : 4;
      const counts = Array.from({ length: dur }, (_, i) => numberWords[i] || `${i + 1}`).join(", ");
      return `${label}: breathe through ${dur} counts — ${counts}.`;
    })
    .join("\n");
  return `${safeIntro}${body}`.trim();
};

const TimerScript = ({
  steps,
  label,
  controllerRef,
  autoplayMusic = true,
  showMusicToggle = true,
  showControls = true,
  scriptWords,
  onStartChime,
  onEndChime,
}: {
  steps: Array<{ label?: string; duration_seconds?: number }>;
  label?: string;
  controllerRef?: React.MutableRefObject<{ start: () => void; reset: () => void; pause: () => void } | null>;
  autoplayMusic?: boolean;
  showMusicToggle?: boolean;
  showControls?: boolean;
  scriptWords?: string[];
  onStartChime?: () => void;
  onEndChime?: () => void;
}) => {
  const timeline = steps.map((entry) => ({
    label: entry.label || "Step",
    duration: typeof entry.duration_seconds === "number" && entry.duration_seconds > 0 ? entry.duration_seconds : 5,
  }));
  const totalSeconds = timeline.reduce((sum, entry) => sum + entry.duration, 0);
  if (totalSeconds <= 0) return null;

  const [running, setRunning] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [stepRemaining, setStepRemaining] = useState(timeline[0]?.duration || 0);
  const [stepCount, setStepCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [spokenWordIdx, setSpokenWordIdx] = useState(0);
  const [spokenWord, setSpokenWord] = useState<string | null>(null);
  const [spokenNumber, setSpokenNumber] = useState<number | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const iconPulse = useRef(new Animated.Value(1)).current;
  const idxRef = useRef(0);
  const stepElapsedRef = useRef(0);
  const remainingRef = useRef(timeline[0]?.duration || 0);
  const elapsedRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const musicUriRef = useRef<string | null>(null);
  const musicSoundRef = useRef<ExpoAudio.Sound | null>(null);
  const musicAudioElRef = useRef<HTMLAudioElement | null>(null);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const soundRef = useRef<HTMLAudioElement | null>(null);
  const playChime = useCallback(
    (freq: number) => {
      if (Platform.OS === "web") {
        try {
          const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
          const ctx = Ctx ? new Ctx() : null;
          if (ctx) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.type = "sine";
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
            return;
          }
        } catch {}
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    },
    []
  );

  const startPulse = useCallback(() => {
    pulse.setValue(0.9);
    Animated.spring(pulse, {
      toValue: 1,
      friction: 2,
      useNativeDriver: false,
    }).start();
  }, [pulse]);

  const startIconLoop = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulse, { toValue: 1.1, duration: 700, useNativeDriver: false }),
        Animated.timing(iconPulse, { toValue: 0.95, duration: 700, useNativeDriver: false }),
      ])
    ).start();
  }, [iconPulse]);

  const ensureMusic = useCallback(async () => {
    if (musicUriRef.current) return musicUriRef.current;
    const asset = Asset.fromModule(AMBIENT_LOOPS.piano);
    await asset.downloadAsync();
    musicUriRef.current = asset.localUri || asset.uri;
    return musicUriRef.current;
  }, []);

  const stopMusic = useCallback(async () => {
    try {
      if (musicAudioElRef.current) {
        musicAudioElRef.current.pause();
        musicAudioElRef.current = null;
      }
      if (musicSoundRef.current) {
        await musicSoundRef.current.unloadAsync();
        musicSoundRef.current = null;
      }
    } catch (e) {
      console.warn("[timer] stopMusic error", e);
    }
  }, []);

  const startMusic = useCallback(async () => {
    if (!autoplayMusic) return;
    try {
      if (!musicEnabled) return;
      const uri = await ensureMusic();
      if (!uri) return;
      if (Platform.OS === "web") {
        const audioCtor = (typeof window !== "undefined" && (window as any).Audio) || null;
        if (!audioCtor) return;
        const audio = new audioCtor(uri);
        audio.loop = true;
        audio.volume = 0.18;
        musicAudioElRef.current = audio;
        await audio.play().catch(() => {});
        return;
      }
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { shouldPlay: true, isLooping: true, volume: 0.2 }
      );
      musicSoundRef.current = sound;
    } catch (e) {
      console.warn("[timer] startMusic error", e);
    }
  }, [ensureMusic, musicEnabled]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRunning(false);
    stopMusic();
  }, [stopMusic]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      const nextElapsed = Math.min(totalSeconds, (elapsedRef.current || 0) + 1);
      elapsedRef.current = nextElapsed;
      setElapsed(nextElapsed);

      if ((remainingRef.current || 0) <= 1) {
        const nextIdx = (idxRef.current || 0) + 1;
        if (nextIdx >= timeline.length) {
          idxRef.current = timeline.length - 1;
          remainingRef.current = 0;
          stepElapsedRef.current = timeline[timeline.length - 1]?.duration || 0;
          setStepCount(stepElapsedRef.current);
          setStepRemaining(0);
          onEndChime?.();
          playChime(520);
          stop();
          return;
        }
        idxRef.current = nextIdx;
        const nextDur = timeline[nextIdx].duration;
        remainingRef.current = nextDur;
        stepElapsedRef.current = 0;
        setCurrentIdx(nextIdx);
        setStepRemaining(nextDur);
        setStepCount(0);
        startPulse();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        const nextRemaining = Math.max(0, (remainingRef.current || 0) - 1);
        remainingRef.current = nextRemaining;
        setStepRemaining(nextRemaining);
        const stepElapsed = (stepElapsedRef.current || 0) + 1;
        stepElapsedRef.current = stepElapsed;
        setStepCount(stepElapsed);
      }

      if (Array.isArray(scriptWords) && scriptWords.length > 0 && totalSeconds > 0) {
        const targetIdx = Math.min(
          scriptWords.length - 1,
          Math.floor((elapsedRef.current / totalSeconds) * scriptWords.length)
        );
        if (targetIdx !== spokenWordIdx) {
          const word = scriptWords[targetIdx];
          setSpokenWordIdx(targetIdx);
          setSpokenWord(word);
          const normalized = word?.toLowerCase().replace(/[^a-z0-9]/g, "");
          const numIdx = numberWords.findIndex((w) => w === normalized);
          if (numIdx >= 0) {
            setSpokenNumber(numIdx + 1);
          } else {
            const directNum = Number(normalized);
            setSpokenNumber(Number.isFinite(directNum) ? directNum : null);
          }
        }
      }
    }, 1000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running, stop, timeline, startPulse]);

  const reset = () => {
    stop();
    idxRef.current = 0;
    const first = timeline[0]?.duration || 0;
    remainingRef.current = first;
    stepElapsedRef.current = 0;
    elapsedRef.current = 0;
    setCurrentIdx(0);
    setStepRemaining(first);
    setStepCount(0);
    setElapsed(0);
    setSpokenWordIdx(0);
    setSpokenWord(null);
    setSpokenNumber(null);
  };

  const toggle = () => {
    if (running) {
      stop();
      stopMusic();
    } else {
      reset();
      setRunning(true);
      onStartChime?.();
      playChime(880);
      startPulse();
      Animated.loop(
        Animated.sequence([
          Animated.timing(iconPulse, { toValue: 1.1, duration: 700, useNativeDriver: false }),
          Animated.timing(iconPulse, { toValue: 0.95, duration: 700, useNativeDriver: false }),
        ])
      ).start();
      startMusic();
    }
  };

  const formatClock = (secs: number) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, "0");
    const s = Math.floor(secs % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${s}`;
  };

  const overallProgress = totalSeconds > 0 ? Math.min(1, elapsed / totalSeconds) : 0;
  const activeLabel = timeline[currentIdx]?.label || "Step";
  const activeDuration = timeline[currentIdx]?.duration || 0;
  const activeCountLabel =
    stepCount > 0 ? (numberWords[stepCount - 1] ? numberWords[stepCount - 1] : `${stepCount}`) : "";
  const spokenNumberDisplay = spokenNumber != null ? spokenNumber : 0;

  useEffect(() => {
    if (controllerRef) {
      controllerRef.current = {
        start: () => {
          if (!running) {
            reset();
            setRunning(true);
            startPulse();
            Animated.loop(
              Animated.sequence([
                Animated.timing(iconPulse, { toValue: 1.1, duration: 700, useNativeDriver: false }),
                Animated.timing(iconPulse, { toValue: 0.95, duration: 700, useNativeDriver: false }),
              ])
            ).start();
            startMusic();
          }
        },
        reset: () => reset(),
        pause: () => stop(),
      };
    }
    return () => {
      if (controllerRef) controllerRef.current = null;
    };
  }, [controllerRef, reset, stop, startMusic, startPulse]);

  return (
    <View style={styles.timerCard}>
      <Text style={styles.timerTitle}>{label || "Timer"}</Text>
      <Animated.View style={[styles.timerIconWrap, { transform: [{ scale: iconPulse }] }]}>
        <Text style={styles.timerIcon}>⏱️</Text>
      </Animated.View>
      <Animated.View style={[styles.timerClockWrapper, { transform: [{ scale: pulse }] }]}>
        <Text style={styles.timerClock}>{formatClock(stepRemaining)}</Text>
        <Text style={styles.timerActiveLabel}>{activeLabel}</Text>
      </Animated.View>
      <View style={styles.timerProgressOuter}>
        <View style={[styles.timerProgressInner, { width: `${overallProgress * 100}%` }]} />
      </View>
      {showControls ? (
        <View style={styles.timerActions}>
          <Pressable
            accessibilityRole="button"
            onPress={toggle}
            style={({ pressed }) => [
              styles.timerButton,
              running && styles.timerButtonActive,
              pressed && styles.timerButtonPressed,
            ]}
          >
            <Text style={styles.timerButtonLabel}>{running ? "Pause" : "Start"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={reset}
            style={({ pressed }) => [styles.timerButtonGhost, pressed && styles.timerButtonPressed]}
          >
            <Text style={styles.timerButtonGhostLabel}>Reset</Text>
          </Pressable>
          {showMusicToggle ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setMusicEnabled((prev) => !prev)}
              style={({ pressed }) => [styles.timerButtonGhost, pressed && styles.timerButtonPressed]}
            >
              <Text style={styles.timerButtonGhostLabel}>{musicEnabled ? "Music on" : "Music off"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.timerSteps}>
        {timeline.map((entry, idx) => {
          const isActive = idx === currentIdx && running;
          return (
            <Text key={`ts-${idx}`} style={[styles.timerStepText, isActive && styles.timerStepTextActive]}>
              {entry.duration}s • {entry.label}
            </Text>
          );
        })}
      </View>
    </View>
  );
};

const Card = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <View style={[styles.card, style]}>{children}</View>
);

const FORMAT_CHOICES: Array<{ id: string; label: string; description: string }> = [
  { id: "short_audio", label: "Short audio", description: "Short spoken/audio clip." },
  { id: "images", label: "Image", description: "Generated visual cue." },
  { id: "storyboard", label: "Storyboard", description: "3-5 visual beats." },
  { id: "slides", label: "Slides", description: "Concise card deck." },
  { id: "timed_cues", label: "Timed cues", description: "Paced steps with a timer." },
  { id: "calming_motion", label: "Calming motion", description: "Soft animated breathing visual." },
  { id: "dalle_video", label: "Dalle video", description: "4-beat script for a short video." },
  { id: "timer", label: "Timer", description: "Single countdown with start/finish chime." },
];

export default function StressSupportSandboxScreen() {
  const router = useRouter();
  const [step1Medium, setStep1Medium] = useState<string>("short_audio");
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [plan, setPlan] = useState<SupportPlan | null>(null);
  const [planStatus, setPlanStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [planError, setPlanError] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [spokenWord, setSpokenWord] = useState<string | null>(null);
  const [spokenNumber, setSpokenNumber] = useState<number | null>(null);
  const [spokenDisplayCount, setSpokenDisplayCount] = useState<number>(0);
  const spokenPulse = useRef(new Animated.Value(1)).current;
  const spokenAmbientRef = useRef<HTMLAudioElement | null>(null);
  const timerControllerRef = useRef<{ start: () => void; reset: () => void; pause: () => void } | null>(null);
  const [timerSecondsInput, setTimerSecondsInput] = useState<string>("60");
  const [imageCache, setImageCache] = useState<Record<string, { status: "idle" | "loading" | "ready" | "error"; url?: string; error?: string }>>({});
  const [remoteSound, setRemoteSound] = useState<ExpoAudio.Sound | null>(null);
  const [ambientSound, setAmbientSound] = useState<ExpoAudio.Sound | null>(null);
  const [ambientVolume, setAmbientVolume] = useState<number>(0.15);
  const deckTheme = useMemo(() => randomFromArray(DECK_THEMES), []);
  const [videoImageCache, setVideoImageCache] = useState<
    Record<string, { status: "idle" | "loading" | "ready" | "error"; url?: string; error?: string }>
  >({});
  const [videoActiveIndex, setVideoActiveIndex] = useState<number>(0);
  const [videoAuto, setVideoAuto] = useState<boolean>(false);
  const [videoNarrationActive, setVideoNarrationActive] = useState<boolean>(false);
  const [videoNarrationPaused, setVideoNarrationPaused] = useState<boolean>(false);

  const loadSummary = useCallback(async () => {
    setSummaryStatus("loading");
    setSummaryError(null);
    setPlan(null);
    setPlanStatus("idle");
    setPlanError(null);

    try {
      const response = await fetch(`${API_BASE}/dev/stress-support/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data = await response.json();
      if (!data?.summary) {
        throw new Error("No summary returned");
      }
      setSummary({
        summary: data.summary,
        seed: data.seed,
        source: data.source,
      });
      setSummaryStatus("ready");
    } catch (err: any) {
      setSummaryStatus("error");
      setSummaryError(err?.message || "Could not load a stress summary.");
    }
  }, []);

  const ensureSpokenAmbientUri = useCallback(async () => {
    const asset = Asset.fromModule(AMBIENT_LOOPS.piano);
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
      console.warn("[stress-support] spoken ambient error", err);
    }
  }, [ensureSpokenAmbientUri]);

  const stopSpokenAmbient = useCallback(() => {
    try {
      if (spokenAmbientRef.current) {
        spokenAmbientRef.current.pause();
        spokenAmbientRef.current = null;
      }
    } catch (err) {
      console.warn("[stress-support] stop spoken ambient error", err);
    }
  }, []);

  useEffect(() => {
    return () => {
      stopSpokenAmbient();
    };
  }, [stopSpokenAmbient]);

  const handleGeneratePlan = useCallback(async () => {
    if (!summary?.summary) {
      setPlanError("Load a summary first.");
      setPlanStatus("error");
      return;
    }
    setPlanStatus("loading");
    setPlanError(null);

    try {
      const response = await fetch(`${API_BASE}/dev/stress-support/intervention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: summary.summary, formats: [step1Medium] }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.warn("[stress-support] intervention request failed", response.status, text);
        throw new Error(text || `Request failed with status ${response.status}`);
      }
      const data = (await response.json()) as SupportPlan;
      if (!data || !data.steps) {
        throw new Error("No plan returned");
      }

      setPlan(data);
      setPlanStatus("ready");
      console.log("[stress-support] plan received", {
        title: data.title,
        medium: data.step_formats?.[0] || step1Medium,
        assetCount: Array.isArray(data.assets) ? data.assets.length : 0,
        assetPreview: Array.isArray(data.assets) ? data.assets[0] : null,
      });
    } catch (err: any) {
      setPlanStatus("error");
      setPlanError(err?.message || "Could not generate an intervention.");
      console.warn("[stress-support] plan generation failed", err);
    }
  }, [summary, step1Medium]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const steps = Array.isArray(plan?.steps) ? plan?.steps : [];
  const assets = Array.isArray(plan?.assets) ? plan?.assets : [];

  const handlePlayAudio = useCallback(
    async (
      text: string,
      key: string,
      opts?: {
        pitch?: number;
        rate?: number;
        music_prompt?: string;
        music_choice?: string;
        onStart?: () => void;
        onEnd?: () => void;
      }
    ) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        console.log("[stress-support] handlePlayAudio start", {
          key,
          pitch: opts?.pitch,
          rate: opts?.rate,
          preview: trimmed.slice(0, 60),
          music_prompt: opts?.music_prompt,
          music_choice: opts?.music_choice,
        });
        setSpeakingId(key);
        // Try remote TTS first
    const body = {
      text: trimmed,
      speed:
        typeof opts?.rate === "number"
          ? Math.min(1.3, Math.max(0.7, opts.rate))
          : 1,
      use_gpt_voice: true,
      style: "calm, human, grounded guidance",
    };
        console.log("[stress-support] requesting remote TTS", {
          key,
          speed: body.speed,
          textPreview: trimmed.slice(0, 80),
        });
        const resp = await fetch(TTS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        const uri = data?.audio_url;
        console.log("[stress-support] remote TTS response", { ok: resp.ok, hasUri: Boolean(uri), status: resp.status });
        if (!resp.ok || !uri) {
          throw new Error(`remote TTS failed (${resp.status})`);
        }

        const ambientUri = resolveAmbientUri(opts?.music_prompt, opts?.music_choice);
        const handleStart = () => {
          console.log("[stress-support] tts playback start", { key });
          opts?.onStart?.();
        };
        const handleEnd = (reason?: string) => {
          console.log("[stress-support] tts playback ended", { key, reason: reason || "ended" });
          opts?.onEnd?.();
          setSpeakingId((current) => (current === key ? null : current));
        };

        if (Platform.OS === "web") {
          const audioCtor = (typeof window !== "undefined" && (window as any).Audio) || null;
          if (!audioCtor) {
            throw new Error("No Audio constructor on web");
          }
          console.log("[stress-support] playing remote TTS via HTMLAudioElement");
          const voiceEl = new audioCtor(uri);
          const ambientEl = ambientUri ? new audioCtor(ambientUri) : null;
          if (ambientEl) {
            ambientEl.loop = true;
            ambientEl.volume = ambientVolume;
          }
          voiceEl.onplay = () => {
            handleStart();
            if (ambientEl) ambientEl.play().catch((err: any) => console.warn("[stress-support] ambient play failed", err));
          };
          voiceEl.onended = () => {
            if (ambientEl) ambientEl.pause();
            handleEnd("ended");
          };
          voiceEl.onerror = (ev: any) => {
            console.warn("[stress-support] HTML audio error", ev);
            if (ambientEl) ambientEl.pause();
            handleEnd("error");
          };
          await voiceEl.play();
          return;
        }

        if (remoteSound) {
          console.log("[stress-support] unloading previous remote sound");
          await remoteSound.unloadAsync();
        }
        if (ambientSound) {
          await ambientSound.unloadAsync();
        }
        if (ambientUri) {
          try {
            const { sound: ambient } = await ExpoAudio.Sound.createAsync(
              { uri: ambientUri },
              { shouldPlay: true, isLooping: true, volume: ambientVolume }
            );
            setAmbientSound(ambient);
          } catch (err) {
            console.warn("[stress-support] ambient load failed", err);
          }
        }

        const { sound } = await ExpoAudio.Sound.createAsync({ uri });
        console.log("[stress-support] playing remote TTS");
        setRemoteSound(sound);
        await sound.playAsync();
        handleStart();
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            console.log("[stress-support] remote TTS finished");
            handleEnd("ended");
          }
        });
        return;
      } catch (err) {
        console.warn("[stress-support] TTS playback failed", err);
        opts?.onEnd?.();
        setSpeakingId(null);
      }
    },
    [remoteSound, ambientSound, ambientVolume]
  );

  const stepFormats =
    Array.isArray(plan?.step_formats) && plan?.step_formats?.length >= 1
      ? (plan.step_formats as string[])
      : [step1Medium];

  const setMedium = useCallback((medium: string) => {
    setStep1Medium(medium);
  }, []);

const resolveAssetForStep = useCallback(
  (stepNumber: number, format: string) => {
  const typeMap: Record<string, SupportAssetType[]> = {
    breathing_animation: ["animation", "timer"],
    micro_visuals: ["animation", "image"],
    timed_cues: ["timer"],
    short_audio: ["audio"],
    short_video: ["video"],
    images: ["image"],
    slides: ["slide"],
    storyboard: ["storyboard"],
    calming_motion: ["motion", "image"],
    timer: ["timer"],
    dalle_video: ["video"],
  };
    const preferredTypes = typeMap[format] || [];
    const byStep = assets.find(
      (asset) => asset.step === stepNumber && preferredTypes.includes(asset.type)
    );
    if (byStep) return byStep;
      const byType = assets.find((asset) => preferredTypes.includes(asset.type));
      return byType || assets[0] || null;
    },
    [assets]
  );

  useEffect(() => {
    const pending: Array<{ prompt: string }> = [];
    assets.forEach((asset) => {
      if (asset.type === "image") {
        const prompt = asset.prompt || asset.content || "";
        if (prompt && !imageCache[prompt]) {
          pending.push({ prompt });
        }
      }
    });
    if (!pending.length) return;
    pending.forEach(({ prompt }) => {
      console.log("[stress-support] image request", { prompt: prompt.slice(0, 80) });
      setImageCache((prev) => ({ ...prev, [prompt]: { status: "loading" } }));
      fetch(`${API_BASE}/dev/media/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })
        .then(async (resp) => {
          const text = await resp.text();
          const data = (() => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })();
          if (!resp.ok) {
            const detail = data?.detail || data?.error || `status ${resp.status}`;
            throw new Error(detail);
          }
          const url = data?.url || data?.image?.url;
          if (url) {
            console.log("[stress-support] image ready", { prompt: prompt.slice(0, 80), url: url.slice(0, 80) });
            setImageCache((prev) => ({ ...prev, [prompt]: { status: "ready", url } }));
          } else {
            throw new Error("no url returned");
          }
        })
        .catch((err) => {
          console.warn("[stress-support] image failed", { prompt: prompt.slice(0, 80), error: err?.message });
          setImageCache((prev) => ({
            ...prev,
            [prompt]: { status: "error", error: err?.message || "failed" },
          }));
        });
    });
  }, [assets, imageCache]);

  useEffect(() => {
    // DALL·E video prompts -> fetch images
    const dalleAsset = assets.find((a) => a.type === "video" && Array.isArray(a.prompts));
    if (!dalleAsset || !Array.isArray(dalleAsset.prompts)) return;
    const prompts = (dalleAsset.prompts as string[]).filter(Boolean);
    const pending: Array<string> = [];
    prompts.forEach((p) => {
      if (p && !videoImageCache[p]) pending.push(p);
    });
    if (!pending.length) return;
    pending.forEach((prompt) => {
      console.log("[stress-support] dalle_video image request", { prompt: prompt.slice(0, 80) });
      setVideoImageCache((prev) => ({ ...prev, [prompt]: { status: "loading" } }));
      fetch(`${API_BASE}/dev/media/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })
        .then(async (resp) => {
          const text = await resp.text();
          console.log("[stress-support] dalle_video image response", { status: resp.status, len: text?.length });
          const data = (() => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })();
          if (!resp.ok) {
            const detail = data?.detail || data?.error || `status ${resp.status}`;
            throw new Error(detail);
          }
          const url = data?.url || data?.image?.url;
          if (url) {
            console.log("[stress-support] dalle_video image ready", { prompt: prompt.slice(0, 80), url: url.slice(0, 80) });
            setVideoImageCache((prev) => ({ ...prev, [prompt]: { status: "ready", url } }));
          } else {
            throw new Error("no url returned");
          }
        })
        .catch((err) => {
          console.warn("[stress-support] dalle_video image failed", { prompt: prompt.slice(0, 80), error: err?.message });
          setVideoImageCache((prev) => ({
            ...prev,
            [prompt]: { status: "error", error: err?.message || "failed" },
          }));
        });
    });
  }, [assets, videoImageCache]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.eyebrow}>Sandbox</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.chipButton, pressed && styles.chipButtonPressed]}
            >
              <Text style={styles.chipButtonLabel}>Close</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/")}
              style={({ pressed }) => [styles.chipButton, pressed && styles.chipButtonPressed]}
            >
              <Text style={styles.chipButtonLabel}>Go to production flow</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.heading}>Stress support pilot</Text>
        <Text style={styles.subheading}>
          This is a separate interface for quick experiments. It auto-selects a random stress
          summary and, on click, drafts a simple 15 minute intervention. No psychology theory or
          research copy is baked in yet.
        </Text>

        <Card style={styles.summaryCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeading}>
              <Text style={styles.cardTitle}>Auto-selected summary</Text>
              {summary?.source ? (
                <Text style={styles.badge}>{summary.source === "llm" ? "AI" : "Fallback"}</Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={loadSummary}
              style={({ pressed }) => [styles.ghostButton, pressed && styles.ghostButtonPressed]}
            >
              <Text style={styles.ghostButtonLabel}>
                {summaryStatus === "loading" ? "Refreshing..." : "Shuffle summary"}
              </Text>
            </Pressable>
          </View>
          {summaryStatus === "loading" ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#0ea5e9" />
              <Text style={styles.loadingText}>Generating a fresh stress snapshot...</Text>
            </View>
          ) : null}
          {summaryStatus === "error" ? (
            <Text style={styles.errorText}>{summaryError}</Text>
          ) : null}
          {summary?.summary ? <Text style={styles.summaryText}>{summary.summary}</Text> : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Seed</Text>
            <Text style={styles.metaValue}>{summary?.seed || "randomized"}</Text>
          </View>
        </Card>

        <Card style={styles.planCard}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeading}>
                <Text style={styles.cardTitle}>15 minute intervention</Text>
                {plan?.source ? <Text style={styles.badge}>{plan.source}</Text> : null}
              </View>
              <View style={styles.formatPicker}>
                <Text style={styles.formatPickerLabel}>Support medium</Text>
                <View style={styles.formatPickerRow}>
                  {FORMAT_CHOICES.map((choice) => {
                    const selected = step1Medium === choice.id;
                    return (
                      <Pressable
                        key={`s1-${choice.id}`}
                        accessibilityRole="button"
                        onPress={() => setMedium(choice.id)}
                        style={({ pressed }) => [
                          styles.formatChip,
                          selected && styles.formatChipSelected,
                          pressed && styles.formatChipPressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.formatChipLabel,
                            selected && styles.formatChipLabelSelected,
                          ]}
                        >
                          {choice.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={handleGeneratePlan}
                disabled={planStatus === "loading" || summaryStatus === "loading"}
                style={({ pressed }) => [
                styles.primaryButton,
                (pressed || planStatus === "loading") && styles.primaryButtonPressed,
                (summaryStatus === "loading" || planStatus === "loading") && styles.primaryButtonDisabled,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>
                {planStatus === "loading" ? "Drafting..." : "Generate from summary"}
              </Text>
            </Pressable>
          </View>

          {planStatus === "error" ? <Text style={styles.errorText}>{planError}</Text> : null}
          {planStatus === "idle" ? (
            <Text style={styles.placeholderText}>
              Tap "Generate from summary" to see a quick support plan for the current stress note.
            </Text>
          ) : null}

          {plan ? (
            <View style={styles.planBody}>
              <Text style={styles.planTitle}>{plan.title || "Stress reset"}</Text>
              <Text style={styles.planFocus}>{plan.focus || "One short reset"}</Text>
              <View style={styles.formatRow}>
                <Text style={styles.formatBadge}>{plan.format || "text_steps"}</Text>
                <Text style={styles.planDuration}>
                  Approximate time - {formatMinutes(plan.duration_minutes || 15)}
                </Text>
              </View>
              <Text style={styles.planDuration}>Content is generated for the selected medium.</Text>
              {steps.map((step, idx) => {
                const stepNumber = idx + 1;
                const format = step1Medium; // enforce selected medium for this test
                const asset = resolveAssetForStep(stepNumber, format);
                const backgroundImageAsset =
                  format === "storyboard"
                    ? assets.find(
                        (a) =>
                          a.type === "image" &&
                          (a.step === stepNumber || typeof a.step === "undefined")
                      ) || assets.find((a) => a.type === "image")
                    : null;
                const contentLines = splitContentLines(asset?.content || step.instruction);
                return (
                  <View key={`${step.title || "step"}-${idx}`} style={styles.stepCard}>
                    <View style={styles.stepHeader}>
                      <Text style={styles.stepIndex}>{stepNumber}</Text>
                      <View style={styles.stepMeta}>
                        <Text style={styles.stepTitle}>{step.title || "Step"}</Text>
                        {step.minutes ? (
                          <Text style={styles.stepDuration}>{formatMinutes(step.minutes)}</Text>
                        ) : null}
                        <Text style={styles.stepFormat}>{format}</Text>
                      </View>
                    </View>

                    {["short_audio"].includes(format) ? (
                      <View style={styles.modalityBlock}>
                        <Text style={styles.stepInstruction}>{asset?.content || step.instruction}</Text>
                        {asset?.audio_tone ? <Text style={styles.audioTone}>Tone: {asset.audio_tone}</Text> : null}
                        {(asset?.voice_pitch || asset?.voice_rate) ? (
                          <Text style={styles.audioTone}>
                            Pitch: {asset?.voice_pitch ?? "—"} · Rate: {asset?.voice_rate ?? "—"}
                          </Text>
                        ) : null}
                        {asset?.music_prompt ? (
                          <Text style={styles.audioTone}>Background: {asset.music_prompt}</Text>
                        ) : null}
                        <Text style={styles.audioTone}>
                          Why: {asset?.explanation || "No explanation returned"}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() =>
                            handlePlayAudio(asset?.content || step.instruction || "", `audio-${idx}`, {
                              pitch: typeof asset?.voice_pitch === "number" ? asset.voice_pitch : undefined,
                              rate: typeof asset?.voice_rate === "number" ? asset.voice_rate : undefined,
                              music_prompt: asset?.music_prompt,
                              music_choice: asset?.music_choice,
                            })
                          }
                          style={({ pressed }) => [styles.audioButton, pressed && styles.audioButtonPressed]}
                        >
                          <Text style={styles.audioButtonLabel}>Play audio</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {format === "slides" ? (
                      <View style={styles.modalityBlock}>
                        <SlideDeck
                          slides={asset?.slides || contentLines}
                          theme={deckTheme}
                          imageUrls={
                            assets
                              .filter((a) => a.type === "image")
                              .map((img) => {
                                const prompt = img.prompt || img.content || "";
                                const entry = prompt ? imageCache[prompt] : null;
                                if (entry?.status === "ready") return entry.url;
                                if (entry?.status === "error") {
                                  console.warn("[stress-support] slide image failed", {
                                    prompt: prompt.slice(0, 80),
                                    error: entry.error,
                                  });
                                }
                                return null;
                              })
                              .filter(Boolean)
                          }
                        />
                        {assets.filter((a) => a.type === "image").length === 0 ? (
                          <Text style={styles.errorText}>No image asset returned for slides.</Text>
                        ) : imageUrlsForSlidesMissing(asset?.slides, assets, imageCache) ? (
                          <Text style={styles.errorText}>Some slides are missing images.</Text>
                        ) : null}
                      </View>
                    ) : null}

                    {format === "timed_cues" || format === "timer" ? (
                      <View style={styles.modalityBlock}>
                        {format === "timer" ? (
                          <>
                            <Text style={styles.stepInstruction}>Set a duration and start the timer.</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                              <TextInput
                                value={timerSecondsInput}
                                onChangeText={setTimerSecondsInput}
                                keyboardType="numeric"
                                placeholder="60"
                                placeholderTextColor="#64748b"
                                style={styles.timerInput}
                              />
                              <Text style={styles.audioTone}>seconds</Text>
                            </View>
                            <TimerScript
                              steps={[
                                {
                                  label: asset?.label || step.title || "Timer",
                                  duration_seconds: Math.max(
                                    1,
                                    Number.isFinite(Number(timerSecondsInput)) ? Math.round(Number(timerSecondsInput)) : 60
                                  ),
                                },
                              ]}
                              label={asset?.label || step.title}
                              showMusicToggle
                            />
                          </>
                        ) : (
                          (() => {
                            const timerSteps =
                              (Array.isArray(asset?.timer_steps) && asset.timer_steps.length
                                ? asset.timer_steps
                                : [{ label: asset?.label || "Timer", duration_seconds: asset?.duration_seconds || 60 }]) as Array<{
                                  label?: string;
                                  duration_seconds?: number;
                                }>;
                            const script =
                              asset?.audio_script ||
                                  asset?.content ||
                                  buildTimerGuidedScript(timerSteps, step.instruction);
                                const highlightWord = (text: string) => {
                              const parts = text.split(/(\s+)/);
                              const active = spokenWord?.toLowerCase().replace(/[^a-z0-9]/g, "");
                              return (
                                <Text style={styles.stepInstruction}>
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
                                return (
                                  <>
                                {highlightWord(script)}
                                <TimerScript
                                  steps={timerSteps}
                                  label={asset?.label || step.title}
                                  scriptWords={script ? splitScriptWords(script).map((t) => t.word) : undefined}
                                  showMusicToggle={false}
                                />
                                <SpokenCounter
                                  word={spokenWord}
                                  number={spokenNumber}
                                  displayCount={spokenDisplayCount}
                                  pulse={spokenPulse}
                                  icon={["🌿", "💧", "✨", "🌙", "🌸"][spokenDisplayCount % 5] || "🌿"}
                                  showMotion={spokenDisplayCount > 0}
                                />
                                <Pressable
                                  accessibilityRole="button"
                                  onPress={() => {
                                    const text = script.trim();
                                    if (!text) {
                                      console.warn("[stress-support] no script to read");
                                      return;
                                    }
                                    if (typeof window === "undefined" || !(window as any).speechSynthesis) {
                                      console.warn("[stress-support] SpeechSynthesis not available");
                                      return;
                                    }
                                    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
                                    const synth = window.speechSynthesis;
                                    synth.cancel();
                                    stopSpokenAmbient();
                                    startSpokenAmbient();
                                    const bump = () => {
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
                                    const handleNumber = (num: number | null) => {
                                      if (!Number.isFinite(num)) {
                                        setSpokenDisplayCount(0);
                                        return;
                                      }
                                      const n = num as number;
                                      setSpokenDisplayCount(n);
                                      bump();
                                    };
                                    const speakSentence = (idx: number) => {
                                      if (idx >= sentences.length) {
                                        setSpokenWord(null);
                                        setSpokenNumber(null);
                                        setSpokenDisplayCount(0);
                                        stopSpokenAmbient();
                                        return;
                                      }
                                      const sentence = sentences[idx];
                                      const localTokens = splitScriptWords(sentence);
                                      const utter = new SpeechSynthesisUtterance(sentence);
                                    utter.rate = 0.55;
                                    utter.pitch = 0.95;
                                    utter.onstart = () => {
                                      console.log("[stress-support] speech start sentence", idx + 1);
                                      setSpokenDisplayCount(0);
                                    };
                                    utter.onboundary = (ev: any) => {
                                      const charIdx = ev.charIndex || 0;
                                      const tokenIdx = localTokens.findIndex(
                                        (t, i) =>
                                          charIdx >= t.start &&
                                          (i === localTokens.length - 1 || charIdx < localTokens[i + 1].start)
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
                                      console.log("[stress-support] speech end sentence", idx + 1);
                                      setTimeout(() => speakSentence(idx + 1), 2000);
                                    };
                                    synth.speak(utter);
                                  };
                                  speakSentence(0);
                                }}
                                style={({ pressed }) => [styles.audioButton, pressed && styles.audioButtonPressed]}
                                >
                                  <Text style={styles.audioButtonLabel}>Play guided audio</Text>
                                </Pressable>
                                <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                                  <Pressable
                                    accessibilityRole="button"
                                    onPress={() => {
                                      if (typeof window === "undefined" || !(window as any).speechSynthesis) return;
                                      console.log("[stress-support] speech paused");
                                      window.speechSynthesis.pause();
                                      if (spokenAmbientRef.current) spokenAmbientRef.current.pause();
                                    }}
                                    style={({ pressed }) => [styles.audioButtonGhost, pressed && styles.audioButtonPressed]}
                                  >
                                    <Text style={styles.audioButtonGhostLabel}>Pause</Text>
                                  </Pressable>
                                  <Pressable
                                    accessibilityRole="button"
                                    onPress={() => {
                                      if (typeof window === "undefined" || !(window as any).speechSynthesis) return;
                                      console.log("[stress-support] speech reset");
                                      window.speechSynthesis.cancel();
                                      setSpokenWord(null);
                                      setSpokenNumber(null);
                                      setSpokenDisplayCount(0);
                                      stopSpokenAmbient();
                                    }}
                                    style={({ pressed }) => [styles.audioButtonGhost, pressed && styles.audioButtonPressed]}
                                  >
                                    <Text style={styles.audioButtonGhostLabel}>Reset</Text>
                                  </Pressable>
                                </View>
                              </>
                            );
                          })()
                        )}
                        {asset?.explanation && format !== "timer" ? <Text style={styles.audioTone}>Why: {asset.explanation}</Text> : null}
                      </View>
                    ) : null}

                    {format === "calming_motion" ? (
                      <View style={styles.modalityBlock}>
                        <CalmingMotion
                          lines={
                            Array.isArray(asset?.overlay) && asset?.overlay?.length
                              ? (asset?.overlay as string[])
                              : contentLines
                          }
                          prompt={asset?.prompt || asset?.content || step.instruction}
                        />
                        {asset?.explanation ? <Text style={styles.audioTone}>Why: {asset.explanation}</Text> : null}
                      </View>
                    ) : null}

                    {format === "dalle_video" ? (
                      <View style={styles.modalityBlock}>
                        {Array.isArray(asset?.prompts) && asset.prompts.length ? (
                          <DallePseudoVideo
                            prompts={asset.prompts as string[]}
                            cache={videoImageCache}
                            captions={asset.script_lines as string[]}
                            activeIndex={videoAuto ? undefined : videoActiveIndex}
                            auto={videoAuto}
                            onFrameChange={(nextIdx) => {
                              if (videoAuto) setVideoActiveIndex(nextIdx);
                            }}
                          />
                        ) : (
                          <Text style={styles.errorText}>No image prompts returned for this video.</Text>
                        )}
                        {Array.isArray(asset?.script_lines) && asset.script_lines.length ? (
                          <View style={styles.deckShell}>
                            <LinearGradient
                              colors={["rgba(59,130,246,0.06)", "rgba(14,165,233,0.05)"]}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={[styles.deckBackground, { borderRadius: 12 }]}
                            />
                            <View style={[styles.deckHeader, { marginBottom: 10 }]}>
                              <View style={styles.microBadge}>
                                <Text style={styles.microIcon}>🎬</Text>
                              </View>
                              <Text style={styles.slideIndex}>4-step script</Text>
                            </View>
                            {(asset.script_lines as string[]).map((line, i) => (
                              <View key={`dv-${i}`} style={[styles.slideCard, { padding: 12, minWidth: "100%", gap: 6 }]}>
                                <View style={[styles.stepMeta, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
                                  <View style={styles.microBadge}>
                                    <Text style={styles.microIcon}>{["🌿", "💧", "✨", "🌙"][i % 4] || "🎬"}</Text>
                                  </View>
                                  <Text style={styles.slideIndex}>Beat {i + 1}</Text>
                                </View>
                                <Text style={[styles.slideText, { lineHeight: 22 }]}>{line}</Text>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.errorText}>No script lines returned.</Text>
                        )}
                        {Array.isArray(asset?.script_lines) && asset.script_lines.length ? (
                          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => {
                                if (typeof window === "undefined" || !(window as any).speechSynthesis) {
                                  console.warn("[dalle_video] SpeechSynthesis not available");
                                  return;
                                }
                                const lines = (asset.script_lines as string[]).filter(Boolean);
                                if (!lines.length) return;
                                const synth = window.speechSynthesis;
                                synth.cancel();
                                setVideoAuto(false);
                                setVideoActiveIndex(0);
                                setVideoNarrationActive(true);
                                setVideoNarrationPaused(false);
                                const speakLine = (idx: number) => {
                                if (idx >= lines.length) {
                                  console.log("[dalle_video] voiceover complete");
                                  setVideoNarrationActive(false);
                                  setVideoNarrationPaused(false);
                                  return;
                                }
                                  const utter = new SpeechSynthesisUtterance(lines[idx]);
                                  utter.rate = 0.95;
                                  utter.pitch = 1.0;
                                  utter.onstart = () => {
                                    console.log("[dalle_video] voiceover start line", idx + 1);
                                    setVideoActiveIndex(idx);
                                  };
                                  utter.onend = () => {
                                    console.log("[dalle_video] voiceover end line", idx + 1);
                                    setVideoActiveIndex((prev) => Math.min(lines.length - 1, idx + 1));
                                    setTimeout(() => speakLine(idx + 1), 250);
                                  };
                                  synth.speak(utter);
                                };
                                speakLine(0);
                              }}
                              style={({ pressed }) => [styles.audioButton, pressed && styles.audioButtonPressed]}
                            >
                              <Text style={styles.audioButtonLabel}>Play voiceover</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => {
                                const lines = (asset.script_lines as string[]).filter(Boolean);
                                if (!lines.length) return;
                                const tonePitch =
                                  typeof asset?.voice_pitch === "number" && Number.isFinite(asset.voice_pitch)
                                    ? asset.voice_pitch
                                    : 1.0;
                                const toneRate =
                                  typeof asset?.voice_rate === "number" && Number.isFinite(asset.voice_rate)
                                    ? asset.voice_rate
                                    : 0.94;
                                setVideoAuto(false);
                                setVideoActiveIndex(0);
                                setVideoNarrationActive(true);
                                setVideoNarrationPaused(false);
                                startSpokenAmbient();
                                const playLineTts = (lineIdx: number) => {
                                  if (lineIdx >= lines.length) {
                                    setVideoNarrationActive(false);
                                    setVideoNarrationPaused(false);
                                    stopSpokenAmbient();
                                    return;
                                  }
                                  setVideoActiveIndex(lineIdx);
                                  handlePlayAudio(lines[lineIdx], `dalle-gpt-voice-${idx}-${lineIdx}-${Date.now()}`, {
                                    pitch: tonePitch,
                                    rate: toneRate,
                                    onEnd: () => {
                                      setTimeout(() => playLineTts(lineIdx + 1), 200);
                                    },
                                  });
                                };
                                playLineTts(0);
                              }}
                              style={({ pressed }) => [styles.audioButtonGhost, pressed && styles.audioButtonPressed]}
                            >
                              <Text style={styles.audioButtonGhostLabel}>Play GPT voiceover (TTS)</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => {
                                if (typeof window === "undefined" || !(window as any).speechSynthesis) {
                                  console.warn("[dalle_video] SpeechSynthesis not available");
                                  return;
                                }
                                if (!videoNarrationActive) return;
                                const synth = window.speechSynthesis;
                                if (videoNarrationPaused) {
                                  synth.resume();
                                  setVideoNarrationPaused(false);
                                } else {
                                  synth.pause();
                                  setVideoNarrationPaused(true);
                                }
                              }}
                              style={({ pressed }) => [styles.audioButtonGhost, pressed && styles.audioButtonPressed]}
                            >
                              <Text style={styles.audioButtonGhostLabel}>
                                {videoNarrationPaused ? "Resume voiceover" : "Pause voiceover"}
                              </Text>
                            </Pressable>
                          </View>
                        ) : null}
                        {asset?.explanation ? <Text style={styles.audioTone}>Why: {asset.explanation}</Text> : null}
                      </View>
                    ) : null}

                    {format === "storyboard" ? (
                      <View style={styles.modalityBlock}>
                        <Text style={styles.stepInstruction}>{asset?.content || step.instruction}</Text>
                        <Storyboard
                          frames={asset?.frames || contentLines}
                          imageUrls={
                            assets
                              .filter((a) => a.type === "image")
                              .map((img, idx) => {
                                const prompt = img.prompt || img.content || "";
                                const entry = prompt ? imageCache[prompt] : null;
                                console.log("[stress-support] storyboard image map", {
                                  idx,
                                  prompt: prompt.slice(0, 80),
                                  status: entry?.status,
                                });
                                if (entry?.status === "ready") return entry.url;
                                if (entry?.status === "error") {
                                  console.warn("[stress-support] storyboard image failed", {
                                    prompt: prompt.slice(0, 80),
                                    error: entry.error,
                                  });
                                }
                                return null;
                              })
                              .filter(Boolean)
                          }
                        />
                        {assets.filter((a) => a.type === "image").length === 0 ? (
                          <Text style={styles.errorText}>No image asset returned for storyboard.</Text>
                        ) : null}
                        {asset?.frames?.length && assets.filter((a) => a.type === "image").length < (asset.frames?.length || 0) ? (
                          <Text style={styles.errorText}>Some storyboard cards are missing images.</Text>
                        ) : null}
                        {asset?.explanation ? (
                          <Text style={styles.audioTone}>Why: {asset.explanation}</Text>
                        ) : null}
                      </View>
                    ) : null}

                    {format === "images" ? (
                      <View style={styles.modalityBlock}>
                        <Text style={styles.stepInstruction}>{asset?.content || step.instruction}</Text>
                        {asset?.prompt ? (
                          <Text style={styles.audioTone}>Prompt: {asset.prompt}</Text>
                        ) : null}
                        <GeneratedImage prompt={asset?.prompt || asset?.content || ""} cache={imageCache} />
                      </View>
                    ) : null}

                    {format === "text_steps" ? (
                      <Text style={styles.stepInstruction}>{step.instruction}</Text>
                    ) : null}
                  </View>
                );
              })}
              {plan.wrap_up ? <Text style={styles.wrapUp}>{plan.wrap_up}</Text> : null}
              {plan.encouragement ? (
                <Text style={styles.encouragement}>{plan.encouragement}</Text>
              ) : null}
            </View>
          ) : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  spokenCounter: {
    marginTop: 12,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 14,
    backgroundColor: "rgba(34,211,238,0.1)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.35)",
    minHeight: 160,
    width: "100%",
  },
  spokenNumber: {
    fontSize: 40,
    fontWeight: "800",
    color: "#7dd3fc",
  },
  spokenNumberWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(59,130,246,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.35)",
  },
  spokenNumberIcon: {
    fontSize: 22,
  },
  spokenWord: {
    marginTop: 6,
    fontSize: 16,
    color: "#cbd5f5",
    fontWeight: "600",
  },
  spokenHeard: {
    fontSize: 13,
    color: "#94a3b8",
    marginTop: 4,
  },
  spokenMotionWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: 110,
    marginBottom: 8,
    position: "relative",
    overflow: "hidden",
    borderRadius: 12,
  },
  spokenMotionBlob: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(16,185,129,0.25)",
  },
  spokenHighlight: {
    backgroundColor: "rgba(34,211,238,0.25)",
    color: "#e0f2fe",
    borderRadius: 4,
  },
  spokenAmbientNote: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 4,
  },
  motionCard: {
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#0b1530",
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.25)",
    minHeight: 220,
    justifyContent: "center",
    alignItems: "center",
  },
  motionBg: {
    ...StyleSheet.absoluteFillObject,
  },
  motionBlob: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(16,185,129,0.22)",
    position: "absolute",
  },
  motionTextWrap: {
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  motionLine: {
    fontSize: 16,
    color: "#e2e8f0",
    textAlign: "center",
    fontWeight: "700",
  },
  motionPrompt: {
    fontSize: 13,
    color: "#cbd5e1",
    textAlign: "center",
  },
  promptList: {
    marginTop: 8,
    gap: 4,
  },
  promptLine: {
    color: "#e2e8f0",
    fontSize: 14,
  },
  promptLineActive: {
    color: "#22d3ee",
    fontWeight: "700",
  },
  pseudoVideo: {
    marginTop: 12,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.35)",
    width: "92%",
    alignSelf: "center",
    maxWidth: 520,
    backgroundColor: "#0b1530",
  },
  pseudoVideoFrame: {
    width: "100%",
    height: 320,
    position: "relative",
    backgroundColor: "#0b1530",
  },
  pseudoVideoImage: {
    width: "100%",
    height: "100%",
    borderRadius: 0,
  },
  pseudoVideoCaptionWrap: {
    position: "absolute",
    bottom: 10,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(6,12,26,0.72)",
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.35)",
  },
  pseudoVideoCaption: {
    color: "#e0f2fe",
    fontSize: 14,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    flex: 1,
    lineHeight: 20,
  },
  safe: {
    flex: 1,
    backgroundColor: "#0b1224",
  },
  container: {
    padding: 20,
    paddingBottom: 36,
    gap: 18,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  eyebrow: {
    fontSize: 13,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#60a5fa",
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  heading: {
    fontSize: 26,
    color: "#e0f2fe",
    fontWeight: "700",
  },
  subheading: {
    fontSize: 15,
    color: "#cbd5e1",
    lineHeight: 22,
  },
  card: {
    borderRadius: 18,
    padding: 18,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.25)",
    gap: 12,
    ...Platform.select({
      web: {
        boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
      },
      default: {
        shadowColor: "#0b1224",
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 10 },
        elevation: 6,
      },
    }),
  },
  summaryCard: {
    backgroundColor: "#0b1530",
  },
  planCard: {
    backgroundColor: "#0b1530",
    borderColor: "rgba(52, 211, 153, 0.35)",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    fontSize: 17,
    color: "#e2e8f0",
    fontWeight: "700",
  },
  badge: {
    fontSize: 12,
    color: "#0ea5e9",
    backgroundColor: "rgba(14, 165, 233, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(14, 165, 233, 0.4)",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  ghostButton: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.4)",
  },
  ghostButtonPressed: {
    opacity: 0.8,
  },
  ghostButtonLabel: {
    color: "#e0f2fe",
    fontWeight: "600",
    fontSize: 14,
  },
  primaryButton: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#10b981",
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonLabel: {
    color: "#0b1224",
    fontWeight: "700",
    fontSize: 14,
  },
  chipButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.5)",
    backgroundColor: "rgba(96, 165, 250, 0.1)",
  },
  chipButtonPressed: {
    opacity: 0.85,
  },
  chipButtonLabel: {
    color: "#e0f2fe",
    fontWeight: "600",
    fontSize: 13,
  },
  summaryText: {
    color: "#e2e8f0",
    fontSize: 16,
    lineHeight: 24,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaLabel: {
    fontSize: 12,
    color: "#94a3b8",
    letterSpacing: 0.3,
  },
  metaValue: {
    fontSize: 13,
    color: "#cbd5e1",
    fontWeight: "600",
  },
  storyboardCanvas: {
    position: "relative",
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(11, 18, 36, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.15)",
  },
  storyboardBg: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  storyboardOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  storyboardRow: {
    paddingVertical: 12,
    paddingHorizontal: 6,
    gap: 18,
  },
  frameCard: {
    flexGrow: 1,
    minWidth: 320,
    maxWidth: 380,
    height: 260,
    padding: 18,
    borderRadius: 14,
    backgroundColor: "rgba(11, 18, 36, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.25)",
    shadowColor: "#0ea5e9",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    overflow: "hidden",
  },
  frameImage: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  frameMask: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 14,
  },
  frameHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    zIndex: 1,
  },
  framePill: {
    backgroundColor: "rgba(34,211,238,0.2)",
    borderColor: "rgba(34,211,238,0.6)",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  framePillText: {
    color: "#a5f3fc",
    fontSize: 12,
    fontWeight: "700",
  },
  frameIndex: {
    color: "#bae6fd",
    fontWeight: "700",
    marginBottom: 10,
    zIndex: 1,
  },
  frameText: {
    color: "#e2e8f0",
    fontSize: 16,
    lineHeight: 22,
    zIndex: 1,
  },
  timerCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: "rgba(11, 22, 40, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.25)",
    gap: 8,
  },
  timerTitle: {
    color: "#e2e8f0",
    fontSize: 18,
    fontWeight: "700",
  },
  timerClockWrapper: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  timerClock: {
    color: "#e0f2fe",
    fontSize: 34,
    fontWeight: "700",
  },
  timerIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.5)",
    backgroundColor: "rgba(34,211,238,0.15)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  timerIcon: {
    fontSize: 22,
  },
  timerActiveLabel: {
    color: "#a5f3fc",
    fontSize: 15,
    marginTop: 6,
    fontWeight: "700",
  },
  timerCountLabel: {
    color: "#9ae6b4",
    fontSize: 16,
    marginTop: 4,
    fontWeight: "700",
  },
  timerSpokenLabel: {
    color: "#cbd5f5",
    fontSize: 14,
    marginTop: 4,
    fontWeight: "600",
  },
  timerProgressOuter: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(148,163,184,0.2)",
    overflow: "hidden",
    marginBottom: 10,
  },
  timerProgressInner: {
    height: "100%",
    backgroundColor: "#22d3ee",
  },
  timerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  timerButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#22d3ee",
  },
  timerButtonActive: {
    backgroundColor: "#0ea5e9",
  },
  timerButtonPressed: {
    opacity: 0.85,
  },
  timerButtonLabel: {
    color: "#0b1224",
    fontWeight: "700",
  },
  timerButtonGhost: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.4)",
  },
  timerButtonGhostLabel: {
    color: "#e2e8f0",
    fontWeight: "700",
  },
  timerSteps: {
    gap: 4,
  },
  timerStepText: {
    color: "#cbd5e1",
    fontSize: 14,
  },
  timerStepTextActive: {
    color: "#22d3ee",
    fontWeight: "700",
  },
  placeholderText: {
    color: "#94a3b8",
    fontSize: 14,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: "#cbd5e1",
    fontSize: 14,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
  },
  planBody: {
    gap: 12,
  },
  planTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#e2e8f0",
  },
  planFocus: {
    fontSize: 15,
    color: "#cbd5e1",
  },
  formatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  formatBadge: {
    fontSize: 12,
    color: "#0ea5e9",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(14,165,233,0.12)",
    borderWidth: 1,
    borderColor: "rgba(14,165,233,0.35)",
  },
  planDuration: {
    fontSize: 13,
    color: "#a5f3fc",
    flex: 1,
  },
  formatPicker: {
    gap: 8,
    maxWidth: "100%",
  },
  formatPickerLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#cbd5e1",
    letterSpacing: 0.3,
  },
  formatPickerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  formatChip: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.5)",
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  formatChipSelected: {
    borderColor: "rgba(16, 185, 129, 0.8)",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  formatChipPressed: {
    opacity: 0.9,
  },
  formatChipLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#cbd5e1",
  },
  formatChipLabelSelected: {
    color: "#34d399",
  },
  stepList: {
    gap: 10,
  },
  stepCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(52, 211, 153, 0.3)",
    backgroundColor: "rgba(52, 211, 153, 0.05)",
    padding: 12,
    gap: 6,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#10b981",
    color: "#0b1224",
    textAlign: "center",
    textAlignVertical: "center",
    fontWeight: "700",
  },
  stepMeta: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#e2e8f0",
  },
  stepDuration: {
    fontSize: 12,
    color: "#cbd5e1",
  },
  stepFormat: {
    fontSize: 12,
    color: "#34d399",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontWeight: "700",
  },
  stepInstruction: {
    fontSize: 14,
    color: "#dbeafe",
    lineHeight: 20,
  },
  wrapUp: {
    fontSize: 14,
    color: "#cbd5e1",
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.35)",
    paddingTop: 10,
  },
  encouragement: {
    fontSize: 13,
    color: "#a5f3fc",
    fontWeight: "600",
  },
  assetList: {
    gap: 10,
    marginTop: 6,
  },
  assetHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: "#e2e8f0",
  },
  assetCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.4)",
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    padding: 12,
    gap: 6,
  },
  assetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  assetType: {
    fontSize: 12,
    fontWeight: "700",
    color: "#93c5fd",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  assetDuration: {
    fontSize: 12,
    color: "#e0f2fe",
  },
  assetLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#e2e8f0",
  },
  assetContent: {
    fontSize: 13,
    color: "#dbeafe",
    lineHeight: 19,
  },
  audioButton: {
    marginTop: 6,
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#0ea5e9",
  },
  audioButtonGhost: {
    marginTop: 6,
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.4)",
  },
  audioButtonPressed: {
    opacity: 0.9,
  },
  audioButtonLabel: {
    color: "#0b1224",
    fontWeight: "700",
    fontSize: 13,
  },
  audioButtonGhostLabel: {
    color: "#e2e8f0",
    fontWeight: "700",
    fontSize: 13,
  },
  timerInput: {
    backgroundColor: "#0b1530",
    color: "#e2e8f0",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 80,
  },
  audioTone: {
    fontSize: 12,
    color: "#cbd5e1",
  },
  modalityBlock: {
    marginTop: 8,
    gap: 6,
  },
  deckShell: {
    position: "relative",
    paddingVertical: 8,
    marginTop: 6,
  },
  deckBackground: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 16,
    opacity: 0.55,
  },
  deckHero: {
    position: "absolute",
    top: -12,
    right: 0,
    width: 180,
    height: 180,
    borderRadius: 120,
    opacity: 0.7,
  },
  deckHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  deckEyebrow: {
    fontSize: 12,
    color: "#a5b4fc",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  deckProgress: {
    flexDirection: "row",
    gap: 6,
  },
  deckDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(148, 163, 184, 0.45)",
  },
  deckDotActive: {
    backgroundColor: "#22d3ee",
  },
  slideRow: {
    paddingVertical: 4,
    paddingHorizontal: 2,
    gap: 12,
  },
  slideCard: {
    width: 260,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "rgba(15, 23, 42, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(34, 211, 238, 0.25)",
    marginRight: 12,
    overflow: "hidden",
    shadowColor: "#0ea5e9",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  slideGlow: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    opacity: 0.16,
  },
  slideImage: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 18,
  },
  slideMask: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  slideFallback: {
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
  },
  slideTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  microBadge: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  microIcon: {
    fontSize: 18,
  },
  slideIndex: {
    fontSize: 12,
    color: "#93c5fd",
    fontWeight: "700",
  },
  slideText: {
    fontSize: 15,
    color: "#e2e8f0",
    lineHeight: 22,
  },
  imageCard: {
    borderRadius: 12,
    padding: 14,
    minHeight: 120,
    justifyContent: "flex-end",
  },
  imageText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0b1224",
  },
  generatedImageCard: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.5)",
    backgroundColor: "#0f172a",
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    width: "92%",
    alignSelf: "center",
  },
  generatedImage: {
    width: "100%",
    height: 320,
    backgroundColor: "#0b1224",
  },
  generatedImageShimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  imagePromptLabel: {
    fontSize: 12,
    color: "#cbd5e1",
    padding: 8,
  },
});
