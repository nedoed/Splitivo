import { useEffect, useState } from 'react'
import Purchases, { CustomerInfo } from 'react-native-purchases'
import { supabase } from '../lib/supabase'

const RC_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY!

export interface ProStatus {
  isPro: boolean
  isLoading: boolean
  customerInfo: CustomerInfo | null
}

export function usePro(): ProStatus {
  const [isPro, setIsPro] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null)

  useEffect(() => {
    Purchases.configure({ apiKey: RC_API_KEY })

    const checkPro = async () => {
      try {
        // app_user_id an Supabase-uid koppeln, damit der RevenueCat-
        // Webhook den Pro-Status dem richtigen Profil zuordnen kann.
        const { data } = await supabase.auth.getUser()
        if (data.user) {
          try { await Purchases.logIn(data.user.id) } catch (e) { console.warn('RC logIn failed:', e) }
        }

        const info = await Purchases.getCustomerInfo()
        setCustomerInfo(info)
        const active = info.entitlements.active['pro']
        setIsPro(!!active)
      } catch (err) {
        console.error('RevenueCat check failed:', err)
      } finally {
        setIsLoading(false)
      }
    }

    checkPro()

    const listener = (info: CustomerInfo) => {
      setCustomerInfo(info)
      setIsPro(!!info.entitlements.active['pro'])
    }
    Purchases.addCustomerInfoUpdateListener(listener)

    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener)
    }
  }, [])

  return { isPro, isLoading, customerInfo }
}
