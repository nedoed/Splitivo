import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LineChart } from 'react-native-chart-kit';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import EmptyState from '../components/EmptyState';
import { CATEGORIES } from '../types';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

const { width: screenWidth } = Dimensions.get('window');

const CATEGORY_COLORS = ['#6C63FF', '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#FF9F40', '#9B59B6', '#2ECC71'];

type Period = 'thisMonth' | 'lastMonth' | 'thisYear';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'thisMonth', label: 'Dieser Monat' },
  { key: 'lastMonth', label: 'Letzter Monat' },
  { key: 'thisYear',  label: 'Dieses Jahr'  },
];

const getCategoryLabel = (value: string) =>
  CATEGORIES.find((c) => c.value === value)?.label ?? value;

const getDateRange = (period: Period): { start: Date; end: Date | null } => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'thisMonth': return { start: new Date(y, m, 1),     end: null };
    case 'lastMonth': return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
    case 'thisYear':  return { start: new Date(y, 0, 1),     end: null };
  }
};

const getPrevRange = (period: Period): { start: Date; end: Date } => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'thisMonth': return { start: new Date(y, m - 1, 1),     end: new Date(y, m, 1) };
    case 'lastMonth': return { start: new Date(y, m - 2, 1),     end: new Date(y, m - 1, 1) };
    case 'thisYear':  return { start: new Date(y - 1, 0, 1),     end: new Date(y, 0, 1) };
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
}

interface CategoryStat {
  name: string;
  amount: number;
  color: string;
  pct: number;
}

interface CurrencyStats {
  total: number;
  count: number;
  categories: CategoryStat[];
  topExpenses: Expense[];
  maxExpense: Expense | null;
  avgPerExpense: number;
}

// Schulden pro Währung pro Mitglied
interface MemberDebt {
  userId: string;
  username: string;
  owesMe: number;   // Summe über alle Währungen (für Sortierung)
  iOwe: number;     // Summe über alle Währungen (für Sortierung)
  byCurrency: Record<string, { owesMe: number; iOwe: number }>;
}

interface GroupStat {
  name: string;
  total: number;
  count: number;
  percentage: number;
  byCurrency: Record<string, number>;
}

export default function StatsScreen() {
  const [period, setPeriod] = useState<Period>('thisMonth');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('all');

  const [currencies, setCurrencies] = useState<string[]>([]);
  const [statsByCurrency, setStatsByCurrency] = useState<Record<string, CurrencyStats>>({});

  const [totalPaid, setTotalPaid] = useState(0);
  const [totalDebt, setTotalDebt] = useState(0);
  const [totalOwed, setTotalOwed] = useState(0);
  // Schulden-Übersicht pro Währung
  const [owedByCurrency, setOwedByCurrency] = useState<Record<string, number>>({});
  const [oweByCurrency, setOweByCurrency] = useState<Record<string, number>>({});

  const [activeGroups, setActiveGroups] = useState(0);
  const [activestGroupName, setActivestGroupName] = useState('');
  const [trend, setTrend] = useState<number | null>(null);
  const [hasData, setHasData] = useState(false);

  const [groupStats, setGroupStats] = useState<GroupStat[]>([]);
  // 6-Monatstrend pro Währung
  const [monthlyDataByCurrency, setMonthlyDataByCurrency] = useState<Record<string, { labels: string[]; values: number[] }>>({});
  const [memberDebts, setMemberDebts] = useState<MemberDebt[]>([]);

  const { theme } = useTheme();
  const styles = getStyles(theme);

  const loadStats = useCallback(async (p: Period) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const userId = userData.user.id;

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
    const { start, end } = getDateRange(p);

    // ── Hauptabfrage: Ausgaben im gewählten Zeitraum ───────────────────────────
    let query = supabase
      .from('expenses')
      .select('id, description, amount, currency, category, date, paid_by, group_id, group:groups!group_id(id, name)')
      .in('group_id', groupIds)
      .gte('date', start.toISOString())
      .order('amount', { ascending: false });
    if (end) query = query.lt('date', end.toISOString());
    const { data: expensesRaw } = await query;
    const exps: Expense[] = (expensesRaw ?? []) as any;

    // ── Vorperiode für Trend ───────────────────────────────────────────────────
    const prevRange = getPrevRange(p);
    const { data: prevRaw } = await supabase
      .from('expenses')
      .select('amount, paid_by')
      .in('group_id', groupIds)
      .gte('date', prevRange.start.toISOString())
      .lt('date', prevRange.end.toISOString());
    const prevPaid = (prevRaw ?? [])
      .filter((e) => e.paid_by === userId)
      .reduce((s, e) => s + e.amount, 0);

    // ── 6-Monatstrend (mit Währung für per-currency Charts) ───────────────────
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);
    const { data: trendRaw } = await supabase
      .from('expenses')
      .select('amount, date, currency')
      .in('group_id', groupIds)
      .eq('paid_by', userId)
      .gte('date', sixMonthsAgo.toISOString());

    // ── Was ich schulde (mit Währung) ─────────────────────────────────────────
    const { data: othersExpenses } = await supabase
      .from('expenses')
      .select('id')
      .in('group_id', groupIds)
      .neq('paid_by', userId);

    let debtTotal = 0;
    const iOweArr: { amount: number; currency: string }[] = [];
    if (othersExpenses && othersExpenses.length > 0) {
      const { data: mySplits } = await supabase
        .from('expense_splits')
        .select('amount, expense:expenses!expense_id(currency)')
        .in('expense_id', othersExpenses.map((e) => e.id))
        .eq('user_id', userId)
        .eq('is_settled', false);
      (mySplits ?? []).forEach((s: any) => {
        debtTotal += s.amount;
        iOweArr.push({ amount: s.amount, currency: (s.expense as any)?.currency ?? 'CHF' });
      });
    }

    // ── Was andere mir schulden (mit Währung) ─────────────────────────────────
    const { data: myExpenseIds } = await supabase
      .from('expenses')
      .select('id')
      .in('group_id', groupIds)
      .eq('paid_by', userId);

    let owedTotal = 0;
    const owedSplitsArr: { user_id: string; amount: number; currency: string }[] = [];
    if (myExpenseIds && myExpenseIds.length > 0) {
      const { data: owedSplits } = await supabase
        .from('expense_splits')
        .select('user_id, amount, expense:expenses!expense_id(currency)')
        .in('expense_id', myExpenseIds.map((e) => e.id))
        .neq('user_id', userId)
        .eq('is_settled', false);
      (owedSplits ?? []).forEach((s: any) => {
        owedTotal += s.amount;
        owedSplitsArr.push({
          user_id: s.user_id,
          amount: s.amount,
          currency: (s.expense as any)?.currency ?? 'CHF',
        });
      });
    }

    // ── Meine Splits mit Zahler-Info + Währung (für Schulden pro Mitglied) ────
    const { data: mySplitsWithPayer } = await supabase
      .from('expense_splits')
      .select('amount, expense:expenses!expense_id(paid_by, group_id, currency)')
      .eq('user_id', userId)
      .eq('is_settled', false);

    const relevantOwesSplits = (mySplitsWithPayer ?? []).filter(
      (s: any) => groupIds.includes(s.expense?.group_id) && s.expense?.paid_by !== userId
    );

    // ── Schulden pro Währung (für Overview-Card) ──────────────────────────────
    const newOwedByCur: Record<string, number> = {};
    owedSplitsArr.forEach((s) => {
      newOwedByCur[s.currency] = (newOwedByCur[s.currency] ?? 0) + s.amount;
    });

    const newOweByCur: Record<string, number> = {};
    iOweArr.forEach((s) => {
      newOweByCur[s.currency] = (newOweByCur[s.currency] ?? 0) + s.amount;
    });

    // ── Profile für Schulden-Heatmap laden ────────────────────────────────────
    const debtUserIds = new Set<string>([
      ...owedSplitsArr.map((s) => s.user_id),
      ...relevantOwesSplits.map((s: any) => s.expense?.paid_by).filter(Boolean),
    ]);
    debtUserIds.delete(userId);

    const { data: debtProfiles } = debtUserIds.size > 0
      ? await supabase.from('profiles').select('id, username').in('id', [...debtUserIds])
      : { data: [] };

    const profileMap: Record<string, string> = {};
    (debtProfiles ?? []).forEach((p: any) => { profileMap[p.id] = p.username ?? '?'; });

    // ── Schulden-Heatmap pro Mitglied und Währung ─────────────────────────────
    const debtMap: Record<string, MemberDebt> = {};

    owedSplitsArr.forEach((s) => {
      if (!debtMap[s.user_id])
        debtMap[s.user_id] = { userId: s.user_id, username: profileMap[s.user_id] ?? '?', owesMe: 0, iOwe: 0, byCurrency: {} };
      debtMap[s.user_id].owesMe += s.amount;
      if (!debtMap[s.user_id].byCurrency[s.currency])
        debtMap[s.user_id].byCurrency[s.currency] = { owesMe: 0, iOwe: 0 };
      debtMap[s.user_id].byCurrency[s.currency].owesMe += s.amount;
    });

    relevantOwesSplits.forEach((s: any) => {
      const pid = s.expense?.paid_by;
      const cur = s.expense?.currency ?? 'CHF';
      if (!pid) return;
      if (!debtMap[pid])
        debtMap[pid] = { userId: pid, username: profileMap[pid] ?? '?', owesMe: 0, iOwe: 0, byCurrency: {} };
      debtMap[pid].iOwe += s.amount;
      if (!debtMap[pid].byCurrency[cur])
        debtMap[pid].byCurrency[cur] = { owesMe: 0, iOwe: 0 };
      debtMap[pid].byCurrency[cur].iOwe += s.amount;
    });

    const memberDebtsArr = Object.values(debtMap)
      .filter((m) => m.owesMe > 0.005 || m.iOwe > 0.005)
      .sort((a, b) => (b.owesMe - b.iOwe) - (a.owesMe - a.iOwe));

    // ── Stats pro Währung ──────────────────────────────────────────────────────
    const myExps = exps.filter((e) => e.paid_by === userId);
    const byCur: Record<string, Expense[]> = {};
    myExps.forEach((e) => {
      const cur = e.currency ?? 'CHF';
      if (!byCur[cur]) byCur[cur] = [];
      byCur[cur].push(e);
    });

    const newStats: Record<string, CurrencyStats> = {};
    Object.entries(byCur).forEach(([cur, curExps]) => {
      const total = curExps.reduce((s, e) => s + e.amount, 0);
      const count = curExps.length;

      const byCat: Record<string, number> = {};
      curExps.forEach((e) => {
        const label = getCategoryLabel(e.category);
        byCat[label] = (byCat[label] ?? 0) + e.amount;
      });
      const categories: CategoryStat[] = Object.entries(byCat)
        .sort(([, a], [, b]) => b - a)
        .map(([name, amount], i) => ({
          name,
          amount: parseFloat(amount.toFixed(2)),
          color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
          pct: total > 0 ? Math.round((amount / total) * 100) : 0,
        }));

      const topExpenses = [...curExps].sort((a, b) => b.amount - a.amount).slice(0, 5);

      newStats[cur] = {
        total: parseFloat(total.toFixed(2)),
        count,
        categories,
        topExpenses,
        maxExpense: topExpenses[0] ?? null,
        avgPerExpense: count > 0 ? parseFloat((total / count).toFixed(2)) : 0,
      };
    });

    // ── Gruppenvergleich ───────────────────────────────────────────────────────
    const byGroup: Record<string, { name: string; total: number; count: number; byCurrency: Record<string, number> }> = {};
    exps.forEach((e) => {
      const gid = e.group_id;
      const gname = (e.group as any)?.name ?? gid;
      const cur = e.currency ?? 'CHF';
      if (!byGroup[gid]) byGroup[gid] = { name: gname, total: 0, count: 0, byCurrency: {} };
      byGroup[gid].total += e.amount;
      byGroup[gid].count += 1;
      byGroup[gid].byCurrency[cur] = (byGroup[gid].byCurrency[cur] ?? 0) + e.amount;
    });
    const groupArr = Object.values(byGroup).sort((a, b) => b.total - a.total);
    const maxGroupTotal = groupArr[0]?.total ?? 1;
    const mostActiveByCount = Object.values(byGroup).sort((a, b) => b.count - a.count)[0];

    // ── 6-Monats-Daten pro Währung ─────────────────────────────────────────────
    const last6 = Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      return { label: d.toLocaleString('de-CH', { month: 'short' }), year: d.getFullYear(), month: d.getMonth() };
    });

    const monthTotalsByCur: Record<string, Record<string, number>> = {};
    (trendRaw ?? []).forEach((e: any) => {
      const cur = e.currency ?? 'CHF';
      if (!monthTotalsByCur[cur]) monthTotalsByCur[cur] = {};
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthTotalsByCur[cur][key] = (monthTotalsByCur[cur][key] ?? 0) + e.amount;
    });

    const newMonthlyData: Record<string, { labels: string[]; values: number[] }> = {};
    Object.entries(monthTotalsByCur).forEach(([cur, totals]) => {
      newMonthlyData[cur] = {
        labels: last6.map((m) => m.label),
        values: last6.map((m) => parseFloat((totals[`${m.year}-${m.month}`] ?? 0).toFixed(2))),
      };
    });
    // Fallback: wenn gar keine Trend-Daten vorhanden, aber Ausgaben existieren
    if (Object.keys(newMonthlyData).length === 0) {
      const fallbackCur = Object.keys(newStats)[0] ?? 'CHF';
      newMonthlyData[fallbackCur] = { labels: last6.map((m) => m.label), values: [0, 0, 0, 0, 0, 0] };
    }

    // ── Trend ─────────────────────────────────────────────────────────────────
    const currentTotal = myExps.reduce((s, e) => s + e.amount, 0);
    const trendPct = prevPaid > 0.01 ? ((currentTotal - prevPaid) / prevPaid) * 100 : null;

    // ── State setzen ──────────────────────────────────────────────────────────
    const currencyList = Object.keys(newStats).sort();
    setCurrencies(currencyList);
    setStatsByCurrency(newStats);
    setTotalPaid(currentTotal);
    setTotalDebt(debtTotal);
    setTotalOwed(owedTotal);
    setOwedByCurrency(newOwedByCur);
    setOweByCurrency(newOweByCur);
    setActiveGroups(new Set(exps.map((e) => e.group_id)).size);
    setActivestGroupName(mostActiveByCount?.name ?? '');
    setTrend(trendPct !== null ? parseFloat(trendPct.toFixed(1)) : null);
    setGroupStats(groupArr.map((g) => ({
      name: g.name,
      total: parseFloat(g.total.toFixed(2)),
      count: g.count,
      percentage: Math.round((g.total / maxGroupTotal) * 100),
      byCurrency: Object.fromEntries(
        Object.entries(g.byCurrency).sort().map(([cur, amt]) => [cur, parseFloat(amt.toFixed(2))])
      ),
    })));
    setMonthlyDataByCurrency(newMonthlyData);
    setMemberDebts(memberDebtsArr);
    setHasData(exps.length > 0);

    setSelectedCurrency((prev) => {
      if (prev === 'all') return 'all';
      return currencyList.includes(prev) ? prev : 'all';
    });

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

  const displayCurrencies = selectedCurrency === 'all' ? currencies : [selectedCurrency];

  // Alle Währungen aus Schulden-Daten (für Schulden-Übersicht)
  const debtCurrencies = [
    ...new Set([...Object.keys(owedByCurrency), ...Object.keys(oweByCurrency)]),
  ].sort();

  const chartConfig = {
    backgroundColor: theme.card,
    backgroundGradientFrom: theme.card,
    backgroundGradientTo: theme.card,
    color: (opacity = 1) => `rgba(139, 132, 255, ${opacity})`,
    labelColor: () => theme.textSecondary,
    propsForLabels: { fontSize: 11 },
    decimalPlaces: 0,
    propsForDots: { r: '4', strokeWidth: '2', stroke: theme.primary },
  };

  const trendLabel =
    period === 'thisMonth' ? 'letzten Monat' :
    period === 'lastMonth' ? 'den Monat davor' : 'letztes Jahr';

  // Welche Charts zeigen? Bei "Alle" alle vorhandenen Währungen, sonst nur die gewählte
  const chartCurrencies = selectedCurrency === 'all'
    ? Object.keys(monthlyDataByCurrency).sort()
    : (monthlyDataByCurrency[selectedCurrency] ? [selectedCurrency] : Object.keys(monthlyDataByCurrency).sort());

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Statistiken</Text>

        {/* Zeitraum-Selector */}
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

        {/* Währungs-Picker */}
        {!loading && currencies.length > 1 && (
          <View style={styles.currencyRow}>
            <TouchableOpacity
              style={[styles.currencyBtn, selectedCurrency === 'all' && styles.currencyBtnActive]}
              onPress={() => setSelectedCurrency('all')}
            >
              <Text style={[styles.currencyBtnText, selectedCurrency === 'all' && styles.currencyBtnTextActive]}>
                Alle
              </Text>
            </TouchableOpacity>
            {currencies.map((cur) => (
              <TouchableOpacity
                key={cur}
                style={[styles.currencyBtn, selectedCurrency === cur && styles.currencyBtnActive]}
                onPress={() => setSelectedCurrency(cur)}
              >
                <Text style={[styles.currencyBtnText, selectedCurrency === cur && styles.currencyBtnTextActive]}>
                  {cur}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
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
              tintColor={theme.primary}
            />
          }
        >
          {/* ── Trend-Banner ─────────────────────────────────────────────────── */}
          {trend !== null && (
            <View style={[styles.trendBanner, { backgroundColor: trend > 0 ? theme.dangerBg : theme.successBg }]}>
              <Text style={[styles.trendText, { color: trend > 0 ? theme.danger : theme.success }]}>
                {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%{' '}
                {trend > 0 ? 'mehr' : 'weniger'} als {trendLabel}
              </Text>
            </View>
          )}

          {/* ── Übersicht-Karten ──────────────────────────────────────────────── */}
          <View style={styles.overviewRow}>
            {/* Ausgaben */}
            <View style={styles.overviewCard}>
              <Text style={styles.overviewValue}>
                {currencies.length > 1
                  ? Object.values(statsByCurrency).reduce((s, cs) => s + cs.count, 0)
                  : totalPaid >= 1000 ? `${(totalPaid / 1000).toFixed(1)}k` : totalPaid.toFixed(0)}
              </Text>
              <Text style={styles.overviewLabel}>Ausgaben</Text>
              {currencies.length > 1 && (
                <Text style={styles.overviewCurrencyHint}>{currencies.join(' · ')}</Text>
              )}
            </View>

            {/* Schulden */}
            <View style={[styles.overviewCard, styles.overviewCardMiddle]}>
              {Object.keys(oweByCurrency).length === 0 ? (
                <>
                  <Text style={[styles.overviewValue, { color: theme.textTertiary }]}>0</Text>
                  <Text style={styles.overviewLabel}>Schulden</Text>
                </>
              ) : (
                <>
                  {Object.entries(oweByCurrency).sort().map(([cur, amount]) => (
                    <Text
                      key={cur}
                      style={[
                        amount > 99 ? styles.overviewValueSm : styles.overviewValue,
                        { color: theme.danger, marginBottom: 1 },
                      ]}
                    >
                      <Text style={styles.overviewInlineCur}>{cur} </Text>
                      {amount.toFixed(0)}
                    </Text>
                  ))}
                  <Text style={styles.overviewLabel}>Schulden</Text>
                </>
              )}
            </View>

            {/* Gruppen */}
            <View style={styles.overviewCard}>
              <Text style={styles.overviewValue}>{activeGroups}</Text>
              <Text style={styles.overviewLabel}>Gruppen</Text>
            </View>
          </View>

          {/* ── Schulden-Übersicht pro Währung ────────────────────────────────── */}
          {(totalOwed > 0.01 || totalDebt > 0.01) && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Schulden Übersicht</Text>
              <View style={styles.debtRow}>
                {/* Du bekommst */}
                <View style={[styles.debtBox, { backgroundColor: theme.successBg }]}>
                  <Text style={styles.debtBoxLabel}>Du bekommst noch</Text>
                  {Object.keys(owedByCurrency).length === 0 ? (
                    <Text style={[styles.debtBoxValue, { color: theme.success }]}>0.00</Text>
                  ) : (
                    Object.entries(owedByCurrency).sort().map(([cur, amt]) => (
                      <View key={cur} style={styles.debtCurrencyRow}>
                        <Text style={[styles.debtCurrencyLabel, { color: theme.success }]}>{cur}</Text>
                        <Text style={[styles.debtCurrencyAmount, { color: theme.success }]}>
                          {amt.toFixed(2)}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
                {/* Du schuldest */}
                <View style={[styles.debtBox, { backgroundColor: theme.dangerBg }]}>
                  <Text style={styles.debtBoxLabel}>Du schuldest noch</Text>
                  {Object.keys(oweByCurrency).length === 0 ? (
                    <Text style={[styles.debtBoxValue, { color: theme.danger }]}>0.00</Text>
                  ) : (
                    Object.entries(oweByCurrency).sort().map(([cur, amt]) => (
                      <View key={cur} style={styles.debtCurrencyRow}>
                        <Text style={[styles.debtCurrencyLabel, { color: theme.danger }]}>{cur}</Text>
                        <Text style={[styles.debtCurrencyAmount, { color: theme.danger }]}>
                          {amt.toFixed(2)}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              </View>
              {/* Netto pro Währung */}
              <View style={[styles.netBox, { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.borderLight }]}>
                <Text style={styles.netLabel}>Netto</Text>
                {debtCurrencies.map((cur) => {
                  const net = (owedByCurrency[cur] ?? 0) - (oweByCurrency[cur] ?? 0);
                  return (
                    <View key={cur} style={styles.debtCurrencyRow}>
                      <Text style={styles.netCurrencyLabel}>{cur}</Text>
                      <Text style={[styles.debtCurrencyAmount, { color: net >= 0 ? theme.success : theme.danger }]}>
                        {net >= 0 ? '+' : ''}{net.toFixed(2)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── Pro-Währung-Bereiche ──────────────────────────────────────────── */}
          {displayCurrencies.map((cur) => {
            const stats = statsByCurrency[cur];
            if (!stats) return null;
            return (
              <View key={cur}>
                {selectedCurrency === 'all' && currencies.length > 1 && (
                  <View style={styles.currencySectionHeader}>
                    <Text style={styles.currencySectionTitle}>{cur} Übersicht</Text>
                    <Text style={styles.currencySectionTotal}>
                      {cur} {stats.total.toFixed(2)}
                    </Text>
                  </View>
                )}

                <View style={styles.quickStatsRow}>
                  <View style={styles.quickStatCard}>
                    <Text style={styles.quickStatValue}>Ø {stats.avgPerExpense.toFixed(2)}</Text>
                    <Text style={styles.quickStatLabel}>Ø {cur} pro Ausgabe</Text>
                  </View>
                  <View style={styles.quickStatCard}>
                    <Text style={styles.quickStatValue}>{stats.count}</Text>
                    <Text style={styles.quickStatLabel}>Ausgaben bezahlt</Text>
                  </View>
                </View>

                {stats.maxExpense && (
                  <View style={styles.maxExpenseCard}>
                    <Text style={styles.maxExpenseIcon}>🏆</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.maxExpenseLabel}>Grösste Ausgabe</Text>
                      <Text style={styles.maxExpenseDesc} numberOfLines={1}>
                        {stats.maxExpense.description}
                      </Text>
                    </View>
                    <Text style={styles.maxExpenseAmount}>
                      {cur} {stats.maxExpense.amount.toFixed(2)}
                    </Text>
                  </View>
                )}

                {stats.categories.length > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Kategorien · {cur}</Text>
                    {stats.categories.map((cat) => (
                      <View key={cat.name} style={styles.catRow}>
                        <View style={styles.catLabelRow}>
                          <View style={[styles.catDot, { backgroundColor: cat.color }]} />
                          <Text style={styles.catName} numberOfLines={1}>{cat.name}</Text>
                          <Text style={styles.catPct}>{cat.pct}%</Text>
                          <Text style={styles.catAmount}>{cur} {cat.amount.toFixed(2)}</Text>
                        </View>
                        <View style={styles.catBarBg}>
                          <View style={[styles.catBarFill, { width: `${Math.max(cat.pct, 2)}%` as any, backgroundColor: cat.color }]} />
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {stats.topExpenses.length > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Grösste Ausgaben · {cur}</Text>
                    {stats.topExpenses.map((expense, idx) => (
                      <View
                        key={expense.id}
                        style={[styles.expenseRow, idx === stats.topExpenses.length - 1 && { borderBottomWidth: 0 }]}
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
                          {cur} {expense.amount.toFixed(2)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          {/* ── 6-Monats-Liniendiagramme pro Währung ─────────────────────────── */}
          {chartCurrencies.map((cur) => {
            const md = monthlyDataByCurrency[cur];
            if (!md) return null;
            const chartData = {
              labels: md.labels,
              datasets: [{
                data: md.values.some((v) => v > 0) ? md.values : [0, 0, 0, 0, 0, 0.01],
                color: (opacity = 1) => `rgba(139, 132, 255, ${opacity})`,
                strokeWidth: 2.5,
              }],
            };
            return (
              <View key={cur} style={styles.card}>
                <Text style={styles.cardTitle}>
                  Ausgaben-Trend · {cur} · 6 Monate
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <LineChart
                    data={chartData}
                    width={Math.max(screenWidth - 48, 340)}
                    height={200}
                    chartConfig={chartConfig}
                    bezier
                    style={{ borderRadius: 12, marginTop: 8 }}
                    withInnerLines={false}
                    withShadow={false}
                  />
                </ScrollView>
              </View>
            );
          })}

          {/* ── Gruppen-Vergleich ─────────────────────────────────────────────── */}
          {groupStats.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Gruppen-Vergleich</Text>
              {activestGroupName !== '' && groupStats.length > 1 && (
                <Text style={styles.activestGroup}>🏆 Aktivste Gruppe: {activestGroupName}</Text>
              )}
              {groupStats.map((group) => (
                <View key={group.name} style={styles.groupStatRow}>
                  <View style={styles.groupStatHeader}>
                    <Text style={styles.groupStatName} numberOfLines={1}>{group.name}</Text>
                    <View style={styles.groupStatRight}>
                      <Text style={styles.groupStatCount}>{group.count} Ausgaben</Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        {Object.entries(group.byCurrency).map(([cur, amt]) => (
                          <Text key={cur} style={styles.groupStatAmount}>
                            {cur} {amt.toFixed(2)}
                          </Text>
                        ))}
                      </View>
                    </View>
                  </View>
                  <View style={styles.progressBg}>
                    <View style={[styles.progressFill, { width: `${group.percentage}%` as any }]} />
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* ── Schulden nach Mitglied (pro Währung) ─────────────────────────── */}
          {memberDebts.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Schulden nach Mitglied</Text>
              {memberDebts.map((m, idx) => {
                const netTotal = m.owesMe - m.iOwe;
                return (
                  <View
                    key={m.userId}
                    style={[styles.memberDebtRow, idx === memberDebts.length - 1 && { borderBottomWidth: 0 }]}
                  >
                    <View style={styles.memberDebtAvatar}>
                      <Text style={styles.memberDebtAvatarText}>
                        {m.username.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberDebtName}>{m.username}</Text>
                      {/* Chips pro Währung */}
                      <View style={styles.memberDebtBars}>
                        {Object.entries(m.byCurrency).sort().map(([cur, vals]) => (
                          <React.Fragment key={cur}>
                            {vals.owesMe > 0.005 && (
                              <View style={[styles.memberDebtChip, { backgroundColor: theme.successBg }]}>
                                <Text style={[styles.memberDebtChipText, { color: theme.success }]}>
                                  +{cur} {vals.owesMe.toFixed(2)}
                                </Text>
                              </View>
                            )}
                            {vals.iOwe > 0.005 && (
                              <View style={[styles.memberDebtChip, { backgroundColor: theme.dangerBg }]}>
                                <Text style={[styles.memberDebtChipText, { color: theme.danger }]}>
                                  -{cur} {vals.iOwe.toFixed(2)}
                                </Text>
                              </View>
                            )}
                          </React.Fragment>
                        ))}
                      </View>
                    </View>
                    <Text style={[styles.memberDebtNet, { color: netTotal >= 0 ? theme.success : theme.danger }]}>
                      {netTotal >= 0 ? '+' : ''}{netTotal.toFixed(2)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
    title: { fontSize: 24, fontWeight: '700', color: theme.text, marginBottom: 14 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 16, paddingTop: 4 },

    periodRow: {
      flexDirection: 'row', backgroundColor: theme.toggleBg, borderRadius: 12, padding: 3, marginBottom: 10,
    },
    periodBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
    periodBtnActive: {
      backgroundColor: theme.primary,
      shadowColor: theme.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
    },
    periodBtnText: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
    periodBtnTextActive: { color: '#fff' },

    currencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    currencyBtn: {
      paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20,
      backgroundColor: theme.card, borderWidth: 1.5, borderColor: theme.border,
    },
    currencyBtnActive: { backgroundColor: theme.primary, borderColor: theme.primary },
    currencyBtnText: { fontSize: 13, fontWeight: '600', color: theme.textSecondary },
    currencyBtnTextActive: { color: '#fff' },

    trendBanner: { borderRadius: 12, padding: 12, marginBottom: 12, alignItems: 'center' },
    trendText: { fontSize: 14, fontWeight: '700' },

    overviewRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    overviewCard: {
      flex: 1, backgroundColor: theme.card, borderRadius: 14, padding: 16, alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    },
    overviewCardMiddle: { borderWidth: 1.5, borderColor: theme.primaryLight },
    overviewValue: { fontSize: 22, fontWeight: '800', color: theme.primary, marginBottom: 4 },
    overviewValueSm: { fontSize: 18, fontWeight: '800', color: theme.primary, marginBottom: 2 },
    overviewLabel: { fontSize: 11, color: theme.textTertiary, fontWeight: '600' },
    overviewInlineCur: { fontSize: 13, fontWeight: '600' },
    overviewCurrencyHint: { fontSize: 10, color: theme.textTertiary, fontWeight: '500', marginTop: 3, letterSpacing: 0.3 },

    // Schulden-Übersicht
    debtRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
    debtBox: { flex: 1, borderRadius: 12, padding: 14 },
    debtBoxLabel: { fontSize: 11, fontWeight: '600', color: theme.textSecondary, marginBottom: 6 },
    debtBoxValue: { fontSize: 20, fontWeight: '800' },
    debtCurrencyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
    debtCurrencyLabel: { fontSize: 13, fontWeight: '600' },
    debtCurrencyAmount: { fontSize: 16, fontWeight: '800' },
    netBox: { borderRadius: 10, padding: 12 },
    netLabel: { fontSize: 12, fontWeight: '600', color: theme.textSecondary, marginBottom: 4 },
    netCurrencyLabel: { fontSize: 13, fontWeight: '600', color: theme.textSecondary },

    card: {
      backgroundColor: theme.card, borderRadius: 16, padding: 18, marginBottom: 12,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1,
    },
    cardTitle: { fontSize: 15, fontWeight: '700', color: theme.text, marginBottom: 14 },

    currencySectionHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 10, marginTop: 6,
    },
    currencySectionTitle: { fontSize: 17, fontWeight: '700', color: theme.text },
    currencySectionTotal: { fontSize: 17, fontWeight: '700', color: theme.primary },

    quickStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    quickStatCard: {
      flex: 1, backgroundColor: theme.card, borderRadius: 12, padding: 14, alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    },
    quickStatValue: { fontSize: 18, fontWeight: '700', color: theme.primary, marginBottom: 2 },
    quickStatLabel: { fontSize: 11, color: theme.textTertiary, textAlign: 'center' },

    maxExpenseCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: theme.card, borderRadius: 12, padding: 14, marginBottom: 12,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    },
    maxExpenseIcon: { fontSize: 22, marginRight: 12 },
    maxExpenseLabel: { fontSize: 11, fontWeight: '600', color: theme.textTertiary, marginBottom: 2 },
    maxExpenseDesc: { fontSize: 14, fontWeight: '600', color: theme.text },
    maxExpenseAmount: { fontSize: 16, fontWeight: '700', color: theme.primary, marginLeft: 8 },

    catRow: { marginBottom: 14 },
    catLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
    catDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8, flexShrink: 0 },
    catName: { flex: 1, fontSize: 13, color: theme.text, fontWeight: '500' },
    catPct: { fontSize: 12, color: theme.textSecondary, fontWeight: '600', marginRight: 8 },
    catAmount: { fontSize: 12, fontWeight: '700', color: theme.primary },
    catBarBg: { height: 7, backgroundColor: theme.progressBg, borderRadius: 4 },
    catBarFill: { height: 7, borderRadius: 4 },

    expenseRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: theme.borderLight,
    },
    expenseRank: {
      width: 26, height: 26, borderRadius: 13,
      backgroundColor: theme.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 10,
    },
    expenseRankText: { fontSize: 12, fontWeight: '700', color: theme.primary },
    expenseInfo: { flex: 1 },
    expenseDesc: { fontSize: 14, fontWeight: '500', color: theme.text },
    expenseMeta: { fontSize: 12, color: theme.textTertiary, marginTop: 2 },
    expenseAmount: { fontSize: 14, fontWeight: '700', color: theme.primary, marginLeft: 8 },

    activestGroup: { fontSize: 13, color: theme.textSecondary, marginBottom: 14, fontStyle: 'italic' },
    groupStatRow: { marginBottom: 14 },
    groupStatHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' },
    groupStatName: { fontSize: 14, color: theme.text, fontWeight: '500', flex: 1 },
    groupStatRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    groupStatCount: { fontSize: 11, color: theme.textTertiary },
    groupStatAmount: { fontSize: 13, fontWeight: '700', color: theme.textSecondary },
    progressBg: { height: 8, backgroundColor: theme.progressBg, borderRadius: 4 },
    progressFill: { height: 8, backgroundColor: theme.primary, borderRadius: 4 },

    memberDebtRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: theme.borderLight,
    },
    memberDebtAvatar: {
      width: 36, height: 36, borderRadius: 18, backgroundColor: theme.primaryLight,
      justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0,
    },
    memberDebtAvatarText: { fontSize: 15, fontWeight: '700', color: theme.primary },
    memberDebtName: { fontSize: 14, fontWeight: '600', color: theme.text, marginBottom: 4 },
    memberDebtBars: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    memberDebtChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
    memberDebtChipText: { fontSize: 11, fontWeight: '700' },
    memberDebtNet: { fontSize: 15, fontWeight: '800', marginLeft: 8, minWidth: 64, textAlign: 'right' },
  });
}
