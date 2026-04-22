import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { notifyUser } from '../lib/notifications';
import { haptics } from '../lib/haptics';
import EmptyState from '../components/EmptyState';
import { simplifyDebts, countSavings } from '../lib/debtSimplification';
import { payWithTwint, payWithPayPal, showBankDetails } from '../lib/payments';
import { Debt } from '../types';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

interface HistoryItem {
  id: string;
  amount: number;
  settled_at: string | null;
  payment_method: string | null;
  user_id: string;
  expense: {
    description: string;
    amount: number;
    currency: string;
    date: string;
    paid_by: string;
    group: { id: string; name: string } | null;
    payer: { username: string; avatar_url: string | null } | null;
  } | null;
  debtor: { username: string; avatar_url: string | null } | null;
}

const PAYMENT_METHOD_ICON: Record<string, string> = {
  TWINT: '💙',
  PayPal: '🔵',
  'Banküberweisung': '🏦',
  Bar: '💵',
  Sonstiges: '✅',
};

export default function SettleScreen() {
  const [allDebts, setAllDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [simplified, setSimplified] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);
  const [reminderDays, setReminderDays] = useState(7);
  const [paymentModalDebt, setPaymentModalDebt] = useState<Debt | null>(null);
  const [activeTab, setActiveTab] = useState<'offen' | 'historie'>('offen');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { theme } = useTheme();
  const styles = getStyles(theme);

  const simplifiedAllDebts = useMemo(() => simplifyDebts(allDebts), [allDebts]);
  const savings = useMemo(() => countSavings(allDebts, simplifiedAllDebts), [allDebts, simplifiedAllDebts]);

  const activeDebts = simplified ? simplifiedAllDebts : allDebts;
  const myDebts = activeDebts.filter(
    (d) => d.from_user_id === currentUserId || d.to_user_id === currentUserId
  );

  // ── Filter computations ────────────────────────────────────────────────────
  const uniqueGroups = useMemo(() => [
    ...new Map(
      history
        .filter((h) => h.expense?.group)
        .map((h) => [h.expense!.group!.id, h.expense!.group!])
    ).values(),
  ], [history]);

  const uniquePersons = useMemo(() => [
    ...new Map(
      history
        .filter((h) => h.expense?.payer && h.expense?.paid_by)
        .map((h) => [h.expense!.paid_by, { id: h.expense!.paid_by, ...h.expense!.payer! }])
    ).values(),
  ], [history]);

  const hasActiveFilters = !!searchQuery || !!selectedGroup || !!selectedPerson;

  const filteredHistory = useMemo(() => history.filter((item) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const desc = item.expense?.description?.toLowerCase() ?? '';
      const payer = item.expense?.payer?.username?.toLowerCase() ?? '';
      if (!desc.includes(q) && !payer.includes(q)) return false;
    }
    if (selectedGroup && item.expense?.group?.id !== selectedGroup) return false;
    if (selectedPerson && item.expense?.paid_by !== selectedPerson) return false;
    return true;
  }), [history, searchQuery, selectedGroup, selectedPerson]);

  // Group filtered history by month
  const groupedHistory = useMemo(() => filteredHistory.reduce((acc, item) => {
    if (!item.settled_at) return acc;
    const date = new Date(item.settled_at);
    const month = date.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
    const existing = acc.find((g) => g.month === month);
    if (existing) {
      existing.items.push(item);
    } else {
      acc.push({ month, items: [item] });
    }
    return acc;
  }, [] as { month: string; items: HistoryItem[] }[]), [filteredHistory]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchDebts = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    setCurrentUserId(user.user.id);

    const { data: memberGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.user.id);

    if (!memberGroups || memberGroups.length === 0) {
      setAllDebts([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const groupIds = memberGroups.map((m) => m.group_id);

    const { data: expenses } = await supabase
      .from('expenses')
      .select('id, paid_by, amount, currency')
      .in('group_id', groupIds);

    if (!expenses) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const expenseIds = expenses.map((e) => e.id);

    const { data: profileData } = await supabase
      .from('profiles')
      .select('reminder_days, reminder_enabled')
      .eq('id', user.user.id)
      .single();

    const configuredDays = profileData?.reminder_days ?? 7;
    setReminderDays(configuredDays);

    const { data: splits } = await supabase
      .from('expense_splits')
      .select('*, expense:expenses!expense_id(paid_by, currency, date)')
      .in('expense_id', expenseIds)
      .eq('is_settled', false);

    if (!splits) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const balances: { [key: string]: number } = {};
    splits.forEach((split: any) => {
      const debtor = split.user_id;
      const creditor = split.expense?.paid_by;
      const cur = split.expense?.currency ?? 'CHF';
      if (!creditor || debtor === creditor) return;
      const key = `${debtor}|${creditor}|${cur}`;
      balances[key] = (balances[key] ?? 0) + split.amount;
    });

    const rawDebts: Debt[] = [];
    Object.entries(balances).forEach(([key, amount]) => {
      const [debtor, creditor, cur] = key.split('|');
      const reverseKey = `${creditor}|${debtor}|${cur}`;
      const netAmount = amount - (balances[reverseKey] ?? 0);
      if (netAmount > 0.01) {
        rawDebts.push({ from_user_id: debtor, to_user_id: creditor, amount: netAmount, currency: cur });
      }
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

    const oldestDateByKey: Record<string, number> = {};
    splits.forEach((split: any) => {
      const debtor = split.user_id;
      const creditor = split.expense?.paid_by;
      const cur = split.expense?.currency ?? 'CHF';
      const dateStr = split.expense?.date;
      if (!creditor || debtor === creditor || !dateStr) return;
      if (debtor !== user.user!.id) return;
      const key = `${debtor}|${creditor}|${cur}`;
      const ts = new Date(dateStr).getTime();
      if (!oldestDateByKey[key] || ts < oldestDateByKey[key]) {
        oldestDateByKey[key] = ts;
      }
    });

    const now = Date.now();
    const overdue = Object.values(oldestDateByKey).filter(
      (ts) => Math.floor((now - ts) / (1000 * 60 * 60 * 24)) >= configuredDays
    ).length;
    setOverdueCount(overdue);

    setAllDebts(rawDebts);
    setLoading(false);
    setRefreshing(false);
  };

  const loadHistory = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    setHistoryLoading(true);
    const { data } = await supabase
      .from('expense_splits')
      .select(`
        id, amount, settled_at, payment_method, user_id,
        expense:expenses!expense_id(
          description, amount, currency, date, paid_by,
          group:groups!group_id(id, name),
          payer:profiles!expenses_paid_by_fkey(username, avatar_url)
        ),
        debtor:profiles!expense_splits_user_id_fkey(username, avatar_url)
      `)
      .eq('user_id', userData.user.id)
      .eq('is_settled', true)
      .not('settled_at', 'is', null)
      .order('settled_at', { ascending: false })
      .limit(50);
    setHistory((data as HistoryItem[] | null) ?? []);
    setHistoryLoading(false);
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchDebts();
    loadHistory();
  }, []));

  // ── Debt actions ───────────────────────────────────────────────────────────
  const markAsSettled = async (debt: Debt, paymentMethod: string) => {
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
        .update({
          is_settled: true,
          settled_at: new Date().toISOString(),
          payment_method: paymentMethod,
        })
        .in('id', toSettle);

      haptics.success();
      const debtorName = debt.from_profile?.username ?? 'Jemand';
      notifyUser(
        debt.to_user_id,
        'Schuld beglichen ✅',
        `${debtorName} hat ${debt.amount.toFixed(2)} ${debt.currency} als bezahlt markiert.`
      );
    }
    fetchDebts();
    loadHistory();
  };

  const settleDebt = (debt: Debt) => {
    haptics.warning();
    Alert.alert(
      'Schuld begleichen',
      `${debt.amount.toFixed(2)} ${debt.currency} an ${debt.to_profile?.username} — Wie wurde bezahlt?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: '💙 TWINT',           onPress: () => markAsSettled(debt, 'TWINT') },
        { text: '🔵 PayPal',          onPress: () => markAsSettled(debt, 'PayPal') },
        { text: '🏦 Banküberweisung', onPress: () => markAsSettled(debt, 'Banküberweisung') },
        { text: '💵 Bar',             onPress: () => markAsSettled(debt, 'Bar') },
        { text: '✅ Sonstiges',       onPress: () => markAsSettled(debt, 'Sonstiges') },
      ]
    );
  };

  const askSettleAfterPayment = (debt: Debt, paymentMethod: string) => {
    setPaymentModalDebt(null);
    setTimeout(() => {
      Alert.alert(
        'Zahlung abgeschlossen?',
        'Möchtest du diese Schuld als beglichen markieren?',
        [
          { text: 'Nein', style: 'cancel' },
          { text: 'Ja, beglichen', onPress: () => markAsSettled(debt, paymentMethod) },
        ]
      );
    }, 300);
  };

  const handleTwint = async (debt: Debt) => {
    const opened = await payWithTwint();
    if (opened) askSettleAfterPayment(debt, 'TWINT');
  };

  const handlePayPal = async (debt: Debt) => {
    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('paypal_me')
      .eq('id', debt.to_user_id)
      .single();
    await payWithPayPal(debt.amount, debt.currency, recipientProfile?.paypal_me);
    askSettleAfterPayment(debt, 'PayPal');
  };

  const handleBank = async (debt: Debt) => {
    const hasIban = await showBankDetails(debt.to_user_id);
    if (hasIban) askSettleAfterPayment(debt, 'Banküberweisung');
  };

  const formatTotals = (ds: Debt[]) => {
    const byCur = ds.reduce((acc, d) => {
      acc[d.currency] = (acc[d.currency] ?? 0) + d.amount;
      return acc;
    }, {} as Record<string, number>);
    const entries = Object.entries(byCur);
    if (entries.length === 0) return '0.00 CHF';
    return entries.map(([c, a]) => `${a.toFixed(2)} ${c}`).join('\n');
  };

  const owedDebts = myDebts.filter((d) => d.from_user_id === currentUserId);
  const owingDebts = myDebts.filter((d) => d.to_user_id === currentUserId);
  const totalOwedLabel = formatTotals(owedDebts);
  const totalOwingLabel = formatTotals(owingDebts);

  const debtsByCurrency = myDebts.reduce((acc, d) => {
    const cur = d.currency || 'CHF';
    if (!acc[cur]) acc[cur] = [];
    acc[cur].push(d);
    return acc;
  }, {} as Record<string, Debt[]>);
  const currencyKeys = Object.keys(debtsByCurrency).sort();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Abrechnen</Text>

        {/* Tab Switcher */}
        <View style={styles.tabSwitcher}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'offen' && styles.tabBtnActive]}
            onPress={() => { haptics.selection(); setActiveTab('offen'); }}
          >
            <Text style={[styles.tabBtnText, activeTab === 'offen' && styles.tabBtnTextActive]}>
              Offen
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'historie' && styles.tabBtnActive]}
            onPress={() => { haptics.selection(); setActiveTab('historie'); }}
          >
            <Text style={[styles.tabBtnText, activeTab === 'historie' && styles.tabBtnTextActive]}>
              Historie
            </Text>
          </TouchableOpacity>
        </View>

        {/* Vereinfachen toggle — only in Offen tab */}
        {activeTab === 'offen' && !loading && allDebts.length > 0 && (
          <View style={[styles.toggleRow, { marginTop: 10 }]}>
            <TouchableOpacity
              style={[styles.toggleBtn, !simplified && styles.toggleBtnActive]}
              onPress={() => { haptics.selection(); setSimplified(false); }}
            >
              <Text style={[styles.toggleBtnText, !simplified && styles.toggleBtnTextActive]}>
                Alle Schulden
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, simplified && styles.toggleBtnActive]}
              onPress={() => { haptics.selection(); setSimplified(true); }}
            >
              <Text style={[styles.toggleBtnText, simplified && styles.toggleBtnTextActive]}>
                ✨ Vereinfacht
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Filter button — only in Historie tab */}
        {activeTab === 'historie' && (
          <View style={styles.historyHeaderRow}>
            <TouchableOpacity
              style={[styles.filterBtn, hasActiveFilters && styles.filterBtnActive]}
              onPress={() => { haptics.selection(); setShowFilters((v) => !v); }}
            >
              <Text style={styles.filterBtnIcon}>🔍</Text>
              <Text style={[styles.filterBtnText, hasActiveFilters && styles.filterBtnTextActive]}>
                Filter{hasActiveFilters ? ' ●' : ''}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── OFFEN TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'offen' && (
        <>
          {simplified && savings > 0 && (
            <View style={styles.savingsBanner}>
              <Text style={styles.savingsText}>
                Statt {allDebts.length} Zahlungen nur {simplifiedAllDebts.length}! Du sparst {savings} {savings === 1 ? 'Transaktion' : 'Transaktionen'}.
              </Text>
            </View>
          )}

          {!loading && overdueCount > 0 && (
            <View style={styles.overdueBanner}>
              <Text style={styles.overdueIcon}>⚠️</Text>
              <Text style={styles.overdueText}>
                {overdueCount === 1
                  ? `1 Schuld ist seit über ${reminderDays} Tagen offen`
                  : `${overdueCount} Schulden sind seit über ${reminderDays} Tagen offen`}
              </Text>
            </View>
          )}

          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, styles.cardRed]}>
              <Text style={styles.summaryLabel}>Du schuldest</Text>
              <Text style={[styles.summaryAmount, styles.amountRed]}>{totalOwedLabel}</Text>
            </View>
            <View style={[styles.summaryCard, styles.cardGreen]}>
              <Text style={styles.summaryLabel}>Dir schuldet man</Text>
              <Text style={[styles.summaryAmount, styles.amountGreen]}>{totalOwingLabel}</Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : myDebts.length === 0 ? (
            <EmptyState
              emoji="🎉"
              title="Alles beglichen!"
              subtitle={"Du hast keine offenen Schulden\nund niemand schuldet dir etwas"}
            />
          ) : (
            <ScrollView
              contentContainerStyle={styles.list}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => { setRefreshing(true); fetchDebts(); }}
                  tintColor={theme.primary}
                />
              }
            >
              {currencyKeys.map((currency) => (
                <View key={currency}>
                  {currencyKeys.length > 1 && (
                    <View style={styles.currencyHeader}>
                      <Text style={styles.currencyHeaderText}>{currency}</Text>
                    </View>
                  )}
                  {debtsByCurrency[currency].map((item, index) => {
                    const isDebtor = item.from_user_id === currentUserId;

                    if (simplified) {
                      return (
                        <View key={`${item.from_user_id}-${item.to_user_id}-${index}`} style={styles.simplifiedCard}>
                          <View style={styles.simplifiedFlow}>
                            <View style={styles.simplifiedPerson}>
                              <View style={[styles.simplifiedAvatar, isDebtor ? styles.avatarRed : styles.avatarGreen]}>
                                <Text style={styles.simplifiedAvatarText}>
                                  {(item.from_profile?.username ?? '?')[0].toUpperCase()}
                                </Text>
                              </View>
                              <Text style={styles.simplifiedPersonName} numberOfLines={1}>
                                {item.from_profile?.username ?? '?'}
                              </Text>
                            </View>
                            <View style={styles.simplifiedArrowContainer}>
                              <Text style={[styles.simplifiedAmount, isDebtor ? styles.amountRed : styles.amountGreen]}>
                                {item.amount.toFixed(2)} {item.currency}
                              </Text>
                              <Text style={styles.simplifiedArrow}>→</Text>
                            </View>
                            <View style={styles.simplifiedPerson}>
                              <View style={[styles.simplifiedAvatar, isDebtor ? styles.avatarGreen : styles.avatarRed]}>
                                <Text style={styles.simplifiedAvatarText}>
                                  {(item.to_profile?.username ?? '?')[0].toUpperCase()}
                                </Text>
                              </View>
                              <Text style={styles.simplifiedPersonName} numberOfLines={1}>
                                {item.to_profile?.username ?? '?'}
                              </Text>
                            </View>
                          </View>
                          {isDebtor && (
                            <TouchableOpacity style={styles.payBtn} onPress={() => setPaymentModalDebt(item)}>
                              <Text style={styles.payBtnText}>Jetzt bezahlen</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    }

                    return (
                      <View key={`${item.from_user_id}-${item.to_user_id}-${index}`} style={styles.debtCard}>
                        <View style={styles.debtInfo}>
                          <View style={[styles.debtBadge, isDebtor ? styles.debtBadgeRed : styles.debtBadgeGreen]}>
                            <Text style={styles.debtBadgeText}>{isDebtor ? 'Ich schulde' : 'Bekomme'}</Text>
                          </View>
                          <Text style={styles.debtPerson}>
                            {isDebtor ? item.to_profile?.username : item.from_profile?.username}
                          </Text>
                          <Text style={[styles.debtAmount, isDebtor ? styles.amountRed : styles.amountGreen]}>
                            {item.amount.toFixed(2)} {item.currency}
                          </Text>
                        </View>
                        {isDebtor && (
                          <View style={styles.debtActions}>
                            <TouchableOpacity style={styles.payBtn} onPress={() => setPaymentModalDebt(item)}>
                              <Text style={styles.payBtnText}>Jetzt bezahlen</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.settleBtn} onPress={() => settleDebt(item)}>
                              <Text style={styles.settleBtnText}>Als beglichen markieren</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}

      {/* ── HISTORIE TAB ────────────────────────────────────────────────────── */}
      {activeTab === 'historie' && (
        historyLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.historyList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => { setRefreshing(true); await loadHistory(); setRefreshing(false); }}
                tintColor={theme.primary}
              />
            }
          >
            {/* Filter Panel */}
            {showFilters && (
              <View style={styles.filterPanel}>
                <TextInput
                  placeholder="Suche nach Ausgabe oder Person..."
                  placeholderTextColor={theme.textSecondary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  style={styles.filterInput}
                  clearButtonMode="while-editing"
                />

                {uniqueGroups.length > 0 && (
                  <>
                    <Text style={styles.filterSectionLabel}>Gruppe</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterChipRow}>
                      <TouchableOpacity
                        style={[styles.filterChip, selectedGroup === null && styles.filterChipActive]}
                        onPress={() => setSelectedGroup(null)}
                      >
                        <Text style={[styles.filterChipText, selectedGroup === null && styles.filterChipTextActive]}>
                          Alle
                        </Text>
                      </TouchableOpacity>
                      {uniqueGroups.map((group) => (
                        <TouchableOpacity
                          key={group.id}
                          style={[styles.filterChip, selectedGroup === group.id && styles.filterChipActive]}
                          onPress={() => setSelectedGroup(selectedGroup === group.id ? null : group.id)}
                        >
                          <Text style={[styles.filterChipText, selectedGroup === group.id && styles.filterChipTextActive]}>
                            {group.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                {uniquePersons.length > 0 && (
                  <>
                    <Text style={styles.filterSectionLabel}>Gläubiger</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterChipRow}>
                      <TouchableOpacity
                        style={[styles.filterChip, selectedPerson === null && styles.filterChipActive]}
                        onPress={() => setSelectedPerson(null)}
                      >
                        <Text style={[styles.filterChipText, selectedPerson === null && styles.filterChipTextActive]}>
                          Alle
                        </Text>
                      </TouchableOpacity>
                      {uniquePersons.map((person) => (
                        <TouchableOpacity
                          key={person.id}
                          style={[styles.filterChip, selectedPerson === person.id && styles.filterChipActive]}
                          onPress={() => setSelectedPerson(selectedPerson === person.id ? null : person.id)}
                        >
                          <View style={styles.filterPersonChipInner}>
                            <View style={styles.filterPersonAvatar}>
                              <Text style={styles.filterPersonAvatarText}>
                                {person.username?.[0]?.toUpperCase() ?? '?'}
                              </Text>
                            </View>
                            <Text style={[styles.filterChipText, selectedPerson === person.id && styles.filterChipTextActive]}>
                              {person.username}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                {hasActiveFilters && (
                  <TouchableOpacity
                    style={styles.filterResetBtn}
                    onPress={() => { setSearchQuery(''); setSelectedGroup(null); setSelectedPerson(null); }}
                  >
                    <Text style={styles.filterResetText}>Filter zurücksetzen</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* History content */}
            {groupedHistory.length === 0 ? (
              hasActiveFilters ? (
                <EmptyState
                  emoji="🔍"
                  title="Keine Einträge gefunden"
                  subtitle="Versuche andere Filterkriterien"
                />
              ) : (
                <EmptyState
                  emoji="📋"
                  title="Noch keine Historie"
                  subtitle="Beglichene Schulden erscheinen hier"
                />
              )
            ) : (
              groupedHistory.map(({ month, items }) => {
                const monthTotal = items.reduce((acc, item) => {
                  const cur = item.expense?.currency ?? 'CHF';
                  acc[cur] = (acc[cur] ?? 0) + item.amount;
                  return acc;
                }, {} as Record<string, number>);

                return (
                  <View key={month}>
                    <View style={styles.monthHeader}>
                      <Text style={styles.monthLabel}>{month}</Text>
                      <View style={styles.monthTotals}>
                        {Object.entries(monthTotal).map(([cur, total]) => (
                          <Text key={cur} style={styles.monthTotal}>
                            {total.toFixed(2)} {cur}
                          </Text>
                        ))}
                      </View>
                    </View>

                    {items.map((item) => {
                      const icon = PAYMENT_METHOD_ICON[item.payment_method ?? ''] ?? '✅';
                      const settledDate = item.settled_at
                        ? new Date(item.settled_at).toLocaleDateString('de-CH', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })
                        : '';
                      const debtorInitial = item.debtor?.username?.[0]?.toUpperCase() ?? '?';
                      const payerInitial = item.expense?.payer?.username?.[0]?.toUpperCase() ?? '?';
                      const debtorName = item.debtor?.username ?? '–';
                      const payerName = item.expense?.payer?.username ?? '–';
                      const groupName = item.expense?.group?.name ?? '';

                      return (
                        <View key={item.id} style={styles.historyCard}>
                          <View style={styles.historyIcon}>
                            <Text style={{ fontSize: 22 }}>{icon}</Text>
                          </View>
                          <View style={styles.historyInfo}>
                            <Text style={styles.historyDesc} numberOfLines={1}>
                              {item.expense?.description ?? '–'}
                            </Text>
                            <Text style={styles.historyMeta}>
                              {groupName ? `${groupName} · ` : ''}{item.payment_method ?? 'Sonstiges'}
                            </Text>
                            {/* Debtor → Payer mini row */}
                            <View style={styles.historyFlow}>
                              <View style={styles.historyMiniAvatar}>
                                <Text style={styles.historyMiniAvatarText}>{debtorInitial}</Text>
                              </View>
                              <Text style={styles.historyArrow}>→</Text>
                              <View style={[styles.historyMiniAvatar, styles.historyMiniAvatarGreen]}>
                                <Text style={styles.historyMiniAvatarText}>{payerInitial}</Text>
                              </View>
                              <Text style={styles.historyFlowNames}>
                                {debtorName} → {payerName}
                              </Text>
                            </View>
                            <Text style={styles.historyDate}>{settledDate}</Text>
                          </View>
                          <Text style={styles.historyAmount}>
                            {item.amount.toFixed(2)} {item.expense?.currency ?? 'CHF'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })
            )}
            <View style={{ height: 24 }} />
          </ScrollView>
        )
      )}

      {/* ── Zahlungs-Modal ──────────────────────────────────────────────────── */}
      {paymentModalDebt && (
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Jetzt bezahlen</Text>
            <Text style={styles.modalSubtitle}>
              {paymentModalDebt.amount.toFixed(2)} {paymentModalDebt.currency} an{' '}
              <Text style={{ fontWeight: '700' }}>{paymentModalDebt.to_profile?.username}</Text>
            </Text>

            <TouchableOpacity style={styles.payOption} onPress={() => handleTwint(paymentModalDebt)}>
              <View style={[styles.payOptionIcon, { backgroundColor: '#E8F4FD' }]}>
                <Text style={styles.payOptionEmoji}>💙</Text>
              </View>
              <View style={styles.payOptionText}>
                <Text style={styles.payOptionName}>TWINT</Text>
                <Text style={styles.payOptionDesc}>App direkt öffnen</Text>
              </View>
              <Text style={styles.payOptionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.payOption} onPress={() => handlePayPal(paymentModalDebt)}>
              <View style={[styles.payOptionIcon, { backgroundColor: '#E8F0FE' }]}>
                <Text style={styles.payOptionEmoji}>🔵</Text>
              </View>
              <View style={styles.payOptionText}>
                <Text style={styles.payOptionName}>PayPal</Text>
                <Text style={styles.payOptionDesc}>
                  {paymentModalDebt.to_profile ? 'Via paypal.me-Link' : 'App öffnen'}
                </Text>
              </View>
              <Text style={styles.payOptionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.payOption} onPress={() => handleBank(paymentModalDebt)}>
              <View style={[styles.payOptionIcon, { backgroundColor: '#F0F4FF' }]}>
                <Text style={styles.payOptionEmoji}>🏦</Text>
              </View>
              <View style={styles.payOptionText}>
                <Text style={styles.payOptionName}>Banküberweisung</Text>
                <Text style={styles.payOptionDesc}>IBAN anzeigen & kopieren</Text>
              </View>
              <Text style={styles.payOptionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setPaymentModalDebt(null)}>
              <Text style={styles.modalCancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: { padding: 20, paddingTop: 10, paddingBottom: 12 },
    title: { fontSize: 24, fontWeight: '700', color: theme.text, marginBottom: 12 },

    tabSwitcher: { flexDirection: 'row', backgroundColor: theme.inputBg, borderRadius: 12, padding: 4 },
    tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
    tabBtnActive: {
      backgroundColor: theme.primary,
      shadowColor: theme.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
    },
    tabBtnText: { fontSize: 14, fontWeight: '600', color: theme.textSecondary },
    tabBtnTextActive: { color: '#fff' },

    historyHeaderRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
    filterBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
      backgroundColor: theme.inputBg,
    },
    filterBtnActive: { backgroundColor: theme.primary },
    filterBtnIcon: { fontSize: 14 },
    filterBtnText: { fontSize: 13, fontWeight: '600', color: theme.textSecondary },
    filterBtnTextActive: { color: '#fff' },

    toggleRow: { flexDirection: 'row', backgroundColor: theme.toggleBg, borderRadius: 12, padding: 3 },
    toggleBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
    toggleBtnActive: { backgroundColor: theme.primary, shadowColor: theme.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
    toggleBtnText: { fontSize: 13, fontWeight: '600', color: theme.textSecondary },
    toggleBtnTextActive: { color: '#fff' },

    savingsBanner: {
      marginHorizontal: 16, marginBottom: 8, paddingVertical: 10, paddingHorizontal: 14,
      backgroundColor: theme.savingsBg, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: theme.primary,
    },
    savingsText: { fontSize: 13, color: theme.savingsText, fontWeight: '600' },

    summaryRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 8 },
    summaryCard: { flex: 1, borderRadius: 12, padding: 16 },
    cardRed: { backgroundColor: theme.debtRedBg },
    cardGreen: { backgroundColor: theme.debtGreenBg },
    summaryLabel: { fontSize: 12, color: theme.textSecondary, marginBottom: 4 },
    summaryAmount: { fontSize: 22, fontWeight: '700' },
    amountRed: { color: theme.danger },
    amountGreen: { color: theme.success },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { padding: 16 },

    debtCard: {
      backgroundColor: theme.card, borderRadius: 12, padding: 16, marginBottom: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    },
    debtInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    debtBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginRight: 10 },
    debtBadgeRed: { backgroundColor: theme.debtRedAvatar },
    debtBadgeGreen: { backgroundColor: theme.debtGreenAvatar },
    debtBadgeText: { fontSize: 11, fontWeight: '600', color: theme.badgeText },
    debtPerson: { flex: 1, fontSize: 16, fontWeight: '600', color: theme.text },
    debtAmount: { fontSize: 18, fontWeight: '700' },

    simplifiedCard: {
      backgroundColor: theme.card, borderRadius: 14, padding: 16, marginBottom: 10,
      shadowColor: theme.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
    },
    simplifiedFlow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    simplifiedPerson: { alignItems: 'center', width: 72 },
    simplifiedAvatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
    avatarRed: { backgroundColor: theme.debtRedAvatar },
    avatarGreen: { backgroundColor: theme.debtGreenAvatar },
    simplifiedAvatarText: { fontSize: 18, fontWeight: '700', color: theme.text },
    simplifiedPersonName: { fontSize: 12, fontWeight: '600', color: theme.textSecondary, textAlign: 'center' },
    simplifiedArrowContainer: { flex: 1, alignItems: 'center' },
    simplifiedAmount: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
    simplifiedArrow: { fontSize: 22, color: theme.primary, fontWeight: '700' },

    debtActions: { gap: 8 },
    payBtn: { backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    payBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    settleBtn: { borderWidth: 1.5, borderColor: theme.border, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
    settleBtnText: { color: theme.textSecondary, fontWeight: '600', fontSize: 13 },

    modalBackdrop: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: theme.overlay, justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 24, paddingBottom: 36,
    },
    modalHandle: {
      width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border,
      alignSelf: 'center', marginBottom: 20,
    },
    modalTitle: { fontSize: 20, fontWeight: '700', color: theme.text, marginBottom: 4 },
    modalSubtitle: { fontSize: 14, color: theme.textSecondary, marginBottom: 20 },
    payOption: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: theme.borderLight,
    },
    payOptionIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    payOptionEmoji: { fontSize: 22 },
    payOptionText: { flex: 1 },
    payOptionName: { fontSize: 16, fontWeight: '600', color: theme.text },
    payOptionDesc: { fontSize: 12, color: theme.textTertiary, marginTop: 2 },
    payOptionArrow: { fontSize: 22, color: theme.border },
    modalCancelBtn: { marginTop: 16, alignItems: 'center', paddingVertical: 14 },
    modalCancelText: { color: theme.textSecondary, fontSize: 16, fontWeight: '600' },

    currencyHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: 4 },
    currencyHeaderText: {
      fontSize: 11, fontWeight: '700', color: theme.textTertiary, letterSpacing: 1.2,
      textTransform: 'uppercase', paddingHorizontal: 10, paddingVertical: 4,
      backgroundColor: theme.borderLight, borderRadius: 6, overflow: 'hidden',
    },

    overdueBanner: {
      marginHorizontal: 16, marginBottom: 8, paddingVertical: 10, paddingHorizontal: 14,
      backgroundColor: theme.warningBg, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: theme.warning,
      flexDirection: 'row', alignItems: 'center',
    },
    overdueIcon: { fontSize: 16, marginRight: 8 },
    overdueText: { fontSize: 13, color: theme.warningText, fontWeight: '600', flex: 1 },

    // Filter panel
    filterPanel: {
      backgroundColor: theme.card, borderRadius: 14, padding: 14,
      marginBottom: 12, gap: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    },
    filterInput: {
      backgroundColor: theme.inputBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
      color: theme.text, fontSize: 14,
    },
    filterSectionLabel: { fontSize: 11, fontWeight: '700', color: theme.textTertiary, letterSpacing: 0.8, textTransform: 'uppercase' },
    filterChipRow: { flexGrow: 0 },
    filterChip: {
      paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
      backgroundColor: theme.inputBg, marginRight: 8,
    },
    filterChipActive: { backgroundColor: theme.primary },
    filterChipText: { fontSize: 13, fontWeight: '500', color: theme.textSecondary },
    filterChipTextActive: { color: '#fff' },
    filterPersonChipInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    filterPersonAvatar: {
      width: 20, height: 20, borderRadius: 10,
      backgroundColor: theme.primaryLight, justifyContent: 'center', alignItems: 'center',
    },
    filterPersonAvatarText: { fontSize: 10, fontWeight: '700', color: theme.primary },
    filterResetBtn: { alignItems: 'center', paddingVertical: 4 },
    filterResetText: { fontSize: 13, color: theme.danger, fontWeight: '600' },

    // Historie list
    historyList: { paddingTop: 8, paddingHorizontal: 16 },
    monthHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginTop: 16, marginBottom: 10,
    },
    monthLabel: { fontSize: 13, fontWeight: '700', color: theme.textSecondary },
    monthTotals: { alignItems: 'flex-end' },
    monthTotal: { fontSize: 12, fontWeight: '600', color: theme.success },
    historyCard: {
      backgroundColor: theme.card, borderRadius: 12, padding: 14, marginBottom: 8,
      flexDirection: 'row', alignItems: 'flex-start', gap: 12,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
    },
    historyIcon: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: theme.successBg, justifyContent: 'center', alignItems: 'center', flexShrink: 0,
    },
    historyInfo: { flex: 1 },
    historyDesc: { fontSize: 15, fontWeight: '600', color: theme.text },
    historyMeta: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
    historyFlow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
    historyMiniAvatar: {
      width: 20, height: 20, borderRadius: 10,
      backgroundColor: theme.primaryLight, justifyContent: 'center', alignItems: 'center',
    },
    historyMiniAvatarGreen: { backgroundColor: theme.debtGreenAvatar },
    historyMiniAvatarText: { fontSize: 10, fontWeight: '700', color: theme.primary },
    historyArrow: { fontSize: 11, color: theme.textTertiary },
    historyFlowNames: { fontSize: 11, color: theme.textSecondary },
    historyDate: { fontSize: 11, color: theme.textTertiary, marginTop: 3 },
    historyAmount: { fontSize: 15, fontWeight: '700', color: theme.success, flexShrink: 0, marginTop: 2 },
  });
}
