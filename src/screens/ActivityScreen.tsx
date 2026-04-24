import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { haptics } from '../lib/haptics';
import { Expense, CATEGORIES } from '../types';
import EmptyState from '../components/EmptyState';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

interface Group {
  id: string;
  name: string;
}

export default function ActivityScreen() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { theme } = useTheme();
  const styles = getStyles(theme);

  const fetchActivity = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    const { data: memberGroups } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name)')
      .eq('user_id', user.user.id);

    if (!memberGroups || memberGroups.length === 0) {
      setExpenses([]);
      setGroups([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const groupIds = memberGroups.map((m) => m.group_id);
    const loadedGroups = memberGroups
      .map((m) => (m as any).groups)
      .filter(Boolean) as Group[];
    setGroups(loadedGroups);

    const { data, error } = await supabase
      .from('expenses')
      .select(`
        *,
        payer:profiles!paid_by(id, username),
        groups!group_id(name)
      `)
      .in('group_id', groupIds)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!error && data) setExpenses(data as any);
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { fetchActivity(); }, []));

  const getCategoryIcon = (cat: string) =>
    CATEGORIES.find((c) => c.value === cat)?.icon ?? '📦';

  const filteredExpenses = selectedGroupId
    ? expenses.filter((e) => e.group_id === selectedGroupId)
    : expenses;

  const groupByDate = (list: Expense[]) => {
    const map: { [key: string]: Expense[] } = {};
    list.forEach((expense) => {
      const date = new Date(expense.date).toLocaleDateString('de-DE', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      if (!map[date]) map[date] = [];
      map[date].push(expense);
    });
    return Object.entries(map).map(([date, items]) => ({ date, items }));
  };

  const grouped = groupByDate(filteredExpenses);
  const activeGroupName = groups.find((g) => g.id === selectedGroupId)?.name;

  const renderItem = ({ item }: { item: { date: string; items: Expense[] } }) => (
    <View style={styles.section}>
      <Text style={styles.dateHeader}>{item.date}</Text>
      {item.items.map((expense) => (
        <View key={expense.id} style={styles.expenseCard}>
          <View style={styles.expenseIcon}>
            <Text style={styles.expenseIconText}>{getCategoryIcon(expense.category)}</Text>
          </View>
          <View style={styles.expenseInfo}>
            <Text style={styles.expenseName}>{expense.description}</Text>
            <Text style={styles.expenseMeta}>
              {(expense as any).payer?.username ?? 'Du'} • {(expense as any).groups?.name ?? ''}
            </Text>
          </View>
          <Text style={styles.expenseAmount}>
            {expense.amount.toFixed(2)} {(expense as any).currency ?? 'CHF'}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Aktivität</Text>
      </View>

      {/* Filter-Pills */}
      {groups.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pillsScroll}
          contentContainerStyle={styles.pillsContent}
        >
          <TouchableOpacity
            onPress={() => { haptics.selection(); setSelectedGroupId(null); }}
            style={[styles.pill, selectedGroupId === null && styles.pillActive]}
          >
            <Text style={[styles.pillText, selectedGroupId === null && styles.pillTextActive]}>
              Alle
            </Text>
          </TouchableOpacity>

          {groups.map((group) => (
            <TouchableOpacity
              key={group.id}
              onPress={() => {
                haptics.selection();
                setSelectedGroupId(selectedGroupId === group.id ? null : group.id);
              }}
              style={[styles.pill, selectedGroupId === group.id && styles.pillActive]}
            >
              <Text style={[styles.pillText, selectedGroupId === group.id && styles.pillTextActive]}>
                {group.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Aktiver Filter-Badge */}
      {selectedGroupId && activeGroupName && (
        <View style={styles.badgeRow}>
          <Text style={styles.badgeLabel}>Gefiltert nach:</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeName}>{activeGroupName}</Text>
            <TouchableOpacity onPress={() => { haptics.light(); setSelectedGroupId(null); }}>
              <Ionicons name="close-circle" size={14} color={theme.primary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : filteredExpenses.length === 0 ? (
        <EmptyState
          emoji={selectedGroupId ? '🔍' : '🧾'}
          title="Keine Ausgaben"
          subtitle={
            selectedGroupId
              ? 'Diese Gruppe hat noch keine Ausgaben'
              : 'Erfasse deine erste Ausgabe\nin einer Gruppe'
          }
        />
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(item) => item.date}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchActivity(); }}
              tintColor={theme.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: { padding: 20, paddingTop: 10, paddingBottom: 4 },
    title: { fontSize: 24, fontWeight: '700', color: theme.text },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { padding: 16, paddingTop: 0 },

    pillsScroll: { marginBottom: 4 },
    pillsContent: { paddingHorizontal: 16, gap: 8 },
    pill: {
      paddingHorizontal: 16, paddingVertical: 8,
      borderRadius: 20, backgroundColor: theme.inputBg,
    },
    pillActive: { backgroundColor: theme.primary },
    pillText: { color: theme.textSecondary, fontWeight: '600', fontSize: 13 },
    pillTextActive: { color: '#fff' },

    badgeRow: {
      flexDirection: 'row', alignItems: 'center',
      marginHorizontal: 16, marginBottom: 8, gap: 8,
    },
    badgeLabel: { color: theme.textSecondary, fontSize: 12 },
    badge: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: theme.primary + '20',
      borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, gap: 6,
    },
    badgeName: { color: theme.primary, fontSize: 12, fontWeight: '600' },

    section: { marginBottom: 8 },
    dateHeader: {
      fontSize: 12, fontWeight: '600', color: theme.textSecondary,
      marginBottom: 8, marginTop: 8,
      textTransform: 'uppercase', letterSpacing: 0.5,
    },
    expenseCard: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card,
      borderRadius: 12, padding: 14, marginBottom: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    },
    expenseIcon: {
      width: 42, height: 42, borderRadius: 21,
      backgroundColor: theme.primaryLight,
      justifyContent: 'center', alignItems: 'center', marginRight: 12,
    },
    expenseIconText: { fontSize: 20 },
    expenseInfo: { flex: 1 },
    expenseName: { fontSize: 15, fontWeight: '600', color: theme.text },
    expenseMeta: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
    expenseAmount: { fontSize: 16, fontWeight: '700', color: theme.primary },
  });
}
