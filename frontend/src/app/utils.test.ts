import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import type { AskResponse } from "../api";
import type { Message } from "./types";
import {
  appendRulingToThread,
  getActiveClarification,
  getPendingClarification,
  sortRulebooks,
  toAppError,
  visibleRulebooks,
} from "./utils";

function askResponse(overrides: Partial<AskResponse["ruling"]> = {}): AskResponse {
  return {
    mode: "ask",
    rulebook_id: "book-1",
    rulebook_name: "Test Game",
    question: "Can I attack?",
    ruling: {
      ruling: "No.",
      confidence: "high",
      reasoning: "Rules say no.",
      citations: [],
      needs_clarification: false,
      clarification_question: null,
      ...overrides,
    },
    retrieval: { chunks_found: 1, pages: [1] },
    citation_check: { all_valid: true, issues: [], citations: [] },
    cached: false,
    response_id: "resp-1",
  };
}

describe("toAppError", () => {
  it("maps rate limit and BGG manual download codes", () => {
    expect(toAppError(new ApiError("Slow down", "rate_limit", 429))).toEqual({
      message: "Slow down",
      code: "rate_limit",
    });
    expect(
      toAppError(
        new ApiError("Download manually", "bgg_manual_download", 400, "https://bgg.example/file"),
      ),
    ).toEqual({
      message: "Download manually",
      code: "bgg_manual_download",
      bggUrl: "https://bgg.example/file",
    });
  });
});

describe("clarification helpers", () => {
  it("detects pending clarification from the last referee message", () => {
    const messages: Message[] = [
      { role: "user", text: "Can I attack?" },
      {
        role: "referee",
        data: askResponse({
          needs_clarification: true,
          clarification_question: "How many players?",
        }),
      },
    ];
    expect(getPendingClarification(messages)).toEqual({
      originalQuestion: "Can I attack?",
      question: "How many players?",
      mode: "ask",
    });
  });

  it("honors an explicit override over pending clarification", () => {
    const messages: Message[] = [
      { role: "user", text: "Can I attack?" },
      {
        role: "referee",
        data: askResponse({
          needs_clarification: true,
          clarification_question: "How many players?",
        }),
      },
    ];
    expect(getActiveClarification(messages, null)).toBeNull();
    expect(
      getActiveClarification(messages, {
        originalQuestion: "Can I attack?",
        question: "Override question",
        mode: "ask",
      }),
    ).toEqual({
      originalQuestion: "Can I attack?",
      question: "Override question",
      mode: "ask",
    });
  });
});

describe("appendRulingToThread", () => {
  it("reuses the last matching prompt instead of duplicating it", () => {
    const prompt = { role: "user" as const, text: "Can I attack?" };
    const existing: Message[] = [prompt];
    const next = appendRulingToThread(existing, prompt, askResponse());
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(prompt);
    expect(next[1].role).toBe("referee");
  });
});

describe("rulebook list helpers", () => {
  it("sorts pinned books first, then by created date", () => {
    const books = sortRulebooks([
      { id: "a", name: "A", pinned: false, created_at: "2024-01-02", page_count: 1, filename: "a.pdf" },
      { id: "b", name: "B", pinned: true, created_at: "2024-01-01", page_count: 1, filename: "b.pdf" },
    ]);
    expect(books.map((book) => book.id)).toEqual(["b", "a"]);
  });

  it("keeps the selected book visible when the list is collapsed", () => {
    const books = Array.from({ length: 6 }, (_, index) => ({
      id: `book-${index}`,
      name: `Game ${index}`,
      pinned: false,
      created_at: `2024-01-0${index + 1}`,
      page_count: 1,
      filename: `game-${index}.pdf`,
    }));
    const visible = visibleRulebooks(books, "book-5", false);
    expect(visible.some((book) => book.id === "book-5")).toBe(true);
    expect(visible.length).toBeLessThanOrEqual(5);
  });
});
