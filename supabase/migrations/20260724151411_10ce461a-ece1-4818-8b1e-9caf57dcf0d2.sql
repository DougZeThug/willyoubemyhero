
-- Rename demo participants to real league members and drop extras
UPDATE public.participants SET name='AJ Dewalt', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000001';
UPDATE public.participants SET name='Daniel Weidensaul', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000002';
UPDATE public.participants SET name='Danielo Cancela', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000003';
UPDATE public.participants SET name='David Weidensaul', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000004';
UPDATE public.participants SET name='Grant McMinn', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000005';
UPDATE public.participants SET name='Jordan Bowers', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000006';
UPDATE public.participants SET name='Josh Eden', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000007';
UPDATE public.participants SET name='Stephen Lipko', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000008';
UPDATE public.participants SET name='Mike Strosser', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000009';
UPDATE public.participants SET name='Robert Wolgemuth', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000010';
UPDATE public.participants SET name='Ryan Herr', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000011';
UPDATE public.participants SET name='Ryan Marquart', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000012';
UPDATE public.participants SET name='Shawn Strauss', nickname=NULL, fantasy_team_name=NULL WHERE id='c0000000-0000-0000-0000-000000000013';

-- Remove extras (14, 15, 16) and reindex running_order
DELETE FROM public.event_participants WHERE participant_id IN (
  'c0000000-0000-0000-0000-000000000014',
  'c0000000-0000-0000-0000-000000000015',
  'c0000000-0000-0000-0000-000000000016'
);
DELETE FROM public.participants WHERE id IN (
  'c0000000-0000-0000-0000-000000000014',
  'c0000000-0000-0000-0000-000000000015',
  'c0000000-0000-0000-0000-000000000016'
);

-- Recompute running_order to be contiguous 1..N per event
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY running_order, created_at) AS rn
  FROM public.event_participants
)
UPDATE public.event_participants ep
SET running_order = ordered.rn
FROM ordered
WHERE ep.id = ordered.id;
