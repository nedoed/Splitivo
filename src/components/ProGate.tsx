import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { usePro } from '../hooks/usePro'

interface ProGateProps {
  children: React.ReactNode
  onUpgrade: () => void
  featureName: string
}

export function ProGate({ children, onUpgrade, featureName }: ProGateProps) {
  const { isPro, isLoading } = usePro()

  if (isLoading) return null
  if (isPro) return <>{children}</>

  return (
    <View style={styles.container}>
      <Text style={styles.badge}>PRO</Text>
      <Text style={styles.title}>{featureName}</Text>
      <Text style={styles.desc}>Dieses Feature ist Teil von Splitivo Pro.</Text>
      <TouchableOpacity style={styles.btn} onPress={onUpgrade}>
        <Text style={styles.btnText}>Jetzt upgraden</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  badge: {
    backgroundColor: '#1E40AF',
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 99,
    overflow: 'hidden',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
  },
  desc: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
  },
  btn: {
    marginTop: 8,
    backgroundColor: '#1E40AF',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
})
