// Everything this app writes to the device, in one greppable place.
//
// The string VALUES are persisted on people's phones: renaming one orphans what
// is already stored there, so move the constant, never the text. Sign-out and
// "what does localStorage.clear() take with it" are answered by reading this.

export const STORAGE_KEYS = {
  // localStorage
  deviceId: "wwbh:device-id",
  adminToken: "wwbh:admin-token",
  adminTokenOwner: "wwbh:admin-token-owner",
  memberToken: "wwbh:member-token",
  memberName: "wwbh:member-name",
  wasMember: "wwbh:was-member",
  memberRenewalRefused: "wwbh:member-renewal-refused",
  guestToken: "wwbh:guest-token",
  guestName: "wwbh:guest-name",
  accountHandoffToken: "wwbh:account-handoff-token",
  authNext: "wwbh:auth-next",
  navShape: "wwbh:nav-shape",
  vaultLayout: "wwbh:vault-layout",
  vaultFavourites: "wwbh:vault-favourites",
  vaultLastSeen: "wwbh:vault-last-seen",
  tradeSeen: "wwbh:trade-seen",
  trophySeen: "wwbh:trophy-seen",
  sfxMuted: "wwbh:sfx-muted",
  /** Stored as "off" rather than "on" so an unwritten key means the default: buzzing. */
  hapticsOff: "wwbh:haptics-off",
  tilt: "wwbh:tilt",
  packDealt: "wwbh:pack-dealt",
  packUnrecorded: "wwbh:pack-unrecorded",
  activeRun: "wwbh-active-run",
  /** `<prefix><eventParticipantId>`, one per card (reveal-seen.ts). */
  revealSeenPrefix: "wwbh:reveal-seen:",
} as const;

/** The signed-URL snapshot for one event (use-photo-urls.ts); bump `version` with its strategy. */
export const signedUrlSnapshotKey = (
  version: number,
  kind: string,
  eventId: string | null | undefined,
) => `wwbh:v${version}:${kind}:${eventId ?? ""}`;
