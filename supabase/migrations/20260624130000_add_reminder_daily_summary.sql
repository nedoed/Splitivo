-- ProfileScreen liest/schreibt reminder_daily_summary (Tägliche
-- Zusammenfassung), die Spalte fehlte in der DB -> Updates liefen ins
-- Leere. Spalte nachgezogen.
alter table profiles
  add column if not exists reminder_daily_summary boolean not null default false;
