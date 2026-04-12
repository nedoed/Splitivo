import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PieChart, BarChart } from 'react-native-chart-kit';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import EmptyState from '../components/EmptyState';
import { CATEGORIES } from '../types';

const { width: screenWidth } = Dimensions.get('window');

const CATEGORY_COLORS = ['#6C63FF', '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#FF9F40'];

const CHART_CONFIG = {
  backgroundColor: '#fff',
  backgroundGradientFrom: '#fff',
  backgroundGradientTo: '#fff',
  color: (opacity = 1) => `rgba(108, 99, 255, ${opacity})`,
  labelColor: () => '#888',
  barPercentage: 0.6,
  propsForLabels: { fontSize: 11 },
  decimalPlaces: 0,
};

type Period = 'thisMonth' | 'lastMonth' | 'thisYear';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'thisMonth', label: 'Dieser Monat' },
  { key: 'lastMonth', label: 'Letzter Monat' },
  { key: 'thisYear', label: 'Dieses Jahr' },
];

const getCategoryLabel = (value: string) =>
  CATEGORIES.find((c) => c.value === value)?.label ?? value;

const getDateRange = (period: Period): { start: Date; end: Date | null } => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'thisMonth':  return { start: new Date(y, m, 1), end: null };
    case 'lastMonth':  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
    case 'thisYear':   return { start: new Date(y, 0, 1), end: null };
  }
};

interface Expense {
  id: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  paid_by: string;
  group_id: string;
  group?: { id: string; name: string } | null;
  expense_splits?: { user_id: string; amount: number; is_settled: boolean }[];
}

export default function StatsScreen() {
  const [period, setPeriod] = useState<Period>('thisMonth');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Computed data
  const [totalPaid, setTotalPaid] = useState(0);
  const [totalDebt, setTotalDebt] = useState(0);
  const [activeGroups, setActiveGroups] = useState(0);
  const [categoryData, setCategoryData] = useState<{ name: string; amount: number; color: string; legendFontColor: string; legendFontSize: number }[]>([]);
  const [monthlyData, setMonthlyData] = useState<{ labels: string[]; values: number[] }>({ labels: [], values: [] });
  const [topExpenses, setTopExpenses] = useState<Expense[]>([]);
  const [groupStats, setGroupStats] = useState<{ name: string; total: number; percentage: number }[]>([]);
  const [hasData, setHasData] = useState(false);

  const loadStats = useCallback(async (p: Period) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const userId = userData.user.id;

    const { start, end } = getDateRange(p);

    // 1. Alle Gruppen des Users
    const { data: memberGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId);

    if (!memberGroups || memberGroups.length === 0) {
      setHasData(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const groupIds = memberGroups.map((m) => m.group_id);

    // 2. Ausgaben im Zeitraum (alle Gruppen des Users)
    let query = supabase
      .from('expenses')
      .select('*, group:groups!group_id(id, name), expense_splits(user_id, amount, is_settled)')
      .in('group_id', groupIds)
      .gte('date', start.toISOString())
      .order('amount', { ascending: false });

    if (end) query = query.lt('date', end.toISOString());

    const { data: expenses } = await query;

    // 3. Meine unbeglichenen Schulden (gesamt, nicht zeitgefiltert)
    const { data: allExpenseIds } = await supabase
      .from('expenses')
      .select('id, paid_by')
      .in('group_id', groupIds)
      .neq('paid_by', userId);

    let debtTotal = 0;
    if (allExpenseIds && allExpenseIds.length > 0) {
      const ids = allExpenseIds.map((e) => e.id);
      const { data: mySplits } = await supabase
        .from('expense_splits')
        .select('amount')
        .in('expense_id', ids)
        .eq('user_id', userId)
        .eq('is_settled', false);
      debtTotal = mySplits?.reduce((s, x) => s + x.amount, 0) ?? 0;
    }

    // 4. Letzten 6 Monate für Balkendiagramm (nur vom User bezahlte)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const { data: barExpenses } = await supabase
      .from('expenses')
      .select('amount, date')
      .in('group_id', groupIds)
      .eq('paid_by', userId)
      .gte('date', sixMonthsAgo.toISOString());

    // ── Berechnungen ─────────────────────────────────────────────────────────

    const exps: Expense[] = expenses ?? [];

    // Übersicht
    const myPaid = exps
      .filter((e) => e.paid_by === userId)
      .reduce((s, e) => s + e.amount, 0);
    const distinctGroups = new Set(exps.map((e) => e.group_id)).size;

    setTotalPaid(myPaid);
    setTotalDebt(debtTotal);
    setActiveGroups(distinctGroups);

    // Kategorie-Kuchendiagramm (nur eigene Ausgaben)
    const byCat: Record<string, number> = {};
    exps
      .filter((e) => e.paid_by === userId)
      .forEach((e) => {
        const label = getCategoryLabel(e.category);
        byCat[label] = (byCat[label] ?? 0) + e.amount;
      });
    const catArr = Object.entries(byCat)
      .sort(([, a], [, b]) => b - a)
      .map(([name, amount], i) => ({
        name,
        amount: parseFloat(amount.toFixed(2)),
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
        legendFontColor: '#555',
        legendFontSize: 12,
      }));
    setCategoryData(catArr);

    // Letzte 6 Monate Balkendiagramm
    const last6: { label: string; year: number; month: number }[] = Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      return {
        label: d.toLocaleString('de-CH', { month: 'short' }),
        year: d.getFullYear(),
        month: d.getMonth(),
      };
    });

    const monthTotals: Record<string, number> = {};
    (barExpenses ?? []).forEach((e) => {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthTotals[key] = (monthTotals[key] ?? 0) + e.amount;
    });

    setMonthlyData({
      labels: last6.map((m) => m.label),
      values: last6.map((m) => parseFloat((monthTotals[`${m.year}-${m.month}`] ?? 0).toFixed(2))),
    });

    // Top 5 Ausgaben
    setTopExpenses(exps.slice(0, 5));

    // Gruppen-Vergleich (Ausgaben aller Mitglieder pro Gruppe)
    const byGroup: Record<string, { name: string; total: number }> = {};
    exps.forEach((e) => {
      const gid = e.group_id;
      const gname = (e.group as any)?.name ?? gid;
      if (!byGroup[gid]) byGroup[gid] = { name: gname, total: 0 };
      byGroup[gid].total += e.amount;
    });
    const groupArr = Object.values(byGroup).sort((a, b) => b.total - a.total);
    const maxGroup = groupArr[0]?.total ?? 1;
    setGroupStats(
      groupArr.map((g) => ({
        name: g.name,
        total: parseFloat(g.total.toFixed(2)),
        percentage: Math.round((g.total / maxGroup) * 100),
      }))
    );

    setHasData(exps.length > 0);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadStats(period);
    }, [period, loadStats])
  );

  const handlePeriod = (p: Period) => {
    if (p === period) return;
    setPeriod(p);
    setLoading(true);
  };

  const barChartData = {
    labels: monthlyData.labels,
    datasets: [{ data: monthlyData.values.length > 0 ? monthlyData.values : [0, 0, 0, 0, 0, 0] }],
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Statistiken</Text>
        <View style={styles.periodRow}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.periodBtn, period === p.key && styles.periodBtnActive]}
              onPress={() => handlePeriod(p.key)}
            >
              <Text style={[styles.periodBtnText, period === p.key && styles.periodBtnTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
      ) : !hasData ? (
        <EmptyState
          emoji="📊"
          title="Noch keine Statistiken"
          subtitle="Erfasse Ausgaben um deine Statistiken zu sehen"
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadStats(period); }}
              tintColor="#6C63FF"
            />
          }
        >
          {/* SECTION 1 – Übersicht */}
          <View style={styles.overviewRow}>
            <View style={styles.overviewCard}>
              <Text style={styles.overviewValue}>
                {totalPaid >= 1000
                  ? `${(totalPaid / 1000).toFixed(1)}k`
                  : totalPaid.toFixed(0)}
              </Text>
              <Text style={styles.overviewLabel}>Ausgaben</Text>
            </View>
            <View style={[styles.overviewCard, styles.overviewCardMiddle]}>
              <Text style={[styles.overviewValue, totalDebt > 0 && { color: '#FF4444' }]}>
                {totalDebt.toFixed(0)}
              </Text>
              <Text style={styles.overviewLabel}>Schulden</Text>
            </View>
            <View style={styles.overviewCard}>
              <Text style={styles.overviewValue}>{activeGroups}</Text>
              <Text style={styles.overviewLabel}>Gruppen</Text>
            </View>
          </View>

          {/* SECTION 2 – Kategorien */}
          {categoryData.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ausgaben nach Kategorie</Text>
              <PieChart
                data={categoryData}
                width={screenWidth - 48}
                height={190}
                chartConfig={CHART_CONFIG}
                accessor="amount"
                backgroundColor="transparent"
                paddingLeft="15"
                absolute={false}
              />
            </View>
          )}

          {/* SECTION 3 – Letzte 6 Monate */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Meine Ausgaben · 6 Monate</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <BarChart
                data={barChartData}
                width={Math.max(screenWidth - 48, 340)}
                height={200}
                yAxisLabel=""
                yAxisSuffix=""
                chartConfig={CHART_CONFIG}
                style={{ borderRadius: 12, marginTop: 8 }}
                fromZero
                showValuesOnTopOfBars
                withInnerLines={false}
              />
            </ScrollView>
          </View>

          {/* SECTION 4 – Top 5 Ausgaben */}
          {topExpenses.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Grösste Ausgaben</Text>
              {topExpenses.map((expense, idx) => (
                <View
                  key={expense.id}
                  style={[styles.expenseRow, idx === topExpenses.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <View style={styles.expenseRank}>
                    <Text style={styles.expenseRankText}>{idx + 1}</Text>
                  </View>
                  <View style={styles.expenseInfo}>
                    <Text style={styles.expenseDesc} numberOfLines={1}>{expense.description}</Text>
                    <Text style={styles.expenseMeta}>
                      {new Date(expense.date).toLocaleDateString('de-CH')}
                      {(expense.group as any)?.name ? ` · ${(expense.group as any).name}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.expenseAmount}>
                    {expense.currency} {expense.amount.toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* SECTION 5 – Gruppen-Vergleich */}
          {groupStats.length > 1 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Gruppen-Vergleich</Text>
              {groupStats.map((group) => (
                <View key={group.name} style={styles.groupStatRow}>
                  <View style={styles.groupStatHeader}>
                    <Text style={styles.groupStatName} numberOfLines={1}>{group.name}</Text>
                    <Text style={styles.groupStatAmount}>CHF {group.total.toFixed(2)}</Text>
                  </View>
                  <View style={styles.progressBg}>
                    <View style={[styles.progressFill, { width: `${group.percentage}%` }]} />
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8FF' },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },

  // Period picker
  periodRow: { flexDirection: 'row', backgroundColor: '#EDEDFF', borderRadius: 12, padding: 3 },
  periodBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  periodBtnActive: {
    backgroundColor: '#6C63FF',
    shadowColor: '#6C63FF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  periodBtnText: { fontSize: 12, fontWeight: '600', color: '#888' },
  periodBtnTextActive: { color: '#fff' },

  // Overview cards
  overviewRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  overviewCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  overviewCardMiddle: { borderWidth: 1.5, borderColor: '#F0EEFF' },
  overviewValue: { fontSize: 22, fontWeight: '800', color: '#6C63FF', marginBottom: 4 },
  overviewLabel: { fontSize: 11, color: '#aaa', fontWeight: '600' },

  // Generic card
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 14 },

  // Top 5
  expenseRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: '#F0F0F5',
  },
  expenseRank: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#F0EEFF', justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  expenseRankText: { fontSize: 12, fontWeight: '700', color: '#6C63FF' },
  expenseInfo: { flex: 1 },
  expenseDesc: { fontSize: 14, fontWeight: '500', color: '#1a1a2e' },
  expenseMeta: { fontSize: 12, color: '#aaa', marginTop: 2 },
  expenseAmount: { fontSize: 14, fontWeight: '700', color: '#6C63FF', marginLeft: 8 },

  // Group comparison
  groupStatRow: { marginBottom: 14 },
  groupStatHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  groupStatName: { fontSize: 14, color: '#1a1a2e', fontWeight: '500', flex: 1 },
  groupStatAmount: { fontSize: 13, fontWeight: '700', color: '#555', marginLeft: 8 },
  progressBg: { height: 8, backgroundColor: '#F0EEFF', borderRadius: 4 },
  progressFill: { height: 8, backgroundColor: '#6C63FF', borderRadius: 4 },
});
