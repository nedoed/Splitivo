import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';

const isExpoGo = Constants.appOwnership === 'expo';

export const cancelAllReminders = async () => {
  await Notifications.cancelAllScheduledNotificationsAsync();
};

export const scheduleReminder = async (
  debtorName: string,
  amount: number,
  currency: string,
  daysOverdue: number
) => {
  if (isExpoGo) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '💸 Offene Schulden',
      body: `${debtorName} schuldet dir ${currency} ${amount.toFixed(2)} seit ${daysOverdue} Tagen.`,
      data: { screen: 'Settle' },
    },
    trigger: { seconds: 60, repeats: false } as any,
  });
};

export const scheduleDailySummary = async (
  totalOwed: number,
  totalOwe: number,
  reminderTime: string
) => {
  if (isExpoGo) return;
  const [hours, minutes] = reminderTime.split(':').map(Number);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '📊 SplitEasy Zusammenfassung',
      body: `Du bekommst noch CHF ${totalOwed.toFixed(2)} · Du schuldest noch CHF ${totalOwe.toFixed(2)}`,
      data: { screen: 'Settle' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: hours,
      minute: minutes,
    },
  });
};

/**
 * Prüft überfällige Schulden und plant lokale Benachrichtigungen.
 * Wird beim App-Start aufgerufen wenn eine Session vorliegt.
 */
export const checkAndScheduleReminders = async () => {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('reminder_enabled, reminder_days, reminder_time, reminder_daily_summary')
    .eq('id', userData.user.id)
    .single();

  if (!profile?.reminder_enabled) return;

  const reminderDays: number = profile.reminder_days ?? 7;
  const reminderTime: string = profile.reminder_time ?? '09:00';
  const dailySummary: boolean = profile.reminder_daily_summary ?? false;

  // Immer alles canceln und neu planen
  await cancelAllReminders();

  // Prüfe ob lokale Notifications überhaupt erlaubt sind
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // Alle Ausgaben die ich bezahlt habe → andere schulden mir
  const { data: myExpenses } = await supabase
    .from('expenses')
    .select('id, currency')
    .eq('paid_by', userData.user.id);

  let totalOwed = 0;

  if (myExpenses && myExpenses.length > 0) {
    const expenseIds = myExpenses.map((e) => e.id);

    const { data: splits } = await supabase
      .from('expense_splits')
      .select('amount, user_id, expense:expenses!expense_id(date, currency), profile:profiles!user_id(username)')
      .in('expense_id', expenseIds)
      .eq('is_settled', false)
      .neq('user_id', userData.user.id);

    if (splits && splits.length > 0) {
      // Gruppiere nach Schuldner
      const byDebtor: Record<string, { name: string; total: number; currency: string; maxDays: number }> = {};

      splits.forEach((split: any) => {
        const expenseDate = split.expense?.date;
        if (!expenseDate) return;

        const daysOverdue = Math.floor(
          (Date.now() - new Date(expenseDate).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysOverdue < reminderDays) return;

        const debtorId = split.user_id;
        const name: string = split.profile?.username ?? 'Jemand';
        const cur: string = split.expense?.currency ?? 'CHF';

        if (!byDebtor[debtorId]) {
          byDebtor[debtorId] = { name, total: 0, currency: cur, maxDays: 0 };
        }
        byDebtor[debtorId].total += split.amount;
        byDebtor[debtorId].maxDays = Math.max(byDebtor[debtorId].maxDays, daysOverdue);
        totalOwed += split.amount;
      });

      // Eine Notification pro überfälligem Schuldner
      for (const debtor of Object.values(byDebtor)) {
        await scheduleReminder(debtor.name, debtor.total, debtor.currency, debtor.maxDays);
      }
    }
  }

  // Tägliche Zusammenfassung einplanen
  if (dailySummary) {
    const { data: memberGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userData.user.id);

    let totalOwe = 0;

    if (memberGroups && memberGroups.length > 0) {
      const groupIds = memberGroups.map((m) => m.group_id);

      const { data: allExpenses } = await supabase
        .from('expenses')
        .select('id, paid_by')
        .in('group_id', groupIds)
        .neq('paid_by', userData.user.id);

      if (allExpenses && allExpenses.length > 0) {
        const allExpenseIds = allExpenses.map((e) => e.id);

        const { data: mySplits } = await supabase
          .from('expense_splits')
          .select('amount')
          .in('expense_id', allExpenseIds)
          .eq('user_id', userData.user.id)
          .eq('is_settled', false);

        totalOwe = mySplits?.reduce((sum, s) => sum + s.amount, 0) ?? 0;
      }
    }

    if (totalOwed > 0 || totalOwe > 0) {
      await scheduleDailySummary(totalOwed, totalOwe, reminderTime);
    }
  }
};
