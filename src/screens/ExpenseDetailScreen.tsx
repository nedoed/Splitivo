import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Image, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { haptics } from '../lib/haptics';
import { CATEGORIES, GroupMember } from '../types';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

interface Split {
  id: string;
  user_id: string;
  amount: number;
  is_settled: boolean;
  profile?: { username: string };
}

interface ExpenseDetail {
  id: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  paid_by: string;
  receipt_url: string | null;
  payer?: { username: string };
  splits: Split[];
}

export default function ExpenseDetailScreen({ route, navigation }: any) {
  const { expense: initialExpense, members }: { expense: any; members: GroupMember[] } = route.params;

  const [expense, setExpense] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');

  // Edit-Modus
  const [editMode, setEditMode] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [saving, setSaving] = useState(false);

  // Kassenbon Vollbild
  const [receiptFullscreen, setReceiptFullscreen] = useState(false);

  const { theme } = useTheme();
  const styles = getStyles(theme);

  const loadExpense = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) setCurrentUserId(userData.user.id);

    const { data, error } = await supabase
      .from('expenses')
      .select(`
        id, description, amount, currency, category, date, paid_by, receipt_url,
        payer:profiles!paid_by(username),
        splits:expense_splits(id, user_id, amount, is_settled)
      `)
      .eq('id', initialExpense.id)
      .single();

    if (error || !data) { setLoading(false); return; }

    // Profiles für Splits nachladen
    const userIds = (data.splits as any[]).map((s) => s.user_id);
    const { data: profiles } = userIds.length > 0
      ? await supabase.from('profiles').select('id, username').in('id', userIds)
      : { data: [] };

    const profileMap: Record<string, any> = {};
    (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

    const enriched: ExpenseDetail = {
      ...(data as any),
      payer: (data as any).payer,
      splits: (data.splits as any[]).map((s) => ({
        ...s,
        profile: profileMap[s.user_id],
      })),
    };

    setExpense(enriched);
    setEditDesc(enriched.description);
    setEditAmount(String(enriched.amount));
    setEditCategory(enriched.category);
    setLoading(false);

    // DEBUG – Receipt URL
    console.log('[ExpenseDetail] receipt_url:', enriched.receipt_url);
    console.log('[ExpenseDetail] receipt_url Typ:', typeof enriched.receipt_url);
    console.log('[ExpenseDetail] receipt_url Länge:', enriched.receipt_url?.length ?? 0);
  }, [initialExpense.id]);

  useEffect(() => { loadExpense(); }, [loadExpense]);

  const saveEdit = async () => {
    if (!expense) return;
    const num = parseFloat(editAmount.replace(',', '.'));
    if (!editDesc.trim()) { Alert.alert('Fehler', 'Beschreibung darf nicht leer sein.'); return; }
    if (isNaN(num) || num <= 0) { Alert.alert('Fehler', 'Ungültiger Betrag.'); return; }

    setSaving(true);
    const { error } = await supabase
      .from('expenses')
      .update({ description: editDesc.trim(), amount: num, category: editCategory })
      .eq('id', expense.id);

    setSaving(false);
    if (error) { Alert.alert('Fehler', error.message); return; }
    setEditMode(false);
    loadExpense();
  };

  const deleteExpense = () => {
    Alert.alert('Ausgabe löschen', 'Diese Ausgabe und alle Aufteilungen werden gelöscht.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen', style: 'destructive',
        onPress: async () => {
          await supabase.from('expense_splits').delete().eq('expense_id', initialExpense.id);
          await supabase.from('expenses').delete().eq('id', initialExpense.id);
          navigation.goBack();
        },
      },
    ]);
  };

  const moveExpenseToGroup = async (newGroupId: string) => {
    const { error } = await supabase
      .from('expenses')
      .update({ group_id: newGroupId })
      .eq('id', expense!.id);

    if (error) { Alert.alert('Fehler', error.message); return; }

    haptics.success();
    Alert.alert('Verschoben!', 'Die Ausgabe wurde in die andere Gruppe verschoben.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  };

  const showGroupPicker = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: memberships } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userData.user.id);

    if (!memberships || memberships.length === 0) return;

    const myGroupIds = memberships.map((m) => m.group_id);
    const currentGroupId = initialExpense.group_id;

    const { data: myGroups } = await supabase
      .from('groups')
      .select('id, name')
      .in('id', myGroupIds)
      .neq('id', currentGroupId);

    if (!myGroups || myGroups.length === 0) {
      Alert.alert('Keine anderen Gruppen', 'Du bist in keiner anderen Gruppe.');
      return;
    }

    Alert.alert(
      'Gruppe ändern',
      'In welche Gruppe verschieben?',
      [
        ...myGroups.map((g) => ({
          text: g.name,
          onPress: () => moveExpenseToGroup(g.id),
        })),
        { text: 'Abbrechen', style: 'cancel' as const },
      ]
    );
  };

  const getCategoryInfo = (val: string) =>
    CATEGORIES.find((c) => c.value === val) ?? { label: 'Sonstiges', icon: '📦' };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}><ActivityIndicator size="large" color={theme.primary} /></View>
      </SafeAreaView>
    );
  }

  if (!expense) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}><Text style={styles.errorText}>Ausgabe nicht gefunden.</Text></View>
      </SafeAreaView>
    );
  }

  const cat = getCategoryInfo(expense.category);
  const allSettled = expense.splits.every((s) => s.is_settled);
  const myShare = expense.splits.find((s) => s.user_id === currentUserId);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* ── Hero-Karte ─────────────────────────────────────────────── */}
        <View style={styles.heroCard}>
          <View style={styles.heroCatBadge}>
            <Text style={styles.heroCatIcon}>{cat.icon}</Text>
            <Text style={styles.heroCatLabel}>{cat.label}</Text>
          </View>

          {editMode ? (
            <>
              <TextInput
                style={styles.editDescInput}
                value={editDesc}
                onChangeText={setEditDesc}
                placeholder="Beschreibung"
                placeholderTextColor="#bbb"
              />
              <TextInput
                style={styles.editAmountInput}
                value={editAmount}
                onChangeText={setEditAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#bbb"
              />
            </>
          ) : (
            <>
              <Text style={styles.heroTitle}>{expense.description}</Text>
              <Text style={styles.heroAmount}>
                {expense.amount.toFixed(2)} {expense.currency}
              </Text>
            </>
          )}

          <View style={styles.heroMeta}>
            <Text style={styles.heroMetaText}>
              📅 {new Date(expense.date).toLocaleDateString('de-DE', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
            </Text>
            <Text style={styles.heroMetaText}>
              💳 Bezahlt von {expense.payer?.username ?? '—'}
            </Text>
          </View>

          <View style={[styles.statusBadge, allSettled ? styles.statusGreen : styles.statusOrange]}>
            <Text style={styles.statusText}>{allSettled ? '✓ Vollständig beglichen' : '⏳ Noch offen'}</Text>
          </View>
        </View>

        {/* ── Kategorie-Picker im Edit-Modus ─────────────────────────── */}
        {editMode && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Kategorie</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c.value}
                  style={[styles.catChip, editCategory === c.value && styles.catChipActive]}
                  onPress={() => setEditCategory(c.value)}
                >
                  <Text style={styles.catChipIcon}>{c.icon}</Text>
                  <Text style={[styles.catChipLabel, editCategory === c.value && styles.catChipLabelActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Aufteilung ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Aufteilung</Text>
          {expense.splits.map((split) => (
            <View key={split.id} style={styles.splitRow}>
              <View style={styles.splitAvatar}>
                <Text style={styles.splitAvatarText}>
                  {(split.profile?.username ?? '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.splitInfo}>
                <Text style={styles.splitName}>
                  {split.profile?.username ?? 'Unbekannt'}
                  {split.user_id === expense.paid_by ? ' (hat bezahlt)' : ''}
                </Text>
                <Text style={styles.splitAmount}>{split.amount.toFixed(2)} {expense.currency}</Text>
              </View>
              <View style={[styles.splitBadge, split.is_settled ? styles.splitBadgeGreen : styles.splitBadgeOrange]}>
                <Text style={styles.splitBadgeText}>{split.is_settled ? 'Beglichen' : 'Offen'}</Text>
              </View>
            </View>
          ))}
          {myShare && !myShare.is_settled && myShare.user_id !== expense.paid_by && (
            <View style={styles.myShareBox}>
              <Text style={styles.myShareLabel}>Dein Anteil</Text>
              <Text style={styles.myShareAmount}>{myShare.amount.toFixed(2)} {expense.currency}</Text>
            </View>
          )}
        </View>

        {/* ── Kassenbon ───────────────────────────────────────────────── */}
        {expense.receipt_url && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Kassenbon</Text>
            <TouchableOpacity onPress={() => {
          console.log('[Thumbnail] Antippen → receipt_url:', expense.receipt_url);
          setReceiptFullscreen(true);
        }} activeOpacity={0.85}>
              <Image
                source={{ uri: expense.receipt_url }}
                style={styles.receiptThumb}
                resizeMode="cover"
              />
              <View style={styles.receiptTapHint}>
                <Text style={styles.receiptTapText}>🔍 Zum Vergrössern tippen</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Aktions-Buttons ─────────────────────────────────────────── */}
        {editMode ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity
              style={[styles.primaryBtn, saving && { opacity: 0.7 }]}
              onPress={saveEdit}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>Änderungen speichern</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditMode(false)}>
              <Text style={styles.cancelBtnText}>Abbrechen</Text>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        ) : (
          <>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.editBtn} onPress={() => setEditMode(true)}>
                <Text style={styles.editBtnText}>✏️  Bearbeiten</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={deleteExpense}>
                <Text style={styles.deleteBtnText}>🗑️  Löschen</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.moveGroupBtn} onPress={showGroupPicker}>
              <Ionicons name="arrow-forward-circle-outline" size={22} color={theme.primary} />
              <Text style={styles.moveGroupBtnText}>In andere Gruppe verschieben</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* ── Kassenbon Vollbild-Modal ─────────────────────────────────── */}
      <Modal
        visible={receiptFullscreen}
        animationType="fade"
        transparent={false}
        statusBarTranslucent
        onRequestClose={() => setReceiptFullscreen(false)}
      >
        <View style={styles.fullscreenModal}>
          {/* TEST: Hardcoded Bild – falls das geht, liegt das Problem an receipt_url */}
          <Image
            source={{ uri: 'https://picsum.photos/400/800' }}
            style={[StyleSheet.absoluteFill, { opacity: 0.15 }]}
            resizeMode="cover"
            onLoad={() => console.log('[Modal] Test-Bild geladen ✅')}
            onError={(e) => console.log('[Modal] Test-Bild Fehler ❌', e.nativeEvent.error)}
          />

          {/* Echtes Kassenbon-Bild */}
          {expense.receipt_url ? (
            <Image
              source={{ uri: expense.receipt_url }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              onLoad={() => console.log('[Modal] Kassenbon geladen ✅', expense.receipt_url)}
              onError={(e) => console.log('[Modal] Kassenbon Fehler ❌', e.nativeEvent.error, 'URL:', expense.receipt_url)}
            />
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>Kein Kassenbon gespeichert</Text>
              <Text style={{ color: '#aaa', fontSize: 12 }}>receipt_url ist leer</Text>
            </View>
          )}

          <TouchableOpacity style={styles.fullscreenClose} onPress={() => setReceiptFullscreen(false)}>
            <Text style={styles.fullscreenCloseText}>✕ Schliessen</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    content: { padding: 16, paddingBottom: 40 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    errorText: { color: theme.textSecondary, fontSize: 15 },

    heroCard: {
      backgroundColor: theme.primary, borderRadius: 20, padding: 24, marginBottom: 20,
      shadowColor: theme.primary, shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
    },
    heroCatBadge: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'flex-start',
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 16,
    },
    heroCatIcon: { fontSize: 16, marginRight: 6 },
    heroCatLabel: { fontSize: 12, color: '#fff', fontWeight: '600' },
    heroTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8 },
    heroAmount: { fontSize: 40, fontWeight: '800', color: '#fff', marginBottom: 16 },
    heroMeta: { gap: 6, marginBottom: 16 },
    heroMetaText: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
    statusBadge: {
      alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    },
    statusGreen: { backgroundColor: 'rgba(34,197,94,0.25)' },
    statusOrange: { backgroundColor: 'rgba(251,146,60,0.25)' },
    statusText: { fontSize: 13, fontWeight: '600', color: '#fff' },

    editDescInput: {
      backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, padding: 12,
      fontSize: 18, color: '#fff', fontWeight: '600', marginBottom: 10,
    },
    editAmountInput: {
      backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, padding: 12,
      fontSize: 32, color: '#fff', fontWeight: '800', marginBottom: 16, textAlign: 'center',
    },

    section: { marginBottom: 20 },
    sectionTitle: {
      fontSize: 12, fontWeight: '700', color: theme.textSecondary,
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
    },

    catScroll: { marginBottom: 4 },
    catChip: {
      alignItems: 'center', backgroundColor: theme.card, borderRadius: 12,
      paddingHorizontal: 12, paddingVertical: 10, marginRight: 8,
      borderWidth: 1.5, borderColor: theme.border, minWidth: 72,
    },
    catChipActive: { backgroundColor: theme.primaryLight, borderColor: theme.primary },
    catChipIcon: { fontSize: 20, marginBottom: 4 },
    catChipLabel: { fontSize: 10, color: theme.textSecondary, textAlign: 'center' },
    catChipLabelActive: { color: theme.primary, fontWeight: '600' },

    splitRow: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card,
      borderRadius: 12, padding: 14, marginBottom: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    },
    splitAvatar: {
      width: 38, height: 38, borderRadius: 19, backgroundColor: theme.primaryLight,
      justifyContent: 'center', alignItems: 'center', marginRight: 12,
    },
    splitAvatarText: { fontSize: 15, fontWeight: '700', color: theme.primary },
    splitInfo: { flex: 1 },
    splitName: { fontSize: 14, fontWeight: '600', color: theme.text },
    splitAmount: { fontSize: 13, color: theme.textSecondary, marginTop: 2 },
    splitBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    splitBadgeGreen: { backgroundColor: theme.badgeGreenBg },
    splitBadgeOrange: { backgroundColor: theme.badgeOrangeBg },
    splitBadgeText: { fontSize: 11, fontWeight: '600', color: theme.badgeText },
    myShareBox: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      backgroundColor: theme.primaryLight, borderRadius: 12, padding: 14, marginTop: 4,
    },
    myShareLabel: { fontSize: 14, color: theme.primary, fontWeight: '600' },
    myShareAmount: { fontSize: 18, fontWeight: '700', color: theme.primary },

    receiptThumb: { width: '100%', height: 200, borderRadius: 12 },
    receiptTapHint: {
      position: 'absolute', bottom: 10, right: 10,
      backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    },
    receiptTapText: { color: '#fff', fontSize: 11, fontWeight: '600' },

    actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
    editBtn: {
      flex: 1, backgroundColor: theme.primaryLight, borderRadius: 12,
      paddingVertical: 14, alignItems: 'center',
    },
    editBtnText: { color: theme.primary, fontWeight: '700', fontSize: 14 },
    deleteBtn: {
      flex: 1, backgroundColor: theme.dangerBg, borderRadius: 12,
      paddingVertical: 14, alignItems: 'center',
    },
    deleteBtnText: { color: theme.danger, fontWeight: '700', fontSize: 14 },
    primaryBtn: {
      backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 16,
      alignItems: 'center', marginBottom: 10,
      shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    cancelBtn: { alignItems: 'center', paddingVertical: 12 },
    cancelBtnText: { color: theme.textSecondary, fontSize: 15 },
    moveGroupBtn: {
      flexDirection: 'row', alignItems: 'center',
      padding: 14, backgroundColor: theme.card,
      borderRadius: 12, marginTop: 8, gap: 10,
    },
    moveGroupBtnText: { color: theme.primary, fontWeight: '500', fontSize: 15 },

    fullscreenModal: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
    fullscreenClose: {
      position: 'absolute', top: 56, right: 20, zIndex: 10,
      backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20,
      paddingHorizontal: 14, paddingVertical: 8,
    },
    fullscreenCloseText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  });
}
