# Show the card you just bought

## The problem

Buying a bonus pull with dust works — the dust leaves, the card is minted — but the
shop only says "Pull bought — check your secrets". You have to go hunting through
the vault and guess which card is new, which is exactly what happened here ("I
think it gave me an isaiah… but I'm not sure").

Every other way of getting a secret card ends in a reveal: the daily pull and the
streak milestone both turn a card over in front of you. A 150-dust purchase — the
most expensive way to get one — is the only one that ends in a toast.

## The fix

After a successful purchase, the shop reveals the card.

1. The purchase already returns the pulled card's id, level and whether it is a
   duplicate. The shop refreshes your secrets list, finds that card, and opens it
   full-size in a reveal — face-down, then turning onto the artwork, with its
   level shown and a "you already had this one" note when it is a duplicate.
2. The dust balance and the vault keep updating exactly as they do now.
3. If the refreshed list somehow doesn't come back (offline mid-purchase), it
   falls back to today's message rather than getting stuck — the card is safely
   in your collection either way.
4. Buying the card that completes a set still fires the existing trophy
   celebration, after the reveal closes rather than behind it.

## Technical notes

- `src/components/dust-shop.tsx`: in the `buy` mutation's `onSuccess`, refetch
  `mySecretsKey(actor)` instead of only invalidating it, look up
  `res.pull.cardId` in the returned `cards`, and set reveal state.
- Reuse the existing reveal chrome rather than adding a new one: render
  `HoloCard` + `SecretBackPanel` in the same face-down-then-turn shape
  `MilestoneReveal` uses, without the streak flame — a small
  `BoughtPullReveal` component next to it, driven by `SecretCardView` plus
  `duplicate` and `tier`.
- Universal back comes from `useEventCardBack`, the same source the sheet and the
  milestone reveal use, so the turn never lands on a text placeholder.
- Component test in `dust-shop.test.tsx`: a successful buy refetches the secrets
  key and mounts the reveal; a failed buy does not.

## Checking it worked

Buy a pull with dust on a phone-sized viewport and confirm the bought card turns
over on screen, names itself, and is present in the vault afterwards.
