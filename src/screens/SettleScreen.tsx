import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { notifyUser } from '../lib/notifications';
import { haptics } from '../lib/haptics';
import { payWithTwint, payWithWero, payWithPayPal, showBankDetails } from '../lib/payments';
import EmptyState from '../components/EmptyState';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SplitItem {
  id: string;
  amount: number;
  user_id: string;
  expenses: {
    id: string;
    description: string;
    currency: string;
    paid_by: string;
    group_id: string;
    groups: { id: string; name: string } | null;
    payer: { id: string; username: string } | null;
  } | null;
  debtor: { id: string; username: string } | null;
}

interface DebtEntry {
  payerId: string;
  payerName: string;
  currency: string;
  splits: SplitItem[];
}

interface CreditEntry {
  debtorId: string;
  debtorName: string;
  currency: string;
  splits: SplitItem[];
}

interface GroupData {
  name: string;
  debts: DebtEntry[];
  credits: CreditEntry[];
}

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
  TWINT: '💙', WERO: '🟣', PayPal: '🔵', 'Banküberweisung': '🏦', Bar: '💵', Sonstiges: '✅', Erhalten: '✅',
};

function getGroupNetto(group: GroupData): Record<string, { name: string; byCurrency: Record<string, number> }> {
  const result: Record<string, { name: string; byCurrency: Record<string, number> }> = {};
  group.debts.forEach(entry => {
    const total = entry.splits.reduce((s, sp) => s + sp.amount, 0);
    if (!result[entry.payerId]) result[entry.payerId] = { name: entry.payerName, byCurrency: {} };
    result[entry.payerId].byCurrency[entry.currency] =
      (result[entry.payerId].byCurrency[entry.currency] ?? 0) - total;
  });
  group.credits.forEach(entry => {
    const total = entry.splits.reduce((s, sp) => s + sp.amount, 0);
    if (!result[entry.debtorId]) result[entry.debtorId] = { name: entry.debtorName, byCurrency: {} };
    result[entry.debtorId].byCurrency[entry.currency] =
      (result[entry.debtorId].byCurrency[entry.currency] ?? 0) + total;
  });
  Object.keys(result).forEach(id => {
    Object.keys(result[id].byCurrency).forEach(cur => {
      if (Math.abs(result[id].byCurrency[cur]) < 0.005) delete result[id].byCurrency[cur];
    });
    if (Object.keys(result[id].byCurrency).length === 0) delete result[id];
  });
  return result;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettleScreen() {
  const [groupedData, setGroupedData] = useState<Record<string, GroupData>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [exchangeInput, setExchangeInput] = useState('');
  const [showExchangeRate, setShowExchangeRate] = useState(false);

  const [activeTab, setActiveTab] = useState<'offen' | 'historie'>('offen');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [totalExpanded, setTotalExpanded] = useState(true);

  const { theme } = useTheme();
  const styles = getStyles(theme);

  const toggleGroup = (groupId: string) =>
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));

  // ── Computed totals ──────────────────────────────────────────────────────────
  const { totalOweByCurrency, totalOwedByCurrency } = useMemo(() => {
    const owe: Record<string, number> = {};
    const owed: Record<string, number> = {};
    Object.values(groupedData).forEach(group => {
      group.debts.forEach(d => {
        const s = d.splits.reduce((acc, sp) => acc + sp.amount, 0);
        owe[d.currency] = (owe[d.currency] ?? 0) + s;
      });
      group.credits.forEach(c => {
        const s = c.splits.reduce((acc, sp) => acc + sp.amount, 0);
        owed[c.currency] = (owed[c.currency] ?? 0) + s;
      });
    });
    return { totalOweByCurrency: owe, totalOwedByCurrency: owed };
  }, [groupedData]);

  const hasAnyData = useMemo(
    () => Object.values(groupedData).some(g => g.debts.length > 0 || g.credits.length > 0),
    [groupedData]
  );

  const debtsByPerson = useMemo(() => {
    const map: Record<string, {
      payerId: string; payerName: string; currency: string;
      splits: SplitItem[]; creditEntries: CreditEntry[];
    }> = {};
    // Pass 1: collect all debts
    Object.values(groupedData).forEach(group => {
      group.debts.forEach(entry => {
        const key = `${entry.payerId}|${entry.currency}`;
        if (!map[key]) map[key] = { payerId: entry.payerId, payerName: entry.payerName, currency: entry.currency, splits: [], creditEntries: [] };
        map[key].splits.push(...entry.splits);
      });
    });
    // Pass 2: collect credits from ALL groups (not just same group)
    Object.values(groupedData).forEach(group => {
      group.credits.forEach(credit => {
        const key = `${credit.debtorId}|${credit.currency}`;
        if (map[key]) map[key].creditEntries.push(credit);
      });
    });
    return Object.values(map);
  }, [groupedData]);

  const creditsByPerson = useMemo(() => {
    const map: Record<string, { debtorId: string; debtorName: string; currency: string; splits: SplitItem[] }> = {};
    Object.values(groupedData).forEach(group => {
      group.credits.forEach(entry => {
        const key = `${entry.debtorId}|${entry.currency}`;
        if (!map[key]) map[key] = { debtorId: entry.debtorId, debtorName: entry.debtorName, currency: entry.currency, splits: [] };
        map[key].splits.push(...entry.splits);
      });
    });
    return Object.values(map);
  }, [groupedData]);

  const personIds = useMemo(() => {
    const ids = new Set<string>();
    debtsByPerson.forEach(d => ids.add(d.payerId));
    creditsByPerson.forEach(c => ids.add(c.debtorId));
    return [...ids];
  }, [debtsByPerson, creditsByPerson]);

  const nettoByPerson = useMemo(() => {
    const result: Record<string, { name: string; byCurrency: Record<string, number> }> = {};
    Object.values(groupedData).forEach(group => {
      group.debts.forEach(entry => {
        const total = entry.splits.reduce((s, sp) => s + sp.amount, 0);
        if (!result[entry.payerId]) result[entry.payerId] = { name: entry.payerName, byCurrency: {} };
        result[entry.payerId].byCurrency[entry.currency] =
          (result[entry.payerId].byCurrency[entry.currency] ?? 0) - total;
      });
      group.credits.forEach(entry => {
        const total = entry.splits.reduce((s, sp) => s + sp.amount, 0);
        if (!result[entry.debtorId]) result[entry.debtorId] = { name: entry.debtorName, byCurrency: {} };
        result[entry.debtorId].byCurrency[entry.currency] =
          (result[entry.debtorId].byCurrency[entry.currency] ?? 0) + total;
      });
    });
    Object.keys(result).forEach(id => {
      Object.keys(result[id].byCurrency).forEach(cur => {
        if (Math.abs(result[id].byCurrency[cur]) < 0.005) delete result[id].byCurrency[cur];
      });
      if (Object.keys(result[id].byCurrency).length === 0) delete result[id];
    });
    return result;
  }, [groupedData]);

  // ── History filter computations ──────────────────────────────────────────────
  const uniqueGroups = useMemo(() => [
    ...new Map(
      history.filter(h => h.expense?.group).map(h => [h.expense!.group!.id, h.expense!.group!])
    ).values(),
  ], [history]);

  const uniquePersons = useMemo(() => [
    ...new Map(
      history
        .filter(h => h.expense?.payer && h.expense?.paid_by)
        .map(h => [h.expense!.paid_by, { id: h.expense!.paid_by, ...h.expense!.payer! }])
    ).values(),
  ], [history]);

  const hasActiveFilters = !!searchQuery || !!selectedGroup || !!selectedPerson;

  const filteredHistory = useMemo(() => history.filter(item => {
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

  const groupedHistory = useMemo(() => filteredHistory.reduce((acc, item) => {
    if (!item.settled_at) return acc;
    const month = new Date(item.settled_at).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
    const existing = acc.find(g => g.month === month);
    if (existing) existing.items.push(item);
    else acc.push({ month, items: [item] });
    return acc;
  }, [] as { month: string; items: HistoryItem[] }[]), [filteredHistory]);

  // ── Data fetching ────────────────────────────────────────────────────────────
  const fetchDebts = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const userId = userData.user.id;
    setCurrentUserId(userId);

    const { data: memberGroups } = await supabase
      .from('group_members').select('group_id').eq('user_id', userId);

    if (!memberGroups || memberGroups.length === 0) {
      setGroupedData({});
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const groupIds = memberGroups.map(m => m.group_id);

    const { data: groupExpenses } = await supabase
      .from('expenses').select('id').in('group_id', groupIds);

    if (!groupExpenses || groupExpenses.length === 0) {
      setGroupedData({});
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const expenseIds = groupExpenses.map(e => e.id);

    const { data: splits } = await supabase
      .from('expense_splits')
      .select(`
        id, amount, user_id,
        expenses:expenses!expense_id(
          id, description, currency, paid_by, group_id,
          groups:groups!group_id(id, name),
          payer:profiles!expenses_paid_by_fkey(id, username)
        ),
        debtor:profiles!expense_splits_user_id_fkey(id, username)
      `)
      .in('expense_id', expenseIds)
      .eq('is_settled', false);

    if (!splits) {
      setGroupedData({});
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const newData: Record<string, GroupData> = {};

    (splits as any[]).forEach(split => {
      const expense = split.expenses;
      if (!expense) return;

      const groupId = expense.group_id;
      const groupName = expense.groups?.name ?? 'Unbekannte Gruppe';
      const currency = expense.currency ?? 'CHF';

      if (!newData[groupId]) newData[groupId] = { name: groupName, debts: [], credits: [] };
      const group = newData[groupId];

      if (split.user_id === userId && expense.paid_by !== userId) {
        const key = `${expense.paid_by}|${currency}`;
        let entry = group.debts.find(d => `${d.payerId}|${d.currency}` === key);
        if (!entry) {
          entry = { payerId: expense.paid_by, payerName: expense.payer?.username ?? 'Unbekannt', currency, splits: [] };
          group.debts.push(entry);
        }
        entry.splits.push(split);

      } else if (expense.paid_by === userId && split.user_id !== userId) {
        const key = `${split.user_id}|${currency}`;
        let entry = group.credits.find(c => `${c.debtorId}|${c.currency}` === key);
        if (!entry) {
          entry = { debtorId: split.user_id, debtorName: split.debtor?.username ?? 'Unbekannt', currency, splits: [] };
          group.credits.push(entry);
        }
        entry.splits.push(split);
      }
    });

    // Remove groups with no debts/credits
    Object.keys(newData).forEach(gId => {
      if (newData[gId].debts.length === 0 && newData[gId].credits.length === 0) delete newData[gId];
    });

    // Auto-expand all persons on first load
    setExpandedGroups(prev => {
      if (Object.keys(prev).length > 0) return prev;
      const ids = new Set<string>();
      Object.values(newData).forEach(group => {
        group.debts.forEach(d => ids.add(d.payerId));
        group.credits.forEach(c => ids.add(c.debtorId));
      });
      const expanded: Record<string, boolean> = {};
      ids.forEach(pid => { expanded[pid] = true; });
      return expanded;
    });

    setGroupedData(newData);
    setLoading(false);
    setRefreshing(false);
  };

  const loadHistory = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const userId = userData.user.id;
    setHistoryLoading(true);

    const selectQuery = `
      id, amount, settled_at, payment_method, user_id,
      expense:expenses!expense_id(
        description, amount, currency, date, paid_by,
        group:groups!group_id(id, name),
        payer:profiles!expenses_paid_by_fkey(username, avatar_url)
      ),
      debtor:profiles!expense_splits_user_id_fkey(username, avatar_url)
    `;

    // Query 1: splits I paid (I'm the debtor)
    const { data: paid } = await supabase
      .from('expense_splits')
      .select(selectQuery)
      .eq('user_id', userId)
      .eq('is_settled', true)
      .not('settled_at', 'is', null)
      .order('settled_at', { ascending: false })
      .limit(50);

    // Query 2: splits I received (I'm the creditor — expense paid_by me)
    const { data: myExpenses } = await supabase
      .from('expenses')
      .select('id')
      .eq('paid_by', userId);
    const myExpenseIds = (myExpenses ?? []).map((e: any) => e.id);

    let received: any[] = [];
    if (myExpenseIds.length > 0) {
      const { data: receivedData } = await supabase
        .from('expense_splits')
        .select(selectQuery)
        .in('expense_id', myExpenseIds)
        .neq('user_id', userId)
        .eq('is_settled', true)
        .not('settled_at', 'is', null)
        .order('settled_at', { ascending: false })
        .limit(50);
      received = receivedData ?? [];
    }

    const merged = [...(paid ?? []), ...received]
      .sort((a, b) => new Date(b.settled_at).getTime() - new Date(a.settled_at).getTime())
      .slice(0, 100);

    setHistory(merged as HistoryItem[]);
    setHistoryLoading(false);
  };

  const reopenDebt = async (splitId: string) => {
    setReopeningId(splitId);
    try {
      const { error } = await supabase
        .from('expense_splits')
        .update({ is_settled: false, settled_at: null, payment_method: null })
        .eq('id', splitId);
      if (error) throw error;
      haptics.success();
      await loadHistory();
      fetchDebts();
      Alert.alert('Erledigt', 'Die Zahlung wurde als offen markiert und erscheint wieder im Offen-Tab.');
    } catch (err: any) {
      haptics.error();
      Alert.alert('Fehler', err.message);
    } finally {
      setReopeningId(null);
    }
  };

  const confirmReopenDebt = (item: HistoryItem) => {
    Alert.alert(
      'Zahlung rückgängig machen?',
      `Möchtest du die Zahlung von ${item.expense?.currency ?? 'CHF'} ${item.amount.toFixed(2)} wieder als offen markieren?\n\nSie erscheint dann wieder im Offen-Tab.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Als offen markieren', style: 'destructive', onPress: () => reopenDebt(item.id) },
      ]
    );
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchDebts();
    loadHistory();
  }, []));

  // ── Settle actions ───────────────────────────────────────────────────────────
  const markSplitsSettled = async (splits: SplitItem[], paymentMethod: string, toUserId?: string, onAfterSettle?: () => void) => {
    const ids = splits.map(s => s.id);
    await supabase
      .from('expense_splits')
      .update({ is_settled: true, settled_at: new Date().toISOString(), payment_method: paymentMethod })
      .in('id', ids);
    haptics.success();
    if (toUserId) {
      const total = splits.reduce((s, sp) => s + sp.amount, 0);
      const currency = splits[0]?.expenses?.currency ?? 'CHF';
      notifyUser(toUserId, 'Schuld beglichen ✅', `${currency} ${total.toFixed(2)} wurde als bezahlt markiert.`);
    }
    fetchDebts();
    loadHistory();
    if (onAfterSettle) onAfterSettle();
  };

  const askSettled = (entry: DebtEntry, method: string, onAfterSettle?: () => void) => {
    setTimeout(() => {
      Alert.alert(
        'Zahlung abgeschlossen?',
        'Möchtest du diese Schulden als beglichen markieren?',
        [
          { text: 'Nein', style: 'cancel' },
          { text: 'Ja, beglichen', onPress: () => markSplitsSettled(entry.splits, method, entry.payerId, onAfterSettle) },
        ]
      );
    }, 400);
  };

  const showSettleOptions = (entry: DebtEntry, creditEntries: CreditEntry[]) => {
    const currency = entry.currency;
    const debtTotal = entry.splits.reduce((s, sp) => s + sp.amount, 0);
    const creditTotal = (creditEntries ?? [])
      .reduce((s, c) => s + c.splits.reduce((ss, sp) => ss + sp.amount, 0), 0);
    const nettoAmount = Math.max(0, debtTotal - creditTotal);

    console.log('debtTotal:', debtTotal);
    console.log('creditTotal:', creditTotal);
    console.log('nettoAmount:', nettoAmount);
    console.log('creditEntries:', JSON.stringify(creditEntries));

    const title = creditTotal > 0
      ? `Netto begleichen: ${currency} ${nettoAmount.toFixed(2)}`
      : 'Begleichen';

    const message = creditTotal > 0
      ? `Du schuldest ${entry.payerName}: ${currency} ${debtTotal.toFixed(2)}\n` +
        `${entry.payerName} schuldet dir: ${currency} ${creditTotal.toFixed(2)}\n` +
        `─────────────────────────────────\n` +
        `Netto zu zahlen: ${currency} ${nettoAmount.toFixed(2)}`
      : `${currency} ${debtTotal.toFixed(2)} an ${entry.payerName} — Wie bezahlen?`;

    const onAfterSettle = creditTotal > 0 ? () => {
      setTimeout(() => Alert.alert(
        '✅ Beglichen',
        `Netto-Betrag wurde als beglichen markiert.\n\nDeine offenen Forderungen bleiben bestehen bis ${entry.payerName} sie begleicht.`
      ), 300);
    } : undefined;

    haptics.warning();
    Alert.alert(title, message, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: '💙 TWINT',
        onPress: async () => {
          const opened = await payWithTwint();
          if (opened) askSettled(entry, 'TWINT', onAfterSettle);
        },
      },
      {
        text: '🟣 WERO',
        onPress: async () => {
          const opened = await payWithWero();
          if (opened) askSettled(entry, 'WERO', onAfterSettle);
        },
      },
      {
        text: '🔵 PayPal',
        onPress: async () => {
          const opened = await payWithPayPal(entry.payerId);
          if (opened) askSettled(entry, 'PayPal', onAfterSettle);
        },
      },
      {
        text: '🏦 Banküberweisung',
        onPress: async () => {
          const shown = await showBankDetails(entry.payerId);
          if (shown) askSettled(entry, 'Banküberweisung', onAfterSettle);
        },
      },
      { text: '💵 Bar',       onPress: () => markSplitsSettled(entry.splits, 'Bar', entry.payerId, onAfterSettle) },
      { text: '✅ Sonstiges', onPress: () => markSplitsSettled(entry.splits, 'Sonstiges', entry.payerId, onAfterSettle) },
    ]);
  };

  const handleSettlePress = (entry: DebtEntry, creditEntries: CreditEntry[]) => {
    haptics.light();
    Alert.alert(
      'Beträge prüfen',
      'Hast du alle Positionen und Beträge auf ihre Richtigkeit geprüft?',
      [
        { text: 'Nochmals prüfen', style: 'cancel' },
        { text: 'Ja, alles korrekt', onPress: () => showSettleOptions(entry, creditEntries) },
      ]
    );
  };

  const confirmPaymentReceived = (entry: CreditEntry, nettoAmount: number, debtAmount: number) => {
    const creditTotal = entry.splits.reduce((s, sp) => s + sp.amount, 0);
    const message = debtAmount > 0
      ? `${entry.debtorName} schuldet dir: ${entry.currency} ${creditTotal.toFixed(2)}\n` +
        `Du schuldest ${entry.debtorName}: ${entry.currency} ${debtAmount.toFixed(2)}\n` +
        `─────────────────────────────\n` +
        `Netto erhalten: ${entry.currency} ${nettoAmount.toFixed(2)}`
      : `Hast du ${entry.currency} ${creditTotal.toFixed(2)} von ${entry.debtorName} erhalten?`;

    Alert.alert('Zahlung erhalten?', message, [
      { text: 'Nein', style: 'cancel' },
      {
        text: 'Ja, erhalten ✓',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('expense_splits')
              .update({ is_settled: true, settled_at: new Date().toISOString(), payment_method: 'Erhalten' })
              .in('id', entry.splits.map(s => s.id));
            if (error) throw error;
            haptics.success();
            await Promise.all([fetchDebts(), loadHistory()]);
          } catch (err: any) {
            Alert.alert('Fehler', err.message);
          }
        },
      },
    ]);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  const hasMultiCurrency = Object.keys({ ...totalOweByCurrency, ...totalOwedByCurrency }).length > 1;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.title}>Abrechnen</Text>
        <View style={styles.tabSwitcher}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'offen' && styles.tabBtnActive]}
            onPress={() => { haptics.selection(); setActiveTab('offen'); }}
          >
            <Text style={[styles.tabBtnText, activeTab === 'offen' && styles.tabBtnTextActive]}>Offen</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'historie' && styles.tabBtnActive]}
            onPress={() => { haptics.selection(); setActiveTab('historie'); }}
          >
            <Text style={[styles.tabBtnText, activeTab === 'historie' && styles.tabBtnTextActive]}>Historie</Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'historie' && (
          <View style={styles.historyHeaderRow}>
            <TouchableOpacity
              style={[styles.filterBtn, hasActiveFilters && styles.filterBtnActive]}
              onPress={() => { haptics.selection(); setShowFilters(v => !v); }}
            >
              <Text style={styles.filterBtnIcon}>🔍</Text>
              <Text style={[styles.filterBtnText, hasActiveFilters && styles.filterBtnTextActive]}>
                Filter{hasActiveFilters ? ' ●' : ''}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── OFFEN TAB ────────────────────────────────────────────────────────── */}
      {activeTab === 'offen' && (
        loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : !hasAnyData ? (
          <EmptyState
            emoji="🎉"
            title="Alles beglichen!"
            subtitle={"Du hast keine offenen Schulden\nund niemand schuldet dir etwas"}
          />
        ) : (
          <View style={{ flex: 1 }}>
            <ScrollView
              contentContainerStyle={[styles.list, { paddingBottom: totalExpanded ? 220 : 80 }]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => { setRefreshing(true); fetchDebts(); }}
                  tintColor={theme.primary}
                />
              }
            >
              {/* Umrechnungskurs */}
              <TouchableOpacity
                onPress={() => { haptics.light(); setShowExchangeRate(v => !v); }}
                style={styles.exchangeToggle}
                activeOpacity={0.7}
              >
                <Ionicons name="swap-horizontal" size={18} color={theme.primary} />
                <Text style={styles.exchangeToggleText}>
                  Umrechnungskurs{exchangeRate ? ` (1 EUR = ${exchangeRate} CHF)` : ' eingeben'}
                </Text>
                <Ionicons
                  name={showExchangeRate ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>

              {showExchangeRate && (
                <View style={styles.exchangeRow}>
                  <Text style={styles.exchangeLabel}>1 EUR =</Text>
                  <TextInput
                    style={styles.exchangeInput}
                    placeholder="0.95"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    value={exchangeInput}
                    onChangeText={val => {
                      setExchangeInput(val);
                      const parsed = parseFloat(val.replace(',', '.'));
                      setExchangeRate(isNaN(parsed) ? null : parsed);
                    }}
                  />
                  <Text style={styles.exchangeLabel}>CHF</Text>
                </View>
              )}

              {/* Personen-Karten */}
              {personIds.map(personId => {
                const personDebts = debtsByPerson.filter(d => d.payerId === personId);
                const personCredits = creditsByPerson.filter(c => c.debtorId === personId);
                const personName = personDebts[0]?.payerName ?? personCredits[0]?.debtorName ?? 'Unbekannt';

                return (
                  <View key={personId} style={styles.groupCard}>
                    <TouchableOpacity
                      onPress={() => { haptics.light(); toggleGroup(personId); }}
                      style={styles.groupHeader}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.groupHeaderName}>{personName}</Text>
                      <Ionicons
                        name={expandedGroups[personId] ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color={theme.textSecondary}
                      />
                    </TouchableOpacity>

                    {expandedGroups[personId] && (
                      <View style={styles.groupBody}>

                        {/* Ich schulde dieser Person */}
                        {personDebts.map((entry, i) => {
                          const debtTotal = entry.splits.reduce((s, sp) => s + sp.amount, 0);
                          const creditTotal = entry.creditEntries.reduce((s, c) => s + c.splits.reduce((ss, sp) => ss + sp.amount, 0), 0);
                          const nettoAmount = debtTotal - creditTotal;
                          const debtEntry: DebtEntry = { payerId: entry.payerId, payerName: entry.payerName, currency: entry.currency, splits: entry.splits };
                          return (
                            <View key={`d${i}`} style={[styles.entryBlock, i > 0 && styles.entryDivider]}>
                              <Text style={styles.entryTitleRed}>
                                Du schuldest {personName}{personDebts.length > 1 ? ` (${entry.currency})` : ''}
                              </Text>
                              {entry.splits.map(split => (
                                <View key={split.id} style={styles.splitRow}>
                                  <Text style={styles.splitDesc} numberOfLines={1}>
                                    └ {split.expenses?.groups?.name ? `${split.expenses.groups.name}: ` : ''}{split.expenses?.description ?? '–'}
                                  </Text>
                                  <Text style={styles.splitAmount}>
                                    {entry.currency} {split.amount.toFixed(2)}
                                  </Text>
                                </View>
                              ))}
                              <View style={styles.totalRow}>
                                <Text style={styles.totalLabelRed}>Total</Text>
                                <Text style={styles.totalAmountRed}>
                                  {entry.currency} {debtTotal.toFixed(2)}
                                </Text>
                              </View>
                              {nettoAmount > 0 && (
                                <TouchableOpacity
                                  style={styles.settleBtn}
                                  onPress={() => handleSettlePress(debtEntry, entry.creditEntries)}
                                  activeOpacity={0.8}
                                >
                                  <Text style={styles.settleBtnText}>
                                    {creditTotal > 0
                                      ? `Netto begleichen: ${entry.currency} ${nettoAmount.toFixed(2)}`
                                      : 'Begleichen'}
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })}

                        {/* Diese Person schuldet mir */}
                        {personCredits.map((entry, i) => (
                          <View
                            key={`c${i}`}
                            style={[styles.entryBlock, (personDebts.length > 0 || i > 0) && styles.entryDivider]}
                          >
                            <Text style={styles.entryTitleGreen}>
                              {personName} schuldet dir{personCredits.length > 1 ? ` (${entry.currency})` : ''}
                            </Text>
                            {entry.splits.map(split => (
                              <View key={split.id} style={styles.splitRow}>
                                <Text style={styles.splitDesc} numberOfLines={1}>
                                  └ {split.expenses?.groups?.name ? `${split.expenses.groups.name}: ` : ''}{split.expenses?.description ?? '–'}
                                </Text>
                                <Text style={styles.splitAmount}>
                                  {entry.currency} {split.amount.toFixed(2)}
                                </Text>
                              </View>
                            ))}
                            <View style={styles.totalRow}>
                              <Text style={styles.totalLabelGreen}>Total</Text>
                              <Text style={styles.totalAmountGreen}>
                                {entry.currency} {entry.splits.reduce((s, sp) => s + sp.amount, 0).toFixed(2)}
                              </Text>
                            </View>
                            {(() => {
                              const creditTotal = entry.splits.reduce((s, sp) => s + sp.amount, 0);
                              const debtToThisPerson = debtsByPerson
                                .filter(d => d.payerId === entry.debtorId && d.currency === entry.currency)
                                .reduce((s, d) => s + d.splits.reduce((ss, sp) => ss + sp.amount, 0), 0);
                              const nettoReceived = creditTotal - debtToThisPerson;
                              if (nettoReceived <= 0) return null;
                              return (
                                <TouchableOpacity
                                  onPress={() => confirmPaymentReceived(entry, nettoReceived, debtToThisPerson)}
                                  style={{
                                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                                    backgroundColor: '#4CAF5015', borderRadius: 10,
                                    padding: 10, marginTop: 8, gap: 6,
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <Ionicons name="checkmark-circle-outline" size={18} color="#4CAF50" />
                                  <Text style={{ color: '#4CAF50', fontWeight: '600', fontSize: 14 }}>
                                    Zahlung erhalten: {entry.currency} {nettoReceived.toFixed(2)}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })()}
                          </View>
                        ))}

                      </View>
                    )}
                  </View>
                );
              })}

              {/* Netto pro Person */}
              {Object.keys(nettoByPerson).length > 0 && (
                <View style={styles.nettoCard}>
                  <Text style={styles.nettoCardTitle}>Netto pro Person</Text>
                  {Object.entries(nettoByPerson).map(([personId, person]) => (
                    <View key={personId} style={styles.nettoPersonBlock}>
                      <Text style={styles.nettoPersonName}>{person.name}</Text>
                      {Object.entries(person.byCurrency).map(([currency, amount]) => {
                        const isPositive = amount > 0;
                        return (
                          <View
                            key={currency}
                            style={[styles.nettoRow, { backgroundColor: isPositive ? '#4CAF5018' : '#F4433618' }]}
                          >
                            <Text style={[styles.nettoLabel, { color: isPositive ? '#4CAF50' : '#F44336' }]}>
                              {isPositive ? `${person.name} zahlt dir: ` : `Du zahlst ${person.name}: `}
                            </Text>
                            <Text style={[styles.nettoAmount, { color: isPositive ? '#4CAF50' : '#F44336' }]}>
                              {currency} {Math.abs(amount).toFixed(2)}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              )}

              <View style={{ height: 16 }} />
            </ScrollView>

            {/* Gesamttotal */}
            <View style={{
              backgroundColor: theme.card,
              borderTopWidth: 2,
              borderTopColor: theme.primary,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -3 },
              shadowOpacity: 0.08,
              shadowRadius: 8,
              elevation: 10,
            }}>
              <TouchableOpacity
                onPress={() => setTotalExpanded(v => !v)}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                }}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 4, height: 20, backgroundColor: theme.primary, borderRadius: 2 }} />
                  <Text style={{ fontWeight: '800', fontSize: 16, color: theme.text }}>Gesamttotal</Text>
                </View>
                <Ionicons
                  name={totalExpanded ? 'chevron-down' : 'chevron-up'}
                  size={20}
                  color={theme.primary}
                />
              </TouchableOpacity>

              {totalExpanded && (
                <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
                  <View style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    backgroundColor: theme.inputBg,
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 8,
                  }}>
                    <View>
                      <Text style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 2 }}>Du schuldest</Text>
                      {Object.entries(totalOweByCurrency).map(([cur, amount]) => (
                        <Text key={cur} style={{ fontWeight: '700', color: '#F44336', fontSize: 15 }}>
                          {cur} {amount.toFixed(2)}
                        </Text>
                      ))}
                      {Object.keys(totalOweByCurrency).length === 0 && (
                        <Text style={{ color: '#4CAF50', fontWeight: '600' }}>–</Text>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 2 }}>Du bekommst</Text>
                      {Object.entries(totalOwedByCurrency).map(([cur, amount]) => (
                        <Text key={cur} style={{ fontWeight: '700', color: '#4CAF50', fontSize: 15 }}>
                          {cur} {amount.toFixed(2)}
                        </Text>
                      ))}
                      {Object.keys(totalOwedByCurrency).length === 0 && (
                        <Text style={{ color: theme.textSecondary, fontWeight: '600' }}>–</Text>
                      )}
                    </View>
                  </View>

                  {[...new Set([...Object.keys(totalOweByCurrency), ...Object.keys(totalOwedByCurrency)])].map(cur => {
                    const owe = totalOweByCurrency[cur] ?? 0;
                    const owed = totalOwedByCurrency[cur] ?? 0;
                    const netto = owed - owe;
                    return (
                      <View key={cur} style={{
                        backgroundColor: theme.primary + '15',
                        borderRadius: 12,
                        padding: 12,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 4,
                      }}>
                        <Text style={{ fontWeight: '700', color: theme.primary, fontSize: 14 }}>Netto {cur}</Text>
                        <Text style={{ fontWeight: '800', color: netto >= 0 ? '#4CAF50' : '#F44336', fontSize: 16 }}>
                          {netto >= 0 ? '+' : ''}{Math.abs(netto).toFixed(2)} {cur}
                        </Text>
                      </View>
                    );
                  })}

                  {exchangeRate !== null && hasMultiCurrency && (
                    <View style={styles.totalConverted}>
                      <Text style={styles.totalConvertedText}>
                        Total CHF (netto):{' '}
                        {(
                          ((totalOweByCurrency['CHF'] ?? 0) + (totalOweByCurrency['EUR'] ?? 0) * exchangeRate) -
                          ((totalOwedByCurrency['CHF'] ?? 0) + (totalOwedByCurrency['EUR'] ?? 0) * exchangeRate)
                        ).toFixed(2)} CHF
                      </Text>
                      <Text style={styles.totalConvertedSub}>(1 EUR = {exchangeRate} CHF)</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        )
      )}

      {/* ── HISTORIE TAB ─────────────────────────────────────────────────────── */}
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
                        <Text style={[styles.filterChipText, selectedGroup === null && styles.filterChipTextActive]}>Alle</Text>
                      </TouchableOpacity>
                      {uniqueGroups.map(group => (
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
                        <Text style={[styles.filterChipText, selectedPerson === null && styles.filterChipTextActive]}>Alle</Text>
                      </TouchableOpacity>
                      {uniquePersons.map(person => (
                        <TouchableOpacity
                          key={person.id}
                          style={[styles.filterChip, selectedPerson === person.id && styles.filterChipActive]}
                          onPress={() => setSelectedPerson(selectedPerson === person.id ? null : person.id)}
                        >
                          <View style={styles.filterPersonChipInner}>
                            <View style={styles.filterPersonAvatar}>
                              <Text style={styles.filterPersonAvatarText}>{person.username?.[0]?.toUpperCase() ?? '?'}</Text>
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

            {groupedHistory.length === 0 ? (
              hasActiveFilters ? (
                <EmptyState emoji="🔍" title="Keine Einträge gefunden" subtitle="Versuche andere Filterkriterien" />
              ) : (
                <EmptyState emoji="📋" title="Noch keine Historie" subtitle="Beglichene Schulden erscheinen hier" />
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
                          <Text key={cur} style={styles.monthTotal}>{cur} {total.toFixed(2)}</Text>
                        ))}
                      </View>
                    </View>
                    {items.map(item => {
                      const icon = PAYMENT_METHOD_ICON[item.payment_method ?? ''] ?? '✅';
                      const settledDate = item.settled_at
                        ? new Date(item.settled_at).toLocaleDateString('de-CH', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })
                        : '';
                      return (
                        <View key={item.id} style={styles.historyCard}>
                          <View style={styles.historyCardMain}>
                            <View style={styles.historyIcon}>
                              <Text style={{ fontSize: 22 }}>{icon}</Text>
                            </View>
                            <View style={styles.historyInfo}>
                              <Text style={styles.historyDesc} numberOfLines={1}>
                                {item.expense?.description ?? '–'}
                              </Text>
                              <Text style={styles.historyMeta}>
                                {item.expense?.group?.name ? `${item.expense.group.name} · ` : ''}
                                {item.payment_method ?? 'Sonstiges'}
                              </Text>
                              <View style={styles.historyFlow}>
                                <View style={styles.historyMiniAvatar}>
                                  <Text style={styles.historyMiniAvatarText}>
                                    {item.debtor?.username?.[0]?.toUpperCase() ?? '?'}
                                  </Text>
                                </View>
                                <Text style={styles.historyArrow}>→</Text>
                                <View style={[styles.historyMiniAvatar, styles.historyMiniAvatarGreen]}>
                                  <Text style={styles.historyMiniAvatarText}>
                                    {item.expense?.payer?.username?.[0]?.toUpperCase() ?? '?'}
                                  </Text>
                                </View>
                                <Text style={styles.historyFlowNames}>
                                  {item.debtor?.username ?? '–'} → {item.expense?.payer?.username ?? '–'}
                                </Text>
                              </View>
                              <Text style={styles.historyDate}>{settledDate}</Text>
                            </View>
                            <Text style={styles.historyAmount}>
                              {item.expense?.currency ?? 'CHF'} {item.amount.toFixed(2)}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.reopenBtn}
                            onPress={() => confirmReopenDebt(item)}
                            disabled={reopeningId === item.id}
                            activeOpacity={0.7}
                          >
                            {reopeningId === item.id ? (
                              <ActivityIndicator size="small" color={theme.textSecondary} />
                            ) : (
                              <Ionicons name="arrow-undo-outline" size={14} color={theme.textSecondary} />
                            )}
                            <Text style={styles.reopenBtnText}>Als offen markieren</Text>
                          </TouchableOpacity>
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
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: { padding: 20, paddingTop: 10, paddingBottom: 12 },
    title: { fontSize: 24, fontWeight: '700', color: theme.text, marginBottom: 12 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { padding: 16, paddingTop: 8 },

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
      paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: theme.inputBg,
    },
    filterBtnActive: { backgroundColor: theme.primary },
    filterBtnIcon: { fontSize: 14 },
    filterBtnText: { fontSize: 13, fontWeight: '600', color: theme.textSecondary },
    filterBtnTextActive: { color: '#fff' },

    // Umrechnungskurs
    exchangeToggle: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      padding: 12, marginBottom: 8,
      backgroundColor: theme.card, borderRadius: 12,
    },
    exchangeToggleText: { flex: 1, color: theme.primary, fontWeight: '500', fontSize: 14 },
    exchangeRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: theme.card, borderRadius: 12,
      padding: 12, marginBottom: 12,
    },
    exchangeLabel: { color: theme.text, fontSize: 15, fontWeight: '500' },
    exchangeInput: {
      flex: 1, backgroundColor: theme.inputBg, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 8,
      color: theme.text, fontSize: 16,
    },

    // Gruppen-Karten
    groupCard: {
      backgroundColor: theme.card, borderRadius: 16,
      marginBottom: 12, overflow: 'hidden',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    },
    groupHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      padding: 16,
      backgroundColor: theme.primary + '18',
    },
    groupHeaderName: { fontWeight: '700', fontSize: 16, color: theme.text },
    groupBody: { padding: 16 },

    entryBlock: { paddingVertical: 4 },
    entryDivider: { borderTopWidth: 0.5, borderTopColor: theme.border, marginTop: 12, paddingTop: 12 },
    entryTitleRed: { color: '#F44336', fontWeight: '600', fontSize: 13, marginBottom: 8 },
    entryTitleGreen: { color: '#4CAF50', fontWeight: '600', fontSize: 13, marginBottom: 8 },

    splitRow: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 12, paddingVertical: 3 },
    splitDesc: { color: theme.textSecondary, fontSize: 13, flex: 1, marginRight: 8 },
    splitAmount: { color: theme.textSecondary, fontSize: 13 },

    totalRow: {
      flexDirection: 'row', justifyContent: 'space-between',
      borderTopWidth: 0.5, borderTopColor: theme.border,
      marginTop: 8, paddingTop: 8,
    },
    totalLabelRed: { fontWeight: '600', color: '#F44336', fontSize: 13 },
    totalLabelGreen: { fontWeight: '600', color: '#4CAF50', fontSize: 13 },
    totalAmountRed: { fontWeight: '700', color: '#F44336', fontSize: 13 },
    totalAmountGreen: { fontWeight: '700', color: '#4CAF50', fontSize: 13 },

    settleBtn: {
      backgroundColor: '#F44336', borderRadius: 10,
      padding: 10, alignItems: 'center', marginTop: 10,
    },
    settleBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

    groupNettoBlock: { marginTop: 12, borderTopWidth: 0.5, borderTopColor: theme.border, paddingTop: 8, gap: 6 },
    groupNettoRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
    },
    groupNettoLabel: { fontSize: 13, fontWeight: '600' },
    groupNettoAmount: { fontSize: 14, fontWeight: '700' },

    // Gesamttotal footer
    totalFooter: {
      backgroundColor: theme.card, padding: 16,
      borderTopWidth: 0.5, borderTopColor: theme.border,
    },
    totalFooterTitle: { fontWeight: '700', fontSize: 15, color: theme.text, marginBottom: 8 },
    totalFooterCols: { flexDirection: 'row' },
    totalRed: { color: '#F44336', fontSize: 13, fontWeight: '500', marginBottom: 3 },
    totalGreen: { color: '#4CAF50', fontSize: 13, fontWeight: '500', marginBottom: 3 },
    totalNeutral: { color: theme.textSecondary, fontSize: 13 },
    totalConverted: { marginTop: 10, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: theme.border },
    totalConvertedText: { fontWeight: '700', color: theme.text, fontSize: 14 },
    totalConvertedSub: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },

    footerNetto: { borderTopWidth: 0.5, borderTopColor: theme.border, marginTop: 8, paddingTop: 8 },
    footerNettoTitle: { fontWeight: '700', color: theme.text, fontSize: 13, marginBottom: 4 },
    footerNettoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
    footerNettoLabel: { fontSize: 13 },
    footerNettoValue: { fontWeight: '700', fontSize: 13 },

    nettoCard: {
      backgroundColor: theme.card, borderRadius: 16,
      marginBottom: 12, padding: 16,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    },
    nettoCardTitle: { fontWeight: '700', fontSize: 16, color: theme.text, marginBottom: 12 },
    nettoPersonBlock: { marginBottom: 10 },
    nettoPersonName: { fontSize: 14, fontWeight: '600', color: theme.text, marginBottom: 4 },
    nettoRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, marginTop: 4,
    },
    nettoLabel: { fontSize: 13 },
    nettoAmount: { fontWeight: '700', fontSize: 14 },

    // Filter panel
    filterPanel: {
      backgroundColor: theme.card, borderRadius: 14, padding: 14, marginBottom: 12, gap: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    },
    filterInput: {
      backgroundColor: theme.inputBg, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10, color: theme.text, fontSize: 14,
    },
    filterSectionLabel: { fontSize: 11, fontWeight: '700', color: theme.textTertiary, letterSpacing: 0.8, textTransform: 'uppercase' },
    filterChipRow: { flexGrow: 0 },
    filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: theme.inputBg, marginRight: 8 },
    filterChipActive: { backgroundColor: theme.primary },
    filterChipText: { fontSize: 13, fontWeight: '500', color: theme.textSecondary },
    filterChipTextActive: { color: '#fff' },
    filterPersonChipInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    filterPersonAvatar: { width: 20, height: 20, borderRadius: 10, backgroundColor: theme.primaryLight, justifyContent: 'center', alignItems: 'center' },
    filterPersonAvatarText: { fontSize: 10, fontWeight: '700', color: theme.primary },
    filterResetBtn: { alignItems: 'center', paddingVertical: 4 },
    filterResetText: { fontSize: 13, color: theme.danger, fontWeight: '600' },

    // Historie
    historyList: { paddingTop: 8, paddingHorizontal: 16 },
    monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 10 },
    monthLabel: { fontSize: 13, fontWeight: '700', color: theme.textSecondary },
    monthTotals: { alignItems: 'flex-end' },
    monthTotal: { fontSize: 12, fontWeight: '600', color: theme.success },
    historyCard: {
      backgroundColor: theme.card, borderRadius: 12, padding: 14, marginBottom: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
    },
    historyCardMain: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    reopenBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      marginTop: 10, paddingTop: 10, gap: 6,
      borderTopWidth: 0.5, borderTopColor: theme.border,
    },
    reopenBtnText: { color: theme.textSecondary, fontSize: 12 },
    historyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.successBg, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
    historyInfo: { flex: 1 },
    historyDesc: { fontSize: 15, fontWeight: '600', color: theme.text },
    historyMeta: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
    historyFlow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
    historyMiniAvatar: { width: 20, height: 20, borderRadius: 10, backgroundColor: theme.primaryLight, justifyContent: 'center', alignItems: 'center' },
    historyMiniAvatarGreen: { backgroundColor: theme.debtGreenAvatar },
    historyMiniAvatarText: { fontSize: 10, fontWeight: '700', color: theme.primary },
    historyArrow: { fontSize: 11, color: theme.textTertiary },
    historyFlowNames: { fontSize: 11, color: theme.textSecondary },
    historyDate: { fontSize: 11, color: theme.textTertiary, marginTop: 3 },
    historyAmount: { fontSize: 15, fontWeight: '700', color: theme.success, flexShrink: 0, marginTop: 2 },
  });
}
