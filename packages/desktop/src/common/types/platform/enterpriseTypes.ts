/**
 * Member-side enterprise DTOs served by the `dream-domain-platform` crate of
 * dream-core (see `crates/dream-domain-platform/src/models.rs`). These are the
 * reads a member makes about themself — their scenes, their notification
 * inbox, their file vault — as opposed to the admin-console types the console
 * project owns. All camelCase per the Rust `serde(rename_all = "camelCase")`.
 */

/** Resource types the E5 grant matrix can carry into a scene. */
export type SceneResourceType = 'skill' | 'mcp' | 'model_channel' | 'knowledge' | 'employee';

/** One resource-type slice of a scene's grant package (Rust `MySceneResourceSummaryDto`). */
export type MySceneResourceSummary = {
  resourceType: SceneResourceType | string;
  /** Explicit grant rows of this type. */
  count: number;
  /** The `'*'` wildcard grant is present — every resource of this type. */
  includesAll: boolean;
};

/** A scene the caller belongs to (Rust `MySceneDto`). */
export type MyScene = {
  id: string;
  name: string;
  description?: string | null;
  jobFunctions: string[];
  builtIn: boolean;
  resources: MySceneResourceSummary[];
  createdAt: number;
  updatedAt: number;
};

/** One inbox notification as its recipient sees it (Rust `MyNotificationDto`). */
export type MyNotification = {
  id: string;
  kind: 'broadcast' | 'targeted' | string;
  category: string;
  title: string;
  body: string;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds, or null while unread. */
  readAt: number | null;
};

/** The member inbox page + the badge count, in one round trip (Rust `MyNotificationsDto`). */
export type MyNotifications = {
  notifications: MyNotification[];
  unreadCount: number;
};

/** The caller's own vault: availability, quota and usage (Rust `FileVaultDto`). */
export type FileVaultInfo = {
  userId: string;
  /** `"available" | "frozen"` — frozen refuses uploads, keeps downloads/deletes. */
  status: 'available' | 'frozen' | string;
  /** null = unlimited. */
  quotaBytes: number | null;
  usageBytes: number;
  objectCount: number;
};

/** One stored vault object (Rust `FileVaultObjectDto`). */
export type FileVaultObject = {
  id: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  createdAt: number;
  /** Set for tombstoned rows (disk file gone; ledger row kept for audit). */
  deletedAt: number | null;
};
