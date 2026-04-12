import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';
import { supabase } from './supabase';
import { haptics } from './haptics';

/**
 * Öffnet TWINT direkt, oder leitet zum App Store weiter.
 * Gibt true zurück wenn die App geöffnet werden konnte.
 */
export const payWithTwint = async (): Promise<boolean> => {
  const canOpen = await Linking.canOpenURL('twint://');

  if (canOpen) {
    await Linking.openURL('twint://');
    haptics.success();
    return true;
  }

  return new Promise((resolve) => {
    Alert.alert(
      'TWINT nicht installiert',
      'Möchtest du TWINT im App Store öffnen?',
      [
        { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'App Store',
          onPress: () => {
            Linking.openURL('https://apps.apple.com/ch/app/twint/id1262500691');
            resolve(false);
          },
        },
      ]
    );
  });
};

/**
 * Öffnet PayPal mit optionalem paypal.me-Direktlink.
 */
export const payWithPayPal = async (
  amount: number,
  currency: string,
  recipientPayPalMe?: string | null
): Promise<boolean> => {
  if (recipientPayPalMe) {
    const url = `https://paypal.me/${recipientPayPalMe}/${amount.toFixed(2)}${currency}`;
    await Linking.openURL(url);
    haptics.success();
    return true;
  }

  const canOpen = await Linking.canOpenURL('paypal://');
  if (canOpen) {
    await Linking.openURL('paypal://');
  } else {
    await Linking.openURL('https://www.paypal.com');
  }
  haptics.success();
  return true;
};

/**
 * Zeigt die Bankverbindung des Empfängers an.
 * Gibt true zurück wenn IBAN vorhanden war.
 */
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
