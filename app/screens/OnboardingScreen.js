// app/screens/OnboardingScreen.js
import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from "react-native";
import * as Animatable from "react-native-animatable";
import GestureRecognizer from "react-native-swipe-gestures";
import AsyncStorage from "@react-native-async-storage/async-storage";

const slides = [
  {
    id: 1,
    title: "Connect",
    subtitle: "Stay connected, even when networks fail.",
    image: "📡", // Placeholder emoji - replace with require("../assets/onboarding/connect.png")
    color: "#3B82F6",
  },
  {
    id: 2,
    title: "Communicate",
    subtitle: "Send help requests or updates instantly.",
    image: "💬", // Placeholder emoji - replace with require("../assets/onboarding/communicate.png")
    color: "#F97316",
  },
  {
    id: 3,
    title: "Survive",
    subtitle: "Your community is your network.",
    image: "🤝", // Placeholder emoji - replace with require("../assets/onboarding/survive.png")
    color: "#10B981",
  },
];

export default function OnboardingScreen({ navigation }) {
  const [index, setIndex] = useState(0);
  const slide = slides[index];

  const handleNext = async () => {
    if (index < slides.length - 1) {
      setIndex(index + 1);
    } else {
      await AsyncStorage.setItem("hasSeenOnboarding", "true");
      navigation.replace("MeshHome");
    }
  };

  const handlePrev = () => {
    if (index > 0) setIndex(index - 1);
  };

  const onSwipeLeft = () => handleNext();
  const onSwipeRight = () => handlePrev();

  return (
    <GestureRecognizer 
      onSwipeLeft={onSwipeLeft} 
      onSwipeRight={onSwipeRight} 
      style={styles.container}
      config={{
        velocityThreshold: 0.3,
        directionalOffsetThreshold: 80
      }}
    >
      <Animatable.View
        animation="fadeIn"
        duration={400}
        key={slide.id}
        style={styles.slideContainer}
      >
        <View style={[styles.slide, { borderColor: slide.color }]}>
          <Animatable.View
            animation="zoomIn"
            duration={800}
            style={styles.imageContainer}
          >
            <Text style={styles.imageEmoji}>{slide.image}</Text>
          </Animatable.View>

        <Animatable.Text
          animation="fadeInUp"
          delay={300}
          style={[styles.title, { color: slide.color }]}
        >
          {slide.title}
        </Animatable.Text>

        <Animatable.Text animation="fadeInUp" delay={500} style={styles.subtitle}>
          {slide.subtitle}
        </Animatable.Text>

        <View style={styles.dotsContainer}>
          {slides.map((_, i) => (
            <Animatable.View
              key={i}
              animation={i === index ? "pulse" : undefined}
              style={[
                styles.dot,
                { backgroundColor: i === index ? slide.color : "#94A3B8" },
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          onPress={handleNext}
          style={[styles.button, { backgroundColor: slide.color }]}
        >
          <Text style={styles.buttonText}>
            {index === slides.length - 1 ? "Get Started" : "Next →"}
          </Text>
        </TouchableOpacity>
        </View>
      </Animatable.View>
    </GestureRecognizer>
  );
}

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  slideContainer: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  slide: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: 24,
    borderColor: "#334155",
    paddingVertical: 50,
    paddingHorizontal: 30,
    width: width * 0.9,
    backgroundColor: "#0F172A",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  imageContainer: {
    width: 220,
    height: 220,
    marginBottom: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    borderRadius: 110,
  },
  imageEmoji: {
    fontSize: 120,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    color: "#CBD5E1",
    fontSize: 16,
    textAlign: "center",
    paddingHorizontal: 30,
    marginBottom: 30,
    lineHeight: 24,
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 30,
    alignItems: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 6,
  },
  button: {
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
});

