import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
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

export default function SettleScreen() {
  const [allDebts, setAllDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [simplified, setSimplified] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);
  const [reminderDays, setReminderDays] = useState(7);
  const [paymentModalDebt, setPaymentModalDebt] = useState<Debt | null>(null);

  const { theme } = useTheme();
  const styles = getStyles(theme);

  const simplifiedAllDebts = useMemo(() => simplifyDebts(allDebts), [allDebts]);
  const savings = useMemo(() => countSavings(allDebts, simplifiedAllDebts), [allDebts, simplifiedAllDebts]);

  const activeDebts = simplified ? simplifiedAllDebts : allDebts;
  const myDebts = activeDebts.filter(
    (d) => d.from_user_id === currentUserId || d.to_user_id === currentUserId
  );

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

  useFocusEffect(useCallback(() => { fetchDebts(); }, []));

  const markAsSettled = async (debt: Debt) => {
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

      haptics.success();
      const debtorName = debt.from_profile?.username ?? 'Jemand';
      notifyUser(
        debt.to_user_id,
        'Schuld beglichen ✅',
        `${debtorName} hat ${debt.amount.toFixed(2)} ${debt.currency} als bezahlt markiert.`
      );
    }
    fetchDebts();
  };

  const settleDebt = (debt: Debt) => {
    haptics.warning();
    Alert.alert(
      'Schuld begleichen',
      `Möchtest du ${debt.amount.toFixed(2)} ${debt.currency} an ${debt.to_profile?.username} als bezahlt markieren?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Begleichen', onPress: () => markAsSettled(debt) },
      ]
    );
  };

  const askSettleAfterPayment = (debt: Debt) => {
    setPaymentModalDebt(null);
    setTimeout(() => {
      Alert.alert(
        'Zahlung abgeschlossen?',
        'Möchtest du diese Schuld als beglichen markieren?',
        [
          { text: 'Nein', style: 'cancel' },
          { text: 'Ja, beglichen', onPress: () => markAsSettled(debt) },
        ]
      );
    }, 300);
  };

  const handleTwint = async (debt: Debt) => {
    const opened = await payWithTwint();
    if (opened) askSettleAfterPayment(debt);
  };

  const handlePayPal = async (debt: Debt) => {
    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('paypal_me')
      .eq('id', debt.to_user_id)
      .single();

    await payWithPayPal(debt.amount, debt.currency, recipientProfile?.paypal_me);
    askSettleAfterPayment(debt);
  };

  const handleBank = async (debt: Debt) => {
    const hasIban = await showBankDetails(debt.to_user_id);
    if (hasIban) askSettleAfterPayment(debt);
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Abrechnen</Text>

        {!loading && allDebts.length > 0 && (
          <View style={styles.toggleRow}>
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
      </View>

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
        <FlatList
          data={myDebts}
          keyExtractor={(item, index) => `${item.from_user_id}-${item.to_user_id}-${index}`}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchDebts(); }} tintColor={theme.primary} />
          }
          renderItem={({ item }) => {
            const isDebtor = item.from_user_id === currentUserId;

            if (simplified) {
              return (
                <View style={styles.simplifiedCard}>
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
              <View style={styles.debtCard}>
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
          }}
        />
      )}
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

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setPaymentModalDebt(null)}
            >
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

    overdueBanner: {
      marginHorizontal: 16, marginBottom: 8, paddingVertical: 10, paddingHorizontal: 14,
      backgroundColor: theme.warningBg, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: theme.warning,
      flexDirection: 'row', alignItems: 'center',
    },
    overdueIcon: { fontSize: 16, marginRight: 8 },
    overdueText: { fontSize: 13, color: theme.warningText, fontWeight: '600', flex: 1 },
  });
}
