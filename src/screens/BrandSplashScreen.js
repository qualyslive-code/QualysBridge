// QualysBridge — Brand splash shown briefly right before Home mounts
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { C } from '../theme';

export default function BrandSplashScreen() {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.timing(taglineOpacity, {
      toValue: 1,
      duration: 420,
      delay: 260,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] });

  return (
    <View style={s.wrap}>
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <View style={s.center}>
          <Animated.View style={[s.dot, { opacity: glowOpacity }]} />
          <Text style={s.title}>
            <Text style={s.qualys}>Qualys</Text>
            <Text style={s.bridge}>Bridge</Text>
          </Text>
          <Animated.Text style={[s.tagline, { opacity: taglineOpacity }]}>
            Total Privacy. End-to-End Encrypted Communication.
          </Animated.Text>
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center' },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.accentL,
    marginBottom: 14,
    shadowColor: C.accentL,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  title: { fontSize: 32, fontFamily: 'Syne_800ExtraBold' },
  qualys: { color: C.text },
  bridge: { color: C.accentL },
  tagline: {
    marginTop: 8,
    fontSize: 13,
    color: C.sub,
    fontFamily: 'Inter_400Regular',
  },
});
