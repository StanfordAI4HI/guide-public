import React from "react";
import { Redirect } from "expo-router";

export const options = {
  headerShown: false,
};

export default function IndexScreen() {
  return <Redirect href="/chat-intro" />;
}
