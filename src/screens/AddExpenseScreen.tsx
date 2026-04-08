import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Image, Modal,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { CATEGORIES, GroupMember } from '../types';

export default function AddExpenseScreen({ route, navigation }: any) {
  const { group, members }: { group: any; members: GroupMember[] } = route.params;

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('other');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [paidBy, setPaidBy] = useState('');
  const [paidByPickerVisible, setPaidByPickerVisible] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>(
    members.map((m) => m.user_id)
  );
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);

  const descriptionRef = useRef<TextInput>(null);
  const dateRef = useRef<TextInput>(null);

  // Eingeloggten User als Standard-Zahler setzen
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setPaidBy(user.id);
    });
  }, []);

  const getPaidByName = () => {
    const member = members.find((m) => m.user_id === paidBy);
    return (member as any)?.profile?.username ?? 'Auswählen...';
  };

  const toggleMember = (userId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const scanReceipt = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Berechtigung', 'Kamera-Zugriff benötigt für Kassenbon-Scan.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setReceiptImage(asset.uri);
    setScanLoading(true);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Lies diesen Kassenbon. Antworte NUR mit JSON: {"amount": 12.50, "description": "Supermarkt", "category": "food"}. Kategorien: food, transport, accommodation, entertainment, shopping, health, other.',
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${asset.base64}` },
              },
            ],
          }],
          max_tokens: 100,
        }),
      });
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content ?? '';
      const match = content.match(/\{.*\}/s);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.amount) setAmount(String(parsed.amount));
        if (parsed.description) setDescription(parsed.description);
        if (parsed.category) setCategory(parsed.category);
      }
    } catch {
      Alert.alert('Fehler', 'Kassenbon konnte nicht gelesen werden.');
    } finally {
      setScanLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      Alert.alert('Fehler', 'Bitte gib eine Beschreibung ein.');
      return;
    }
    const numAmount = parseFloat(amount.replace(',', '.'));
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Fehler', 'Bitte gib einen gültigen Betrag ein.');
      return;
    }
    if (!paidBy) {
      Alert.alert('Fehler', 'Bitte wähle wer bezahlt hat.');
      return;
    }
    if (selectedMembers.length === 0) {
      Alert.alert('Fehler', 'Wähle mindestens ein Mitglied für die Aufteilung.');
      return;
    }

    setLoading(true);
    try {
      const { data: expense, error: expenseError } = await supabase
        .from('expenses')
        .insert({
          group_id: group.id,
          paid_by: paidBy,
          amount: numAmount,
          description: description.trim(),
          category,
          date,
        })
        .select()
        .single();

      if (expenseError) {
        Alert.alert('Fehler', expenseError.message);
        return;
      }

      const splitAmount = numAmount / selectedMembers.length;
      const splits = selectedMembers.map((userId) => ({
        expense_id: expense.id,
        user_id: userId,
        amount: parseFloat(splitAmount.toFixed(2)),
        is_settled: false,
      }));

      const { error: splitError } = await supabase
        .from('expense_splits')
        .insert(splits);

      if (splitError) {
        Alert.alert('Fehler', splitError.message);
        return;
      }

      navigation.goBack();
    } catch (e) {
      Alert.alert('Fehler', 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  };

  const splitAmount =
    selectedMembers.length > 0 && parseFloat(amount.replace(',', '.')) > 0
      ? parseFloat(amount.replace(',', '.')) / selectedMembers.length
      : 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Kassenbon scannen */}
        <TouchableOpacity style={styles.scanBtn} onPress={scanReceipt} disabled={scanLoading}>
          {scanLoading ? (
            <ActivityIndicator color="#6C63FF" />
          ) : (
            <>
              <Text style={styles.scanIcon}>📷</Text>
              <Text style={styles.scanText}>Kassenbon scannen</Text>
            </>
          )}
        </TouchableOpacity>

        {receiptImage && (
          <Image source={{ uri: receiptImage }} style={styles.receiptPreview} resizeMode="cover" />
        )}

        {/* Betrag */}
        <Text style={styles.label}>Betrag (€)</Text>
        <TextInput
          style={[styles.input, styles.amountInput]}
          placeholder="0,00"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholderTextColor="#bbb"
          returnKeyType="next"
          onSubmitEditing={() => descriptionRef.current?.focus()}
          blurOnSubmit={false}
        />

        {/* Beschreibung */}
        <Text style={styles.label}>Beschreibung</Text>
        <TextInput
          ref={descriptionRef}
          style={styles.input}
          placeholder="z.B. Einkauf REWE"
          value={description}
          onChangeText={setDescription}
          placeholderTextColor="#999"
          returnKeyType="next"
          onSubmitEditing={() => dateRef.current?.focus()}
          blurOnSubmit={false}
        />

        {/* Wer hat bezahlt */}
        <Text style={styles.label}>Wer hat bezahlt?</Text>
        <TouchableOpacity
          style={styles.pickerBtn}
          onPress={() => setPaidByPickerVisible(true)}
        >
          <Text style={styles.pickerBtnText}>{getPaidByName()}</Text>
          <Text style={styles.pickerArrow}>▾</Text>
        </TouchableOpacity>

        {/* Kategorie */}
        <Text style={styles.label}>Kategorie</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoriesScroll}
          contentContainerStyle={styles.categoriesContent}
        >
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.value}
              style={[styles.categoryChip, category === cat.value && styles.categoryChipActive]}
              onPress={() => setCategory(cat.value)}
            >
              <Text style={styles.categoryIcon}>{cat.icon}</Text>
              <Text style={[styles.categoryLabel, category === cat.value && styles.categoryLabelActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Datum */}
        <Text style={styles.label}>Datum</Text>
        <TextInput
          ref={dateRef}
          style={styles.input}
          placeholder="JJJJ-MM-TT"
          value={date}
          onChangeText={setDate}
          placeholderTextColor="#999"
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
        />

        {/* Aufteilen mit */}
        <Text style={styles.label}>Gleichmässig aufteilen mit</Text>
        <View style={styles.membersList}>
          {members.map((member) => {
            const isSelected = selectedMembers.includes(member.user_id);
            const profile = (member as any).profile;
            const name = profile?.username ?? 'Unbekannt';
            return (
              <TouchableOpacity
                key={member.user_id}
                style={[styles.memberChip, isSelected && styles.memberChipActive]}
                onPress={() => toggleMember(member.user_id)}
              >
                <View style={[styles.memberAvatar, isSelected && styles.memberAvatarActive]}>
                  <Text style={styles.memberAvatarText}>
                    {name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.memberName, isSelected && styles.memberNameActive]}>
                  {name}
                </Text>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Split-Vorschau */}
        {splitAmount > 0 && (
          <View style={styles.splitPreview}>
            <Text style={styles.splitPreviewLabel}>Aufteilung</Text>
            <Text style={styles.splitPreviewAmount}>
              {splitAmount.toFixed(2)} € pro Person
            </Text>
            <Text style={styles.splitPreviewSub}>
              {selectedMembers.length} Person{selectedMembers.length !== 1 ? 'en' : ''} • Gesamt {parseFloat(amount.replace(',', '.')).toFixed(2)} €
            </Text>
          </View>
        )}

        {/* Speichern */}
        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitBtnText}>Ausgabe speichern</Text>
          }
        </TouchableOpacity>
      </ScrollView>
      </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      {/* Zahler-Picker Modal */}
      <Modal visible={paidByPickerVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Wer hat bezahlt?</Text>
            {members.map((member) => {
              const profile = (member as any).profile;
              const name = profile?.username ?? 'Unbekannt';
              const isSelected = paidBy === member.user_id;
              return (
                <TouchableOpacity
                  key={member.user_id}
                  style={[styles.modalItem, isSelected && styles.modalItemActive]}
                  onPress={() => {
                    setPaidBy(member.user_id);
                    setPaidByPickerVisible(false);
                  }}
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
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setPaidByPickerVisible(false)}
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
  safeArea: { flex: 1, backgroundColor: '#F8F8FF' },
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 48 },

  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#EEF0FF', borderRadius: 12, padding: 14, marginBottom: 20,
    borderWidth: 2, borderColor: '#D8D5FF', borderStyle: 'dashed',
  },
  scanIcon: { fontSize: 22, marginRight: 8 },
  scanText: { fontSize: 14, fontWeight: '600', color: '#6C63FF' },
  receiptPreview: { width: '100%', height: 140, borderRadius: 12, marginBottom: 16 },

  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 8 },

  input: {
    borderWidth: 1.5, borderColor: '#E8E8F0', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 15,
    color: '#1a1a2e', backgroundColor: '#fff', marginBottom: 16,
  },
  amountInput: { fontSize: 22, fontWeight: '700', color: '#1a1a2e', textAlign: 'center' },

  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: '#E8E8F0', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff', marginBottom: 16,
  },
  pickerBtnText: { fontSize: 15, color: '#1a1a2e', fontWeight: '500' },
  pickerArrow: { fontSize: 14, color: '#999' },

  categoriesScroll: { marginBottom: 16 },
  categoriesContent: { paddingRight: 16 },
  categoryChip: {
    alignItems: 'center', backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginRight: 8,
    borderWidth: 1.5, borderColor: '#E8E8F0', minWidth: 72,
  },
  categoryChipActive: { backgroundColor: '#EEF0FF', borderColor: '#6C63FF' },
  categoryIcon: { fontSize: 22, marginBottom: 4 },
  categoryLabel: { fontSize: 10, color: '#888', textAlign: 'center' },
  categoryLabelActive: { color: '#6C63FF', fontWeight: '600' },

  membersList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  memberChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1.5, borderColor: '#E8E8F0',
  },
  memberChipActive: { backgroundColor: '#EEF0FF', borderColor: '#6C63FF' },
  memberAvatar: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#ddd',
    justifyContent: 'center', alignItems: 'center', marginRight: 8,
  },
  memberAvatarActive: { backgroundColor: '#6C63FF' },
  memberAvatarText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  memberName: { fontSize: 13, color: '#555' },
  memberNameActive: { color: '#6C63FF', fontWeight: '600' },
  checkmark: { marginLeft: 6, color: '#6C63FF', fontWeight: '700', fontSize: 13 },

  splitPreview: {
    backgroundColor: '#EEF0FF', borderRadius: 12, padding: 16,
    alignItems: 'center', marginBottom: 20,
  },
  splitPreviewLabel: { fontSize: 12, color: '#6C63FF', fontWeight: '600', marginBottom: 4 },
  splitPreviewAmount: { fontSize: 24, fontWeight: '700', color: '#6C63FF' },
  splitPreviewSub: { fontSize: 12, color: '#888', marginTop: 4 },

  submitBtn: {
    backgroundColor: '#6C63FF', borderRadius: 12, paddingVertical: 16, alignItems: 'center',
    shadowColor: '#6C63FF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3,
    shadowRadius: 8, elevation: 4,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 16 },
  modalItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    paddingHorizontal: 8, borderRadius: 12, marginBottom: 4,
  },
  modalItemActive: { backgroundColor: '#EEF0FF' },
  modalAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#ddd',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  modalAvatarActive: { backgroundColor: '#6C63FF' },
  modalAvatarText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  modalItemText: { flex: 1, fontSize: 15, color: '#1a1a2e' },
  modalItemTextActive: { color: '#6C63FF', fontWeight: '600' },
  modalCheck: { color: '#6C63FF', fontWeight: '700', fontSize: 16 },
  modalCancel: { alignItems: 'center', paddingVertical: 16, marginTop: 8 },
  modalCancelText: { color: '#888', fontSize: 15 },
});
