import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity, Alert, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

interface SpesaExpense {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  group_name: string;
  payer_name: string;
  is_settled: boolean;
}

type ExportRange = 'current' | 'last' | 'all' | 'custom';

export default function SpesaScreen() {
  const [expenses, setExpenses] = useState<SpesaExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportModal, setExportModal] = useState(false);

  const fetchSpesen = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: memberGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userData.user.id);

    if (!memberGroups || memberGroups.length === 0) {
      setExpenses([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const groupIds = memberGroups.map((m) => m.group_id);

    const { data, error } = await supabase
      .from('expenses')
      .select(`
        id, date, description, category, amount, currency, paid_by,
        groups!group_id(name),
        payer:profiles!paid_by(username),
        expense_splits!expense_id(is_settled, user_id)
      `)
      .eq('category', 'expenses')
      .in('group_id', groupIds)
      .order('date', { ascending: false });

    if (error || !data) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const userId = userData.user.id;
    const mapped: SpesaExpense[] = data.map((e: any) => {
      const mySplit = e.expense_splits?.find((s: any) => s.user_id === userId);
      return {
        id: e.id,
        date: e.date,
        description: e.description,
        category: e.category,
        amount: e.amount,
        currency: e.currency ?? 'CHF',
        group_name: e.groups?.name ?? '—',
        payer_name: e.payer?.username ?? '—',
        is_settled: mySplit?.is_settled ?? false,
      };
    });

    setExpenses(mapped);
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { fetchSpesen(); }, []));

  // ─── Gruppiert nach Monat ───────────────────────────────────────────────────

  const groupByMonth = (items: SpesaExpense[]) => {
    const map: Record<string, SpesaExpense[]> = {};
    items.forEach((e) => {
      const key = e.date.slice(0, 7); // "YYYY-MM"
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return Object.entries(map).map(([month, list]) => ({ month, list }));
  };

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  };

  const monthTotal = (list: SpesaExpense[]) => {
    const byCur: Record<string, number> = {};
    list.forEach((e) => {
      byCur[e.currency] = (byCur[e.currency] ?? 0) + e.amount;
    });
    return Object.entries(byCur)
      .map(([c, a]) => `${a.toFixed(2)} ${c}`)
      .join(' + ');
  };

  // ─── Excel Export ───────────────────────────────────────────────────────────

  const exportToExcel = async (range: ExportRange) => {
    // Modal zuerst schliessen, dann Delay bevor wir weitermachen
    setExportModal(false);
    await new Promise((r) => setTimeout(r, 400));
    setExporting(true);
    await new Promise((r) => setTimeout(r, 50));

    try {
      console.log('A. Export gestartet, Range:', range);

      // ── Daten filtern ────────────────────────────────────────────────────
      const now = new Date();
      let filtered = expenses;

      if (range === 'current') {
        const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        filtered = expenses.filter((e) => e.date.startsWith(prefix));
      } else if (range === 'last') {
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        filtered = expenses.filter((e) => e.date.startsWith(prefix));
      }

      console.log('B. Spesen werden geladen:', filtered.length);

      if (!filtered || filtered.length === 0) {
        Alert.alert('Keine Spesen', 'Keine Einträge für den gewählten Zeitraum.');
        return;
      }

      // ── Excel-Workbook bauen (synchron → in setTimeout) ──────────────────
      console.log('C. Excel Workbook wird erstellt...');
      const wbout: string = await new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            const wsData: (string | number)[][] = [
              ['Datum', 'Beschreibung', 'Kategorie', 'Betrag', 'Währung', 'Gruppe', 'Bezahlt von', 'Status'],
              ...filtered.map((e) => [
                new Date(e.date).toLocaleDateString('de-CH'),
                e.description,
                'Spesen',
                e.amount,
                e.currency ?? 'CHF',
                e.group_name ?? '',
                e.payer_name ?? '',
                e.is_settled ? 'Beglichen' : 'Offen',
              ]),
            ];
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            ws['!cols'] = [
              { wch: 12 }, { wch: 28 }, { wch: 10 }, { wch: 10 },
              { wch: 8 }, { wch: 20 }, { wch: 18 }, { wch: 12 },
            ];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Spesen');
            resolve(XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }));
          } catch (err) {
            reject(err);
          }
        }, 0);
      });
      console.log('D. Excel erstellt, Base64-Länge:', wbout.length);

      // ── Datei schreiben ──────────────────────────────────────────────────
      const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
      if (!dir) throw new Error('Kein Dateisystem-Verzeichnis verfügbar.');
      const fileUri = `${dir}spesen_export.xlsx`;
      console.log('E. Datei wird geschrieben:', fileUri);

      await FileSystem.writeAsStringAsync(fileUri, wbout, {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log('Datei gespeichert.');

      // ── Spinner stoppen BEVOR Share-Sheet erscheint ──────────────────────
      // (React re-render darf den nativen Dialog nicht unterbrechen)
      setExporting(false);
      await new Promise((r) => setTimeout(r, 100));

      // ── Teilen via Share-Sheet ───────────────────────────────────────────
      console.log('F. Sharing wird geöffnet...');
      const sharingAvailable = await Sharing.isAvailableAsync();
      console.log('Sharing verfügbar:', sharingAvailable);

      if (sharingAvailable) {
        await Sharing.shareAsync(fileUri, {
          dialogTitle: 'Spesen exportieren',
        });
        console.log('Share-Sheet wurde geschlossen.');
      } else {
        // Fallback: In Medien-Bibliothek speichern
        console.log('Sharing nicht verfügbar – versuche MediaLibrary...');
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          const asset = await MediaLibrary.createAssetAsync(fileUri);
          Alert.alert(
            'Export erfolgreich ✅',
            `Datei gespeichert: ${asset.filename}\n\nDu findest sie in der Dateien-App.`,
            [{ text: 'OK' }]
          );
        } else {
          Alert.alert('Gespeichert', `Datei liegt unter:\n${fileUri}`);
        }
      }
    } catch (e: any) {
      console.log('Export Fehler:', e?.message ?? String(e));
      Alert.alert('Export Fehler', e?.message ?? 'Unbekannter Fehler.');
    } finally {
      setExporting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  const grouped = groupByMonth(expenses);

  const renderSection = ({ item }: { item: { month: string; list: SpesaExpense[] } }) => (
    <View style={styles.monthSection}>
      <View style={styles.monthHeader}>
        <Text style={styles.monthTitle}>{monthLabel(item.month)}</Text>
        <Text style={styles.monthTotal}>{monthTotal(item.list)}</Text>
      </View>
      {item.list.map((e) => (
        <View key={e.id} style={styles.row}>
          <View style={styles.rowLeft}>
            <Text style={styles.rowDate}>{new Date(e.date).toLocaleDateString('de-DE')}</Text>
            <Text style={styles.rowDesc}>{e.description}</Text>
            <Text style={styles.rowMeta}>{e.group_name} · {e.payer_name}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.rowAmount}>{e.amount.toFixed(2)} {e.currency}</Text>
            <View style={[styles.badge, e.is_settled ? styles.badgeGreen : styles.badgeOrange]}>
              <Text style={styles.badgeText}>{e.is_settled ? 'Beglichen' : 'Offen'}</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );

  const totalLabel = (() => {
    const byCur: Record<string, number> = {};
    expenses.forEach((e) => { byCur[e.currency] = (byCur[e.currency] ?? 0) + e.amount; });
    const entries = Object.entries(byCur);
    if (entries.length === 0) return '0.00 CHF';
    return entries.map(([c, a]) => `${a.toFixed(2)} ${c}`).join(' + ');
  })();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Spesen</Text>
          <Text style={styles.subtitle}>{expenses.length} Einträge · {totalLabel}</Text>
        </View>
        <TouchableOpacity
          style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
          onPress={() => setExportModal(true)}
          disabled={exporting || expenses.length === 0}
        >
          {exporting
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.exportBtnText}>📊 Export</Text>
          }
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
      ) : expenses.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💼</Text>
          <Text style={styles.emptyTitle}>Keine Spesen</Text>
          <Text style={styles.emptyText}>
            Erfasse Ausgaben mit der Kategorie „Spesen" um sie hier zu sehen.
          </Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(item) => item.month}
          renderItem={renderSection}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchSpesen(); }}
              tintColor="#6C63FF"
            />
          }
        />
      )}

      {/* Export-Optionen Modal */}
      <Modal visible={exportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Excel exportieren</Text>
            <Text style={styles.modalSubtitle}>Zeitraum wählen</Text>

            {([
              ['current', '📅', 'Aktueller Monat'],
              ['last',    '📆', 'Letzter Monat'],
              ['all',     '📋', 'Alle Spesen'],
            ] as [ExportRange, string, string][]).map(([range, icon, label]) => (
              <TouchableOpacity
                key={range}
                style={styles.exportOption}
                onPress={() => exportToExcel(range)}
              >
                <Text style={styles.exportOptionIcon}>{icon}</Text>
                <Text style={styles.exportOptionText}>{label}</Text>
                <Text style={styles.exportOptionArrow}>›</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setExportModal(false)}
            >
              <Text style={styles.modalCancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8FF' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e' },
  subtitle: { fontSize: 12, color: '#888', marginTop: 2 },

  exportBtn: {
    backgroundColor: '#6C63FF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
  },
  exportBtnDisabled: { opacity: 0.5 },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingTop: 4 },

  monthSection: { marginBottom: 20 },
  monthHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  monthTitle: { fontSize: 13, fontWeight: '700', color: '#6C63FF', textTransform: 'uppercase', letterSpacing: 0.5 },
  monthTotal: { fontSize: 13, fontWeight: '700', color: '#6C63FF' },

  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05,
    shadowRadius: 6, elevation: 1,
  },
  rowLeft: { flex: 1, marginRight: 12 },
  rowDate: { fontSize: 11, color: '#aaa', marginBottom: 2 },
  rowDesc: { fontSize: 15, fontWeight: '600', color: '#1a1a2e' },
  rowMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeGreen: { backgroundColor: '#DCFCE7' },
  badgeOrange: { backgroundColor: '#FEF3C7' },
  badgeText: { fontSize: 10, fontWeight: '600', color: '#555' },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  modalSubtitle: { fontSize: 13, color: '#888', marginBottom: 16 },
  exportOption: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  exportOptionIcon: { fontSize: 22, marginRight: 14 },
  exportOptionText: { flex: 1, fontSize: 16, color: '#1a1a2e' },
  exportOptionArrow: { fontSize: 20, color: '#ccc' },
  modalCancel: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  modalCancelText: { color: '#888', fontSize: 15 },
});
