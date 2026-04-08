import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Image, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { CATEGORIES, GroupMember } from '../types';

export default function AddExpenseScreen({ route, navigation }: any) {
  const { group, members }: { group: any; members: GroupMember[] } = route.params;
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('other');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal');
  const [selectedMembers, setSelectedMembers] = useState<string[]>(members.map((m) => m.user_id));
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);

  const scanReceipt = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Berechtigung', 'Kamera-Zugriff benötigt für Kassenbon-Scan.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.7,
    });

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
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Lies diesen Kassenbon und antworte NUR mit JSON im Format: {"amount": 12.50, "description": "Supermarkt", "category": "food"}. Kategorien: food, transport, accommodation, entertainment, shopping, health, other.',
                },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${asset.base64}` },
                },
              ],
            },
          ],
          max_tokens: 100,
        }),
      });

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content ?? '';
      const jsonMatch = content.match(/\{.*\}/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.amount) setAmount(String(parsed.amount));
        if (parsed.description) setDescription(parsed.description);
        if (parsed.category) setCategory(parsed.category);
      }
    } catch (e) {
      Alert.alert('Fehler', 'Kassenbon konnte nicht gelesen werden.');
    } finally {
      setScanLoading(false);
    }
  };

  const toggleMember = (userId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSubmit = async () => {
    if (!description.trim() || !amount) {
      Alert.alert('Fehler', 'Beschreibung und Betrag sind erforderlich.');
      return;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Fehler', 'Ungültiger Betrag.');
      return;
    }
    if (selectedMembers.length === 0) {
      Alert.alert('Fehler', 'Wähle mindestens ein Mitglied.');
      return;
    }

    setLoading(true);
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    const { data: expense, error } = await supabase
      .from('expenses')
      .insert({
        group_id: group.id,
        paid_by: user.user.id,
        amount: numAmount,
        description: description.trim(),
        category,
        date,
      })
      .select()
      .single();

    if (error) {
      Alert.alert('Fehler', error.message);
      setLoading(false);
      return;
    }

    const splitAmount = numAmount / selectedMembers.length;
    const splits = selectedMembers.map((userId) => ({
      expense_id: expense.id,
      user_id: userId,
      amount: splitAmount,
      is_settled: false,
    }));

    await supabase.from('expense_splits').insert(splits);

    setLoading(false);
    navigation.goBack();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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

      <Text style={styles.sectionLabel}>Beschreibung</Text>
      <TextInput
        style={styles.input}
        placeholder="z.B. Einkauf REWE"
        value={description}
        onChangeText={setDescription}
        placeholderTextColor="#999"
      />

      <Text style={styles.sectionLabel}>Betrag (€)</Text>
      <TextInput
        style={styles.input}
        placeholder="0.00"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholderTextColor="#999"
      />

      <Text style={styles.sectionLabel}>Datum</Text>
      <TextInput
        style={styles.input}
        placeholder="JJJJ-MM-TT"
        value={date}
        onChangeText={setDate}
        placeholderTextColor="#999"
      />

      <Text style={styles.sectionLabel}>Kategorie</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categories}>
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

      <Text style={styles.sectionLabel}>Aufteilen mit</Text>
      <View style={styles.membersList}>
        {members.map((member) => {
          const isSelected = selectedMembers.includes(member.user_id);
          const profile = (member as any).profile;
          return (
            <TouchableOpacity
              key={member.user_id}
              style={[styles.memberChip, isSelected && styles.memberChipActive]}
              onPress={() => toggleMember(member.user_id)}
            >
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>
                  {profile?.username?.charAt(0).toUpperCase() ?? '?'}
                </Text>
              </View>
              <Text style={[styles.memberName, isSelected && styles.memberNameActive]}>
                {profile?.username ?? 'Unbekannt'}
              </Text>
              {isSelected && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          );
        })}
      </View>

      {selectedMembers.length > 0 && amount && parseFloat(amount) > 0 && (
        <View style={styles.splitPreview}>
          <Text style={styles.splitPreviewText}>
            Jeder zahlt: {(parseFloat(amount) / selectedMembers.length).toFixed(2)} €
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Ausgabe hinzufügen</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8FF' },
  content: { padding: 20, paddingBottom: 40 },
  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#EEF0FF', borderRadius: 12, padding: 16, marginBottom: 20,
    borderWidth: 2, borderColor: '#D8D5FF', borderStyle: 'dashed',
  },
  scanIcon: { fontSize: 24, marginRight: 8 },
  scanText: { fontSize: 15, fontWeight: '600', color: '#6C63FF' },
  receiptPreview: { width: '100%', height: 150, borderRadius: 12, marginBottom: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 8, marginTop: 4 },
  input: { borderWidth: 1.5, borderColor: '#E8E8F0', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#1a1a2e', backgroundColor: '#fff', marginBottom: 16 },
  categories: { marginBottom: 16 },
  categoryChip: {
    alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    marginRight: 8, borderWidth: 1.5, borderColor: '#E8E8F0',
  },
  categoryChipActive: { backgroundColor: '#EEF0FF', borderColor: '#6C63FF' },
  categoryIcon: { fontSize: 22, marginBottom: 4 },
  categoryLabel: { fontSize: 11, color: '#888' },
  categoryLabelActive: { color: '#6C63FF', fontWeight: '600' },
  membersList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  memberChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1.5, borderColor: '#E8E8F0',
  },
  memberChipActive: { backgroundColor: '#EEF0FF', borderColor: '#6C63FF' },
  memberAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#6C63FF', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  memberAvatarText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  memberName: { fontSize: 13, color: '#555' },
  memberNameActive: { color: '#6C63FF', fontWeight: '600' },
  checkmark: { marginLeft: 6, color: '#6C63FF', fontWeight: '700' },
  splitPreview: { backgroundColor: '#EEF0FF', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 16 },
  splitPreviewText: { color: '#6C63FF', fontWeight: '600', fontSize: 14 },
  submitBtn: { backgroundColor: '#6C63FF', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8, shadowColor: '#6C63FF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
