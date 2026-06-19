# Using the app

Rules Referee helps you settle board game rules questions during play. Upload a rulebook PDF, ask questions in plain English, settle two-sided disputes, and get rulings backed by page citations from the rulebook.

## Before you start

1. Complete [local setup](README.md#local-setup) and run the app:

   ```bash
   ./scripts/dev.sh
   ```

2. Open **http://localhost:5173** in your browser (recommended — hot reload).

   Or use **http://localhost:8000** if you only started the backend (serves the built frontend). After code changes, hard-refresh (`Cmd+Shift+R`) or run `npm run build` in `frontend/`.

3. Make sure `ANTHROPIC_API_KEY` is set in `backend/.env` — the referee needs it to answer questions (cached repeat answers skip the LLM).

## Upload a rulebook

1. In the left sidebar, optionally type a **game name** (e.g. "Wingspan"). If you leave it blank, the app tries to detect the title from the PDF.
2. Click **Choose rulebook PDF** and select the game's rulebook PDF.
3. Wait a few seconds while the app indexes the text. The rulebook appears in **Your library** with a page count and three **Try asking** suggestions.

You can upload multiple rulebooks and switch between them. The library shows up to five games at once — click **See N more** to expand. Click **×** next to a rulebook to delete it.

**Duplicate uploads** — If you upload the same PDF again (even with a different filename), the app opens the existing copy instead of adding a duplicate. A banner under the header tells you it was already in your library.

## Ask a rules question

1. Select a rulebook from the library.
2. Make sure **Ask** is selected in the chat header (next to **Dispute**).
3. Pick a **Try asking** chip, or type your own question in the box at the bottom, e.g.:
   - *Can I play this card during another player's turn?*
   - *What happens on a tie in combat?*
   - *Do I draw a card at the end of my turn?*
4. Press **Ask** or hit Enter.

The referee searches the rulebook for relevant passages, reasons over them, and returns an answer.

**From cache** — If you ask the exact same question again (with no follow-up history), the app returns the previous ruling instantly with a green **From cache** badge. No API call is made.

## Dispute mode

When two players disagree on how a rule works:

1. Select **Dispute** in the chat header.
2. Fill in three fields:
   - **What's in dispute?** — the situation (e.g. *Can I play this card after combat ends?*)
   - **Player A says** — one player's interpretation
   - **Player B says** — the other player's interpretation
3. Click **Settle dispute**.

The referee weighs both arguments against the rulebook and returns:

| Part | What it means |
|------|----------------|
| **Favors badge** | Who the rules support: Player A, Player B, split, neither, or unclear |
| **Ruling** | The direct verdict for the table |
| **Player A / B assessments** | How each argument matches the rule text |
| **Citations** | Supporting passages with page numbers |

Disputes with no prior conversation in the thread can also be served from cache on repeat.

## Read the ruling

Each answer includes:

| Part | What it means |
|------|----------------|
| **Confidence badge** | `high`, `medium`, or `low` — how sure the referee is based on the retrieved text |
| **From cache** | Shown when the answer was reused from a previous identical question |
| **Ruling** | The direct answer in one or two sentences |
| **Reasoning** | A short explanation of how the referee reached that answer |
| **Citations** | Page numbers and quoted rule text supporting the ruling |
| **Agent trace** | Expandable debug view showing retrieved passages, retrieval metrics, and the full API response |

If you see **citations need review**, the referee cited a page or quote that could not be fully verified against the retrieved text. Treat the ruling with extra caution.

## Clarification flow

Some questions are ambiguous — the answer may depend on game state the referee doesn't know. When that happens:

1. A blue **Needs your input** callout appears in the answer with a follow-up question.
2. The same question is shown **above the input box** at the bottom of the chat.
3. The button changes to **Send detail** — type your answer and submit.

Your reply is sent together with the original question so the referee can give a final ruling. Clarification requests are not cached.

Click **Ask something else instead** if you want to dismiss the follow-up and ask a new question.

## Follow-up questions

The referee remembers your conversation **per rulebook**. After an answer, you can ask short follow-ups like:

- *What about on the first turn?*
- *Does that apply to two players?*
- *What if I already drew a card?*

Switch between rulebooks in the sidebar — each keeps its own chat history. Click **New conversation** to start fresh on the current game.

Follow-ups always call the LLM (they use conversation history, so they are not served from the FAQ cache).

## Tips for better answers

- **Be specific** — "Can I attack on the first turn?" works better than "Is this allowed?"
- **One question at a time** — keep each message focused on a single rules situation.
- **Use Dispute mode at the table** — paste each player's reading of the rule instead of arguing in chat.
- **Re-upload after rulebook changes** — if you update the PDF, delete the old copy and upload again so the index stays in sync.
- **Use text-based PDFs** — scanned image-only PDFs may not extract well.

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Upload fails | Check the file is a PDF and not empty |
| "Already in your library" | Expected for duplicate PDFs — the existing game was selected |
| Question fails / API error | Verify `ANTHROPIC_API_KEY` in `backend/.env` |
| Stale UI on :8000 | Hard refresh or `cd frontend && npm run build` |
| Vague or wrong answers | Rephrase the question; try Dispute mode with both interpretations spelled out |
| `Address already in use` | Stop old servers: `lsof -ti :8000,:5173 \| xargs kill`, then run `./scripts/dev.sh` again |

For setup, API details, tuning, and deployment, see the [README](README.md).
