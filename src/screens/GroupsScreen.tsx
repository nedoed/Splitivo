import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  Animated,
  PanResponder,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { haptics } from '../lib/haptics';
import { Group } from '../types';
import EmptyState from '../components/EmptyState';
import { joinGroupWithCode } from '../lib/invites';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

// ─── Swipeable Card ────────────────────────────────────────────────────────────

type SwipeableGroupCardProps = {
  group: Group;
  currentUserId: string;
  onPress: () => void;
  onDelete: (groupId: string) => void;
  onLeave: (groupId: string) => void;
};

function SwipeableGroupCard({
  group,
  currentUserId,
  onPress,
  onDelete,
  onLeave,
}: SwipeableGroupCardProps) {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const translateX = useRef(new Animated.Value(0)).current;
  const isCreator = group.created_by === currentUserId;
  const ACTION_WIDTH = 80;
  const THRESHOLD = -50;

  const close = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 8,
      onPanResponderMove: (_, g) => {
        if (g.dx <= 0) {
          translateX.setValue(Math.max(g.dx, -ACTION_WIDTH));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < THRESHOLD) {
          haptics.light();
          Animated.spring(translateX, {
            toValue: -ACTION_WIDTH,
            useNativeDriver: true,
            tension: 80,
            friction: 10,
          }).start();
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 80,
            friction: 10,
          }).start();
        }
      },
    })
  ).current;

  const handleAction = () => {
    haptics.warning();
    Alert.alert(
      isCreator ? 'Gruppe löschen' : 'Gruppe verlassen',
      isCreator
        ? 'Möchtest du diese Gruppe wirklich löschen? Alle Ausgaben und Schulden werden ebenfalls gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.'
        : 'Möchtest du diese Gruppe verlassen?',
      [
        { text: 'Abbrechen', style: 'cancel', onPress: close },
        {
          text: isCreator ? 'Löschen' : 'Verlassen',
          style: 'destructive',
          onPress: () => {
            if (isCreator) onDelete(group.id);
            else onLeave(group.id);
          },
        },
      ]
    );
  };

  return (
    <View style={styles.swipeContainer}>
      <TouchableOpacity
        style={[styles.actionBtn, isCreator ? styles.actionDelete : styles.actionLeave]}
        onPress={handleAction}
        activeOpacity={0.85}
      >
        <Text style={styles.actionIcon}>{isCreator ? '🗑️' : '🚪'}</Text>
        <Text style={styles.actionLabel}>{isCreator ? 'Löschen' : 'Verlassen'}</Text>
      </TouchableOpacity>

      <Animated.View
        style={[styles.groupCard, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.groupCardInner}
          onPress={() => { haptics.light(); onPress(); }}
          activeOpacity={0.8}
        >
          <View style={styles.groupIcon}>
            <Text style={styles.groupIconText}>{group.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.groupInfo}>
            <Text style={styles.groupName}>{group.name}</Text>
            {group.member_profiles && group.member_profiles.length > 0 ? (
              <View style={styles.memberRow}>
                {group.member_profiles.slice(0, 4).map((m, i) => (
                  <View key={i} style={[styles.miniAvatar, i > 0 && { marginLeft: -6 }]}>
                    {(m as any).avatar_url ? (
                      <Image
                        source={{ uri: (m as any).avatar_url }}
                        style={{ width: 22, height: 22, borderRadius: 11 }}
                      />
                    ) : (
                      <Text style={styles.miniAvatarText}>
                        {m.username?.[0]?.toUpperCase() ?? '?'}
                      </Text>
                    )}
                  </View>
                ))}
                <Text style={[styles.groupDesc, { marginLeft: 8, flex: 1 }]} numberOfLines={1}>
                  {group.member_profiles.slice(0, 3).map((m) => m.username).filter(Boolean).join(' · ')}
                  {group.member_profiles.length > 3 ? ` +${group.member_profiles.length - 3}` : ''}
                </Text>
              </View>
            ) : (
              <Text style={styles.groupDesc} numberOfLines={1}>
                {group.description
                  ? group.description
                  : `${group.member_count ?? 1} Mitglied${(group.member_count ?? 1) !== 1 ? 'er' : ''}`}
              </Text>
            )}
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function GroupsScreen({ navigation }: any) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const descRef = useRef<TextInput>(null);

  const [codeModal, setCodeModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const { theme } = useTheme();
  const styles = getStyles(theme);
  const { right: rightInset } = useSafeAreaInsets();

  const fetchGroups = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return;
    const user = sessionData.session.user;
    setCurrentUserId(user.id);

    const { data: memberships, error: memError } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id);

    if (memError || !memberships || memberships.length === 0) {
      setGroups([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const groupIds = memberships.map((m) => m.group_id);

    const { data, error } = await supabase
      .from('groups')
      .select('*')
      .in('id', groupIds)
      .order('created_at', { ascending: false });

    if (!error && data) {
      const { data: allMembers } = await supabase
        .from('group_members')
        .select('group_id, profiles(username, avatar_url)')
        .in('group_id', groupIds);

      const countMap: { [key: string]: number } = {};
      const membersByGroup: { [key: string]: Array<{ username: string | null; avatar_url: string | null }> } = {};
      (allMembers as any[])?.forEach((m) => {
        countMap[m.group_id] = (countMap[m.group_id] || 0) + 1;
        if (!membersByGroup[m.group_id]) membersByGroup[m.group_id] = [];
        membersByGroup[m.group_id].push({
          username: m.profiles?.username ?? null,
          avatar_url: m.profiles?.avatar_url ?? null,
        });
      });

      setGroups(
        data.map((g) => ({
          ...g,
          member_count: countMap[g.id] || 1,
          member_profiles: membersByGroup[g.id] ?? [],
        })) as Group[]
      );
    }
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { fetchGroups(); }, []));

  const createGroup = async () => {
    setCreating(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) { Alert.alert('Fehler', 'Nicht eingeloggt'); return; }

      const { data: group, error: groupError } = await supabase
        .from('groups')
        .insert({ name: groupName, description: groupDesc || '', created_by: user.id })
        .select()
        .single();

      if (groupError) { Alert.alert('Fehler', groupError.message); return; }

      const { error: memberError } = await supabase
        .from('group_members')
        .insert({ group_id: group.id, user_id: user.id });

      if (memberError) { Alert.alert('Fehler', memberError.message); return; }

      setGroupName('');
      setGroupDesc('');
      setModalVisible(false);
      haptics.success();
      fetchGroups();
    } catch {
      haptics.error();
      Alert.alert('Fehler', 'Unbekannter Fehler');
    } finally {
      setCreating(false);
    }
  };

  const deleteGroup = async (groupId: string) => {
    const { error } = await supabase.from('groups').delete().eq('id', groupId);
    if (error) { haptics.error(); Alert.alert('Fehler', error.message); return; }
    haptics.heavy();
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  };

  const handleJoinWithCode = async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    const result = await joinGroupWithCode(joinCode);
    setJoining(false);

    if (result.success) {
      haptics.success();
      setCodeModal(false);
      setJoinCode('');
      fetchGroups();
      Alert.alert('Willkommen! 🎉', `Du bist der Gruppe „${result.groupName}" beigetreten!`);
    } else {
      haptics.error();
      Alert.alert('Fehler', result.error ?? 'Beitritt fehlgeschlagen');
    }
  };

  const leaveGroup = async (groupId: string) => {
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', currentUserId);
    if (error) { haptics.error(); Alert.alert('Fehler', error.message); return; }
    haptics.medium();
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  };

  const renderGroup = ({ item }: { item: Group }) => (
    <SwipeableGroupCard
      key={item.id}
      group={item}
      currentUserId={currentUserId}
      onPress={() => navigation.navigate('GroupDetail', { group: item })}
      onDelete={deleteGroup}
      onLeave={leaveGroup}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.header, { paddingRight: Math.max(20, rightInset + 16) }]}>
        <Text style={styles.title}>Meine Gruppen</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TouchableOpacity
            style={styles.codeBtn}
            onPress={() => { haptics.light(); setCodeModal(true); }}
          >
            <Text style={styles.codeBtnText}>🔗 Code</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
            <Text style={styles.addBtnText}>+ Neu</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : groups.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="Noch keine Gruppen"
          subtitle={"Erstelle deine erste Gruppe für\nWG, Reise oder Freunde"}
          buttonText="Erste Gruppe erstellen"
          onButtonPress={() => setModalVisible(true)}
        />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={renderGroup}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchGroups(); }}
              tintColor={theme.primary}
            />
          }
        />
      )}

      {/* Per Code beitreten Modal */}
      <Modal visible={codeModal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Per Code beitreten</Text>
                <Text style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 16 }}>
                  Gib den 8-stelligen Einladungscode ein
                </Text>
                <TextInput
                  style={[styles.input, { textAlign: 'center', fontSize: 24, fontWeight: '800', letterSpacing: 4 }]}
                  placeholder="ABCD1234"
                  value={joinCode}
                  onChangeText={(t) => setJoinCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  autoCapitalize="characters"
                  maxLength={8}
                  placeholderTextColor={theme.border}
                  returnKeyType="done"
                  onSubmitEditing={handleJoinWithCode}
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.button, (joining || joinCode.length < 8) && styles.buttonDisabled]}
                  onPress={handleJoinWithCode}
                  disabled={joining || joinCode.length < 8}
                >
                  {joining
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.buttonText}>Gruppe beitreten</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => { setCodeModal(false); setJoinCode(''); }}
                >
                  <Text style={styles.cancelText}>Abbrechen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Neue Gruppe</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Gruppenname (z.B. WG Berlin)"
                  value={groupName}
                  onChangeText={setGroupName}
                  placeholderTextColor={theme.textTertiary}
                  returnKeyType="next"
                  onSubmitEditing={() => descRef.current?.focus()}
                  blurOnSubmit={false}
                  autoFocus
                />
                <TextInput
                  ref={descRef}
                  style={styles.input}
                  placeholder="Beschreibung (optional)"
                  value={groupDesc}
                  onChangeText={setGroupDesc}
                  placeholderTextColor={theme.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={createGroup}
                />
                <TouchableOpacity
                  style={[styles.button, creating && styles.buttonDisabled]}
                  onPress={createGroup}
                  disabled={creating}
                >
                  {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Erstellen</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => { Keyboard.dismiss(); setModalVisible(false); }}
                >
                  <Text style={styles.cancelText}>Abbrechen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingLeft: 20, paddingRight: 20, paddingVertical: 12,
    },
    title: { fontSize: 24, fontWeight: '700', color: theme.text },
    addBtn: { backgroundColor: theme.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
    addBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
    codeBtn: { borderWidth: 1.5, borderColor: theme.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
    codeBtnText: { color: theme.primary, fontWeight: '600', fontSize: 14 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { paddingVertical: 8 },

    swipeContainer: {
      marginHorizontal: 16, marginVertical: 6,
      borderRadius: 12, overflow: 'hidden',
    },
    actionBtn: {
      position: 'absolute', right: 0, top: 0, bottom: 0,
      width: 80, justifyContent: 'center', alignItems: 'center',
    },
    actionDelete: { backgroundColor: '#FF3B30' },
    actionLeave: { backgroundColor: '#FF9500' },
    actionIcon: { fontSize: 20, marginBottom: 4 },
    actionLabel: { color: '#fff', fontSize: 11, fontWeight: '700' },

    groupCard: {
      backgroundColor: theme.card,
      borderRadius: 12,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    },
    groupCardInner: {
      flexDirection: 'row', alignItems: 'center', padding: 16,
    },
    groupIcon: {
      width: 48, height: 48, borderRadius: 24, backgroundColor: theme.primaryLight,
      justifyContent: 'center', alignItems: 'center', marginRight: 14,
    },
    groupIconText: { fontSize: 20, fontWeight: '700', color: theme.primary },
    groupInfo: { flex: 1 },
    groupName: { fontSize: 16, fontWeight: '600', color: theme.text },
    groupDesc: { fontSize: 13, color: theme.textSecondary, marginTop: 2 },
    arrow: { fontSize: 22, color: theme.border },

    memberRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    miniAvatar: {
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: theme.primary,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 1.5, borderColor: theme.card,
    },
    miniAvatarText: { color: '#fff', fontSize: 9, fontWeight: '700' },

    modalOverlay: { flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' },
    modalCard: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
    modalTitle: { fontSize: 20, fontWeight: '700', color: theme.text, marginBottom: 20 },
    input: {
      borderWidth: 1.5, borderColor: theme.border, borderRadius: 12,
      paddingHorizontal: 16, paddingVertical: 14, fontSize: 15,
      color: theme.text, backgroundColor: theme.inputBg, marginBottom: 12,
    },
    button: {
      backgroundColor: theme.primary, borderRadius: 12,
      paddingVertical: 16, alignItems: 'center', marginTop: 4,
    },
    buttonDisabled: { opacity: 0.7 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    cancelBtn: { alignItems: 'center', padding: 16 },
    cancelText: { color: theme.textSecondary, fontSize: 15 },
  });
}
