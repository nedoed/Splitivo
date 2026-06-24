// RevenueCat → Supabase Webhook
//
// Empfängt RevenueCat-Events und schreibt den Pro-Status nach
// profiles. Mapping läuft über app_user_id == Supabase auth uid
// (App ruft Purchases.logIn(userId) auf, siehe usePro.ts).
//
// Secrets (Supabase → Project Settings → Edge Functions → Secrets):
//   REVENUECAT_WEBHOOK_SECRET  – frei gewählter Wert, identisch im
//                                RevenueCat-Dashboard als Authorization-Header
//   SUPABASE_URL               – automatisch gesetzt
//   SUPABASE_SERVICE_ROLE_KEY  – automatisch gesetzt
//
// Deploy:  supabase functions deploy revenuecat-webhook --no-verify-jwt
//   (--no-verify-jwt, weil RevenueCat keinen Supabase-JWT mitschickt;
//    die Auth läuft über den Authorization-Header unten.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Event-Typen, die Pro GEWÄHREN (Entitlement aktiv)
const GRANT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
])

// Event-Typen, die Pro ENTZIEHEN
const REVOKE_EVENTS = new Set([
  'EXPIRATION',
])

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // 1. Authentifizierung des Webhooks
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')
  const got = req.headers.get('Authorization')
  if (!expected || got !== expected) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. Payload parsen
  let payload: any
  try {
    payload = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const event = payload?.event
  const type: string | undefined = event?.type
  const appUserId: string | undefined = event?.app_user_id
  if (!type || !appUserId) {
    return new Response('Ignored: kein verwertbares Event', { status: 200 })
  }

  // 3. Pro-Status ableiten
  let update: Record<string, unknown> | null = null
  if (GRANT_EVENTS.has(type)) {
    const expiresMs: number | null = event?.expiration_at_ms ?? null
    update = {
      is_pro: true,
      rc_customer_id: event?.original_app_user_id ?? appUserId,
      pro_expires_at: expiresMs ? new Date(expiresMs).toISOString() : null,
    }
  } else if (REVOKE_EVENTS.has(type)) {
    update = { is_pro: false, pro_expires_at: new Date().toISOString() }
  } else {
    // CANCELLATION etc. ändern nichts am aktiven Zugriff bis Ablauf
    return new Response('Ignored: ' + type, { status: 200 })
  }

  // 4. In profiles schreiben (Service-Role umgeht RLS + Spaltenschutz)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', appUserId)

  if (error) {
    console.error('profiles update failed', error)
    return new Response('DB error', { status: 500 })
  }

  return new Response('ok', { status: 200 })
})
