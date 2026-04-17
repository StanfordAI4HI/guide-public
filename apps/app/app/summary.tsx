import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaView, StyleSheet, View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { cacheLayeredPayload, getLayeredPayload } from "./layered-store";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:8787";

type SummarySeed = {
  summary?: string;
  userSummary?: string;
  intro?: string;
  steps?: any[];
  demographics?: any;
  sessionId?: string;
};

type GenerationStatus = "idle" | "loading" | "ready" | "error";

export default function SummaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const seed: SummarySeed | null = useMemo(() => {
    const cached = getLayeredPayload(params?.cacheKey);
    if (cached) return cached;
    if (typeof params?.data === "string") {
      try {
        return JSON.parse(params.data);
      } catch (err) {
        console.warn("[summary] failed to parse seed from params.data", err);
        return null;
      }
    }
    return null;
  }, [params]);

  const [summaryText, setSummaryText] = useState<string>(seed?.summary || seed?.userSummary || "");
  const [summaryStatus, setSummaryStatus] = useState<GenerationStatus>(summaryText ? "ready" : "idle");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [support, setSupport] = useState<any>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>("idle");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const pendingNavigation = useRef(false);
  const generationRef = useRef<Promise<any> | null>(null);

  const fetchSummary = useCallback(async () => {
    if (!seed?.steps || !seed.steps.length) {
      setSummaryError("Missing reflection steps to generate a summary.");
      setSummaryStatus("error");
      return;
    }
    setSummaryStatus("loading");
    setSummaryError(null);
    try {
      const resp = await fetch(`${API_BASE}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: seed?.sessionId || "",
          steps: seed.steps,
          demographics: seed?.demographics || {},
        }),
      });
      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const data = (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })();
      const generated = (data?.text || data?.summary || "").trim();
      if (!generated) {
        throw new Error("No summary returned");
      }
      setSummaryText(generated);
      setSummaryStatus("ready");
    } catch (err: any) {
      console.warn("[summary] summary fetch error", err);
      setSummaryError(err?.message || "Could not load summary.");
      setSummaryStatus("error");
    }
  }, [seed]);

  const navigateToIntervention = useCallback(
    (payload: any) => {
      const cacheKey = cacheLayeredPayload({
        layered: payload,
        summary: payload?.summary_recap || summaryText,
        userSummary: summaryText,
        intro: seed?.intro || "",
        steps: seed?.steps || [],
      });
      router.push({
        pathname: "/layers",
        params: { cacheKey },
      });
    },
    [router, seed?.intro, seed?.steps, summaryText]
  );

  const startGeneration = useCallback(
    (currentSummary: string) => {
      if (generationRef.current) return;
      if (!seed?.steps || seed.steps.length === 0) {
        setGenerationError("Missing steps to generate an intervention.");
        setGenerationStatus("error");
        return;
      }
      setGenerationStatus("loading");
      setGenerationError(null);
      const body = {
        intro: seed?.intro || "",
        steps: seed?.steps || [],
        summary: currentSummary,
        demographics: seed?.demographics || {},
        sessionId: seed?.sessionId || "",
      };
      const promise = fetch(`${API_BASE}/layered-intervention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (resp) => {
          if (!resp.ok) {
            const text = await resp.text();
            throw new Error(text || `HTTP ${resp.status}`);
          }
          return resp.json();
        })
        .then((data) => {
          setSupport(data);
          setGenerationStatus("ready");
          return data;
        })
        .catch((err) => {
          console.warn("[summary] layered-intervention error", err);
          setGenerationStatus("error");
          setGenerationError(err?.message || "Unable to generate your intervention right now.");
          return null;
        })
        .finally(() => {
          if (generationRef.current === promise) {
            generationRef.current = null;
          }
        });
      generationRef.current = promise;
    },
    [seed]
  );

  useEffect(() => {
    if (!summaryText && summaryStatus === "idle") {
      fetchSummary();
    }
  }, [fetchSummary, summaryStatus, summaryText]);

  useEffect(() => {
    if (summaryStatus !== "ready" || !summaryText) return;
    if (generationStatus === "idle" || generationStatus === "error") {
      startGeneration(summaryText);
    }
  }, [generationStatus, startGeneration, summaryStatus, summaryText]);

  useEffect(() => {
    if (pendingNavigation.current && generationStatus === "ready" && support) {
      pendingNavigation.current = false;
      navigateToIntervention(support);
    }
  }, [generationStatus, navigateToIntervention, support]);

  const handleGeneratePress = () => {
    if (generationStatus === "ready" && support) {
      navigateToIntervention(support);
      return;
    }
    if (!summaryText || summaryStatus !== "ready") {
      return;
    }
    pendingNavigation.current = true;
    if (generationStatus === "idle" || generationStatus === "error") {
      startGeneration(summaryText);
    }
  };

  const disabled = summaryStatus !== "ready";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.heading}>Session summary</Text>
          {summaryStatus === "loading" ? (
            <View style={styles.inlineRow}>
              <ActivityIndicator color="#2563eb" />
              <Text style={styles.statusText}>Drafting your summary…</Text>
            </View>
          ) : null}
          {summaryStatus === "error" && summaryError ? (
            <Text style={styles.statusError}>{summaryError}</Text>
          ) : null}
          {summaryStatus === "ready" ? (
            <Text style={styles.summary}>{summaryText}</Text>
          ) : null}
          {summaryStatus === "error" ? (
            <Pressable
              accessibilityRole="button"
              onPress={fetchSummary}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
            >
              <Text style={styles.secondaryButtonLabel}>Retry summary</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Intervention</Text>
          {generationStatus === "loading" ? (
            <View style={styles.inlineRow}>
              <ActivityIndicator color="#2563eb" />
              <Text style={styles.statusText}>Generating your intervention…</Text>
            </View>
          ) : null}
          {generationStatus === "error" && generationError ? (
            <Text style={styles.statusError}>{generationError}</Text>
          ) : null}
          {generationStatus === "ready" ? (
            <Text style={styles.statusReady}>Ready to view.</Text>
          ) : (
            <Text style={styles.placeholder}>We’ll start as soon as the summary is ready.</Text>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={handleGeneratePress}
            disabled={disabled}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              disabled && styles.primaryButtonDisabled,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>
              {generationStatus === "ready" ? "Open intervention" : "Generate intervention"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#eef2ff",
  },
  container: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.12)",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  heading: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0f172a",
  },
  summary: {
    fontSize: 16,
    color: "#111827",
    lineHeight: 24,
  },
  placeholder: {
    fontSize: 14,
    color: "#64748b",
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    color: "#1d4ed8",
  },
  statusReady: {
    fontSize: 14,
    fontWeight: "700",
    color: "#15803d",
  },
  statusError: {
    fontSize: 14,
    color: "#b91c1c",
  },
  primaryButton: {
    marginTop: 6,
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonPressed: {
    opacity: 0.92,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  secondaryButton: {
    marginTop: 4,
    backgroundColor: "#e2e8f0",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  secondaryButtonPressed: {
    opacity: 0.9,
  },
  secondaryButtonLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
});
