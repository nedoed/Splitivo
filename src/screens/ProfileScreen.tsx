import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, Image, ScrollView, RefreshControl,
  TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ groups: 0, expenses: 0, totalPaid: 0 });
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [editUsernameVisible, setEditUsernameVisible] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  const fetchProfile = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    const [profileRes, groupsRes, expensesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.user.id).single(),
      supabase.from('group_members').select('id', { count: 'exact' }).eq('user_id', user.user.id),
      supabase.from('expenses').select('amount').eq('paid_by', user.user.id),
    ]);

    if (!profileRes.error) setProfile(profileRes.data);

    const totalPaid = expensesRes.data?.reduce((sum, e) => sum + e.amount, 0) ?? 0;
    setStats({
      groups: groupsRes.count ?? 0,
      expenses: expensesRes.data?.length ?? 0,
      totalPaid,
    });

    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { fetchProfile(); }, []));

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
      Alert.alert('Fehler', error.message);
    } else {
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
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchProfile(); }} tintColor="#6C63FF" />}
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
          <Text style={styles.statValue}>{stats.expenses}</Text>
          <Text style={styles.statLabel}>Ausgaben</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalPaid.toFixed(0)} €</Text>
          <Text style={styles.statLabel}>Bezahlt</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Konto</Text>
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
              placeholderTextColor="#bbb"
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8FF' },
  scrollView: { flex: 1 },
  content: { padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  profileSection: { alignItems: 'center', paddingVertical: 24 },
  avatarContainer: { position: 'relative', marginBottom: 16 },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#6C63FF', justifyContent: 'center', alignItems: 'center' },
  avatarImage: { width: 96, height: 96, borderRadius: 48 },
  avatarText: { fontSize: 36, fontWeight: '700', color: '#fff' },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  editBadgeText: { fontSize: 12 },
  usernameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  usernameEditIcon: { fontSize: 14, marginLeft: 6, opacity: 0.5 },
  username: { fontSize: 22, fontWeight: '700', color: '#1a1a2e' },
  email: { fontSize: 14, color: '#888', marginBottom: 4 },
  joinDate: { fontSize: 13, color: '#aaa' },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  statValue: { fontSize: 22, fontWeight: '700', color: '#6C63FF', marginBottom: 4 },
  statLabel: { fontSize: 12, color: '#888' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 16, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  menuIcon: { fontSize: 20, marginRight: 12 },
  menuLabel: { flex: 1, fontSize: 15, color: '#1a1a2e' },
  menuArrow: { fontSize: 20, color: '#ccc' },
  signOutBtn: {
    borderWidth: 1.5, borderColor: '#FF4444', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  signOutText: { color: '#FF4444', fontSize: 16, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 20 },
  modalInput: {
    borderWidth: 1.5, borderColor: '#E8E8F0', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
    color: '#1a1a2e', backgroundColor: '#F8F8FF', marginBottom: 16,
  },
  modalSaveBtn: {
    backgroundColor: '#6C63FF', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 8,
  },
  modalSaveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalCancel: { alignItems: 'center', paddingVertical: 12 },
  modalCancelText: { color: '#888', fontSize: 15 },
});
