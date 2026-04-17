import React, { useEffect } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function IntakeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ participantId?: string; condition?: string; sessionId?: string }>();

  useEffect(() => {
    const participantId =
      typeof params?.participantId === "string" && params.participantId.trim()
        ? params.participantId.trim()
        : "";
    const condition =
      typeof params?.condition === "string" && (params.condition === "1" || params.condition === "2")
        ? params.condition
        : "1";
    const sessionId =
      typeof params?.sessionId === "string" && params.sessionId.trim()
        ? params.sessionId.trim()
        : "";

    router.replace({
      pathname: "/chat",
      params: {
        ...(participantId ? { participantId } : {}),
        ...(sessionId ? { sessionId } : {}),
        condition,
      },
    });
  }, [params, router]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Preparing your chat…</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#e8ecff",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  loadingText: {
    color: "#475569",
    fontSize: 16,
    fontWeight: "600",
  },
});
