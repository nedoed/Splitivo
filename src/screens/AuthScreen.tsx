import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const { theme } = useTheme();
  const styles = getStyles(theme);

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert('Fehler', 'Bitte fülle alle Felder aus.');
      return;
    }
    if (!isLogin && !username) {
      Alert.alert('Fehler', 'Bitte gib einen Benutzernamen ein.');
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username } },
        });
        if (error) throw error;

        if (data.user && data.session) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            username,
            email,
            avatar_url: null,
          });
        } else if (data.user && !data.session) {
          setConfirmationPending(true);
        }
      }
    } catch (error: any) {
      Alert.alert('Fehler', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>💸</Text>
          <Text style={styles.title}>Splitivo</Text>
          <Text style={styles.subtitle}>Ausgaben einfach teilen</Text>
        </View>

        {confirmationPending && (
          <View style={styles.confirmBanner}>
            <Text style={styles.confirmIcon}>📧</Text>
            <Text style={styles.confirmTitle}>E-Mail bestätigen</Text>
            <Text style={styles.confirmText}>
              Wir haben dir eine Bestätigungs-E-Mail geschickt. Bitte klicke auf den Link und melde dich dann an.
            </Text>
            <TouchableOpacity onPress={() => { setConfirmationPending(false); setIsLogin(true); }}>
              <Text style={styles.confirmLink}>Zur Anmeldung</Text>
            </TouchableOpacity>
          </View>
        )}

        {!confirmationPending && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{isLogin ? 'Willkommen zurück' : 'Konto erstellen'}</Text>

          {!isLogin && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Benutzername</Text>
              <TextInput
                style={styles.input}
                placeholder="Dein Name"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                placeholderTextColor={theme.textTertiary}
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                blurOnSubmit={false}
              />
            </View>
          )}

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>E-Mail</Text>
            <TextInput
              ref={emailRef}
              style={styles.input}
              placeholder="deine@email.de"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor={theme.textTertiary}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              blurOnSubmit={false}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Passwort</Text>
            <TextInput
              ref={passwordRef}
              style={styles.input}
              placeholder="Mindestens 6 Zeichen"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholderTextColor={theme.textTertiary}
              returnKeyType="done"
              onSubmitEditing={handleAuth}
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleAuth}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {isLogin ? 'Anmelden' : 'Registrieren'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsLogin(!isLogin)} style={styles.switchButton}>
            <Text style={styles.switchText}>
              {isLogin ? 'Noch kein Konto? ' : 'Bereits registriert? '}
              <Text style={styles.switchTextHighlight}>
                {isLogin ? 'Registrieren' : 'Anmelden'}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
        )}
      </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: 24,
    },
    header: {
      alignItems: 'center',
      marginBottom: 40,
    },
    logo: {
      fontSize: 64,
      marginBottom: 12,
    },
    title: {
      fontSize: 32,
      fontWeight: '700',
      color: theme.primary,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 16,
      color: theme.textSecondary,
      marginTop: 4,
    },
    card: {
      backgroundColor: theme.card,
      borderRadius: 24,
      padding: 24,
      shadowColor: theme.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 20,
      elevation: 5,
    },
    cardTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: theme.text,
      marginBottom: 24,
    },
    inputContainer: {
      marginBottom: 16,
    },
    inputLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textSecondary,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1.5,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 15,
      color: theme.text,
      backgroundColor: theme.inputBg,
    },
    button: {
      backgroundColor: theme.primary,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 8,
      shadowColor: theme.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    switchButton: {
      alignItems: 'center',
      marginTop: 20,
    },
    switchText: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    switchTextHighlight: {
      color: theme.primary,
      fontWeight: '600',
    },
    confirmBanner: {
      backgroundColor: theme.card,
      borderRadius: 24,
      padding: 32,
      alignItems: 'center',
      shadowColor: theme.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 20,
      elevation: 5,
    },
    confirmIcon: { fontSize: 56, marginBottom: 16 },
    confirmTitle: { fontSize: 22, fontWeight: '700', color: theme.text, marginBottom: 12 },
    confirmText: { fontSize: 15, color: theme.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
    confirmLink: { color: theme.primary, fontWeight: '700', fontSize: 16 },
  });
}
