import React, { useCallback, useEffect } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

export const options = {
  headerShown: false,
};

export default function ChatIntroScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ condition?: string; participantId?: string; sessionId?: string; arm?: string }>();
  const conditionParam =
    typeof params?.condition === "string" && (params.condition === "1" || params.condition === "2")
      ? params.condition
      : "1";
  const sessionIdParam =
    typeof params?.sessionId === "string" && params.sessionId.trim() ? params.sessionId.trim() : "";
  const participantId =
    typeof params?.participantId === "string" && params.participantId.trim()
      ? params.participantId.trim()
      : "";

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      try {
        window.history.pushState(null, "", window.location.href);
      } catch {
        // ignore history errors
      }
    };
    try {
      window.history.pushState(null, "", window.location.href);
    } catch {
      // ignore history errors
    }
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const handleContinue = useCallback(() => {
    const nextParams: Record<string, string> = {
      condition: conditionParam,
    };
    if (participantId) nextParams.participantId = participantId;
    if (sessionIdParam) nextParams.sessionId = sessionIdParam;
    router.push({
      pathname: "/chat",
      params: nextParams,
    });
  }, [conditionParam, participantId, router, sessionIdParam]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <View style={styles.logoRow}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoBadgeText}>G</Text>
            </View>
            <Text style={styles.logoText}>GUIDE</Text>
          </View>
          <Text style={styles.kicker}>Before you start</Text>
          <Text style={styles.title}>Here’s what you’ll do</Text>
          <Text style={styles.subtitle}>
            We’ll ask a few quick questions and have a short chat to understand your stress situation.
            Then we’ll suggest one personalized activity and provide a guided experience to help you do it.
          </Text>
          <View style={styles.stepList}>
            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>1</Text>
              </View>
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}>Share and chat</Text>
                <Text style={styles.stepText}>
                  A few quick questions and a short conversation to understand your experience.
                </Text>
              </View>
            </View>
            <View style={styles.stepRow}>
              <View style={[styles.stepBadge, styles.stepBadgeSecondary]}>
                <Text style={[styles.stepBadgeText, styles.stepBadgeTextSecondary]}>2</Text>
              </View>
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}>Get a personalized activity</Text>
                <Text style={styles.stepText}>
                  We summarize what you share, suggest one personalized activity, and guide it with an
                  on-screen experience.
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Important</Text>
            <Text style={styles.noticeText}>
              This public demo showcases the system’s ability to generate interventions for general
              stress situations. It is not intended to address safety-critical use cases or complex
              edge cases.
            </Text>
            <Text style={styles.noticeText}>
              Interactions are not monitored, and no real-time support is provided. Do not use this
              tool for crisis, emergency, or high-risk situations.
            </Text>
            <Text style={styles.noticeText}>
              While some basic safeguards are included, this system does not replace professional
              care.
              If you need additional support, please contact a qualified professional or local
              services.
            </Text>
          </View>

          <View style={styles.navRow}>
            <Pressable
              accessibilityRole="button"
              onPress={handleContinue}
              style={({ pressed }) => [styles.button, styles.primaryButton, styles.singleButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonLabel}>Start Chat</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#e8ecff",
  },
  scroll: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "100%",
    maxWidth: 640,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 32,
    gap: 18,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    ...Platform.select({
      web: {
        boxShadow: "0px 30px 50px rgba(15, 23, 42, 0.08)",
      },
      default: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.14,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
      },
    }),
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 2,
  },
  logoBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: "#1d4ed8",
    alignItems: "center",
    justifyContent: "center",
  },
  logoBadgeText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  logoText: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  kicker: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4f46e5",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#0f172a",
  },
  subtitle: {
    fontSize: 15,
    color: "#475569",
    lineHeight: 22,
  },
  inputBlock: {
    marginTop: 6,
    gap: 6,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0f172a",
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.6)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    backgroundColor: "#f8fafc",
    fontSize: 15,
    color: "#111827",
  },
  errorText: {
    marginTop: 4,
    fontSize: 12,
    color: "#b91c1c",
  },
  stepList: {
    gap: 12,
  },
  noticeCard: {
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "rgba(251, 146, 60, 0.4)",
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#9a3412",
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 19,
    color: "#7c2d12",
  },
  stepRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
  },
  stepBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(79, 70, 229, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBadgeSecondary: {
    backgroundColor: "rgba(34, 197, 94, 0.12)",
  },
  stepBadgeText: {
    color: "#312e81",
    fontWeight: "700",
    fontSize: 14,
  },
  stepBadgeTextSecondary: {
    color: "#15803d",
  },
  stepBadgeTertiary: {
    backgroundColor: "rgba(59, 130, 246, 0.12)",
  },
  stepBadgeTextTertiary: {
    color: "#1d4ed8",
  },
  stepCopy: {
    flex: 1,
    gap: 4,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },
  stepText: {
    fontSize: 14,
    color: "#475569",
    lineHeight: 20,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: "center",
    minWidth: 120,
  },
  primaryButton: {
    backgroundColor: "#1d4ed8",
  },
  buttonPressed: {
    opacity: 0.9,
  },
  primaryButtonLabel: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 15,
  },
  navRow: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  singleButton: {
    minWidth: 140,
  },
});
