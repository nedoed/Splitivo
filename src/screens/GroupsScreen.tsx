import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Group } from '../types';

export default function GroupsScreen({ navigation }: any) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchGroups = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    const { data, error } = await supabase
      .from('group_members')
      .select(`
        group_id,
        groups (
          id, name, description, created_by, created_at
        )
      `)
      .eq('user_id', user.user.id);

    if (!error && data) {
      const groupList = data
        .map((item: any) => item.groups)
        .filter(Boolean) as Group[];
      setGroups(groupList);
    }
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { fetchGroups(); }, []));

  const createGroup = async () => {
    if (!groupName.trim()) {
      Alert.alert('Fehler', 'Gruppenname ist erforderlich.');
      return;
    }
    setCreating(true);
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    const { data: group, error } = await supabase
      .from('groups')
      .insert({ name: groupName.trim(), description: groupDesc.trim() || null, created_by: user.user.id })
      .select()
      .single();

    if (error) {
      Alert.alert('Fehler', error.message);
      setCreating(false);
      return;
    }

    await supabase.from('group_members').insert({ group_id: group.id, user_id: user.user.id });

    setGroupName('');
    setGroupDesc('');
    setModalVisible(false);
    setCreating(false);
    fetchGroups();
  };

  const renderGroup = ({ item }: { item: Group }) => (
    <TouchableOpacity
      style={styles.groupCard}
      onPress={() => navigation.navigate('GroupDetail', { group: item })}
      activeOpacity={0.8}
    >
      <View style={styles.groupIcon}>
        <Text style={styles.groupIconText}>{item.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.groupInfo}>
        <Text style={styles.groupName}>{item.name}</Text>
        {item.description && <Text style={styles.groupDesc} numberOfLines={1}>{item.description}</Text>}
      </View>
      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchGroups(); }} tintColor="#6C63FF" />}
        />
      )}

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Neue Gruppe</Text>
            <TextInput
              style={styles.input}
              placeholder="Gruppenname (z.B. WG Berlin)"
              value={groupName}
              onChangeText={setGroupName}
              placeholderTextColor="#999"
            />
            <TextInput
              style={styles.input}
              placeholder="Beschreibung (optional)"
              value={groupDesc}
              onChangeText={setGroupDesc}
              placeholderTextColor="#999"
            />
            <TouchableOpacity style={[styles.button, creating && styles.buttonDisabled]} onPress={createGroup} disabled={creating}>
              {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Erstellen</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
              <Text style={styles.cancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8FF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 10 },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e' },
  addBtn: { backgroundColor: '#6C63FF', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16 },
  groupCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
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
  emptyBtn: { marginTop: 24, backgroundColor: '#6C63FF', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 20 },
  input: { borderWidth: 1.5, borderColor: '#E8E8F0', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#1a1a2e', backgroundColor: '#FAFAFA', marginBottom: 12 },
  button: { backgroundColor: '#6C63FF', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', padding: 16 },
  cancelText: { color: '#888', fontSize: 15 },
});
