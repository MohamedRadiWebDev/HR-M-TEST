/**
 * THE seam between the app and where data lives.
 *
 * Today everything is local (IndexedDB in the user's browser). Every module imports persistence
 * from `@/data/storage` only – never from the IndexedDB file directly – so moving to a database
 * later means providing another `StorageAdapter` here, not touching screens or the engine.
 *
 * NOTE: this adapter saves/loads the whole app snapshot. When a real database arrives, new
 * features should use per-entity repositories (list/get/create/update) instead of snapshots; the
 * snapshot adapter then remains only for import/export/backup.
 */
import * as local from "@/store/persistence";

export type { LoadResult, PersistedSnapshot, PersistedState } from "@/store/persistence";

export interface StorageAdapter {
  load: typeof local.loadPersistedState;
  save: typeof local.persistState;
  clear: typeof local.clearPersistedState;
  loadAutoBackup: typeof local.loadAutoBackup;
  savePreRestoreSnapshot: typeof local.savePreRestoreSnapshot;
  loadPreRestoreSnapshot: typeof local.loadPreRestoreSnapshot;
  exportRawBackup: typeof local.exportIncompatibleBackup;
  requestPersistence: typeof local.requestPersistentStorage;
  lastSavedAt: typeof local.getLastSavedAt;
  removeLegacy: typeof local.removeLegacyStorage;
}

export const indexedDbStorage: StorageAdapter = {
  load: local.loadPersistedState,
  save: local.persistState,
  clear: local.clearPersistedState,
  loadAutoBackup: local.loadAutoBackup,
  savePreRestoreSnapshot: local.savePreRestoreSnapshot,
  loadPreRestoreSnapshot: local.loadPreRestoreSnapshot,
  exportRawBackup: local.exportIncompatibleBackup,
  requestPersistence: local.requestPersistentStorage,
  lastSavedAt: local.getLastSavedAt,
  removeLegacy: local.removeLegacyStorage,
};

/** Swap this line (or select by env) to change where the app stores its data. */
export const storage: StorageAdapter = indexedDbStorage;

export { PERSISTENCE_ERROR_EVENT, PERSISTENCE_SAVED_EVENT } from "@/store/persistence";
