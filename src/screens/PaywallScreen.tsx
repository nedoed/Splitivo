import React, { useEffect, useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Linking
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Purchases, { PurchasesOffering, PurchasesPackage } from 'react-native-purchases'
import { useTheme } from '../lib/ThemeContext'
import { Theme } from '../lib/theme'

// Apple verlangt auf Auto-Renew-Paywalls Links zu Nutzungsbedingungen
// (EULA) und Datenschutz. Apple-Standard-EULA ist als Terms zulässig.
const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
const PRIVACY_URL = 'https://nedoed.github.io/privacy-policy/'

export default function PaywallScreen({ navigation }: any) {
  const { theme } = useTheme()
  const styles = getStyles(theme)
  const [offering, setOffering] = useState<PurchasesOffering | null>(null)
  const [loadingOffering, setLoadingOffering] = useState(true)
  const [purchasing, setPurchasing] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const offerings = await Purchases.getOfferings()
        setOffering(offerings.current ?? null)
      } catch (e: any) {
        console.warn('getOfferings failed:', e)
      } finally {
        setLoadingOffering(false)
      }
    }
    load()
  }, [])

  // Pakete aus dem aktuellen Offering ziehen (keine hardcoded Produkt-IDs).
  const annual: PurchasesPackage | null =
    offering?.annual ??
    offering?.availablePackages.find(p => p.packageType === 'ANNUAL') ??
    null
  const monthly: PurchasesPackage | null =
    offering?.monthly ??
    offering?.availablePackages.find(p => p.packageType === 'MONTHLY') ??
    null

  // Anzeige-Preise: live aus dem Package, sonst Fallback (= ASC-Preise).
  // So sieht die Paywall (und der App-Store-Review-Screenshot) auch vor
  // der Store-Freigabe korrekt aus. Sobald das Offering live ist, gelten
  // automatisch die echten StoreKit-Preise.
  const annualPriceLabel = annual?.product.priceString ?? 'CHF 15.00'
  const monthlyPriceLabel = monthly?.product.priceString ?? 'CHF 2.00'

  let savingPct = 38
  let perMonthLabel = 'CHF 1.25'
  if (annual && monthly && monthly.product.price > 0) {
    const yearlyAtMonthly = monthly.product.price * 12
    savingPct = Math.round((1 - annual.product.price / yearlyAtMonthly) * 100)
    perMonthLabel = `${annual.product.currencyCode} ${(annual.product.price / 12).toFixed(2)}`
  }

  const notReady = () =>
    Alert.alert('Bald verfügbar', 'Die Abos werden gerade freigeschaltet. Bitte versuche es in Kürze erneut.')

  const purchase = async (pkg: PurchasesPackage) => {
    setPurchasing(true)
    try {
      await Purchases.purchasePackage(pkg)
      Alert.alert('Willkommen bei Pro! 🎉', 'Du hast jetzt Zugriff auf alle Pro-Features.')
      navigation.goBack()
    } catch (e: any) {
      if (!e.userCancelled) {
        Alert.alert('Fehler', e.message ?? 'Kauf fehlgeschlagen')
      }
    } finally {
      setPurchasing(false)
    }
  }

  const handleRestore = async () => {
    setPurchasing(true)
    try {
      await Purchases.restorePurchases()
      Alert.alert('Wiederhergestellt', 'Deine Käufe wurden wiederhergestellt.')
      navigation.goBack()
    } catch (e: any) {
      Alert.alert('Fehler', e.message)
    } finally {
      setPurchasing(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        <Text style={styles.badge}>PRO</Text>
        <Text style={styles.title}>Splitivo Pro</Text>
        <Text style={styles.subtitle}>Alle Features, keine Einschränkungen</Text>

        <View style={styles.features}>
          {[
            { icon: '📷', text: 'Kassenbon scannen (OCR)' },
            { icon: '👥', text: 'Unbegrenzte Gruppen & Mitglieder' },
            { icon: '📊', text: 'Erweiterte Statistiken & Charts' },
            { icon: '🔔', text: 'Schulden-Erinnerungen' },
            { icon: '🌍', text: 'Alle Währungen' },
          ].map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <Text style={styles.featureText}>{f.text}</Text>
              <Text style={styles.check}>✓</Text>
            </View>
          ))}
        </View>

        {loadingOffering ? (
          <ActivityIndicator color={theme.primary} style={{ marginVertical: 24 }} />
        ) : (
          <>
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={() => (annual ? purchase(annual) : notReady())}
              disabled={purchasing}
            >
              {purchasing ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Text style={styles.btnPrimaryText}>
                    Jährlich — {annualPriceLabel}
                  </Text>
                  <Text style={styles.btnPrimarySubtext}>
                    Spare {savingPct}% · {perMonthLabel} / Monat
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={() => (monthly ? purchase(monthly) : notReady())}
              disabled={purchasing}
            >
              <Text style={styles.btnSecondaryText}>
                Monatlich — {monthlyPriceLabel}
              </Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={handleRestore} disabled={purchasing}>
          <Text style={styles.restore}>Käufe wiederherstellen</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()} disabled={purchasing}>
          <Text style={styles.skip}>Vielleicht später</Text>
        </TouchableOpacity>

        {/* Apple-Pflichtangaben für Auto-Renew-Abos */}
        <Text style={styles.legalText}>
          Die Zahlung wird bei Kaufbestätigung deinem Apple-ID-Konto belastet.
          Das Abo verlängert sich automatisch um denselben Zeitraum, sofern es
          nicht mindestens 24 Stunden vor Ablauf der laufenden Periode gekündigt
          wird. Die Belastung für die Verlängerung erfolgt innerhalb von 24 Stunden
          vor Periodenende. Abos lassen sich nach dem Kauf in den App-Store-Einstellungen
          verwalten und kündigen.
        </Text>

        <View style={styles.legalLinks}>
          <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
            <Text style={styles.legalLink}>Nutzungsbedingungen</Text>
          </TouchableOpacity>
          <Text style={styles.legalSep}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
            <Text style={styles.legalLink}>Datenschutz</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  )
}

function getStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    content: { padding: 28, alignItems: 'center' },
    badge: {
      backgroundColor: theme.primary, color: '#fff', fontSize: 12,
      fontWeight: '700', paddingHorizontal: 14, paddingVertical: 5,
      borderRadius: 99, overflow: 'hidden', marginBottom: 16, marginTop: 8,
    },
    title: { fontSize: 30, fontWeight: '800', color: theme.text, textAlign: 'center' },
    subtitle: { fontSize: 15, color: theme.textSecondary, textAlign: 'center', marginTop: 8, marginBottom: 28 },
    features: { width: '100%', marginBottom: 28 },
    featureRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border,
    },
    featureIcon: { fontSize: 22, width: 36 },
    featureText: { flex: 1, fontSize: 15, color: theme.text },
    check: { fontSize: 16, color: theme.primary, fontWeight: '700' },
    noProducts: {
      fontSize: 14, color: theme.textSecondary, textAlign: 'center',
      marginVertical: 24, paddingHorizontal: 12,
    },
    btnPrimary: {
      width: '100%', backgroundColor: theme.primary, borderRadius: 14,
      paddingVertical: 16, alignItems: 'center', marginBottom: 12,
    },
    btnPrimaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
    btnPrimarySubtext: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 3 },
    btnSecondary: {
      width: '100%', borderWidth: 2, borderColor: theme.primary,
      borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 20,
    },
    btnSecondaryText: { color: theme.primary, fontSize: 16, fontWeight: '600' },
    restore: { color: theme.textSecondary, fontSize: 13, marginBottom: 12 },
    skip: { color: theme.textTertiary, fontSize: 13 },
    legalText: {
      color: theme.textTertiary, fontSize: 11, lineHeight: 16,
      textAlign: 'center', marginTop: 20,
    },
    legalLinks: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, marginTop: 10, marginBottom: 8,
    },
    legalLink: { color: theme.textSecondary, fontSize: 12, textDecorationLine: 'underline' },
    legalSep: { color: theme.textTertiary, fontSize: 12 },
  })
}
