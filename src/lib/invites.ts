import { supabase } from './supabase';

// Keine verwirrenden Zeichen (0/O, 1/I)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const generateInviteCode = (): string =>
  Array.from({ length: 8 }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join('');

export interface JoinResult {
  success: boolean;
  groupName?: string;
  error?: string;
}

export const joinGroupWithCode = async (rawCode: string): Promise<JoinResult> => {
  const code = rawCode.toUpperCase().trim();
  if (!code) return { success: false, error: 'Kein Code angegeben' };

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { success: false, error: 'Nicht eingeloggt' };

  // Einladung laden
  const { data: invite, error } = await supabase
    .from('group_invites')
    .select('*, group:groups!group_id(id, name)')
    .eq('code', code)
    .maybeSingle();

  if (error || !invite) {
    return { success: false, error: 'Ungültiger Einladungscode.' };
  }

  // Ablaufdatum prüfen
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return { success: false, error: 'Dieser Einladungslink ist abgelaufen.' };
  }

  // Bereits Mitglied?
  const { data: existing } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', invite.group_id)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (existing) {
    return { success: false, error: 'Du bist bereits Mitglied dieser Gruppe.' };
  }

  // Gruppe beitreten
  const { error: joinError } = await supabase
    .from('group_members')
    .insert({ group_id: invite.group_id, user_id: userData.user.id });

  if (joinError) {
    return { success: false, error: joinError.message };
  }

  return { success: true, groupName: invite.group?.name };
};
