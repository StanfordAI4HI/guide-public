import React, { useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaView, View, Text, TextInput, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image as ExpoImage } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { getCachedLayeredImage } from "./layered-store";

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:8787";

export const options = {
  headerShown: false,
};

export default function StepTwoScreen() {
  const params = useLocalSearchParams();
  const minutes =
    typeof params?.minutes === "string" && params.minutes.trim()
      ? params.minutes.trim()
      : null;
  const title =
    typeof params?.title === "string" && params.title.trim()
      ? params.title.trim()
      : "Step 2 activity";
  const description =
    typeof params?.description === "string" && params.description.trim()
      ? params.description.trim()
      : "This step description will flow in from the selected plan.";
  const imagePrompt =
    typeof params?.imagePrompt === "string" && params.imagePrompt.trim()
      ? params.imagePrompt.trim()
      : "";
  const imageUrl =
    typeof params?.imageUrl === "string" && params.imageUrl.trim()
      ? params.imageUrl.trim()
      : "";
  const uiSpec =
    typeof params?.uiSpec === "string" && params.uiSpec.trim()
      ? params.uiSpec.trim()
      : "";
  const [notes, setNotes] = useState("");
  const loggedMissingRef = useRef(false);
  const [uiText, setUiText] = useState(uiSpec);
  const [uiLoading, setUiLoading] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const cachedImageUrl = useMemo(
    () => (imageUrl ? imageUrl : imagePrompt ? getCachedLayeredImage(imagePrompt) : ""),
    [imagePrompt, imageUrl]
  );
  const [imageSrc, setImageSrc] = useState(cachedImageUrl);
  const [imageError, setImageError] = useState<string | null>(null);
  useEffect(() => {
    console.log("[step2] params", { minutes, title, description: description?.slice(0, 120), uiSpec: uiSpec?.slice(0, 200), hasImageUrl: Boolean(imageUrl) });
  }, [minutes, title, description, uiSpec, imageUrl]);
  useEffect(() => {
    if (uiText) return;
    if (!description) return;
    let cancelled = false;
    const run = async () => {
      setUiLoading(true);
      setUiError(null);
      try {
        const resp = await fetch(`${API_BASE}/ui-spec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            minutes: minutes ? Number(minutes) : undefined,
          }),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const spec = (data?.spec || "").trim();
        if (!cancelled) {
          setUiText(spec || "No LLM output yet for this step.");
        }
      } catch (err: any) {
        if (!cancelled) {
          console.warn("[step2] ui-spec fetch failed", err?.message || err);
          setUiError("Could not load LLM output for this step.");
        }
      } finally {
        if (!cancelled) setUiLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [description, minutes, title, uiText]);
  const llmOutput = uiError ? uiError : uiText || "No LLM output yet for this step.";

  useEffect(() => {
    if (!uiSpec && !loggedMissingRef.current) {
      console.warn("[step2] No LLM UI output provided for this step.");
      loggedMissingRef.current = true;
    }
  }, [uiSpec]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Step 2</Text>
          {minutes ? <Text style={styles.minutes}>{minutes} min</Text> : null}
        </View>
        <Text style={styles.subtitle}>
          Capture anything you want to remember for this step. Left: the step card. Right: LLM-designed interface plan (separate from the image).
        </Text>
        <View style={styles.split}>
          <View style={styles.card}>
            {imageSrc ? (
              <ExpoImage
                source={{ uri: imageSrc }}
                style={styles.cardImage}
                contentFit="cover"
                onError={() => {
                  console.warn("[step2] image onError; retrying via prompt");
                  setImageSrc("");
                  setImageError("Image failed to load; retrying.");
                }}
              />
            ) : (
              <LinearGradient
                colors={["#7c3aed", "#22d3ee"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cardFallback}
              />
            )}
            <LinearGradient
              colors={["rgba(7,10,22,0.6)", "rgba(7,10,22,0.9)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.cardOverlay}
            />
            <View style={styles.cardLabelWrap}>
              <Text style={styles.cardBadge}>Step 2</Text>
            </View>
            {minutes ? (
              <View style={styles.cardMinutesWrap}>
                <Text style={styles.cardMinutes}>{minutes} min</Text>
              </View>
            ) : null}
            {imageError ? <Text style={styles.cardImageError}>{imageError}</Text> : null}
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{title}</Text>
              <LinearGradient
                colors={["#7c3aed", "#22d3ee"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.cardUnderline}
              />
              <View style={styles.cardDescriptionShell}>
                <Text style={styles.cardCopy}>{description}</Text>
              </View>
            </View>
          </View>
          <View style={styles.rightPane}>
            <Text style={styles.rightTitle}>LLM output for this interface</Text>
            <View style={styles.briefBox}>
              <Text style={styles.briefLabel}>LLM-designed flow</Text>
              {uiLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#0ea5e9" />
                  <Text style={styles.loadingText}>Generating…</Text>
                </View>
              ) : (
                <Text style={styles.briefText}>{llmOutput}</Text>
              )}
            </View>
            <Text style={styles.rightHint}>
              This is the LLM’s description of the UI: how the user should move through the step, what elements appear, and how time is used.
            </Text>
            <TextInput
              style={styles.textBox}
              placeholder="Jot any notes or adjustments..."
              placeholderTextColor="#94a3b8"
              multiline
              value={notes}
              onChangeText={setNotes}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  container: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
  split: {
    flexDirection: "row",
    gap: 16,
    alignItems: "stretch",
    flex: 1,
  },
  card: {
    flex: 0.9,
    borderRadius: 18,
    overflow: "hidden",
    minHeight: 260,
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
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
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cardUnderline: {
    height: 3,
    width: 80,
    borderRadius: 999,
  },
  cardDescriptionShell: {
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    ...Platform.select({
      web: { backdropFilter: "blur(2px)" },
      default: {},
    }),
  },
  cardCopy: {
    color: "#f8fafc",
    fontSize: 15,
    lineHeight: 22,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  rightPane: {
    flex: 1.15,
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    gap: 10,
  },
  rightTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
  },
  rightCopy: {
    fontSize: 14,
    lineHeight: 20,
    color: "#1f2937",
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
  cardImageError: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    color: "#fecdd3",
    fontSize: 12,
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
  rightHint: {
    fontSize: 13,
    lineHeight: 18,
    color: "#334155",
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
