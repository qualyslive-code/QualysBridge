import re

def patch(path, replacements):
    with open(path, 'r') as f:
        content = f.read()
    for old, new in replacements:
        count = content.count(old)
        if count != 1:
            print(f"WARNING [{path}]: found {count} occurrences (expected 1) — skipped:")
            print(repr(old[:80]))
            continue
        content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print(f"Patched {path}")

# ── 1. BrandSplashScreen.js — add rotating icon, keep everything else ──
patch("src/screens/BrandSplashScreen.js", [
    (
        "import { View, Text, StyleSheet, Animated, Easing } from 'react-native';",
        "import { View, Text, StyleSheet, Animated, Easing, Image } from 'react-native';"
    ),
    (
        "  const glow = useRef(new Animated.Value(0)).current;",
        "  const glow = useRef(new Animated.Value(0)).current;\n  const rotate = useRef(new Animated.Value(0)).current;"
    ),
    (
        "    Animated.loop(\n      Animated.sequence([\n        Animated.timing(glow, {",
        "    Animated.loop(\n      Animated.timing(rotate, {\n        toValue: 1,\n        duration: 1800,\n        easing: Easing.linear,\n        useNativeDriver: true,\n      })\n    ).start();\n\n    Animated.loop(\n      Animated.sequence([\n        Animated.timing(glow, {"
    ),
    (
        "  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] });",
        "  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] });\n  const rotateDeg = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });"
    ),
    (
        "        <View style={s.center}>\n          <Animated.View style={[s.dot, { opacity: glowOpacity }]} />",
        "        <View style={s.center}>\n          <Animated.Image\n            source={require('../../assets/icon.png')}\n            style={[s.logo, { transform: [{ rotate: rotateDeg }] }]}\n          />\n          <Animated.View style={[s.dot, { opacity: glowOpacity }]} />"
    ),
    (
        "  center: { alignItems: 'center' },",
        "  center: { alignItems: 'center' },\n  logo: { width: 100, height: 100, marginBottom: 18, resizeMode: 'contain' },"
    ),
])

# ── 2. App.js — extend splash duration so the tagline is actually readable ──
patch("App.js", [
    (
        "const t = setTimeout(() => setShowBrandSplash(false), 1400);",
        "const t = setTimeout(() => setShowBrandSplash(false), 2600);"
    ),
])

# ── 3. HomeScreen.js — swap Q badge for real icon ──
patch("src/screens/HomeScreen.js", [
    (
        "  View, Text, StyleSheet, FlatList, TextInput,\n  TouchableOpacity,\n} from 'react-native';",
        "  View, Text, StyleSheet, FlatList, TextInput,\n  TouchableOpacity, Image,\n} from 'react-native';"
    ),
    (
        "          <LinearGradient colors={[C.accent, C.accentL]} style={hs.logoMark}>\n            <Text style={hs.logoQ}>Q</Text>\n          </LinearGradient>",
        "          <Image source={require('../../assets/icon.png')} style={hs.logoMark} resizeMode=\"cover\" />"
    ),
])

# ── 4. LoginScreen.js — swap Q badge for real icon ──
patch("src/screens/LoginScreen.js", [
    (
        "  View, Text, StyleSheet, Animated, ScrollView,\n} from 'react-native';",
        "  View, Text, StyleSheet, Animated, ScrollView, Image,\n} from 'react-native';"
    ),
    (
        "          <LinearGradient\n            colors={[C.accent, C.accentL]}\n            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}\n            style={styles.logoMark}\n          >\n            <Text style={styles.logoQ}>Q</Text>\n          </LinearGradient>",
        "          <Image source={require('../../assets/icon.png')} style={styles.logoMark} resizeMode=\"cover\" />"
    ),
])

# ── 5. ProfileSetupScreen.js — swap Q badge in QID card header for real icon ──
patch("src/screens/ProfileSetupScreen.js", [
    (
        "            <View style={styles.qidLogoMark}>\n              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Q</Text>\n            </View>",
        "            <Image source={require('../../assets/icon.png')} style={styles.qidLogoMark} resizeMode=\"cover\" />"
    ),
])

print("Done.")
