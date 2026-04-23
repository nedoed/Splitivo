import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Expense, Group, GroupMember, CATEGORIES } from '../types';
import EmptyState from '../components/EmptyState';
import { addFriend } from '../lib/friends';
import { haptics } from '../lib/haptics';
import { generateInviteCode } from '../lib/invites';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

export default function GroupDetailScreen({ route, navigation }: any) {
  const { group }: { group: Group } = route.params;
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [friendsForInvite, setFriendsForInvite] = useState<any[]>([]);
  const [addingFriendId, setAddingFriendId] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [lastInviteCode, setLastInviteCode] = useState<string | null>(null);

  const { theme } = useTheme();
  const styles = getStyles(theme);

  const fetchData = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (user.user) setCurrentUserId(user.user.id);

    const { data: expensesData } = await supabase
      .from('expenses')
      .select('*')
      .eq('group_id', group.id)
      .order('date', { ascending: false });

    const { data: membersData } = await supabase
      .from('group_members')
      .select('*')
      .eq('group_id', group.id);

    if (expensesData && membersData) {
      const userIds = [
        ...new Set([
          ...membersData.map((m) => m.user_id),
          ...expensesData.map((e) => e.paid_by).filter(Boolean),
        ]),
      ];

      const { data: profiles } = userIds.length > 0
        ? await supabase.from('profiles').select('*').in('id', userIds)
        : { data: [] };

      const profileMap: { [id: string]: any } = {};
      profiles?.forEach((p) => { profileMap[p.id] = p; });

      const enrichedExpenses = expensesData.map((e) => ({
        ...e,
        payer: profileMap[e.paid_by] ?? null,
      }));

      const enrichedMembers = membersData.map((m) => ({
        ...m,
        profile: profileMap[m.user_id] ?? null,
      }));

      setExpenses(enrichedExpenses as any);
      setMembers(enrichedMembers as any);
    }

    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { fetchData(); }, []));

  const openInviteModal = async () => {
    setInviteModal(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: friendships } = await supabase
      .from('friendships')
      .select('friend_id, friend:profiles!friend_id(id, username, email)')
      .eq('user_id', userData.user.id);

    const memberUserIds = members.map((m) => m.user_id);
    const available = (friendships ?? [])
      .map((f) => f.friend)
      .filter((f): f is any => !!f && !memberUserIds.includes(f.id));

    setFriendsForInvite(available);
  };

  const addFriendToGroup = async (friend: any) => {
    setAddingFriendId(friend.id);
    const { error } = await supabase
      .from('group_members')
      .insert({ group_id: group.id, user_id: friend.id });

    if (error) {
      haptics.error();
      Alert.alert('Fehler', error.message);
    } else {
      haptics.success();
      setInviteModal(false);
      setFriendsForInvite([]);
      fetchData();
    }
    setAddingFriendId(null);
  };

  const shareInviteLink = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    setGeneratingLink(true);
    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('group_invites')
      .insert({ group_id: group.id, code, created_by: userData.user.id, expires_at: expiresAt });

    setGeneratingLink(false);

    if (error) {
      haptics.error();
      Alert.alert('Fehler', error.message);
      return;
    }

    setLastInviteCode(code);
    haptics.success();

    await Share.share({
      message:
        `Hallo! Ich lade dich ein, meiner Splitivo Gruppe „${group.name}" beizutreten.\n\n` +
        `1. Lade Splitivo herunter:\n` +
        `   iOS: https://apps.apple.com/app/splitivo/id6762624155\n` +
        `   Android: https://play.google.com/store/apps/details?id=com.nedoed.splitivo\n\n` +
        `2. Öffne die App und tippe auf „Code eingeben"\n\n` +
        `3. Gib diesen Code ein: ${code}\n\n` +
        `Oder tippe direkt auf diesen Link: splitivo://join/${code}\n\n` +
        `(Gültig 7 Tage)`,
      title: 'Splitivo Einladung',
    });
  };

  const copyInviteCode = async () => {
    if (!lastInviteCode) {
      await shareInviteLink();
      return;
    }
    await Clipboard.setStringAsync(lastInviteCode);
    haptics.success();
    Alert.alert('Kopiert! 📋', `Code ${lastInviteCode} wurde in die Zwischenablage kopiert.`);
  };

  const inviteMember = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setInviting(true);

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, username, email')
      .ilike('email', email)
      .limit(1);

    const profile = profiles?.[0];

    if (error || !profile) {
      Alert.alert(
        'Nicht gefunden',
        `Kein Konto für "${email}" gefunden.\n\nDie Person muss sich zuerst in der App registrieren.`
      );
      setInviting(false);
      return;
    }

    const alreadyMember = members.some((m) => m.user_id === profile.id);
    if (alreadyMember) {
      Alert.alert('Bereits Mitglied', `${profile.username} ist schon in dieser Gruppe.`);
      setInviting(false);
      return;
    }

    const { error: insertError } = await supabase
      .from('group_members')
      .insert({ group_id: group.id, user_id: profile.id });

    if (insertError) {
      haptics.error();
      Alert.alert('Fehler', insertError.message);
    } else {
      await addFriend(profile.id);
      haptics.success();
      Alert.alert('✓ Hinzugefügt', `${profile.username} wurde zur Gruppe hinzugefügt!`);
      setInviteEmail('');
      setInviteModal(false);
      setFriendsForInvite([]);
      fetchData();
    }
    setInviting(false);
  };

  const getCategoryIcon = (cat: string) => {
    return CATEGORIES.find((c) => c.value === cat)?.icon ?? '📦';
  };

  const totalByCurrency = expenses.reduce((acc, e) => {
    const cur = (e as any).currency ?? 'CHF';
    acc[cur] = (acc[cur] ?? 0) + e.amount;
    return acc;
  }, {} as Record<string, number>);

  const totalExpensesLabel = Object.entries(totalByCurrency)
    .map(([cur, amt]) => `${amt.toFixed(2)} ${cur}`)
    .join(' + ') || '0.00 CHF';

  const renderExpense = ({ item }: { item: Expense }) => (
    <TouchableOpacity
      style={styles.expenseCard}
      onPress={() => navigation.navigate('ExpenseDetail', { expense: item, members })}
      activeOpacity={0.7}
    >
      <View style={styles.expenseIcon}>
        <Text style={styles.expenseIconText}>{getCategoryIcon(item.category)}</Text>
      </View>
      <View style={styles.expenseInfo}>
        <Text style={styles.expenseName}>{item.description}</Text>
        <Text style={styles.expensePayer}>
          {(item as any).payer?.username ?? 'Unbekannt'} • {new Date(item.date).toLocaleDateString('de-DE')}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.expenseAmount}>{item.amount.toFixed(2)} {(item as any).currency ?? 'CHF'}</Text>
        <Text style={styles.expenseChevron}>›</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.summaryLabel}>Gesamtausgaben</Text>
            <Text style={styles.summaryAmount}>{totalExpensesLabel}</Text>
          </View>
          <View style={styles.membersRow}>
            {members.slice(0, 4).map((m, i) => (
              <View key={m.id} style={[styles.memberAvatar, { marginLeft: i > 0 ? -8 : 0 }]}>
                <Text style={styles.memberAvatarText}>
                  {(m as any).profile?.username?.charAt(0).toUpperCase() ?? '?'}
                </Text>
              </View>
            ))}
            {members.length > 4 && (
              <View style={[styles.memberAvatar, styles.memberAvatarMore, { marginLeft: -8 }]}>
                <Text style={styles.memberMoreText}>+{members.length - 4}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => navigation.navigate('AddExpense', { group, members })}
          >
            <Text style={styles.actionBtnText}>+ Ausgabe</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnOutline]} onPress={openInviteModal}>
            <Text style={[styles.actionBtnText, styles.actionBtnTextOutline]}>+ Mitglied</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : expenses.length === 0 ? (
        <EmptyState
          emoji="💸"
          title="Erste Ausgabe erfassen"
          subtitle={"Tippe auf + um die erste\nAusgabe dieser Gruppe hinzuzufügen"}
          buttonText="Ausgabe hinzufügen"
          onButtonPress={() => navigation.navigate('AddExpense', { group, members })}
        />
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          renderItem={renderExpense}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={theme.primary} />}
        />
      )}

      <Modal visible={inviteModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Mitglied einladen</Text>

                {friendsForInvite.length > 0 && (
                  <>
                    <Text style={styles.modalSectionLabel}>Freunde</Text>
                    {friendsForInvite.map((friend) => (
                      <TouchableOpacity
                        key={friend.id}
                        style={styles.friendRow}
                        onPress={() => addFriendToGroup(friend)}
                        disabled={addingFriendId === friend.id}
                        activeOpacity={0.7}
                      >
                        <View style={styles.friendAvatar}>
                          <Text style={styles.friendAvatarText}>
                            {friend.username.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.friendName}>{friend.username}</Text>
                          <Text style={styles.friendEmail}>{friend.email}</Text>
                        </View>
                        {addingFriendId === friend.id
                          ? <ActivityIndicator color={theme.primary} size="small" />
                          : <Text style={styles.friendAdd}>+ Hinzufügen</Text>
                        }
                      </TouchableOpacity>
                    ))}
                    <View style={styles.modalDivider}>
                      <View style={styles.dividerLine} />
                      <Text style={styles.dividerText}>oder per E-Mail</Text>
                      <View style={styles.dividerLine} />
                    </View>
                  </>
                )}

                <Text style={styles.modalSectionLabel}>Einladungslink</Text>
                <TouchableOpacity
                  style={[styles.linkBtn, generatingLink && { opacity: 0.7 }]}
                  onPress={shareInviteLink}
                  disabled={generatingLink}
                  activeOpacity={0.8}
                >
                  {generatingLink
                    ? <ActivityIndicator color={theme.primary} size="small" />
                    : <Text style={styles.linkBtnText}>🔗  Link generieren & teilen</Text>
                  }
                </TouchableOpacity>

                {lastInviteCode && (
                  <TouchableOpacity style={styles.copyCodeBtn} onPress={copyInviteCode} activeOpacity={0.8}>
                    <Text style={styles.copyCodeText}>📋  Code kopieren: </Text>
                    <Text style={styles.copyCodeValue}>{lastInviteCode}</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.modalDivider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>oder per E-Mail</Text>
                  <View style={styles.dividerLine} />
                </View>

                {friendsForInvite.length === 0 && (
                  <Text style={styles.modalHint}>E-Mail des registrierten Benutzers</Text>
                )}
                <TextInput
                  style={styles.input}
                  placeholder="freund@email.de"
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor={theme.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={inviteMember}
                  autoFocus={friendsForInvite.length === 0}
                />
                <TouchableOpacity style={[styles.button, inviting && styles.buttonDisabled]} onPress={inviteMember} disabled={inviting}>
                  {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Per E-Mail einladen</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { Keyboard.dismiss(); setInviteModal(false); setFriendsForInvite([]); }}>
                  <Text style={styles.cancelText}>Abbrechen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    summaryCard: {
      backgroundColor: theme.primary, margin: 16, borderRadius: 16, padding: 20,
      shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
    },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    summaryLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 4 },
    summaryAmount: { fontSize: 28, fontWeight: '700', color: '#fff' },
    membersRow: { flexDirection: 'row', alignItems: 'center' },
    memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: theme.primary },
    memberAvatarText: { fontSize: 14, fontWeight: '700', color: '#fff' },
    memberAvatarMore: { backgroundColor: 'rgba(0,0,0,0.2)' },
    memberMoreText: { fontSize: 11, fontWeight: '700', color: '#fff' },
    actionRow: { flexDirection: 'row', gap: 10 },
    actionBtn: { flex: 1, backgroundColor: '#fff', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
    actionBtnText: { color: theme.primary, fontWeight: '700', fontSize: 14 },
    actionBtnOutline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' },
    actionBtnTextOutline: { color: '#fff' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { padding: 16 },
    expenseCard: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card,
      borderRadius: 12, padding: 14, marginBottom: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    },
    expenseIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    expenseIconText: { fontSize: 20 },
    expenseInfo: { flex: 1 },
    expenseName: { fontSize: 15, fontWeight: '600', color: theme.text },
    expensePayer: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
    expenseAmount: { fontSize: 16, fontWeight: '700', color: theme.primary },
    expenseChevron: { fontSize: 16, color: theme.border, marginTop: 2 },
    modalOverlay: { flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' },
    modalCard: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
    modalTitle: { fontSize: 20, fontWeight: '700', color: theme.text, marginBottom: 12 },
    modalHint: { fontSize: 13, color: theme.textSecondary, marginBottom: 16 },
    modalSectionLabel: { fontSize: 12, fontWeight: '700', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
    friendRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 10, paddingHorizontal: 4,
      borderBottomWidth: 1, borderBottomColor: theme.borderLight,
    },
    friendAvatar: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: theme.primaryLight,
      justifyContent: 'center', alignItems: 'center', marginRight: 12,
    },
    friendAvatarText: { fontSize: 16, fontWeight: '700', color: theme.primary },
    friendName: { fontSize: 14, fontWeight: '600', color: theme.text },
    friendEmail: { fontSize: 12, color: theme.textSecondary, marginTop: 1 },
    friendAdd: { fontSize: 13, color: theme.primary, fontWeight: '600' },
    modalDivider: {
      flexDirection: 'row', alignItems: 'center',
      marginVertical: 16, gap: 8,
    },
    dividerLine: { flex: 1, height: 1, backgroundColor: theme.border },
    dividerText: { fontSize: 12, color: theme.textTertiary, fontWeight: '500' },
    linkBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: theme.primary, borderRadius: 12,
      paddingVertical: 13, marginBottom: 8,
    },
    linkBtnText: { color: theme.primary, fontWeight: '700', fontSize: 14 },
    copyCodeBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.primaryLight, borderRadius: 10, paddingVertical: 10, marginBottom: 8,
    },
    copyCodeText: { color: theme.primary, fontSize: 13 },
    copyCodeValue: { color: theme.primary, fontWeight: '800', fontSize: 14, letterSpacing: 1 },
    input: { borderWidth: 1.5, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: theme.text, backgroundColor: theme.inputBg, marginBottom: 12 },
    button: { backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    buttonDisabled: { opacity: 0.7 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    cancelBtn: { alignItems: 'center', padding: 16 },
    cancelText: { color: theme.textSecondary, fontSize: 15 },
  });
}
