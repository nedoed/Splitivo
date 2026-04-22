import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback,
  Keyboard, Animated, PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { addFriend, removeFriend } from '../lib/friends';
import { haptics } from '../lib/haptics';
import EmptyState from '../components/EmptyState';
import { useTheme } from '../lib/ThemeContext';
import { Theme } from '../lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Friend {
  id: string;
  username: string;
  email: string;
  shared_groups: number;
  friendship_created_at: string;
}

// ─── Status Helper ────────────────────────────────────────────────────────────

function statusColor(sharedGroups: number): string {
  if (sharedGroups >= 2) return '#22C55E'; // grün
  if (sharedGroups === 1) return '#F59E0B'; // gelb
  return '#D1D5DB'; // grau
}

function statusLabel(sharedGroups: number): string {
  if (sharedGroups === 0) return 'Noch keine gemeinsame Gruppe';
  if (sharedGroups === 1) return '1 gemeinsame Gruppe';
  return `${sharedGroups} gemeinsame Gruppen`;
}

// ─── Swipeable Friend Row ─────────────────────────────────────────────────────

type SwipeableFriendRowProps = {
  friend: Friend;
  onDelete: (id: string) => void;
  styles: ReturnType<typeof getStyles>;
};

function SwipeableFriendRow({ friend, onDelete, styles }: SwipeableFriendRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const ACTION_WIDTH = 80;
  const THRESHOLD = -50;

  const close = () =>
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 8,
      onPanResponderMove: (_, g) => {
        if (g.dx <= 0) translateX.setValue(Math.max(g.dx, -ACTION_WIDTH));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < THRESHOLD) {
          haptics.light();
          Animated.spring(translateX, { toValue: -ACTION_WIDTH, useNativeDriver: true, tension: 80, friction: 10 }).start();
        } else {
          close();
        }
      },
    })
  ).current;

  const handleDelete = () => {
    haptics.warning();
    Alert.alert(
      'Freund entfernen',
      `Möchtest du ${friend.username} aus deiner Freundesliste entfernen?`,
      [
        { text: 'Abbrechen', style: 'cancel', onPress: close },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: () => onDelete(friend.id),
        },
      ]
    );
  };

  const initials = friend.username.charAt(0).toUpperCase();
  const dot = statusColor(friend.shared_groups);

  return (
    <View style={styles.swipeContainer}>
      {/* Delete action behind */}
      <TouchableOpacity style={styles.deleteAction} onPress={handleDelete} activeOpacity={0.85}>
        <Text style={styles.deleteActionIcon}>🗑️</Text>
        <Text style={styles.deleteActionLabel}>Entfernen</Text>
      </TouchableOpacity>

      {/* Card */}
      <Animated.View style={[styles.friendCard, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        <View style={styles.avatarWrapper}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: dot }]} />
        </View>

        <View style={styles.friendInfo}>
          <Text style={styles.friendName}>{friend.username}</Text>
          <Text style={styles.friendEmail} numberOfLines={1}>{friend.email}</Text>
          <Text style={styles.sharedGroups}>{statusLabel(friend.shared_groups)}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Search Result Preview ────────────────────────────────────────────────────

type SearchResult = { id: string; username: string; email: string } | null;

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function FriendsScreen() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');

  const { theme } = useTheme();
  const styles = getStyles(theme);

  // Add modal state
  const [addModal, setAddModal] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult>(null);
  const [adding, setAdding] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchFriends = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    setCurrentUserId(userData.user.id);
    const userId = userData.user.id;

    // 1. My group IDs
    const { data: myGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId);
    const myGroupIds = myGroups?.map((g) => g.group_id) ?? [];

    // 2. Friendships with profiles
    const { data: friendships } = await supabase
      .from('friendships')
      .select('friend_id, created_at, friend:profiles!friend_id(id, username, email)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!friendships || friendships.length === 0) {
      setFriends([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const friendIds = friendships.map((f) => f.friend_id);

    // 3. All group memberships for all friends (single query)
    const { data: friendMemberships } = myGroupIds.length > 0
      ? await supabase
          .from('group_members')
          .select('user_id, group_id')
          .in('user_id', friendIds)
          .in('group_id', myGroupIds)
      : { data: [] };

    // 4. Count shared groups per friend
    const sharedMap: Record<string, number> = {};
    friendMemberships?.forEach((m) => {
      sharedMap[m.user_id] = (sharedMap[m.user_id] ?? 0) + 1;
    });

    const result: Friend[] = friendships
      .filter((f) => f.friend)
      .map((f) => ({
        id: (f.friend as any).id,
        username: (f.friend as any).username ?? '?',
        email: (f.friend as any).email ?? '',
        shared_groups: sharedMap[f.friend_id] ?? 0,
        friendship_created_at: f.created_at,
      }));

    setFriends(result);
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { fetchFriends(); }, []));

  // ── Search by E-Mail ────────────────────────────────────────────────────────

  const searchFriend = async () => {
    const email = searchEmail.trim().toLowerCase();
    if (!email) return;
    setSearching(true);
    setSearchResult(null);

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, email')
      .ilike('email', email)
      .limit(1);

    const profile = profiles?.[0];

    if (!profile) {
      haptics.error();
      Alert.alert('Nicht gefunden', 'Kein Nutzer mit dieser E-Mail-Adresse gefunden.');
      setSearching(false);
      return;
    }

    if (profile.id === currentUserId) {
      Alert.alert('Hinweis', 'Du kannst dich nicht selbst als Freund hinzufügen.');
      setSearching(false);
      return;
    }

    const alreadyFriend = friends.some((f) => f.id === profile.id);
    if (alreadyFriend) {
      Alert.alert('Bereits Freund', `${profile.username} ist schon in deiner Freundesliste.`);
      setSearching(false);
      return;
    }

    setSearchResult(profile);
    setSearching(false);
  };

  const confirmAddFriend = async () => {
    if (!searchResult) return;
    setAdding(true);

    await addFriend(searchResult.id);

    haptics.success();
    setAddModal(false);
    setSearchEmail('');
    setSearchResult(null);
    fetchFriends();
    setAdding(false);
  };

  // ── Remove ──────────────────────────────────────────────────────────────────

  const handleRemoveFriend = async (friendId: string) => {
    await removeFriend(friendId);
    haptics.heavy();
    setFriends((prev) => prev.filter((f) => f.id !== friendId));
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: Friend }) => (
    <SwipeableFriendRow friend={item} onDelete={handleRemoveFriend} styles={styles} />
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Stats bar */}
      {friends.length > 0 && (
        <View style={styles.statsBar}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{friends.length}</Text>
            <Text style={styles.statLabel}>Freunde</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{friends.filter((f) => f.shared_groups > 0).length}</Text>
            <Text style={styles.statLabel}>Aktiv</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{friends.filter((f) => f.shared_groups >= 2).length}</Text>
            <Text style={styles.statLabel}>Enge Kontakte</Text>
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : friends.length === 0 ? (
        <EmptyState
          emoji="🤝"
          title="Noch keine Freunde"
          subtitle={"Füge Freunde hinzu um sie\nschnell zu Gruppen einzuladen"}
          buttonText="Freund hinzufügen"
          onButtonPress={() => setAddModal(true)}
        />
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchFriends(); }}
              tintColor={theme.primary}
            />
          }
        />
      )}

      {/* Floating Add Button */}
      {friends.length > 0 && (
        <TouchableOpacity style={styles.fab} onPress={() => { haptics.light(); setAddModal(true); }}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}

      {/* Add Friend Modal */}
      <Modal visible={addModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Freund hinzufügen</Text>
                <Text style={styles.modalHint}>E-Mail-Adresse des Nutzers</Text>

                <View style={styles.searchRow}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="freund@email.de"
                    value={searchEmail}
                    onChangeText={(t) => { setSearchEmail(t); setSearchResult(null); }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    placeholderTextColor="#999"
                    returnKeyType="search"
                    onSubmitEditing={searchFriend}
                    autoFocus
                  />
                  <TouchableOpacity
                    style={[styles.searchBtn, searching && styles.searchBtnDisabled]}
                    onPress={searchFriend}
                    disabled={searching}
                  >
                    {searching
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.searchBtnText}>Suchen</Text>
                    }
                  </TouchableOpacity>
                </View>

                {/* Search result preview */}
                {searchResult && (
                  <View style={styles.resultCard}>
                    <View style={styles.resultAvatar}>
                      <Text style={styles.resultAvatarText}>
                        {searchResult.username.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName}>{searchResult.username}</Text>
                      <Text style={styles.resultEmail}>{searchResult.email}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.addBtn, adding && { opacity: 0.7 }]}
                      onPress={confirmAddFriend}
                      disabled={adding}
                    >
                      {adding
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={styles.addBtnText}>Hinzufügen</Text>
                      }
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => { setAddModal(false); setSearchEmail(''); setSearchResult(null); }}
                >
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

// ─── Styles ───────────────────────────────────────────────────────────────────

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { paddingVertical: 8, paddingBottom: 100 },

    statsBar: {
      flexDirection: 'row',
      backgroundColor: theme.card,
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 4,
      borderRadius: 16,
      padding: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 2,
    },
    stat: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: 22, fontWeight: '700', color: theme.primary },
    statLabel: { fontSize: 11, color: theme.textSecondary, marginTop: 2 },
    statDivider: { width: 1, backgroundColor: theme.borderLight },

    swipeContainer: {
      marginHorizontal: 16,
      marginVertical: 5,
      borderRadius: 14,
      overflow: 'hidden',
    },
    deleteAction: {
      position: 'absolute', right: 0, top: 0, bottom: 0, width: 80,
      backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center',
    },
    deleteActionIcon: { fontSize: 18, marginBottom: 2 },
    deleteActionLabel: { color: '#fff', fontSize: 10, fontWeight: '700' },

    friendCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.card,
      borderRadius: 14,
      padding: 14,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 2,
    },
    avatarWrapper: { position: 'relative', marginRight: 14 },
    avatar: {
      width: 50, height: 50, borderRadius: 25,
      backgroundColor: theme.primaryLight,
      justifyContent: 'center', alignItems: 'center',
    },
    avatarText: { fontSize: 20, fontWeight: '700', color: theme.primary },
    statusDot: {
      position: 'absolute', bottom: 1, right: 1,
      width: 13, height: 13, borderRadius: 6.5,
      borderWidth: 2, borderColor: theme.card,
    },
    friendInfo: { flex: 1 },
    friendName: { fontSize: 16, fontWeight: '600', color: theme.text },
    friendEmail: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
    sharedGroups: { fontSize: 12, color: theme.primary, marginTop: 3, fontWeight: '500' },

    fab: {
      position: 'absolute', bottom: 28, right: 24,
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: theme.primary,
      justifyContent: 'center', alignItems: 'center',
      shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
    },
    fabText: { fontSize: 28, color: '#fff', lineHeight: 32 },

    modalOverlay: {
      flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end',
    },
    modalCard: {
      backgroundColor: theme.card,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 24, paddingBottom: 36,
    },
    modalTitle: { fontSize: 20, fontWeight: '700', color: theme.text, marginBottom: 4 },
    modalHint: { fontSize: 13, color: theme.textSecondary, marginBottom: 16 },

    searchRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
    searchInput: {
      flex: 1,
      borderWidth: 1.5, borderColor: theme.border, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 13,
      fontSize: 15, color: theme.text, backgroundColor: theme.inputBg,
    },
    searchBtn: {
      backgroundColor: theme.primary, borderRadius: 12,
      paddingHorizontal: 16, justifyContent: 'center',
    },
    searchBtnDisabled: { opacity: 0.7 },
    searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

    resultCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: theme.primaryLight, borderRadius: 12,
      padding: 14, marginBottom: 16,
    },
    resultAvatar: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: theme.primary,
      justifyContent: 'center', alignItems: 'center', marginRight: 12,
    },
    resultAvatarText: { color: '#fff', fontWeight: '700', fontSize: 18 },
    resultInfo: { flex: 1 },
    resultName: { fontSize: 15, fontWeight: '600', color: theme.text },
    resultEmail: { fontSize: 12, color: theme.textSecondary, marginTop: 1 },
    addBtn: {
      backgroundColor: theme.primary, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 10,
    },
    addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

    cancelBtn: { alignItems: 'center', paddingVertical: 14 },
    cancelText: { color: theme.textSecondary, fontSize: 15 },
  });
}
