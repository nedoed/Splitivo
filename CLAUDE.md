# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start dev server
expo start

# Platform-specific
expo start --ios
expo start --android

# Build via EAS
eas build --platform ios --profile production
eas build --platform android --profile production

# Submit to stores
eas submit --platform ios
eas submit --platform android

# Generate icons
node scripts/generate-icons.js
```

No test runner configured.

## Environment

Requires `.env` with:
```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## Architecture

**Splitivo** is an Expo/React Native app (German UI) for splitting group expenses. Backend is Supabase (Postgres + Auth + Realtime).

### Data flow

All DB access goes through `src/lib/supabase.ts` — a single Supabase client using AsyncStorage for session persistence. No Redux/Zustand; screens query Supabase directly with `useEffect` + local state.

### Auth & routing (`App.tsx` → `AppNavigator.tsx`)

`App.tsx` renders `RootNavigator` which gates on three states in order:
1. Onboarding (`AsyncStorage` key `onboarding_completed`)
2. Auth session (`useAuth` hook wraps `supabase.auth`)
3. Main app (`AppNavigator`)

`AppNavigator` is a bottom tab navigator (5 tabs) where the **Gruppen** and **Profil** tabs are nested stack navigators.

### Screen map

| Tab | Screens |
|-----|---------|
| Gruppen | GroupsScreen → GroupDetailScreen → AddExpenseScreen / ExpenseDetailScreen / ReceiptSplitScreen |
| Aktivität | ActivityScreen |
| Statistik | StatsScreen |
| Abrechnen | SettleScreen |
| Profil | ProfileScreen → FriendsScreen |

### Key library files (`src/lib/`)

- **`supabase.ts`** — DB client
- **`debtSimplification.ts`** — greedy algorithm minimizing settlement transactions; runs per currency
- **`payments.ts`** — deep-links into TWINT/PayPal; reads `paypal_me` / IBAN from `profiles` table
- **`invites.ts`** — 8-char invite codes stored in `group_invites` table; joined via deep link scheme `spliteasy://join/<code>`
- **`notifications.ts`** / **`reminders.ts`** — Expo push notifications; token stored in `profiles`
- **`theme.ts`** + **`ThemeContext.tsx`** — light/dark theme; all screens consume `useTheme()`
- **`haptics.ts`** — thin wrapper over `expo-haptics`

### Database schema (`supabase-schema.sql`)

Core tables: `profiles`, `groups`, `group_members`, `expenses`, `expense_splits`, `group_invites`. All tables have Row Level Security. `expense_splits.is_settled` tracks per-split settlement state.

### Types (`src/types/index.ts`)

All shared interfaces live here. `CATEGORIES` and `CATEGORY_SCAN_MAP` define expense categories (used by receipt scanner → OpenAI category mapping).

### Deep links

Scheme: `spliteasy://join/<8-char-code>`. Parsed in `App.tsx`; processed via `joinGroupWithCode()` once session is available.
