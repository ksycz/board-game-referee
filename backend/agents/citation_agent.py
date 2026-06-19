"""Citation agent – verify the referee cited pages that were actually retrieved."""

from __future__ import annotations

from services.vector_store import StoredChunk


class CitationAgent:
    def validate(self, ruling: dict, chunks: list[StoredChunk]) -> dict:
        citations = ruling.get("citations") or []
        available_pages = {chunk.page for chunk in chunks}

        validated: list[dict] = []
        issues: list[str] = []

        for citation in citations:
            page = citation.get("page")
            if not isinstance(page, int):
                issues.append(f"Citation missing valid page number: {citation}")
                validated.append({**citation, "valid": False, "issue": "missing page"})
                continue

            on_page = page in available_pages
            quote = (citation.get("quote") or "").strip().lower()
            grounded = False
            if on_page and quote:
                for chunk in chunks:
                    if chunk.page == page and quote in chunk.text.lower():
                        grounded = True
                        break
            elif on_page:
                grounded = True

            entry = {
                **citation,
                "valid": on_page and grounded,
                "retrieved": on_page,
                "quote_grounded": grounded if quote else on_page,
            }
            if not on_page:
                issues.append(f"Page {page} was cited but not in retrieved context")
                entry["issue"] = "page not in retrieval"
            elif quote and not grounded:
                issues.append(f"Quote on page {page} could not be verified in source text")
                entry["issue"] = "quote not grounded"
            validated.append(entry)

        all_valid = bool(validated) and all(c.get("valid") for c in validated)
        return {
            "agent": "citation",
            "citations_checked": len(validated),
            "all_valid": all_valid,
            "citations": validated,
            "issues": issues,
        }
