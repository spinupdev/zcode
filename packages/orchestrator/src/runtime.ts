/**
 * Runtime interface for Docker (MVP) and Firecracker (post-MVP multi-tenant).
 * See design Appendix D.
 */

export type RuntimeType = 'docker' | 'firecracker';

export interface RuntimeSpec {
  imageOrRootfs: string;
  cpuCount: number;
  memMb: number;
  diskGb: number;
  env: Record<string, string>;
  workspaceVolume: string;
  egressPolicy: 'default-allowlist' | 'deny-all' | 'custom';
}

export interface RuntimeHandle {
  id: string;
  type: RuntimeType;
}

export interface Runtime {
  readonly type: RuntimeType;
  create(spec: RuntimeSpec): Promise<RuntimeHandle>;
  start(id: string): Promise<void>;
  pause?(id: string): Promise<void>;
  resume?(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  destroy(id: string): Promise<void>;
  endpoint(id: string): Promise<{ authority: string; healthUrl: string }>;
}
