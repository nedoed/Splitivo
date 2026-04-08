import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, Modal, TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Expense, Group, GroupMember, CATEGORIES } from '../types';

export default function GroupDetailScreen({ route, navigation }: any) {
  const { group }: { group: Group } = route.params;
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');

  const fetchData = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (user.user) setCurrentUserId(user.user.id);

    const [expensesRes, membersRes] = await Promise.all([
      supabase
        .from('expenses')
        .select('*, payer:profiles!paid_by(id, username, avatar_url)')
        .eq('group_id', group.id)
        .order('date', { ascending: false }),
      supabase
        .from('group_members')
        .select('*, profile:profiles!user_id(id, username, avatar_url)')
        .eq('group_id', group.id),
    ]);

    if (!expensesRes.error) setExpenses(expensesRes.data as any);
    if (!membersRes.error) setMembers(membersRes.data as any);
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { fetchData(); }, []));

  const inviteMember = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', inviteEmail.trim().toLowerCase())
      .single();

    if (error || !profile) {
      Alert.alert('Fehler', 'Benutzer nicht gefunden. Stelle sicher, dass er registriert ist.');
      setInviting(false);
      return;
    }

    const alreadyMember = members.some((m) => m.user_id === profile.id);
    if (alreadyMember) {
      Alert.alert('Hinweis', 'Dieser Benutzer ist bereits Mitglied.');
      setInviting(false);
      return;
    }

    const { error: insertError } = await supabase
      .from('group_members')
      .insert({ group_id: group.id, user_id: profile.id });

    if (insertError) {
      Alert.alert('Fehler', insertError.message);
    } else {
      Alert.alert('Erfolg', 'Mitglied hinzugefügt!');
      setInviteEmail('');
      setInviteModal(false);
      fetchData();
    }
    setInviting(false);
  };

  const getCategoryIcon = (cat: string) => {
    return CATEGORIES.find((c) => c.value === cat)?.icon ?? '📦';
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const renderExpense = ({ item }: { item: Expense }) => (
    <View style={styles.expenseCard}>
      <View style={styles.expenseIcon}>
        <Text style={styles.expenseIconText}>{getCategoryIcon(item.category)}</Text>
      </View>
      <View style={styles.expenseInfo}>
        <Text style={styles.expenseName}>{item.description}</Text>
        <Text style={styles.expensePayer}>
          {(item as any).payer?.username ?? 'Unbekannt'} • {new Date(item.date).toLocaleDateString('de-DE')}
        </Text>
      </View>
      <Text style={styles.expenseAmount}>{item.amount.toFixed(2)} €</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.summaryLabel}>Gesamtausgaben</Text>
            <Text style={styles.summaryAmount}>{totalExpenses.toFixed(2)} €</Text>
          </View>
          <View style={styles.membersRow}>
            {members.slice(0, 4).map((m, i) => (
              <View key={m.id} style={[styles.memberAvatar, { marginLeft: i > 0 ? -8 : 0 }]}>
                <Text style={styles.memberAvatarText}>
                  {(m as any).profile?.username?.charAt(0).toUpperCase() ?? '?'}
                </Text>
              </View>
            ))}
            {members.length > 4 && (
              <View style={[styles.memberAvatar, styles.memberAvatarMore, { marginLeft: -8 }]}>
                <Text style={styles.memberMoreText}>+{members.length - 4}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => navigation.navigate('AddExpense', { group, members })}
          >
            <Text style={styles.actionBtnText}>+ Ausgabe</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnOutline]} onPress={() => setInviteModal(true)}>
            <Text style={[styles.actionBtnText, styles.actionBtnTextOutline]}>+ Mitglied</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
      ) : expenses.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🧾</Text>
          <Text style={styles.emptyTitle}>Keine Ausgaben</Text>
          <Text style={styles.emptyText}>Füge die erste Ausgabe dieser Gruppe hinzu.</Text>
        </View>
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          renderItem={renderExpense}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor="#6C63FF" />}
        />
      )}

      <Modal visible={inviteModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Mitglied einladen</Text>
            <Text style={styles.modalHint}>E-Mail des registrierten Benutzers</Text>
            <TextInput
              style={styles.input}
              placeholder="freund@email.de"
              value={inviteEmail}
              onChangeText={setInviteEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor="#999"
            />
            <TouchableOpacity style={[styles.button, inviting && styles.buttonDisabled]} onPress={inviteMember} disabled={inviting}>
              {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Einladen</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setInviteModal(false)}>
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
  summaryCard: {
    backgroundColor: '#6C63FF', margin: 16, borderRadius: 16, padding: 20,
    shadowColor: '#6C63FF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  summaryLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 4 },
  summaryAmount: { fontSize: 28, fontWeight: '700', color: '#fff' },
  membersRow: { flexDirection: 'row', alignItems: 'center' },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#6C63FF' },
  memberAvatarText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  memberAvatarMore: { backgroundColor: 'rgba(0,0,0,0.2)' },
  memberMoreText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, backgroundColor: '#fff', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  actionBtnText: { color: '#6C63FF', fontWeight: '700', fontSize: 14 },
  actionBtnOutline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' },
  actionBtnTextOutline: { color: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16 },
  expenseCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  expenseIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F0EEFF', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  expenseIconText: { fontSize: 20 },
  expenseInfo: { flex: 1 },
  expenseName: { fontSize: 15, fontWeight: '600', color: '#1a1a2e' },
  expensePayer: { fontSize: 12, color: '#888', marginTop: 2 },
  expenseAmount: { fontSize: 16, fontWeight: '700', color: '#6C63FF' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#888', textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  modalHint: { fontSize: 13, color: '#888', marginBottom: 16 },
  input: { borderWidth: 1.5, borderColor: '#E8E8F0', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#1a1a2e', backgroundColor: '#FAFAFA', marginBottom: 12 },
  button: { backgroundColor: '#6C63FF', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', padding: 16 },
  cancelText: { color: '#888', fontSize: 15 },
});
