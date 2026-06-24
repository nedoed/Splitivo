-- RPC-Oberfläche der SECURITY DEFINER Functions aus 20260624120000
-- entfernen. Trigger feuern unabhängig vom EXECUTE-Grant weiter;
-- is_user_pro soll nicht als /rest/v1/rpc/is_user_pro fremde
-- Pro-Status abfragbar machen.
revoke execute on function public.is_user_pro(uuid)       from anon, authenticated;
revoke execute on function public.enforce_group_limit()   from anon, authenticated;
revoke execute on function public.enforce_member_limit()  from anon, authenticated;
