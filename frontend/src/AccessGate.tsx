import { FormEvent, useState } from "react";
import { setAccessKey } from "./accessKey";

type AccessGateProps = {
  onUnlock: () => void;
};

export default function AccessGate({ onUnlock }: AccessGateProps) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setError("Enter the access code from your invite link.");
      return;
    }
    setAccessKey(trimmed);
    setError(null);
    onUnlock();
  }

  return (
    <div className="access-gate">
      <div className="access-gate-card">
        <h1>Board Game Referee</h1>
        <p>
          This app is private. Open the invite link you received, or enter the
          access code below.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="access-key">Access code</label>
          <input
            id="access-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="Paste access code"
          />
          {error && (
            <p className="access-gate-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit">Continue</button>
        </form>
      </div>
    </div>
  );
}
