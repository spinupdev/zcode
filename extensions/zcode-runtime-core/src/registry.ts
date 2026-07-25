import type {
  ExecutionBackend,
  ExecutionBackendId,
  ExecutionBackendInfo,
  ZcodeRuntimeApi,
} from './types.js';

type Listener = () => void;

export class RuntimeRegistry implements ZcodeRuntimeApi {
  private readonly backends = new Map<ExecutionBackendId, ExecutionBackend>();
  private activePreference: ExecutionBackendId | 'auto' = 'auto';
  private readonly listeners = new Set<Listener>();

  register(backend: ExecutionBackend): void {
    this.backends.set(backend.id, backend);
    this.emit();
  }

  unregister(id: ExecutionBackendId): void {
    const b = this.backends.get(id);
    if (b) {
      try {
        b.dispose();
      } catch {
        /* ignore */
      }
      this.backends.delete(id);
      this.emit();
    }
  }

  list(): ExecutionBackendInfo[] {
    return [...this.backends.values()].map((b) => b.info);
  }

  get(id: ExecutionBackendId): ExecutionBackend | undefined {
    return this.backends.get(id);
  }

  setActive(id: ExecutionBackendId | 'auto'): void {
    this.activePreference = id;
    this.emit();
  }

  getActiveId(languageId = ''): ExecutionBackendId {
    if (this.activePreference !== 'auto' && this.backends.has(this.activePreference)) {
      return this.activePreference;
    }
    const lang = languageId.toLowerCase();
    for (const b of this.backends.values()) {
      if (b.info.requiresRemote) continue;
      const langs = b.info.languages.map((l) => l.toLowerCase());
      if (langs.includes('*') || langs.includes(lang)) {
        return b.id;
      }
    }
    const first = this.backends.keys().next().value;
    return first ?? 'none';
  }

  onDidChange(listener: Listener): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  }

  disposeAll(): void {
    for (const b of this.backends.values()) {
      try {
        b.dispose();
      } catch {
        /* ignore */
      }
    }
    this.backends.clear();
    this.listeners.clear();
  }
}

export function installGlobalRegistry(registry: RuntimeRegistry): void {
  globalThis.zcodeRuntime = registry;
}

export function getGlobalRegistry(): ZcodeRuntimeApi | undefined {
  return globalThis.zcodeRuntime;
}
