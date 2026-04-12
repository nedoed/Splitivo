import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Animated, View, Text, Alert } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';

import { useAuth } from './src/hooks/useAuth';
import AuthScreen from './src/screens/AuthScreen';
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { registerForPushNotifications, savePushToken } from './src/lib/notifications';
import { joinGroupWithCode } from './src/lib/invites';
import { haptics } from './src/lib/haptics';
import { checkAndScheduleReminders } from './src/lib/reminders';

// Nativen Splash-Screen eingefroren halten bis wir bereit sind
SplashScreen.preventAutoHideAsync();

// ─── Root Navigator ───────────────────────────────────────────────────────────

function RootNavigator() {
  const { session, loading } = useAuth();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('onboarding_completed').then((value) => {
      setOnboardingDone(value === 'true');
      setOnboardingChecked(true);
    });
  }, []);

  // ── Deep Link Handler ────────────────────────────────────────────────────────
  useEffect(() => {
    const parseCode = (url: string) => {
      // spliteasy://join/ABCD1234
      const parts = url.replace(/.*:\/\//, '').split('/');
      if (parts[0] === 'join' && parts[1]) return parts[1];
      return null;
    };

    Linking.getInitialURL().then((url) => {
      if (url) { const code = parseCode(url); if (code) setPendingCode(code); }
    });

    const sub = Linking.addEventListener('url', ({ url }) => {
      const code = parseCode(url);
      if (code) setPendingCode(code);
    });

    return () => sub.remove();
  }, []);

  // Erinnerungen prüfen sobald Session bereit
  useEffect(() => {
    if (!session) return;
    checkAndScheduleReminders();
  }, [session]);

  // Einladungscode verarbeiten sobald Session bereit
  useEffect(() => {
    if (!session || !pendingCode) return;
    const code = pendingCode;
    setPendingCode(null);

    joinGroupWithCode(code).then((result) => {
      if (result.success) {
        haptics.success();
        Alert.alert('Willkommen! 🎉', `Du bist der Gruppe „${result.groupName}" beigetreten!\n\nÖffne die Gruppen-Ansicht um sie zu sehen.`);
      } else {
        haptics.error();
        Alert.alert('Hinweis', result.error ?? 'Beitritt fehlgeschlagen');
      }
    });
  }, [session, pendingCode]);

  useEffect(() => {
    const isExpoGo = Constants.appOwnership === 'expo';
    if (isExpoGo) {
      Alert.alert(
        'Test-Modus',
        'Push Notifications sind in Expo Go nicht verfügbar. Sie funktionieren in der fertigen App.',
        [{ text: 'OK' }]
      );
      return;
    }

    registerForPushNotifications().then((token) => {
      if (token) {
        console.log('[App] Push Token erhalten:', token);
        savePushToken(token);
      }
    });
  }, []);

  if (loading || !onboardingChecked) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8F8FF' }}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  if (!onboardingDone) {
    return <OnboardingScreen onDone={() => setOnboardingDone(true)} />;
  }

  return session ? <AppNavigator /> : <AuthScreen />;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [appReady, setAppReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const splashOpacity = useRef(new Animated.Value(1)).current;

  // Mindestens 2 Sekunden Splash zeigen, danach den nativen Splash ausblenden
  useEffect(() => {
    const timer = setTimeout(() => setAppReady(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Wenn App bereit: nativen Splash ausblenden → custom Splash ausblenden
  useEffect(() => {
    if (!appReady) return;

    SplashScreen.hideAsync().then(() => {
      Animated.timing(splashOpacity, {
        toValue: 0,
        duration: 700,
        delay: 100,
        useNativeDriver: true,
      }).start(() => setSplashDone(true));
    });
  }, [appReady]);

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar style={splashDone ? 'dark' : 'light'} />
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>

      {/* Custom Animated Splash – liegt über dem App-Inhalt und faded aus */}
      {!splashDone && (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: splashOpacity,
            zIndex: 999,
          }}
          pointerEvents="none"
        >
          <LinearGradient
            colors={['#8B85FF', '#6C63FF', '#5A52E8']}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {/* Logo-Kreis */}
            <View
              style={{
                width: 100,
                height: 100,
                borderRadius: 50,
                backgroundColor: 'rgba(255,255,255,0.2)',
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 24,
              }}
            >
              <Text style={{ fontSize: 52 }}>💸</Text>
            </View>

            <Text
              style={{
                fontSize: 40,
                fontWeight: '800',
                color: '#fff',
                letterSpacing: -1,
              }}
            >
              SplitEasy
            </Text>

            <Text
              style={{
                fontSize: 16,
                color: 'rgba(255,255,255,0.75)',
                marginTop: 8,
                letterSpacing: 0.2,
              }}
            >
              Ausgaben einfach teilen
            </Text>

            {/* Dezenter Lade-Indikator unten */}
            <ActivityIndicator
              color="rgba(255,255,255,0.5)"
              size="small"
              style={{ position: 'absolute', bottom: 80 }}
            />
          </LinearGradient>
        </Animated.View>
      )}
    </View>
  );
}
