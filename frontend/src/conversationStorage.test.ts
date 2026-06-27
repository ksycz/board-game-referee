import { beforeEach, describe, expect, it } from "vitest";
import type { AskResponse } from "./api";
import {
  appendExchange,
  loadAllHistory,
  repairRaceCorruptedThread,
  saveThread,
  trimThread,
  type StoredMessage,
} from "./conversationStorage";

function refereeMessage(label = "No."): StoredMessage {
  const data: AskResponse = {
    mode: "ask",
    rulebook_id: "book-1",
    rulebook_name: "Test Game",
    question: "Can I attack?",
    ruling: {
      ruling: label,
      confidence: "high",
      reasoning: "Because rules.",
      citations: [],
      needs_clarification: false,
      clarification_question: null,
    },
    retrieval: { chunks_found: 1, pages: [1] },
    citation_check: { all_valid: true, issues: [], citations: [] },
    cached: false,
    response_id: "resp-1",
  };
  return { role: "referee", data };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("trimThread", () => {
  it("keeps only the most recent referee exchanges", () => {
    const messages: StoredMessage[] = [];
    for (let index = 0; index < 12; index += 1) {
      messages.push({ role: "user", text: `Question ${index}` });
      messages.push(refereeMessage(`Answer ${index}`));
    }
    const trimmed = trimThread(messages);
    expect(trimmed.filter((message) => message.role === "referee")).toHaveLength(10);
    expect(trimmed.at(-1)).toEqual(refereeMessage("Answer 11"));
  });
});

describe("repairRaceCorruptedThread", () => {
  it("drops a duplicate trailing dispute bubble after a ruling commit", () => {
    const messages: StoredMessage[] = [
      {
        role: "dispute",
        situation: "Who wins?",
        playerA: "Me",
        playerB: "You",
      },
      refereeMessage("Player A wins."),
      {
        role: "dispute",
        situation: "Who wins?",
        playerA: "Me",
        playerB: "You",
      },
    ];
    expect(repairRaceCorruptedThread(messages)).toHaveLength(2);
  });
});

describe("appendExchange", () => {
  it("updates the latest exchange when the same ruling is saved within five seconds", () => {
    const rulebookId = "book-1";
    const firstThread: StoredMessage[] = [
      { role: "user", text: "Can I attack?" },
      refereeMessage("Draft answer"),
    ];
    saveThread(rulebookId, firstThread);
    const first = appendExchange(rulebookId, firstThread);
    expect(first?.label).toBe("Can I attack?");

    const secondThread: StoredMessage[] = [
      { role: "user", text: "Can I attack?" },
      refereeMessage("Final answer"),
    ];
    saveThread(rulebookId, secondThread);
    const second = appendExchange(rulebookId, secondThread);
    expect(second?.id).toBe(first?.id);
    expect(loadAllHistory()[rulebookId]).toHaveLength(1);
    expect(loadAllHistory()[rulebookId][0].messages.at(-1)).toEqual(refereeMessage("Final answer"));
  });
});
