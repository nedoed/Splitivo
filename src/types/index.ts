export interface CurrencyOption {
  code: string;
  flag: string;
  name: string;
  pro: boolean; // true = nur mit Splitivo Pro wählbar
}

// Free: CHF/EUR/USD. Pro schaltet die übrigen frei ("Alle Währungen").
export const CURRENCIES: CurrencyOption[] = [
  { code: 'CHF', flag: '🇨🇭', name: 'Schweizer Franken', pro: false },
  { code: 'EUR', flag: '🇪🇺', name: 'Euro', pro: false },
  { code: 'USD', flag: '🇺🇸', name: 'US-Dollar', pro: false },
  { code: 'GBP', flag: '🇬🇧', name: 'Britisches Pfund', pro: true },
  { code: 'JPY', flag: '🇯🇵', name: 'Japanischer Yen', pro: true },
  { code: 'AUD', flag: '🇦🇺', name: 'Australischer Dollar', pro: true },
  { code: 'CAD', flag: '🇨🇦', name: 'Kanadischer Dollar', pro: true },
  { code: 'SEK', flag: '🇸🇪', name: 'Schwedische Krone', pro: true },
  { code: 'NOK', flag: '🇳🇴', name: 'Norwegische Krone', pro: true },
  { code: 'DKK', flag: '🇩🇰', name: 'Dänische Krone', pro: true },
  { code: 'PLN', flag: '🇵🇱', name: 'Polnischer Złoty', pro: true },
  { code: 'CZK', flag: '🇨🇿', name: 'Tschechische Krone', pro: true },
];

export interface Profile {
  id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
  reminder_enabled?: boolean;
  reminder_days?: number;
  reminder_time?: string;
  reminder_daily_summary?: boolean;
  paypal_me?: string | null;
  iban?: string | null;
  bank_name?: string | null;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  member_count?: number;
  total_expenses?: number;
  member_profiles?: Array<{ username: string | null; avatar_url?: string | null }>;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  joined_at: string;
  profile?: Profile;
}

export interface Expense {
  id: string;
  group_id: string;
  paid_by: string;
  amount: number;
  description: string;
  category: string;
  currency: string;
  date: string;
  created_at: string;
  payer?: Profile;
  splits?: ExpenseSplit[];
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  user_id: string;
  amount: number;
  is_settled: boolean;
  profile?: Profile;
}

export interface Debt {
  from_user_id: string;
  to_user_id: string;
  amount: number;
  currency: string;
  from_profile?: Profile;
  to_profile?: Profile;
}

export const CATEGORIES = [
  { label: 'Essen & Trinken', value: 'food', icon: '🍔' },
  { label: 'Transport', value: 'transport', icon: '🚗' },
  { label: 'Unterkunft', value: 'accommodation', icon: '🏠' },
  { label: 'Unterhaltung', value: 'entertainment', icon: '🎉' },
  { label: 'Einkaufen', value: 'shopping', icon: '🛒' },
  { label: 'Gesundheit', value: 'health', icon: '💊' },
  { label: 'Sonstiges', value: 'other', icon: '📦' },
];

// Mapping OpenAI-Kategorienamen → interne Category-Values
export const CATEGORY_SCAN_MAP: Record<string, string> = {
  food: 'food',
  essen: 'food',
  transport: 'transport',
  accommodation: 'accommodation',
  unterkunft: 'accommodation',
  entertainment: 'entertainment',
  unterhaltung: 'entertainment',
  shopping: 'shopping',
  einkauf: 'shopping',
  health: 'health',
  gesundheit: 'health',
  other: 'other',
  sonstiges: 'other',
};
