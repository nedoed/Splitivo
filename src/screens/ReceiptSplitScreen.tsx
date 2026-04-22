import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, Alert, ActivityIndicator, TextInput, TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { notifyGroupMembers } from '../lib/notifications';
import { haptics } from '../lib/haptics';
import { GroupMember } from '../types';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

// base64 → Uint8Array
function decode(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const str = base64.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((str.length * 3) / 4));
  let j = 0;
  for (let i = 0; i < str.length; i += 4) {
    const a = lookup[str.charCodeAt(i)], b = lookup[str.charCodeAt(i + 1)];
    const c = lookup[str.charCodeAt(i + 2)], d = lookup[str.charCodeAt(i + 3)];
    bytes[j++] = (a << 2) | (b >> 4);
    if (i + 2 < str.length) bytes[j++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < str.length) bytes[j++] = ((c & 3) << 6) | d;
  }
  return bytes.slice(0, j);
}

type ReceiptItem = {
  name: string;
  price: number;
  quantity: number;
  total: number;
  assignedTo: string; // 'all' | userId
  isManual?: boolean;
};

type ScanResult = {
  total: number;
  currency: string;
  description: string;
  category: string;
  items: Array<{ name: string; price: number; quantity: number; total: number }>;
};

export default function ReceiptSplitScreen({ route, navigation }: any) {
  const { group, members, scanResult, receiptImageUri }: {
    group: any;
    members: GroupMember[];
    scanResult: ScanResult;
    receiptImageUri: string;
  } = route.params;

  const [items, setItems] = useState<ReceiptItem[]>(
    scanResult.items.map((item) => ({ ...item, assignedTo: 'all' }))
  );
  // Separate String-State für Preis-TextInputs (verhindert Tipp-Unterbrechungen)
  const [itemPriceTexts, setItemPriceTexts] = useState<string[]>(
    scanResult.items.map((item) => item.total.toFixed(2))
  );
  const [paidBy, setPaidBy] = useState('');
  const [saving, setSaving] = useState(false);
  const [itemPickerVisible, setItemPickerVisible] = useState(false);
  const [itemPickerIndex, setItemPickerIndex] = useState(-1);
  const [paidByPickerVisible, setPaidByPickerVisible] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState('1');

  const { theme } = useTheme();
  const styles = getStyles(theme);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setPaidBy(user.id);
    });
  }, []);

  const calculateSplits = (): { [userId: string]: number } => {
    const splits: { [userId: string]: number } = {};
    members.forEach((m) => { splits[m.user_id] = 0; });

    items.forEach((item) => {
      if (item.assignedTo === 'all') {
        const perPerson = item.total / members.length;
        members.forEach((m) => { splits[m.user_id] += perPerson; });
      } else {
        splits[item.assignedTo] = (splits[item.assignedTo] ?? 0) + item.total;
      }
    });

    return splits;
  };

  const assignItem = (index: number, assignedTo: string) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, assignedTo } : item)));
  };

  const updateItemPriceText = (index: number, text: string) => {
    setItemPriceTexts((prev) => prev.map((t, i) => (i === index ? text : t)));
  };

  const commitItemPrice = (index: number, text: string) => {
    const parsed = parseFloat(text.replace(',', '.'));
    const newTotal = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, total: newTotal } : item)));
    setItemPriceTexts((prev) => prev.map((t, i) => (i === index ? newTotal.toFixed(2) : t)));
  };

  const addManualItem = () => {
    setNewItemName('');
    setNewItemPrice('');
    setNewItemQuantity('1');
    setShowAddModal(true);
  };

  const confirmAddItem = () => {
    if (!newItemName.trim()) {
      Alert.alert('Fehler', 'Bitte Bezeichnung eingeben');
      return;
    }
    const price = parseFloat(newItemPrice.replace(',', '.'));
    if (isNaN(price) || price <= 0) {
      Alert.alert('Fehler', 'Bitte gültigen Preis eingeben');
      return;
    }
    const quantity = parseInt(newItemQuantity) || 1;
    const total = parseFloat((price * quantity).toFixed(2));
    const newItem: ReceiptItem = {
      name: newItemName.trim(),
      price,
      quantity,
      total,
      assignedTo: 'all',
      isManual: true,
    };
    setItems((prev) => [...prev, newItem]);
    setItemPriceTexts((prev) => [...prev, total.toFixed(2)]);
    haptics.success();
    setShowAddModal(false);
  };

  const removeItem = (index: number) => {
    Alert.alert(
      'Position löschen',
      'Möchtest du diese Position entfernen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: () => {
            setItems((prev) => prev.filter((_, i) => i !== index));
            setItemPriceTexts((prev) => prev.filter((_, i) => i !== index));
            haptics.medium();
          },
        },
      ]
    );
  };

  const getAssignedName = (assignedTo: string) => {
    if (assignedTo === 'all') return 'Alle teilen';
    const m = members.find((m) => m.user_id === assignedTo);
    return (m as any)?.profile?.username ?? 'Unbekannt';
  };

  const getPaidByName = () => {
    const m = members.find((m) => m.user_id === paidBy);
    return (m as any)?.profile?.username ?? 'Auswählen...';
  };

  const handleSave = async () => {
    if (!paidBy) {
      Alert.alert('Fehler', 'Bitte wähle wer bezahlt hat.');
      return;
    }
    setSaving(true);
    try {
      // Kassenbon-Foto hochladen
      let receiptUrl: string | null = null;
      if (receiptImageUri) {
        const base64 = await FileSystem.readAsStringAsync(receiptImageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const { data: userData } = await supabase.auth.getUser();
        const fileName = `receipt-${userData.user?.id}-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('receipts')
          .upload(fileName, decode(base64), { contentType: 'image/jpeg', upsert: true });
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(fileName);
          receiptUrl = urlData.publicUrl;
        }
      }

      // Ausgabe erstellen
      const { data: expense, error: expenseError } = await supabase
        .from('expenses')
        .insert({
          group_id: group.id,
          paid_by: paidBy,
          amount: totalAmount,
          description: scanResult.description,
          category: scanResult.category,
          currency: scanResult.currency,
          date: new Date().toISOString().split('T')[0],
          receipt_url: receiptUrl,
          receipt_items: items.map(({ name, price, quantity, total, assignedTo }) => ({
            name, price, quantity, total, assignedTo,
          })),
        })
        .select()
        .single();

      if (expenseError) {
        Alert.alert('Fehler', expenseError.message);
        return;
      }

      // Splits erstellen
      const splits = calculateSplits();
      const splitRows = Object.entries(splits)
        .filter(([, amount]) => amount > 0.001)
        .map(([userId, amount]) => ({
          expense_id: expense.id,
          user_id: userId,
          amount: parseFloat(amount.toFixed(2)),
          is_settled: false,
        }));

      const { error: splitError } = await supabase.from('expense_splits').insert(splitRows);
      if (splitError) {
        Alert.alert('Fehler', splitError.message);
        return;
      }

      notifyGroupMembers(
        group.id,
        paidBy,
        'Neue Ausgabe 💸',
        `${getPaidByName()} hat „${scanResult.description}" (${scanResult.total.toFixed(2)} ${scanResult.currency}) erfasst.`
      );

      navigation.navigate('GroupDetail', { group });
    } catch (e) {
      Alert.alert('Fehler', 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  };

  const splits = calculateSplits();
  const { currency } = scanResult;
  const activeItem = itemPickerIndex >= 0 ? items[itemPickerIndex] : null;
  const totalAmount = items.reduce((sum, item) => sum + item.total, 0);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.headerCard}>
        <Text style={styles.headerTitle}>{scanResult.description}</Text>
        <Text style={styles.headerAmount}>{totalAmount.toFixed(2)} {currency}</Text>
        <Text style={styles.headerSub}>{items.length} Positionen</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Positionen */}
        <Text style={styles.sectionTitle}>POSITIONEN</Text>
        {items.map((item, index) => (
          <View key={index} style={styles.itemCard}>
            <View style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.quantity > 1 && (
                  <Text style={styles.itemQty}>
                    {item.quantity}× · {item.price.toFixed(2)} {currency}
                  </Text>
                )}
              </View>
              <View style={styles.priceInputWrapper}>
                <TextInput
                  style={styles.priceInput}
                  value={itemPriceTexts[index]}
                  onChangeText={(text) => updateItemPriceText(index, text)}
                  onEndEditing={(e) => commitItemPrice(index, e.nativeEvent.text)}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
                <Text style={styles.priceCurrency}>{currency}</Text>
              </View>
              <TouchableOpacity onPress={() => removeItem(index)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.assignPicker}
              onPress={() => { setItemPickerIndex(index); setItemPickerVisible(true); }}
              activeOpacity={0.7}
            >
              <Text style={styles.assignLabel}>Zuordnen:</Text>
              <Text style={styles.assignValue}>{getAssignedName(item.assignedTo)}</Text>
              <Text style={styles.assignArrow}>▾</Text>
            </TouchableOpacity>
          </View>
        ))}
        <Text style={styles.priceHint}>Tippe auf einen Preis um ihn zu ändern</Text>

        {/* Manuell hinzufügen */}
        <TouchableOpacity style={styles.addItemBtn} onPress={addManualItem}>
          <Text style={styles.addItemPlus}>+</Text>
          <Text style={styles.addItemText}>Position manuell hinzufügen</Text>
        </TouchableOpacity>

        {/* Zusammenfassung */}
        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>ZUSAMMENFASSUNG</Text>
        <View style={styles.summaryCard}>
          {members.map((m) => {
            const amount = splits[m.user_id] ?? 0;
            const name = (m as any).profile?.username ?? 'Unbekannt';
            return (
              <View key={m.user_id} style={styles.summaryRow}>
                <View style={styles.summaryAvatar}>
                  <Text style={styles.summaryAvatarText}>{name.charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={styles.summaryName}>{name}</Text>
                <Text style={[styles.summaryAmount, amount > 0 && styles.summaryAmountActive]}>
                  {amount.toFixed(2)} {currency}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Bezahlt von */}
        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>BEZAHLT VON</Text>
        <TouchableOpacity
          style={styles.paidByBtn}
          onPress={() => setPaidByPickerVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.paidByText}>{getPaidByName()}</Text>
          <Text style={styles.assignArrow}>▾</Text>
        </TouchableOpacity>

        {/* Speichern */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Ausgabe speichern</Text>
          }
        </TouchableOpacity>
      </ScrollView>

      {/* Positions-Picker Modal */}
      <Modal visible={itemPickerVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {activeItem?.name ?? ''} zuordnen
            </Text>
            {/* Alle teilen */}
            <TouchableOpacity
              style={[styles.modalItem, activeItem?.assignedTo === 'all' && styles.modalItemActive]}
              onPress={() => { assignItem(itemPickerIndex, 'all'); setItemPickerVisible(false); }}
            >
              <View style={[styles.modalAvatar, { backgroundColor: theme.primary }]}>
                <Text style={styles.modalAvatarText}>👥</Text>
              </View>
              <Text style={[styles.modalItemText, activeItem?.assignedTo === 'all' && styles.modalItemTextActive]}>
                Alle teilen
              </Text>
              {activeItem?.assignedTo === 'all' && <Text style={styles.modalCheck}>✓</Text>}
            </TouchableOpacity>
            {/* Pro Mitglied */}
            {members.map((m) => {
              const name = (m as any).profile?.username ?? 'Unbekannt';
              const isSelected = activeItem?.assignedTo === m.user_id;
              return (
                <TouchableOpacity
                  key={m.user_id}
                  style={[styles.modalItem, isSelected && styles.modalItemActive]}
                  onPress={() => { assignItem(itemPickerIndex, m.user_id); setItemPickerVisible(false); }}
                >
                  <View style={[styles.modalAvatar, isSelected && styles.modalAvatarActive]}>
                    <Text style={styles.modalAvatarText}>{name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>
                    {name}
                  </Text>
                  {isSelected && <Text style={styles.modalCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setItemPickerVisible(false)}>
              <Text style={styles.modalCancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Position hinzufügen Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowAddModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.addModalCard}>
                <Text style={styles.modalTitle}>Position hinzufügen</Text>

                <Text style={styles.addModalLabel}>Bezeichnung</Text>
                <TextInput
                  style={styles.addModalInput}
                  placeholder="z.B. Mineralwasser"
                  value={newItemName}
                  onChangeText={setNewItemName}
                  autoFocus
                />

                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addModalLabel}>Menge</Text>
                    <TextInput
                      style={[styles.addModalInput, { textAlign: 'center', marginBottom: 0 }]}
                      placeholder="1"
                      value={newItemQuantity}
                      onChangeText={setNewItemQuantity}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={{ flex: 2 }}>
                    <Text style={styles.addModalLabel}>Preis ({currency})</Text>
                    <TextInput
                      style={[styles.addModalInput, { textAlign: 'right', marginBottom: 0 }]}
                      placeholder="0.00"
                      value={newItemPrice}
                      onChangeText={setNewItemPrice}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>

                <TouchableOpacity style={styles.addModalConfirmBtn} onPress={confirmAddItem}>
                  <Text style={styles.addModalConfirmText}>Hinzufügen</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Zahler-Picker Modal */}
      <Modal visible={paidByPickerVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Wer hat bezahlt?</Text>
            {members.map((m) => {
              const name = (m as any).profile?.username ?? 'Unbekannt';
              const isSelected = paidBy === m.user_id;
              return (
                <TouchableOpacity
                  key={m.user_id}
                  style={[styles.modalItem, isSelected && styles.modalItemActive]}
                  onPress={() => { setPaidBy(m.user_id); setPaidByPickerVisible(false); }}
                >
                  <View style={[styles.modalAvatar, isSelected && styles.modalAvatarActive]}>
                    <Text style={styles.modalAvatarText}>{name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.modalItemText, isSelected && styles.modalItemTextActive]}>
                    {name}
                  </Text>
                  {isSelected && <Text style={styles.modalCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setPaidByPickerVisible(false)}>
              <Text style={styles.modalCancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },

    headerCard: {
      backgroundColor: theme.primary, margin: 16, borderRadius: 16, padding: 20,
      shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
    },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 4 },
    headerAmount: { fontSize: 32, fontWeight: '800', color: '#fff', marginBottom: 4 },
    headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },

    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

    sectionTitle: {
      fontSize: 11, fontWeight: '700', color: theme.textTertiary, letterSpacing: 1,
      marginBottom: 10, marginTop: 4,
    },

    itemCard: {
      backgroundColor: theme.card, borderRadius: 14, padding: 14, marginBottom: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1,
    },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
    itemInfo: { flex: 1, paddingRight: 12 },
    itemName: { fontSize: 15, fontWeight: '600', color: theme.text },
    itemQty: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
    itemTotal: { fontSize: 16, fontWeight: '700', color: theme.text },
    priceInputWrapper: { flexDirection: 'row', alignItems: 'center' },
    priceInput: {
      borderWidth: 1.5, borderColor: theme.primary, borderRadius: 8,
      paddingHorizontal: 8, paddingVertical: 4,
      width: 72, textAlign: 'right', fontSize: 15, fontWeight: '700',
      color: theme.text, backgroundColor: theme.inputBg,
    },
    priceCurrency: { fontSize: 12, color: theme.textSecondary, marginLeft: 4, fontWeight: '600' },
    priceHint: { fontSize: 11, color: theme.textTertiary, textAlign: 'center', marginTop: 2, marginBottom: 8 },

    assignPicker: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: theme.primaryLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    },
    assignLabel: { fontSize: 12, color: theme.textSecondary, marginRight: 6 },
    assignValue: { flex: 1, fontSize: 13, fontWeight: '600', color: theme.primary },
    assignArrow: { fontSize: 13, color: theme.primary },

    summaryCard: {
      backgroundColor: theme.card, borderRadius: 14, padding: 16, marginBottom: 12,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1,
    },
    summaryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    summaryAvatar: {
      width: 34, height: 34, borderRadius: 17, backgroundColor: theme.primary,
      justifyContent: 'center', alignItems: 'center', marginRight: 12,
    },
    summaryAvatarText: { fontSize: 14, fontWeight: '700', color: '#fff' },
    summaryName: { flex: 1, fontSize: 15, color: theme.text, fontWeight: '500' },
    summaryAmount: { fontSize: 16, fontWeight: '700', color: theme.border },
    summaryAmountActive: { color: theme.primary },

    paidByBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: theme.card, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
      marginBottom: 20,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1,
    },
    paidByText: { fontSize: 15, color: theme.text, fontWeight: '500' },

    saveBtn: {
      backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 17, alignItems: 'center',
      shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3,
      shadowRadius: 8, elevation: 4,
    },
    saveBtnDisabled: { opacity: 0.7 },
    saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

    modalOverlay: { flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' },
    modalCard: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
    modalTitle: { fontSize: 18, fontWeight: '700', color: theme.text, marginBottom: 16 },
    modalItem: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
      paddingHorizontal: 8, borderRadius: 12, marginBottom: 4,
    },
    modalItemActive: { backgroundColor: theme.primaryLight },
    modalAvatar: {
      width: 36, height: 36, borderRadius: 18, backgroundColor: theme.border,
      justifyContent: 'center', alignItems: 'center', marginRight: 12,
    },
    modalAvatarActive: { backgroundColor: theme.primary },
    modalAvatarText: { fontSize: 14, fontWeight: '700', color: '#fff' },
    modalItemText: { flex: 1, fontSize: 15, color: theme.text },
    modalItemTextActive: { color: theme.primary, fontWeight: '600' },
    modalCheck: { color: theme.primary, fontWeight: '700', fontSize: 16 },
    modalCancel: { alignItems: 'center', paddingVertical: 16, marginTop: 8 },
    modalCancelText: { color: theme.textSecondary, fontSize: 15 },

    deleteBtn: { padding: 6, marginLeft: 6, justifyContent: 'center' },
    deleteBtnText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },

    addItemBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      padding: 12, marginTop: 4, marginBottom: 8,
      borderWidth: 1.5, borderColor: theme.primary, borderStyle: 'dashed', borderRadius: 12,
      gap: 8,
    },
    addItemPlus: { fontSize: 20, color: theme.primary, lineHeight: 22 },
    addItemText: { color: theme.primary, fontWeight: '500', fontSize: 15 },

    addModalCard: {
      backgroundColor: theme.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 24, paddingBottom: 40,
    },
    addModalLabel: { fontSize: 13, color: theme.textSecondary, marginBottom: 6 },
    addModalInput: {
      borderWidth: 1, borderColor: theme.border, borderRadius: 10,
      padding: 12, fontSize: 15, marginBottom: 16, color: theme.text,
      backgroundColor: theme.inputBg,
    },
    addModalConfirmBtn: {
      backgroundColor: theme.primary, padding: 16, borderRadius: 12, alignItems: 'center',
    },
    addModalConfirmText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  });
}
