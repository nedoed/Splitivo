import React, { createContext, useContext, useEffect, useState } from 'react'
import Purchases, { CustomerInfo } from 'react-native-purchases'
import { supabase } from './supabase'

const RC_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY!

// Splitivo hat genau EIN Entitlement (Pro). Statt eines fixen Keys
// (case-sensitive: 'pro' vs 'Pro') gilt: irgendein aktives Entitlement
// => Pro. Falls später weitere Entitlements dazukommen, hier auf eine
// konkrete ID umstellen.
const hasProEntitlement = (info: CustomerInfo): boolean =>
  Object.keys(info.entitlements.active).length > 0

export interface ProStatus {
  isPro: boolean
  isLoading: boolean
  customerInfo: CustomerInfo | null
}

const ProContext = createContext<ProStatus>({
  isPro: false,
  isLoading: true,
  customerInfo: null,
})

// configure() darf pro Prozess nur einmal laufen.
let rcConfigured = false

export function ProProvider({ children }: { children: React.ReactNode }) {
  const [isPro, setIsPro] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null)

  useEffect(() => {
    if (!rcConfigured) {
      Purchases.configure({ apiKey: RC_API_KEY })
      rcConfigured = true
    }

    const apply = (info: CustomerInfo) => {
      setCustomerInfo(info)
      setIsPro(hasProEntitlement(info))
    }

    // RevenueCat app_user_id an Supabase-uid koppeln (für Webhook-Mapping)
    // und Pro-Status frisch laden. Bei jedem Auth-Wechsel erneut.
    const syncUser = async () => {
      try {
        const { data } = await supabase.auth.getUser()
        if (data.user) {
          try { await Purchases.logIn(data.user.id) } catch (e) { console.warn('RC logIn failed:', e) }
        }
        const info = await Purchases.getCustomerInfo()
        apply(info)
      } catch (err) {
        console.error('RevenueCat check failed:', err)
      } finally {
        setIsLoading(false)
      }
    }

    syncUser()

    Purchases.addCustomerInfoUpdateListener(apply)
    const { data: authSub } = supabase.auth.onAuthStateChange(() => { syncUser() })

    return () => {
      Purchases.removeCustomerInfoUpdateListener(apply)
      authSub.subscription.unsubscribe()
    }
  }, [])

  return (
    <ProContext.Provider value={{ isPro, isLoading, customerInfo }}>
      {children}
    </ProContext.Provider>
  )
}

export function usePro(): ProStatus {
  return useContext(ProContext)
}
