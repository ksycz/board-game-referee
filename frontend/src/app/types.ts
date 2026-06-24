import type { StoredMessage } from "../conversationStorage";

export type ChatMode = "ask" | "search" | "dispute";

export type Message = StoredMessage;

export type ClarificationContext = {
  originalQuestion: string;
  question: string;
};

export type AppError = {
  message: string;
  code?: "rate_limit" | "bgg_manual_download" | "demo_readonly" | "demo_rulebook_only" | "unauthorized";
  bggUrl?: string;
};
