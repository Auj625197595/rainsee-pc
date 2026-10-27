import type { Session } from 'electron';

import type {
  ProxyImpl,
  ProxySettingSnapshot,
} from '~/vendor/electron-chrome-extensions/browser/impl';

export interface ProxyCredentials {
  username: string;
  password: string;
}

export interface ProfileProxyBaseline {
  /** Profile settings take precedence while preserving extension candidates. */
  force?: boolean;
  value: any;
  config: Electron.ProxyConfig;
  credentials?: ProxyCredentials | null;
}

export interface EffectiveProxyState {
  source: 'profile' | 'extension';
  extensionId?: string;
  value: any;
  config: Electron.ProxyConfig;
}

interface ExtensionCandidate {
  value: any;
  config: Electron.ProxyConfig;
  priority: number;
}

interface SessionProxyState {
  session: Session;
  baseline: ProfileProxyBaseline;
  candidates: Map<string, ExtensionCandidate>;
  nextPriority: number;
  tail: Promise<void>;
  applied?: EffectiveProxyState;
  listeners: Set<() => void>;
}

const defaultBaseline = (): ProfileProxyBaseline => ({
  value: { mode: 'system' },
  config: { mode: 'system' },
  credentials: null,
});

const sessionStates = new WeakMap<Session, SessionProxyState>();

const stateFor = (target: Session): SessionProxyState => {
  let state = sessionStates.get(target);
  if (!state) {
    state = {
      session: target,
      baseline: defaultBaseline(),
      candidates: new Map(),
      nextPriority: 0,
      tail: Promise.resolve(),
      listeners: new Set(),
    };
    sessionStates.set(target, state);
  }
  return state;
};

const effectiveFor = (state: SessionProxyState): EffectiveProxyState => {
  if (state.baseline.force) {
    return {
      source: 'profile',
      value: state.baseline.value,
      config: state.baseline.config,
    };
  }
  let controller: [string, ExtensionCandidate] | undefined;
  for (const candidate of state.candidates) {
    if (!controller || candidate[1].priority > controller[1].priority) {
      controller = candidate;
    }
  }
  if (controller) {
    return {
      source: 'extension',
      extensionId: controller[0],
      value: controller[1].value,
      config: controller[1].config,
    };
  }
  return {
    source: 'profile',
    value: state.baseline.value,
    config: state.baseline.config,
  };
};

const notifyChanged = (state: SessionProxyState) => {
  for (const listener of state.listeners) {
    try {
      listener();
    } catch (error) {
      console.error('[proxy-coordinator] change listener failed:', error);
    }
  }
};

const enqueue = <T>(
  state: SessionProxyState,
  operation: () => Promise<T>,
): Promise<T> => {
  const result = state.tail.then(operation);
  state.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const sameProxyConfig = (
  a: Electron.ProxyConfig | undefined,
  b: Electron.ProxyConfig,
) => !!a && JSON.stringify(a) === JSON.stringify(b);

const applyEffective = async (state: SessionProxyState) => {
  const effective = effectiveFor(state);
  // Session 默认就是 system 代理。启动时(whenReady / session-created / 扩展 SW
  // 唤醒)会反复以相同配置调用这里;此时若 closeAllConnections,会把首页正在下载的
  // JS/CSS 连接掐断(经 Service Worker 转发后在页面里表现为 net::ERR_FAILED)。
  // 只有生效配置真的变化时才切换并断开旧连接。
  const previousConfig =
    state.applied?.config ?? ({ mode: 'system' } as Electron.ProxyConfig);
  if (sameProxyConfig(previousConfig, effective.config)) {
    const changed =
      !state.applied ||
      state.applied.source !== effective.source ||
      state.applied.extensionId !== effective.extensionId;
    state.applied = effective;
    if (changed) notifyChanged(state);
    return;
  }
  const firstApply = !state.applied;
  await state.session.setProxy(effective.config);
  // 首次应用(启动)不断开连接:Chromium 连接池按代理链分组,新请求不会复用旧
  // 直连 socket;此时强断只会让首页等已在途的请求失败。
  if (!firstApply && typeof state.session.closeAllConnections === 'function') {
    try {
      await state.session.closeAllConnections();
    } catch (error) {
      console.warn(
        '[proxy-coordinator] failed to close existing connections:',
        error,
      );
    }
  }
  state.applied = effective;
  notifyChanged(state);
};

export const setProfileProxyBaseline = (
  target: Session,
  baseline: ProfileProxyBaseline,
): Promise<void> => {
  const state = stateFor(target);
  return enqueue(state, async () => {
    const previous = state.baseline;
    state.baseline = baseline;
    const effective = effectiveFor(state);
    // An ordinary baseline edit cannot affect an already-applied extension.
    // Force -> unforced is different: `applied` is still the profile, so the
    // preserved extension candidate must be applied now.
    if (
      effective.source === 'extension' &&
      state.applied?.source === 'extension' &&
      state.applied.extensionId === effective.extensionId
    ) {
      return;
    }
    try {
      await applyEffective(state);
    } catch (error) {
      state.baseline = previous;
      throw error;
    }
  });
};

export const getEffectiveProxyState = async (
  target: Session,
): Promise<EffectiveProxyState> => {
  const state = stateFor(target);
  await state.tail;
  return state.applied || effectiveFor(state);
};

export const getEffectiveProxyCredentials = (
  target: Session,
): ProxyCredentials | null => {
  const state = stateFor(target);
  const effective = state.applied || effectiveFor(state);
  return effective.source === 'profile'
    ? state.baseline.credentials || null
    : null;
};

export const onEffectiveProxyChanged = (
  target: Session,
  listener: () => void,
): (() => void) => {
  const listeners = stateFor(target).listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const createExtensionProxyImpl = (target: Session): ProxyImpl => {
  const state = stateFor(target);

  const snapshot = (extensionId: string): ProxySettingSnapshot => {
    const effective = state.applied || effectiveFor(state);
    if (state.baseline.force) {
      return {
        value: state.baseline.value,
        levelOfControl: 'not_controllable',
      };
    }
    if (effective.source === 'extension') {
      return {
        value: effective.value,
        levelOfControl:
          effective.extensionId === extensionId
            ? 'controlled_by_this_extension'
            : 'controlled_by_other_extensions',
      };
    }
    return {
      value: effective.value,
      levelOfControl: 'controllable_by_this_extension',
    };
  };

  const removeCandidate = (extensionId: string) =>
    enqueue(state, async () => {
      const previous = state.candidates.get(extensionId);
      if (!previous) return;
      state.candidates.delete(extensionId);
      if (state.baseline.force) return;
      try {
        await applyEffective(state);
      } catch (error) {
        state.candidates.set(extensionId, previous);
        throw error;
      }
    });

  return {
    set(extensionId, value, config) {
      return enqueue(state, async () => {
        const previous = state.candidates.get(extensionId);
        if (!previous && state.candidates.size > 0) {
          throw new Error('Proxy settings are controlled by another extension');
        }
        // Keep an extension's ownership rank stable while it updates its
        // settings. A later update must not steal control merely because its
        // service worker happened to wake after another extension.
        const priority = previous?.priority ?? ++state.nextPriority;
        state.candidates.set(extensionId, { value, config, priority });
        // Keep the extension's latest candidate for a reversible unlock, but
        // do not touch the Session while the profile is forced. This avoids an
        // extension error/retry loop and restores its current choice when the
        // user later turns the force switch off.
        if (state.baseline.force) return;
        try {
          await applyEffective(state);
        } catch (error) {
          if (previous) state.candidates.set(extensionId, previous);
          else state.candidates.delete(extensionId);
          throw error;
        }
      });
    },
    clear: removeCandidate,
    async get(extensionId) {
      await state.tail;
      return snapshot(extensionId);
    },
    release: removeCandidate,
    onChanged(listener) {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
  };
};
