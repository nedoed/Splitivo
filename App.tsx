import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Alert } from 'react-native';
import Constants from 'expo-constants';

import { useAuth } from './src/hooks/useAuth';
import AuthScreen from './src/screens/AuthScreen';
import AppNavigator from './src/navigation/AppNavigator';
import { registerForPushNotifications, savePushToken } from './src/lib/notifications';

function RootNavigator() {
  const { session, loading } = useAuth();

  useEffect(() => {
    const isExpoGo = Constants.appOwnership === 'expo';
    if (isExpoGo) {
      // Einmalige Info-Meldung im Testmodus
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

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8F8FF' }}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  return session ? <AppNavigator /> : <AuthScreen />;
}

export default function App() {
  return (
    <View style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </View>
  );
}
