# Using the app

Rules Referee helps you settle board game rules questions during play. Upload a rulebook PDF, ask questions in plain English, and get rulings backed by page citations from the rulebook.

## Before you start

1. Complete [local setup](README.md#local-setup) and run the app:

   ```bash
   ./scripts/dev.sh
   ```

2. Open **http://localhost:5173** in your browser.

3. Make sure `ANTHROPIC_API_KEY` is set in `backend/.env` — the referee needs it to answer questions.

## Upload a rulebook

1. In the left sidebar, optionally type a **game name** (e.g. "Wingspan").
2. Click **Choose PDF** and select the game's rulebook PDF.
3. Wait a few seconds while the app indexes the text. The rulebook appears in **Your rulebooks** with a page count.

You can upload multiple rulebooks and switch between them. Click **×** next to a rulebook to delete it.

## Ask a rules question

1. Select a rulebook from the list.
2. Pick a **Try asking** suggestion, or type your own question in the box at the bottom of the chat, e.g.:
   - *Can I play this card during another player's turn?*
   - *What happens on a tie in combat?*
   - *Do I draw a card at the end of my turn?*
3. Press **Ask** or hit Enter.

The referee searches the rulebook for relevant passages, reasons over them, and returns an answer.

## Read the ruling

Each answer includes:

| Part | What it means |
|------|----------------|
| **Confidence badge** | `high`, `medium`, or `low` — how sure the referee is based on the retrieved text |
| **Ruling** | The direct answer in one or two sentences |
| **Reasoning** | A short explanation of how the referee reached that answer |
| **Citations** | Page numbers and quoted rule text supporting the ruling |
| **Agent trace** | Expandable debug view showing retrieved passages and the full API response |

If you see **citations need review**, the referee cited a page or quote that could not be fully verified against the retrieved text. Treat the ruling with extra caution.

## Clarification flow

Some questions are ambiguous — the answer may depend on game state the referee doesn't know. When that happens:

1. A blue **Needs your input** callout appears in the answer with a follow-up question.
2. The same question is shown **above the input box** at the bottom of the chat.
3. The button changes to **Send detail** — type your answer and submit.

Your reply is sent together with the original question so the referee can give a final ruling.

Click **Ask something else instead** if you want to dismiss the follow-up and ask a new question.

## Follow-up questions

The referee remembers your conversation **per rulebook**. After an answer, you can ask short follow-ups like:

- *What about on the first turn?*
- *Does that apply to two players?*
- *What if I already drew a card?*

Switch between rulebooks in the sidebar — each keeps its own chat history. Click **New conversation** to start fresh on the current game.

## Tips for better answers

- **Be specific** — "Can I attack on the first turn?" works better than "Is this allowed?"
- **One question at a time** — keep each message focused on a single rules situation.
- **Re-upload after rulebook changes** — if you update the PDF, delete the old copy and upload again so the index stays in sync.
- **Use text-based PDFs** — scanned image-only PDFs may not extract well.

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Upload fails | Check the file is a PDF and not empty |
| Question fails / API error | Verify `ANTHROPIC_API_KEY` in `backend/.env` |
| Vague or wrong answers | Rephrase the question; try mentioning the specific card, phase, or situation |
| `Address already in use` | Stop old servers: `lsof -ti :8000,:5173 \| xargs kill`, then run `./scripts/dev.sh` again |

For setup, API details, and deployment, see the [README](README.md).
