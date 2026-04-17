import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getUxPlanKeyForSessionStep, getFlowState, updateFlowState } from "./layered-store";
import MoodMeterWidget from "./mood-meter-widget";

const MoodMeter = () => {
  const router = useRouter();
  const params = useLocalSearchParams();
  const stepIndex = useMemo(() => Number(params.stepIndex || 0), [params.stepIndex]);
  const [selected, setSelected] = useState<string[]>([]);
  const [otherEmotions, setOtherEmotions] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const minutes = typeof params.minutes === "string" ? params.minutes : undefined;
  const title = typeof params.title === "string" ? params.title : undefined;
  const description = typeof params.description === "string" ? params.description : undefined;
  const imageUrl = typeof params.imageUrl === "string" ? params.imageUrl : undefined;
  const imagePrompt = typeof params.imagePrompt === "string" ? params.imagePrompt : undefined;
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
  const combinedDescription = typeof params.combinedDescription === "string" ? params.combinedDescription : undefined;
  const conversation = typeof params.conversation === "string" ? params.conversation : undefined;
  const storedMood = useMemo(() => {
    if (!sessionId) return null;
    const state = getFlowState(sessionId);
    if (!state?.moodByIndex) return null;
    return state.moodByIndex[String(stepIndex)] || null;
  }, [sessionId, stepIndex]);

  const [uxCacheKey, setUxCacheKey] = useState(
    typeof params.uxCacheKey === "string" ? params.uxCacheKey : ""
  );
  useEffect(() => {
    if (!storedMood) return;
    if (Array.isArray(storedMood.selected) && storedMood.selected.length) {
      setSelected(storedMood.selected);
    }
    if (typeof storedMood.other === "string" && storedMood.other.length) {
      setOtherEmotions(storedMood.other);
    }
  }, [storedMood]);
  useEffect(() => {
    if (!sessionId) return;
    updateFlowState(sessionId, {
      moodByIndex: {
        [String(stepIndex)]: {
          selected,
          other: otherEmotions,
        },
      },
    });
  }, [otherEmotions, selected, sessionId, stepIndex]);

  useEffect(() => {
    if (!waiting) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
      const cachedKey = getUxPlanKeyForSessionStep(sessionId || "", stepIndex);
      if (cachedKey) {
        setUxCacheKey(cachedKey);
        setWaiting(false);
        clearInterval(id);
      }
    }, 500);
    return () => clearInterval(id);
  }, [waiting, sessionId, stepIndex]);

  const handleSelect = (label: string) => {
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  };

  const goToStep = (cacheKey: string) => {
    const target = stepIndex === 0 ? "/step1" : "/step2";
    router.push({
      pathname: target,
      params: {
        stepIndex: String(stepIndex),
        minutes,
        title,
        description,
        imageUrl,
        imagePrompt,
        sessionId,
        uiSpec: "",
        combinedDescription,
        conversation,
        moodEmotions: JSON.stringify(selected),
        moodOther: otherEmotions.trim() || undefined,
        uxCacheKey: cacheKey || undefined,
      },
    } as any);
  };

  const handleNext = () => {
    const cachedKey = uxCacheKey || getUxPlanKeyForSessionStep(sessionId || "", stepIndex);
    if (cachedKey) {
      goToStep(cachedKey);
      return;
    }
    setWaiting(true);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <MoodMeterWidget
          selected={selected}
          onToggle={handleSelect}
          otherEmotions={otherEmotions}
          onOtherEmotionsChange={setOtherEmotions}
          showIntro
          layout="stacked"
        />

        {waiting ? (
          <View style={styles.waitingBox}>
            <Text style={styles.waitingTitle}>Generating personalized UX based on your stress context…</Text>
            <Text style={styles.waitingTime}>{Math.round(elapsedMs / 1000)}s</Text>
          </View>
        ) : null}

        <View style={styles.buttonRow}>
          <Pressable style={styles.bottomBtn} onPress={() => router.back()}>
            <Text style={styles.bottomBtnText}>Back</Text>
          </Pressable>
          <Pressable style={styles.bottomBtnPrimary} onPress={handleNext}>
            <Text style={styles.bottomBtnPrimaryText}>Next</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },
  container: { padding: 24, gap: 18 },
  waitingBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#e2e8f0",
  },
  waitingTitle: { color: "#0f172a", fontWeight: "700", fontSize: 13 },
  waitingTime: { color: "#475569", marginTop: 4, fontSize: 12 },
  buttonRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
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
  bottomBtnText: { color: "#0f172a", fontWeight: "800", fontSize: 12 },
  bottomBtnPrimaryText: { color: "#ffffff", fontWeight: "800", fontSize: 12 },
});

export default MoodMeter;
