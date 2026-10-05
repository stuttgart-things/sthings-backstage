/**
 * One VM as reported by an inventory. Everything here is live observation;
 * intent (owner, purpose, links) does not come from the source.
 */
export interface VmRecord {
  name: string;
  /** Short label of the source kind, used in the entity name and tags. */
  cloud: string;
  template: boolean;
  /** Power state as reported by the source, e.g. `running`, `stopped`. */
  status?: string;
  cpus?: number;
  memoryMiB?: number;
  ipv4?: string;
  /** Source tags, unsanitized. */
  tags: string[];
  /** Source-specific annotations, already namespaced. */
  annotations: Record<string, string>;
  /** Deeplink into the source UI. */
  url?: string;
}

/** A VM inventory. One implementation per platform. */
export interface VmSource {
  listVms(): Promise<VmRecord[]>;
}
