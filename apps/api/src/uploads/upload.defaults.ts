/**
 * Single source of truth for the M5.1 upload pipeline's default (offline, deterministic) parts.
 * Mirrors `ingestion.defaults.ts`: the running API and any future CLI/worker share one factory so
 * they can't drift on which storage/scanner driver they use. Swap the production GCS storage +
 * ClamAV/VirusTotal scanner in here (and behind the `STORAGE_PROVIDER` / `MALWARE_SCANNER` tokens).
 */
import {
  InMemoryStorageProvider,
  type StorageProvider,
} from "./storage-provider";
import {
  SignatureMalwareScanner,
  type MalwareScanner,
} from "./malware-scanner";

export function createDefaultStorageProvider(): StorageProvider {
  return new InMemoryStorageProvider();
}

export function createDefaultMalwareScanner(): MalwareScanner {
  return new SignatureMalwareScanner();
}
