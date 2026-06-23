import { FormEvent, useState } from "react";
import { validateAccessKey } from "./api";
import { clearAccessKey, setAccessKey } from "./accessKey";

type AccessGateProps = {
  onUnlock: () => void;
};

export default function AccessGate({ onUnlock }: AccessGateProps) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setError("Enter the access code from your invite link.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setAccessKey(trimmed);

    try {
      const valid = await validateAccessKey();
      if (!valid) {
        clearAccessKey();
        setError("That access code didn't work. Check your invite link.");
        return;
      }
      onUnlock();
    } catch {
      clearAccessKey();
      setError("Could not verify the access code. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
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
            disabled={submitting}
          />
          {error && (
            <p className="access-gate-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? "Checking…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
