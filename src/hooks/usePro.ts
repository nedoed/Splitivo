import { useEffect, useState } from 'react'
import Purchases, { CustomerInfo } from 'react-native-purchases'

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

    Purchases.addCustomerInfoUpdateListener(info => {
      setCustomerInfo(info)
      setIsPro(!!info.entitlements.active['pro'])
    })

  }, [])

  return { isPro, isLoading, customerInfo }
}
