import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Expo Go unterstützt seit SDK 53 keine Push Notifications mehr
const isExpoGo = Constants.appOwnership === 'expo';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (isExpoGo) {
    console.log('[Push] Expo Go: Push Notifications nicht verfügbar im Test-Modus.');
    return null;
  }

  if (!Device.isDevice) {
    console.log('[Push] Nur auf echtem Gerät verfügbar.');
    return null;
  }

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'SplitEasy',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6C63FF',
        sound: 'default',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Push] Berechtigung verweigert.');
      return null;
    }

    const projectId =
      Constants.easConfig?.projectId ??
      (Constants.expoConfig?.extra as any)?.eas?.projectId;

    if (!projectId) {
      console.log('[Push] Keine projectId konfiguriert – Token wird übersprungen.');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('[Push] Token:', tokenData.data);
    return tokenData.data;
  } catch (e) {
    console.log('[Push] Fehler beim Registrieren:', e);
    return null;
  }
}

export async function savePushToken(token: string) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;

  await supabase
    .from('profiles')
    .update({ push_token: token })
    .eq('id', userData.user.id);
}

async function sendViaPushService(tokens: string[], title: string, body: string) {
  if (isExpoGo) return; // Kein Push-Versand aus Expo Go

  const messages = tokens
    .filter((t) => t && t.startsWith('ExponentPushToken'))
    .map((to) => ({ to, title, body, sound: 'default', channelId: 'default' }));

  if (messages.length === 0) return;

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
}

export async function notifyGroupMembers(
  groupId: string,
  excludeUserId: string,
  title: string,
  body: string
) {
  if (isExpoGo) return;
  try {
    const { data: members } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .neq('user_id', excludeUserId);

    if (!members || members.length === 0) return;

    const userIds = members.map((m) => m.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('push_token')
      .in('id', userIds);

    const tokens = (profiles ?? []).map((p: any) => p.push_token).filter(Boolean);
    await sendViaPushService(tokens, title, body);
  } catch {
    // non-critical
  }
}

export async function notifyUser(userId: string, title: string, body: string) {
  if (isExpoGo) return;
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', userId)
      .single();

    const token = (profile as any)?.push_token;
    if (token) await sendViaPushService([token], title, body);
  } catch {
    // non-critical
  }
}
