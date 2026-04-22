import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, Image, ScrollView, RefreshControl,
  TextInput, Modal, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { haptics } from '../lib/haptics';
import { cancelAllReminders, checkAndScheduleReminders } from '../lib/reminders';
import { Profile } from '../types';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

const REMINDER_DAY_OPTIONS = [3, 7, 14];

export default function ProfileScreen({ navigation }: any) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ groups: 0, expenses: 0, totalPaid: 0, friends: 0 });
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [editUsernameVisible, setEditUsernameVisible] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [editPayPal, setEditPayPal] = useState('');
  const [editIban, setEditIban] = useState('');
  const [editBankName, setEditBankName] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderDays, setReminderDays] = useState(7);
  const [reminderTime, setReminderTime] = useState('09:00');
  const [reminderDailySummary, setReminderDailySummary] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [pickerHour, setPickerHour] = useState(9);
  const [pickerMinute, setPickerMinute] = useState(0);

  const { theme, isDark, toggleTheme } = useTheme();
  const styles = getStyles(theme);

  const fetchProfile = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    const [profileRes, groupsRes, expensesRes, friendsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.user.id).single(),
      supabase.from('group_members').select('id', { count: 'exact' }).eq('user_id', user.user.id),
      supabase.from('expenses').select('amount').eq('paid_by', user.user.id),
      supabase.from('friendships').select('id', { count: 'exact' }).eq('user_id', user.user.id),
    ]);

    if (!profileRes.error && profileRes.data) {
      setProfile(profileRes.data);

      setReminderEnabled(profileRes.data.reminder_enabled ?? true);
      setReminderDays(profileRes.data.reminder_days ?? 7);
      setReminderTime(profileRes.data.reminder_time ?? '09:00');
      setReminderDailySummary(profileRes.data.reminder_daily_summary ?? false);

      const [h, m] = (profileRes.data.reminder_time ?? '09:00').split(':').map(Number);
      setPickerHour(h);
      setPickerMinute(m);

      setEditPayPal(profileRes.data.paypal_me ?? '');
      setEditIban(profileRes.data.iban ?? '');
      setEditBankName(profileRes.data.bank_name ?? '');
    }

    const totalPaid = expensesRes.data?.reduce((sum, e) => sum + e.amount, 0) ?? 0;
    setStats({
      groups: groupsRes.count ?? 0,
      expenses: expensesRes.data?.length ?? 0,
      totalPaid,
      friends: friendsRes.count ?? 0,
    });

    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { fetchProfile(); }, []));

  const saveReminderField = async (fields: Partial<Profile>) => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    await supabase.from('profiles').update(fields).eq('id', user.user.id);

    const newEnabled = 'reminder_enabled' in fields ? (fields.reminder_enabled ?? reminderEnabled) : reminderEnabled;
    if (newEnabled) {
      checkAndScheduleReminders();
    } else {
      cancelAllReminders();
    }
  };

  const toggleReminderEnabled = (value: boolean) => {
    haptics.selection();
    setReminderEnabled(value);
    saveReminderField({ reminder_enabled: value });
  };

  const toggleDailySummary = (value: boolean) => {
    haptics.selection();
    setReminderDailySummary(value);
    saveReminderField({ reminder_daily_summary: value });
  };

  const selectReminderDays = (days: number) => {
    haptics.light();
    setReminderDays(days);
    saveReminderField({ reminder_days: days });
  };

  const openTimePicker = () => {
    const [h, m] = reminderTime.split(':').map(Number);
    setPickerHour(h);
    setPickerMinute(m);
    setTimePickerVisible(true);
  };

  const openPaymentModal = () => {
    setEditPayPal(profile?.paypal_me ?? '');
    setEditIban(profile?.iban ?? '');
    setEditBankName(profile?.bank_name ?? '');
    setPaymentModalVisible(true);
  };

  const savePaymentDetails = async () => {
    setSavingPayment(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { error } = await supabase
      .from('profiles')
      .update({
        paypal_me: editPayPal.trim() || null,
        iban: editIban.trim().replace(/\s/g, '') || null,
        bank_name: editBankName.trim() || null,
      })
      .eq('id', userData.user.id);

    setSavingPayment(false);
    if (error) {
      haptics.error();
      Alert.alert('Fehler', error.message);
    } else {
      haptics.success();
      setPaymentModalVisible(false);
      fetchProfile();
    }
  };

  const confirmTimePicker = () => {
    const hh = String(pickerHour).padStart(2, '0');
    const mm = String(pickerMinute).padStart(2, '0');
    const time = `${hh}:${mm}`;
    setReminderTime(time);
    setTimePickerVisible(false);
    haptics.success();
    saveReminderField({ reminder_time: time });
  };

  const changeAvatar = async () => {
    Alert.alert('Profilbild', 'Wähle eine Option:', [
      {
        text: 'Kamera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Berechtigung', 'Kamera-Zugriff benötigt.'); return; }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
          if (!result.canceled) uploadAvatar(result.assets[0].uri);
        },
      },
      {
        text: 'Galerie',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Berechtigung', 'Galerie-Zugriff benötigt.'); return; }
          const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
          if (!result.canceled) uploadAvatar(result.assets[0].uri);
        },
      },
      { text: 'Abbrechen', style: 'cancel' },
    ]);
  };

  const uploadAvatar = async (uri: string) => {
    setUploadingAvatar(true);
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const fileName = `avatar-${user.user.id}-${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);

      await supabase
        .from('profiles')
        .update({ avatar_url: urlData.publicUrl })
        .eq('id', user.user.id);

      fetchProfile();
    } catch (e: any) {
      Alert.alert('Fehler', e.message ?? 'Upload fehlgeschlagen.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const openEditUsername = () => {
    setNewUsername(profile?.username ?? '');
    setEditUsernameVisible(true);
  };

  const saveUsername = async () => {
    const trimmed = newUsername.trim();
    if (!trimmed) {
      Alert.alert('Fehler', 'Benutzername darf nicht leer sein.');
      return;
    }
    if (trimmed.length < 3) {
      Alert.alert('Fehler', 'Mindestens 3 Zeichen erforderlich.');
      return;
    }
    setSavingUsername(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { error } = await supabase
      .from('profiles')
      .update({ username: trimmed })
      .eq('id', userData.user.id);

    setSavingUsername(false);
    if (error) {
      haptics.error();
      Alert.alert('Fehler', error.message);
    } else {
      haptics.success();
      setEditUsernameVisible(false);
      fetchProfile();
    }
  };

  const handleSignOut = async () => {
    Alert.alert('Abmelden', 'Möchtest du dich wirklich abmelden?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Abmelden',
        style: 'destructive',
        onPress: async () => {
          await cancelAllReminders();
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchProfile(); }} tintColor={theme.primary} />}
    >
      <View style={styles.profileSection}>
        <TouchableOpacity style={styles.avatarContainer} onPress={changeAvatar} disabled={uploadingAvatar}>
          {uploadingAvatar ? (
            <View style={styles.avatar}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {profile?.username?.charAt(0).toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
          <View style={styles.editBadge}>
            <Text style={styles.editBadgeText}>✏️</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.usernameRow} onPress={openEditUsername}>
          <Text style={styles.username}>{profile?.username ?? 'Benutzer'}</Text>
          <Text style={styles.usernameEditIcon}>✏️</Text>
        </TouchableOpacity>
        <Text style={styles.email}>{profile?.email ?? ''}</Text>
        <Text style={styles.joinDate}>
          Dabei seit {new Date(profile?.created_at ?? '').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
        </Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.groups}</Text>
          <Text style={styles.statLabel}>Gruppen</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.friends}</Text>
          <Text style={styles.statLabel}>Freunde</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalPaid.toFixed(0)} €</Text>
          <Text style={styles.statLabel}>Bezahlt</Text>
        </View>
      </View>

      {/* Konto-Sektion */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Konto</Text>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Friends')}>
          <Text style={styles.menuIcon}>🤝</Text>
          <Text style={styles.menuLabel}>Freunde</Text>
          {stats.friends > 0 && (
            <View style={styles.menuBadge}>
              <Text style={styles.menuBadgeText}>{stats.friends}</Text>
            </View>
          )}
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={openEditUsername}>
          <Text style={styles.menuIcon}>✏️</Text>
          <Text style={styles.menuLabel}>Benutzername ändern</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={changeAvatar}>
          <Text style={styles.menuIcon}>🖼️</Text>
          <Text style={styles.menuLabel}>Profilbild ändern</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Dark Mode-Sektion */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Darstellung</Text>
        <View style={styles.menuItem}>
          <Text style={styles.menuIcon}>{isDark ? '🌙' : '☀️'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuLabel}>Dark Mode</Text>
            <Text style={styles.menuSub}>{isDark ? 'Dunkles Design aktiv' : 'Helles Design aktiv'}</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={() => { haptics.selection(); toggleTheme(); }}
            trackColor={{ false: theme.border, true: theme.primary }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>

      {/* Zahlungsdetails-Sektion */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Zahlungsdetails</Text>
        <TouchableOpacity style={styles.menuItem} onPress={openPaymentModal}>
          <Text style={styles.menuIcon}>💳</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuLabel}>Zahlungsmethoden</Text>
            <Text style={styles.menuSub}>
              {[
                profile?.paypal_me ? 'PayPal' : null,
                profile?.iban ? 'IBAN' : null,
              ].filter(Boolean).join(' · ') || 'Noch nichts hinterlegt'}
            </Text>
          </View>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Erinnerungen-Sektion */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Erinnerungen</Text>

        <View style={styles.menuItem}>
          <Text style={styles.menuIcon}>🔔</Text>
          <Text style={styles.menuLabel}>Erinnerungen aktiv</Text>
          <Switch
            value={reminderEnabled}
            onValueChange={toggleReminderEnabled}
            trackColor={{ false: theme.border, true: theme.primary }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={[styles.menuItem, styles.menuItemColumn, !reminderEnabled && styles.disabled]}>
          <View style={styles.menuItemRow}>
            <Text style={styles.menuIcon}>⏰</Text>
            <Text style={styles.menuLabel}>Erinnere mich nach</Text>
          </View>
          <View style={styles.dayPills}>
            {REMINDER_DAY_OPTIONS.map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.dayPill, reminderDays === d && styles.dayPillActive]}
                onPress={() => selectReminderDays(d)}
                disabled={!reminderEnabled}
              >
                <Text style={[styles.dayPillText, reminderDays === d && styles.dayPillTextActive]}>
                  {d} Tagen
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.menuItem, !reminderEnabled && styles.disabled]}>
          <Text style={styles.menuIcon}>📊</Text>
          <Text style={styles.menuLabel}>Tägliche Zusammenfassung</Text>
          <Switch
            value={reminderDailySummary}
            onValueChange={toggleDailySummary}
            trackColor={{ false: theme.border, true: theme.primary }}
            thumbColor="#FFFFFF"
            disabled={!reminderEnabled}
          />
        </View>

        <TouchableOpacity
          style={[styles.menuItem, (!reminderEnabled || !reminderDailySummary) && styles.disabled]}
          onPress={openTimePicker}
          disabled={!reminderEnabled || !reminderDailySummary}
        >
          <Text style={styles.menuIcon}>🕐</Text>
          <Text style={styles.menuLabel}>Uhrzeit für Erinnerung</Text>
          <View style={styles.timeChip}>
            <Text style={styles.timeChipText}>{reminderTime}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Abmelden</Text>
      </TouchableOpacity>
    </ScrollView>

    {/* Username-Edit Modal */}
    <Modal visible={editUsernameVisible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Benutzername ändern</Text>
            <TextInput
              style={styles.modalInput}
              value={newUsername}
              onChangeText={setNewUsername}
              placeholder="Neuer Benutzername"
              placeholderTextColor={theme.textTertiary}
              autoFocus
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={saveUsername}
            />
            <TouchableOpacity
              style={[styles.modalSaveBtn, savingUsername && { opacity: 0.7 }]}
              onPress={saveUsername}
              disabled={savingUsername}
            >
              {savingUsername
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.modalSaveBtnText}>Speichern</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setEditUsernameVisible(false)}
            >
              <Text style={styles.modalCancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    {/* Payment Details Modal */}
    <Modal visible={paymentModalVisible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Zahlungsdetails</Text>

            <Text style={styles.paymentFieldLabel}>🔵 PayPal.me Benutzername</Text>
            <View style={styles.paymentInputRow}>
              <Text style={styles.paymentPrefix}>paypal.me/</Text>
              <TextInput
                style={styles.paymentInput}
                value={editPayPal}
                onChangeText={setEditPayPal}
                placeholder="deinname"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <Text style={styles.paymentFieldLabel}>🏦 IBAN</Text>
            <TextInput
              style={[styles.modalInput, { marginBottom: 4 }]}
              value={editIban}
              onChangeText={setEditIban}
              placeholder="CH93 0076 2011 6238 5295 7"
              placeholderTextColor={theme.textTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="next"
            />
            <Text style={styles.paymentHint}>Leerzeichen werden automatisch entfernt</Text>

            <Text style={styles.paymentFieldLabel}>🏦 Bank / Institut</Text>
            <TextInput
              style={[styles.modalInput, { marginBottom: 20 }]}
              value={editBankName}
              onChangeText={setEditBankName}
              placeholder="z.B. Zürcher Kantonalbank"
              placeholderTextColor={theme.textTertiary}
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={savePaymentDetails}
            />

            <TouchableOpacity
              style={[styles.modalSaveBtn, savingPayment && { opacity: 0.7 }]}
              onPress={savePaymentDetails}
              disabled={savingPayment}
            >
              {savingPayment
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.modalSaveBtnText}>Speichern</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setPaymentModalVisible(false)}>
              <Text style={styles.modalCancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    {/* Time Picker Modal */}
    <Modal visible={timePickerVisible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Uhrzeit wählen</Text>
          <View style={styles.timePickerRow}>
            <View style={styles.timePickerCol}>
              <Text style={styles.timePickerLabel}>Stunden</Text>
              <TouchableOpacity style={styles.timePickerBtn} onPress={() => setPickerHour((h) => (h + 1) % 24)}>
                <Text style={styles.timePickerArrow}>▲</Text>
              </TouchableOpacity>
              <View style={styles.timePickerValue}>
                <Text style={styles.timePickerValueText}>{String(pickerHour).padStart(2, '0')}</Text>
              </View>
              <TouchableOpacity style={styles.timePickerBtn} onPress={() => setPickerHour((h) => (h - 1 + 24) % 24)}>
                <Text style={styles.timePickerArrow}>▼</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.timePickerColon}>:</Text>

            <View style={styles.timePickerCol}>
              <Text style={styles.timePickerLabel}>Minuten</Text>
              <TouchableOpacity style={styles.timePickerBtn} onPress={() => setPickerMinute((m) => (m + 5) % 60)}>
                <Text style={styles.timePickerArrow}>▲</Text>
              </TouchableOpacity>
              <View style={styles.timePickerValue}>
                <Text style={styles.timePickerValueText}>{String(pickerMinute).padStart(2, '0')}</Text>
              </View>
              <TouchableOpacity style={styles.timePickerBtn} onPress={() => setPickerMinute((m) => (m - 5 + 60) % 60)}>
                <Text style={styles.timePickerArrow}>▼</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.modalSaveBtn} onPress={confirmTimePicker}>
            <Text style={styles.modalSaveBtnText}>Übernehmen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancel} onPress={() => setTimePickerVisible(false)}>
            <Text style={styles.modalCancelText}>Abbrechen</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </SafeAreaView>
  );
}

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    scrollView: { flex: 1 },
    content: { padding: 20 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    profileSection: { alignItems: 'center', paddingVertical: 24 },
    avatarContainer: { position: 'relative', marginBottom: 16 },
    avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: theme.primary, justifyContent: 'center', alignItems: 'center' },
    avatarImage: { width: 96, height: 96, borderRadius: 48 },
    avatarText: { fontSize: 36, fontWeight: '700', color: '#fff' },
    editBadge: {
      position: 'absolute', bottom: 0, right: 0,
      width: 28, height: 28, borderRadius: 14, backgroundColor: theme.card,
      justifyContent: 'center', alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
    },
    editBadgeText: { fontSize: 12 },
    usernameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    usernameEditIcon: { fontSize: 14, marginLeft: 6, opacity: 0.5 },
    username: { fontSize: 22, fontWeight: '700', color: theme.text },
    email: { fontSize: 14, color: theme.textSecondary, marginBottom: 4 },
    joinDate: { fontSize: 13, color: theme.textTertiary },
    statsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
    statCard: {
      flex: 1, backgroundColor: theme.card, borderRadius: 12, padding: 16, alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    },
    statValue: { fontSize: 22, fontWeight: '700', color: theme.primary, marginBottom: 4 },
    statLabel: { fontSize: 12, color: theme.textSecondary },
    section: { marginBottom: 20 },
    sectionTitle: { fontSize: 13, fontWeight: '600', color: theme.textSecondary, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
    menuItem: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card,
      borderRadius: 12, padding: 16, marginBottom: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    },
    menuItemColumn: { flexDirection: 'column', alignItems: 'flex-start' },
    menuItemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    menuIcon: { fontSize: 20, marginRight: 12 },
    menuLabel: { flex: 1, fontSize: 15, color: theme.text },
    menuArrow: { fontSize: 20, color: theme.border },
    menuBadge: {
      backgroundColor: theme.primary, borderRadius: 10,
      paddingHorizontal: 8, paddingVertical: 2, marginRight: 6,
    },
    menuBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    disabled: { opacity: 0.45 },

    dayPills: { flexDirection: 'row', gap: 8 },
    dayPill: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
      backgroundColor: theme.primaryLight, borderWidth: 1.5, borderColor: 'transparent',
    },
    dayPillActive: { backgroundColor: theme.primary, borderColor: theme.primary },
    dayPillText: { fontSize: 13, fontWeight: '600', color: theme.primary },
    dayPillTextActive: { color: '#fff' },

    timeChip: {
      backgroundColor: theme.primaryLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    },
    timeChipText: { fontSize: 14, fontWeight: '700', color: theme.primary },

    signOutBtn: {
      borderWidth: 1.5, borderColor: theme.danger, borderRadius: 12,
      paddingVertical: 16, alignItems: 'center', marginTop: 8,
    },
    signOutText: { color: theme.danger, fontSize: 16, fontWeight: '600' },

    modalOverlay: { flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' },
    modalCard: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
    modalTitle: { fontSize: 18, fontWeight: '700', color: theme.text, marginBottom: 20 },
    modalInput: {
      borderWidth: 1.5, borderColor: theme.border, borderRadius: 12,
      paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
      color: theme.text, backgroundColor: theme.inputBg, marginBottom: 16,
    },
    modalSaveBtn: {
      backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 8,
    },
    modalSaveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    modalCancel: { alignItems: 'center', paddingVertical: 12 },
    modalCancelText: { color: theme.textSecondary, fontSize: 15 },

    menuSub: { fontSize: 12, color: theme.textTertiary, marginTop: 2 },

    paymentFieldLabel: { fontSize: 13, fontWeight: '600', color: theme.textSecondary, marginBottom: 6, marginTop: 4 },
    paymentInputRow: {
      flexDirection: 'row', alignItems: 'center',
      borderWidth: 1.5, borderColor: theme.border, borderRadius: 12,
      backgroundColor: theme.inputBg, marginBottom: 4, overflow: 'hidden',
    },
    paymentPrefix: { paddingHorizontal: 12, fontSize: 14, color: theme.textTertiary },
    paymentInput: { flex: 1, paddingVertical: 14, paddingRight: 16, fontSize: 16, color: theme.text },
    paymentHint: { fontSize: 11, color: theme.textTertiary, marginBottom: 12 },

    timePickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 28, gap: 12 },
    timePickerCol: { alignItems: 'center', width: 90 },
    timePickerLabel: { fontSize: 12, color: theme.textTertiary, marginBottom: 8, fontWeight: '600' },
    timePickerBtn: { padding: 10 },
    timePickerArrow: { fontSize: 18, color: theme.primary, fontWeight: '700' },
    timePickerValue: {
      width: 72, height: 56, borderRadius: 12, backgroundColor: theme.primaryLight,
      justifyContent: 'center', alignItems: 'center',
    },
    timePickerValueText: { fontSize: 28, fontWeight: '700', color: theme.primary },
    timePickerColon: { fontSize: 32, fontWeight: '700', color: theme.text, marginTop: 18 },
  });
}
