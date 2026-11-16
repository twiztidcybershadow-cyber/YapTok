-- 010_player.sql
-- Flags for the player's touch controls. Nothing else changes in the
-- database: these features live in the browser (lib/feed/gestures.ts).
--
-- Run after 009_admin_panel.sql. Safe to run more than once.

insert into public.feature_flags (key, label, description, mode)
values
  ('gestures', 'Player gestures', 'Double tap a clip to like it, hold a finger on it to pause, hold the right side to play at double speed.', 'off'),
  ('scrub', 'Scrub bar', 'The bar at the bottom of a clip can be dragged to move through it.', 'off')
on conflict (key) do nothing;
