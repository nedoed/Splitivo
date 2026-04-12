import { supabase } from './supabase';

export const addFriend = async (friendId: string): Promise<void> => {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user || user.user.id === friendId) return;

  await supabase
    .from('friendships')
    .upsert({ user_id: user.user.id, friend_id: friendId });
};

export const removeFriend = async (friendId: string): Promise<void> => {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return;

  await supabase
    .from('friendships')
    .delete()
    .eq('user_id', user.user.id)
    .eq('friend_id', friendId);
};
