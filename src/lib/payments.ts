import { Linking, Platform, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { supabase } from './supabase';
import { haptics } from './haptics';

export const payWithTwint = async (): Promise<boolean> => {
  const schemes = ['twint://', 'ch.twint.payment://'];

  for (const scheme of schemes) {
    const canOpen = await Linking.canOpenURL(scheme);
    if (canOpen) {
      await Linking.openURL(scheme);
      haptics.success();
      return true;
    }
  }

  return new Promise((resolve) => {
    Alert.alert(
      'TWINT nicht installiert',
      'Möchtest du TWINT installieren?',
      [
        { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Installieren',
          onPress: () => {
            Linking.openURL(
              Platform.OS === 'ios'
                ? 'https://apps.apple.com/ch/app/twint/id1262500691'
                : 'https://play.google.com/store/apps/details?id=ch.twint.payment'
            );
            resolve(false);
          },
        },
      ]
    );
  });
};

export const payWithPayPal = async (recipientId: string): Promise<boolean> => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('paypal_me, username')
    .eq('id', recipientId)
    .single();

  if (!profile?.paypal_me) {
    return new Promise((resolve) => {
      Alert.alert(
        'PayPal nicht verknüpft',
        `${profile?.username ?? 'Diese Person'} hat kein PayPal-Konto hinterlegt.\n\nAlternative Zahlungsmethoden:\n• TWINT\n• Banküberweisung (IBAN)\n• Bar`,
        [
          { text: 'OK', style: 'cancel', onPress: () => resolve(false) },
          {
            text: 'TWINT verwenden',
            onPress: async () => {
              const opened = await payWithTwint();
              resolve(opened);
            },
          },
        ]
      );
    });
  }

  const url = `https://paypal.me/${profile.paypal_me}`;
  await Linking.openURL(url);
  haptics.success();
  return true;
};

export const showBankDetails = async (userId: string): Promise<boolean> => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('iban, bank_name')
    .eq('id', userId)
    .single();

  if (!profile?.iban) {
    Alert.alert(
      'Keine IBAN hinterlegt',
      'Diese Person hat noch keine IBAN in ihrem Profil eingetragen.'
    );
    return false;
  }

  const bankLine = profile.bank_name ? `Bank: ${profile.bank_name}\n` : '';

  return new Promise((resolve) => {
    Alert.alert(
      'Bankverbindung',
      `${bankLine}IBAN: ${profile.iban}`,
      [
        {
          text: 'IBAN kopieren',
          onPress: () => {
            Clipboard.setStringAsync(profile.iban!);
            haptics.success();
            resolve(true);
          },
        },
        { text: 'OK', onPress: () => resolve(true) },
      ]
    );
  });
};
