import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Text, StyleSheet, Platform, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getUxPlan, getCachedLayeredImage, getFlowState, updateFlowState } from "./layered-store";
import UxGeneratorScreen from "./dev/ux-generator";

export const options = {
  headerShown: false,
};

export default function StepOneScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const rawStepIndex =
    typeof params?.stepIndex === "string" && params.stepIndex.trim()
      ? params.stepIndex.trim()
      : "0";
  const stepIndexNumber = Number(rawStepIndex || 0);
  const sessionId =
    typeof params?.sessionId === "string" && params.sessionId.trim()
      ? params.sessionId.trim()
      : "";
  const participantId =
    typeof params?.participantId === "string" && params.participantId.trim()
      ? params.participantId.trim()
      : "";
  const condition =
    typeof params?.condition === "string" && (params.condition === "1" || params.condition === "2")
      ? params.condition
      : "1";
  const arm =
    typeof params?.arm === "string" && (params.arm === "pi" || params.arm === "cr")
      ? params.arm
      : condition === "2"
      ? "cr"
      : "pi";
  const flowState = useMemo(() => getFlowState(sessionId), [sessionId]);
  const storedStepParams =
    flowState?.stepParamsByIndex && Number.isFinite(stepIndexNumber)
      ? flowState.stepParamsByIndex[String(stepIndexNumber)] || null
      : null;
  const minutes =
    (typeof params?.minutes === "string" && params.minutes.trim()
      ? params.minutes.trim()
      : typeof storedStepParams?.minutes === "string"
        ? storedStepParams.minutes
        : null) || null;
  const title =
    (typeof params?.title === "string" && params.title.trim()
      ? params.title.trim()
      : typeof storedStepParams?.title === "string"
        ? storedStepParams.title
        : "") || "Step 1 activity";
  const description =
    (typeof params?.description === "string" && params.description.trim()
      ? params.description.trim()
      : typeof storedStepParams?.description === "string"
        ? storedStepParams.description
        : "") || "This step description will flow in from the selected plan.";
  const imagePrompt =
    (typeof params?.imagePrompt === "string" && params.imagePrompt.trim()
      ? params.imagePrompt.trim()
      : typeof storedStepParams?.imagePrompt === "string"
        ? storedStepParams.imagePrompt
        : "") || "";
  const imageUrl =
    (typeof params?.imageUrl === "string" && params.imageUrl.trim()
      ? params.imageUrl.trim()
      : typeof storedStepParams?.imageUrl === "string"
        ? storedStepParams.imageUrl
        : "") || "";
  const uxCacheKey =
    (typeof params?.uxCacheKey === "string" && params.uxCacheKey.trim()
      ? params.uxCacheKey.trim()
      : typeof storedStepParams?.uxCacheKey === "string"
        ? storedStepParams.uxCacheKey
        : "") || "";
  const cachedUxPlan = useMemo(() => getUxPlan(uxCacheKey), [uxCacheKey]);
  const preStructuredSpec =
    cachedUxPlan && typeof cachedUxPlan.specText === "string" ? cachedUxPlan.specText : "";
  const preGeneratedMedia =
    cachedUxPlan && typeof cachedUxPlan.media === "object" && cachedUxPlan.media ? cachedUxPlan.media : null;
  const cachedImageUrl = useMemo(
    () => (imageUrl ? imageUrl : imagePrompt ? getCachedLayeredImage(imagePrompt) : ""),
    [imagePrompt, imageUrl]
  );
  const conversationContext =
    (typeof params?.conversation === "string" && params.conversation.trim()
      ? params.conversation.trim()
      : typeof storedStepParams?.conversation === "string"
        ? storedStepParams.conversation
        : "") || "";
  const combinedDescription =
    (typeof params?.combinedDescription === "string" && params.combinedDescription.trim()
      ? params.combinedDescription.trim()
      : typeof storedStepParams?.combinedDescription === "string"
        ? storedStepParams.combinedDescription
        : "") || description;
  const moodEmotions =
    (typeof params?.moodEmotions === "string" && params.moodEmotions.trim()
      ? params.moodEmotions.trim()
      : typeof storedStepParams?.moodEmotions === "string"
        ? storedStepParams.moodEmotions
        : "") || "";
  const moodOther =
    (typeof params?.moodOther === "string" && params.moodOther.trim()
      ? params.moodOther.trim()
      : typeof storedStepParams?.moodOther === "string"
        ? storedStepParams.moodOther
        : "") || "";
  const stepIndex = rawStepIndex;
  const paperMode = params?.paperMode === "1";
  const [showInputs, setShowInputs] = useState(false);
  const [uxReady, setUxReady] = useState(false);
  useEffect(() => {
    console.log("[step1] params", {
      minutes,
      title,
      description: description?.slice(0, 120),
      hasConversation: Boolean(conversationContext),
      hasImageUrl: Boolean(cachedImageUrl),
      sessionId: sessionId || null,
      uxCacheKey: uxCacheKey || null,
      hasPreStructuredSpec: Boolean(preStructuredSpec),
    });
  }, [minutes, title, description, conversationContext, cachedImageUrl, sessionId, uxCacheKey, preStructuredSpec]);
  useEffect(() => {
    if (!sessionId) return;
    updateFlowState(sessionId, {
      stepParamsByIndex: {
        [String(stepIndexNumber)]: {
          minutes,
          title,
          description,
          imagePrompt,
          imageUrl,
          sessionId,
          uxCacheKey,
          combinedDescription,
          conversation: conversationContext,
          moodEmotions,
          moodOther,
        },
      },
    });
  }, [
    combinedDescription,
    conversationContext,
    description,
    imagePrompt,
    imageUrl,
    minutes,
    moodEmotions,
    moodOther,
    sessionId,
    stepIndexNumber,
    title,
    uxCacheKey,
  ]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>

        <View style={styles.split}>
          <View style={styles.rightPane}>
            <View style={styles.rightContent}>
              <ScrollView contentContainerStyle={styles.rightScroll}>
                <View style={[styles.uxWrap, !uxReady && styles.uxHidden]}>
                  <UxGeneratorScreen
                    showInputs={showInputs}
                    onToggleInputs={() => setShowInputs((s) => !s)}
                    onComplete={() =>
                      router.push({
                        pathname: "/step1-complete",
                        params: {
                          sessionId: sessionId || undefined,
                          stepIndex,
                          condition,
                          arm,
                          participantId: participantId || undefined,
                        },
                      })
                    }
                    stepIndex={stepIndexNumber}
                    onPrevExit={() => {
                      router.back();
                    }}
                    defaultDescription={combinedDescription}
                    preStructuredSpec={preStructuredSpec}
                    preGeneratedMedia={preGeneratedMedia || undefined}
                    backgroundImage={cachedImageUrl || undefined}
                    autoGenerate
                    conversationContext={conversationContext}
                    moodEmotions={moodEmotions}
                    moodOther={moodOther}
                    paperMode={paperMode}
                    sessionId={sessionId}
                    onMediaReady={() => setUxReady(true)}
                  />
                </View>
                {!uxReady ? (
                  <View style={styles.loadingOverlay}>
                    <Text style={styles.loadingTitle}>Preparing your personalized UX…</Text>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  container: {
    flex: 1,
    padding: 12,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#0f172a",
  },
  minutes: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  subtitle: {
    fontSize: 16,
    color: "#334155",
  },
  headerSpacing: {
    marginBottom: 6,
  },
  rightScroll: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  uxWrap: {
    flex: 1,
  },
  uxHidden: {
    opacity: 0,
    height: 0,
  },
  loadingOverlay: {
    paddingVertical: 36,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 6,
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  split: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    flex: 1,
  },
  leftColumn: {
    flex: 0.45,
    gap: 8,
  },
  card: {
    flex: 0,
    borderRadius: 16,
    overflow: "hidden",
    minHeight: 220,
    position: "relative",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardImage: {
    ...StyleSheet.absoluteFillObject,
  },
  cardFallback: {
    ...StyleSheet.absoluteFillObject,
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  cardLabelWrap: {
    position: "absolute",
    top: 12,
    left: 12,
  },
  cardBadge: {
    color: "#f8fafc",
    backgroundColor: "rgba(0,0,0,0.58)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    fontWeight: "700",
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cardMinutesWrap: {
    position: "absolute",
    top: 12,
    right: 12,
  },
  cardMinutes: {
    color: "#f8fafc",
    backgroundColor: "rgba(0,0,0,0.58)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    fontWeight: "700",
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cardContent: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 12,
    gap: 8,
  },
  cardTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cardImageError: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    color: "#fecdd3",
    fontSize: 12,
  },
  cardUnderline: {
    height: 3,
    width: 80,
    borderRadius: 999,
  },
  cardDescriptionShell: {
    backgroundColor: "rgba(255,255,255,0.8)",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    ...Platform.select({
      web: { backdropFilter: "blur(4px)" },
      default: {},
    }),
  },
  cardCopy: {
    color: "#0f172a",
    fontSize: 14,
    lineHeight: 20,
    textShadowColor: "rgba(255,255,255,0.0)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  rightPane: {
    flex: 1,
    borderRadius: 0,
    padding: 0,
    borderWidth: 0,
    borderColor: "transparent",
    overflow: "visible",
    position: "relative",
  },
  rightContent: {
    flex: 1,
    gap: 8,
  },
  rightCopy: {
    fontSize: 14,
    lineHeight: 20,
    color: "#1f2937",
  },
  rightHint: {
    fontSize: 12,
    color: "#475569",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: "#0ea5e9",
  },
  briefBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 10,
    backgroundColor: "#f8fafc",
    gap: 6,
  },
  briefLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  briefText: {
    fontSize: 14,
    color: "#1f2937",
    lineHeight: 20,
  },
  textBox: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    padding: 12,
    fontSize: 15,
    color: "#0f172a",
    backgroundColor: "#fff",
    textAlignVertical: "top",
  },
});
