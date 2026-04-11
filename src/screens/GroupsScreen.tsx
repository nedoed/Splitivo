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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Group } from '../types';

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
      {/* Aktion-Button dahinter */}
      <TouchableOpacity
        style={[styles.actionBtn, isCreator ? styles.actionDelete : styles.actionLeave]}
        onPress={handleAction}
        activeOpacity={0.85}
      >
        <Text style={styles.actionIcon}>{isCreator ? '🗑️' : '🚪'}</Text>
        <Text style={styles.actionLabel}>{isCreator ? 'Löschen' : 'Verlassen'}</Text>
      </TouchableOpacity>

      {/* Karte darüber */}
      <Animated.View
        style={[styles.groupCard, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.groupCardInner}
          onPress={onPress}
          activeOpacity={0.8}
        >
          <View style={styles.groupIcon}>
            <Text style={styles.groupIconText}>{group.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.groupInfo}>
            <Text style={styles.groupName}>{group.name}</Text>
            <Text style={styles.groupDesc} numberOfLines={1}>
              {group.description
                ? group.description
                : `${group.member_count ?? 1} Mitglied${(group.member_count ?? 1) !== 1 ? 'er' : ''}`}
            </Text>
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
        .select('group_id')
        .in('group_id', groupIds);

      const countMap: { [key: string]: number } = {};
      allMembers?.forEach((m) => {
        countMap[m.group_id] = (countMap[m.group_id] || 0) + 1;
      });

      setGroups(
        data.map((g) => ({ ...g, member_count: countMap[g.id] || 1 })) as Group[]
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
      fetchGroups();
    } catch {
      Alert.alert('Fehler', 'Unbekannter Fehler');
    } finally {
      setCreating(false);
    }
  };

  const deleteGroup = async (groupId: string) => {
    const { error } = await supabase.from('groups').delete().eq('id', groupId);
    if (error) { Alert.alert('Fehler', error.message); return; }
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  };

  const leaveGroup = async (groupId: string) => {
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', currentUserId);
    if (error) { Alert.alert('Fehler', error.message); return; }
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Meine Gruppen</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
          <Text style={styles.addBtnText}>+ Neu</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyTitle}>Noch keine Gruppen</Text>
          <Text style={styles.emptyText}>Erstelle deine erste Gruppe, um Ausgaben zu teilen.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setModalVisible(true)}>
            <Text style={styles.emptyBtnText}>Gruppe erstellen</Text>
          </TouchableOpacity>
        </View>
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
              tintColor="#6C63FF"
            />
          }
        />
      )}

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
                  placeholderTextColor="#999"
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
                  placeholderTextColor="#999"
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8FF' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e' },
  addBtn: { backgroundColor: '#6C63FF', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingVertical: 8 },

  // Swipeable layout
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

  // Card
  groupCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  groupCardInner: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
  },
  groupIcon: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#EEF0FF',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  groupIconText: { fontSize: 20, fontWeight: '700', color: '#6C63FF' },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 16, fontWeight: '600', color: '#1a1a2e' },
  groupDesc: { fontSize: 13, color: '#888', marginTop: 2 },
  arrow: { fontSize: 22, color: '#ccc' },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  emptyText: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 22 },
  emptyBtn: {
    marginTop: 24, backgroundColor: '#6C63FF',
    paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 20 },
  input: {
    borderWidth: 1.5, borderColor: '#E8E8F0', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 15,
    color: '#1a1a2e', backgroundColor: '#FAFAFA', marginBottom: 12,
  },
  button: {
    backgroundColor: '#6C63FF', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 4,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', padding: 16 },
  cancelText: { color: '#888', fontSize: 15 },
});
