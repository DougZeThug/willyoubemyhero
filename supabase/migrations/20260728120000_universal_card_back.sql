-- One card back for the whole event: the admin uploads a single image and every
-- player's card flips to it. event_participants.card_back_path still wins when
-- it is set, so a one-off bespoke back for a single player stays possible.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS card_back_path text;

COMMENT ON COLUMN public.events.card_back_path IS
  'Universal back art for every player card in this event (storage path in participant-photos). Overridden per player by event_participants.card_back_path.';

-- No anon/authenticated grant on purpose: public reads go through the
-- events_public view, and this path is only ever read server-side by
-- getEventCardUrls to mint a signed URL for the private bucket.
