const API = import.meta.env.VITE_API_URL ?? "";

function parseErrorDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail && "message" in detail) {
    return String((detail as { message: string }).message);
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "object" && item && "msg" in item) {
          return String((item as { msg: string }).msg);
        }
        return String(item);
      })
      .join("; ");
  }
  return undefined;
}

export type Rulebook = {
  id: string;
  name: string;
  filename: string;
  page_count: number;
  created_at: string;
};

export type Citation = {
  page: number;
  section?: string;
  quote: string;
  valid?: boolean;
  issue?: string;
};

export type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AskResponse = {
  rulebook_id: string;
  rulebook_name: string;
  question: string;
  retrieval: { chunks_found: number; pages: number[] };
  ruling: {
    ruling: string;
    confidence: "high" | "medium" | "low";
    reasoning: string;
    citations: Citation[];
    needs_clarification: boolean;
    clarification_question: string | null;
  };
  citation_check: {
    all_valid: boolean;
    issues: string[];
    citations: Citation[];
  };
};

export type UploadResponse = {
  rulebook: Rulebook;
  example_questions: string[];
  already_exists?: boolean;
};

export class DuplicateRulebookError extends Error {
  readonly rulebook: Rulebook;
  readonly example_questions: string[];

  constructor(message: string, rulebook: Rulebook, example_questions: string[]) {
    super(message);
    this.name = "DuplicateRulebookError";
    this.rulebook = rulebook;
    this.example_questions = example_questions;
  }
}

export function isDuplicateRulebookError(err: unknown): err is DuplicateRulebookError {
  return (
    err instanceof DuplicateRulebookError
    || (typeof err === "object"
      && err !== null
      && (err as { name?: string }).name === "DuplicateRulebookError"
      && "rulebook" in err)
  );
}

export async function listRulebooks(): Promise<Rulebook[]> {
  const res = await fetch(`${API}/api/rulebooks`);
  if (!res.ok) throw new Error("Failed to load rulebooks");
  return res.json();
}

export async function uploadRulebook(file: File, name?: string): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);

  const res = await fetch(`${API}/api/rulebooks`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && data.detail?.rulebook) {
    throw new DuplicateRulebookError(
      parseErrorDetail(data.detail) ?? "This rulebook is already in your library.",
      data.detail.rulebook,
      data.detail.example_questions ?? [],
    );
  }
  if (!res.ok) {
    throw new Error(parseErrorDetail(data.detail) ?? "Upload failed");
  }
  return {
    rulebook: data.rulebook,
    example_questions: data.example_questions ?? [],
  };
}

export async function fetchExampleQuestions(rulebookId: string): Promise<string[]> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}/examples`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err.detail) ?? "Failed to load example questions");
  }
  const data = await res.json();
  return data.questions ?? [];
}

export async function askRulebook(
  rulebookId: string,
  question: string,
  history: HistoryMessage[] = [],
): Promise<AskResponse> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err.detail) ?? "Question failed");
  }
  return res.json();
}

export async function deleteRulebook(rulebookId: string): Promise<void> {
  const res = await fetch(`${API}/api/rulebooks/${rulebookId}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err.detail) ?? "Delete failed");
  }
}
