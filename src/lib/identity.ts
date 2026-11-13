// Who a pack, a collection or a secret belongs to, as one string.
//
// `m:` a claimed member, `d:` an unclaimed device, `g:` a guest session. The
// prefixes are free insurance against a device or guest id ever colliding with
// a participant id, and they are what the stored pack rows and the secret query
// keys are keyed on — a bare participant id there silently matches nothing.

export const memberIdentity = (participantId: string) => `m:${participantId}`;
export const deviceIdentity = (deviceId: string) => `d:${deviceId}`;
export const guestIdentity = (guestId: string) => `g:${guestId}`;

/** The member's identity, or null while there is no member to be. */
export const memberIdentityOrNull = (participantId: string | null | undefined) =>
  participantId ? memberIdentity(participantId) : null;

export const isMemberIdentity = (identity: string) => identity.startsWith("m:");
export const isDeviceIdentity = (identity: string) => identity.startsWith("d:");
