import { useEffect, useState } from "react";
import App from "./App";
import AccessGate from "./AccessGate";
import { fetchAppConfigWithRetry, validateAccessKey, type AppConfig } from "./api";
import { clearAccessKey, getAccessKey, initAccessKeyFromUrl } from "./accessKey";

function readInitialUnlockState(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  initAccessKeyFromUrl();
  return Boolean(getAccessKey());
}

function configFallback(): AppConfig {
  if (import.meta.env.VITE_DEMO_MODE === "true") {
    return {
      auth_required: false,
      demo_mode: true,
      full_access: false,
    };
  }

  const hasKey = Boolean(getAccessKey());
  return {
    auth_required: hasKey,
    demo_mode: false,
    full_access: false,
  };
}

export default function AppRoot() {
  const [unlocked, setUnlocked] = useState(readInitialUnlockState);
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    fetchAppConfigWithRetry()
      .then(setConfig)
      .catch(() => {
        setConfig(configFallback());
      });
  }, []);

  useEffect(() => {
    if (!unlocked) {
      return;
    }
    fetchAppConfigWithRetry()
      .then(setConfig)
      .catch(() => {});
  }, [unlocked]);

  useEffect(() => {
    if (!config?.auth_required || !unlocked) {
      return;
    }
    const key = getAccessKey();
    if (!key) {
      return;
    }

    let cancelled = false;
    validateAccessKey()
      .then((valid) => {
        if (cancelled || valid) {
          return;
        }
        clearAccessKey();
        setUnlocked(false);
        setConfig((current) =>
          current
            ? { ...current, full_access: false }
            : configFallback(),
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        clearAccessKey();
        setUnlocked(false);
      });

    return () => {
      cancelled = true;
    };
  }, [config?.auth_required, unlocked]);

  if (!config) {
    return (
      <div className="access-gate">
        <div className="access-gate-card">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (config.auth_required && !unlocked) {
    return <AccessGate onUnlock={() => setUnlocked(true)} />;
  }

  return <App demoMode={config.demo_mode} fullAccess={config.full_access} />;
}
