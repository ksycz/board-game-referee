import { useEffect, useState } from "react";
import App from "./App";
import AccessGate from "./AccessGate";
import { fetchAppConfig, type AppConfig } from "./api";
import { getAccessKey, initAccessKeyFromUrl } from "./accessKey";

function readInitialUnlockState(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  initAccessKeyFromUrl();
  return Boolean(getAccessKey());
}

export default function AppRoot() {
  const [unlocked, setUnlocked] = useState(readInitialUnlockState);
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    fetchAppConfig()
      .then(setConfig)
      .catch(() => {
        setConfig({
          auth_required: false,
          demo_mode: false,
          full_access: true,
        });
      });
  }, []);

  useEffect(() => {
    if (!unlocked) {
      return;
    }
    fetchAppConfig()
      .then(setConfig)
      .catch(() => {});
  }, [unlocked]);

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
