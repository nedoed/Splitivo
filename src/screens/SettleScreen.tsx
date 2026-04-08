import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Debt } from '../types';

export default function SettleScreen() {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');

  const fetchDebts = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    setCurrentUserId(user.user.id);

    const { data: memberGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.user.id);

    if (!memberGroups || memberGroups.length === 0) {
      setDebts([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const groupIds = memberGroups.map((m) => m.group_id);

    const { data: expenses } = await supabase
      .from('expenses')
      .select('id, paid_by, amount')
      .in('group_id', groupIds);

    if (!expenses) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const expenseIds = expenses.map((e) => e.id);
    const paidByMap: { [key: string]: string } = {};
    expenses.forEach((e) => { paidByMap[e.id] = e.paid_by; });

    const { data: splits } = await supabase
      .from('expense_splits')
      .select('*, expense:expenses!expense_id(paid_by)')
      .in('expense_id', expenseIds)
      .eq('is_settled', false);

    if (!splits) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const balances: { [key: string]: { [key: string]: number } } = {};

    splits.forEach((split: any) => {
      const debtor = split.user_id;
      const creditor = split.expense?.paid_by;
      if (!creditor || debtor === creditor) return;

      if (!balances[debtor]) balances[debtor] = {};
      balances[debtor][creditor] = (balances[debtor][creditor] || 0) + split.amount;
    });

    const rawDebts: Debt[] = [];
    Object.entries(balances).forEach(([debtor, creditors]) => {
      Object.entries(creditors).forEach(([creditor, amount]) => {
        const netAmount = amount - (balances[creditor]?.[debtor] || 0);
        if (netAmount > 0.01) {
          rawDebts.push({ from_user_id: debtor, to_user_id: creditor, amount: netAmount });
        }
      });
    });

    const userIds = [...new Set(rawDebts.flatMap((d) => [d.from_user_id, d.to_user_id]))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds);

      const profileMap: { [key: string]: any } = {};
      profiles?.forEach((p) => { profileMap[p.id] = p; });

      rawDebts.forEach((d) => {
        d.from_profile = profileMap[d.from_user_id];
        d.to_profile = profileMap[d.to_user_id];
      });
    }

    const myDebts = rawDebts.filter(
      (d) => d.from_user_id === user.user!.id || d.to_user_id === user.user!.id
    );

    setDebts(myDebts);
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { fetchDebts(); }, []));

  const settleDebt = async (debt: Debt) => {
    Alert.alert(
      'Schuld begleichen',
      `Möchtest du ${debt.amount.toFixed(2)} € an ${debt.to_profile?.username} als bezahlt markieren?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Begleichen',
          onPress: async () => {
            const { data: splits } = await supabase
              .from('expense_splits')
              .select('id, expense:expenses!expense_id(paid_by)')
              .eq('user_id', debt.from_user_id)
              .eq('is_settled', false);

            if (!splits) return;

            const toSettle = splits
              .filter((s: any) => s.expense?.paid_by === debt.to_user_id)
              .map((s: any) => s.id);

            if (toSettle.length > 0) {
              await supabase
                .from('expense_splits')
                .update({ is_settled: true })
                .in('id', toSettle);
            }

            fetchDebts();
          },
        },
      ]
    );
  };

  const totalOwed = debts
    .filter((d) => d.from_user_id === currentUserId)
    .reduce((sum, d) => sum + d.amount, 0);

  const totalOwing = debts
    .filter((d) => d.to_user_id === currentUserId)
    .reduce((sum, d) => sum + d.amount, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Abrechnen</Text>
      </View>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, styles.cardRed]}>
          <Text style={styles.summaryLabel}>Du schuldest</Text>
          <Text style={[styles.summaryAmount, styles.amountRed]}>{totalOwed.toFixed(2)} €</Text>
        </View>
        <View style={[styles.summaryCard, styles.cardGreen]}>
          <Text style={styles.summaryLabel}>Dir schuldet man</Text>
          <Text style={[styles.summaryAmount, styles.amountGreen]}>{totalOwing.toFixed(2)} €</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
      ) : debts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🎉</Text>
          <Text style={styles.emptyTitle}>Alles beglichen!</Text>
          <Text style={styles.emptyText}>Du hast keine offenen Schulden. Super!</Text>
        </View>
      ) : (
        <FlatList
          data={debts}
          keyExtractor={(item, index) => `${item.from_user_id}-${item.to_user_id}-${index}`}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchDebts(); }} tintColor="#6C63FF" />
          }
          renderItem={({ item }) => {
            const isDebtor = item.from_user_id === currentUserId;
            return (
              <View style={styles.debtCard}>
                <View style={styles.debtInfo}>
                  <View style={[styles.debtBadge, isDebtor ? styles.debtBadgeRed : styles.debtBadgeGreen]}>
                    <Text style={styles.debtBadgeText}>{isDebtor ? 'Ich schulde' : 'Bekomme'}</Text>
                  </View>
                  <Text style={styles.debtPerson}>
                    {isDebtor ? item.to_profile?.username : item.from_profile?.username}
                  </Text>
                  <Text style={[styles.debtAmount, isDebtor ? styles.amountRed : styles.amountGreen]}>
                    {item.amount.toFixed(2)} €
                  </Text>
                </View>
                {isDebtor && (
                  <TouchableOpacity style={styles.settleBtn} onPress={() => settleDebt(item)}>
                    <Text style={styles.settleBtnText}>Begleichen</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8FF' },
  header: { padding: 20, paddingTop: 10 },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e' },
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 8 },
  summaryCard: { flex: 1, borderRadius: 12, padding: 16 },
  cardRed: { backgroundColor: '#FFF0F0' },
  cardGreen: { backgroundColor: '#F0FFF4' },
  summaryLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  summaryAmount: { fontSize: 22, fontWeight: '700' },
  amountRed: { color: '#FF4444' },
  amountGreen: { color: '#22C55E' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16 },
  debtCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  debtInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  debtBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginRight: 10 },
  debtBadgeRed: { backgroundColor: '#FFE0E0' },
  debtBadgeGreen: { backgroundColor: '#DCFCE7' },
  debtBadgeText: { fontSize: 11, fontWeight: '600', color: '#555' },
  debtPerson: { flex: 1, fontSize: 16, fontWeight: '600', color: '#1a1a2e' },
  debtAmount: { fontSize: 18, fontWeight: '700' },
  settleBtn: { backgroundColor: '#6C63FF', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  settleBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#888', textAlign: 'center' },
});
