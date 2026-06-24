import React, { useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Purchases from 'react-native-purchases'
import { useTheme } from '../lib/ThemeContext'
import { Theme } from '../lib/theme'

export default function PaywallScreen({ navigation }: any) {
  const { theme } = useTheme()
  const styles = getStyles(theme)
  const [loading, setLoading] = useState(false)

  const handlePurchase = async (productId: string) => {
    setLoading(true)
    try {
      const offerings = await Purchases.getOfferings()
      const current = offerings.current
      if (!current) throw new Error('Keine Angebote gefunden')

      const pkg = current.availablePackages.find(
        p => p.product.identifier === productId
      )
      if (!pkg) throw new Error('Produkt nicht gefunden')

      await Purchases.purchasePackage(pkg)
      Alert.alert('Willkommen bei Pro! 🎉', 'Du hast jetzt Zugriff auf alle Pro-Features.')
      navigation.goBack()
    } catch (e: any) {
      if (!e.userCancelled) {
        Alert.alert('Fehler', e.message ?? 'Kauf fehlgeschlagen')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async () => {
    setLoading(true)
    try {
      await Purchases.restorePurchases()
      Alert.alert('Wiederhergestellt', 'Deine Käufe wurden wiederhergestellt.')
      navigation.goBack()
    } catch (e: any) {
      Alert.alert('Fehler', e.message)
    } finally {
      setLoading(false)
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
            { icon: '📤', text: 'CSV & PDF Export' },
            { icon: '🌍', text: 'Alle Währungen' },
          ].map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <Text style={styles.featureText}>{f.text}</Text>
              <Text style={styles.check}>✓</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => handlePurchase('splitivo_pro_annual')}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : (
            <>
              <Text style={styles.btnPrimaryText}>Jährlich — CHF 14.99</Text>
              <Text style={styles.btnPrimarySubtext}>Spare 58% · CHF 1.25 / Monat</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={() => handlePurchase('splitivo_pro_monthly')}
          disabled={loading}
        >
          <Text style={styles.btnSecondaryText}>Monatlich — CHF 2.99</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleRestore} disabled={loading}>
          <Text style={styles.restore}>Käufe wiederherstellen</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()} disabled={loading}>
          <Text style={styles.skip}>Vielleicht später</Text>
        </TouchableOpacity>

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
  })
}
