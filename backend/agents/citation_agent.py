"""Citation agent – verify the referee cited pages that were actually retrieved."""

from __future__ import annotations

from services.vector_store import StoredChunk


def _source_for_citation(
    page: int,
    quote: str,
    chunks: list[StoredChunk],
) -> dict[str, str | None]:
    page_chunks = [chunk for chunk in chunks if chunk.page == page]
    if not page_chunks:
        return {"source_excerpt": None, "source_section": None}

    quote_lower = quote.strip().lower()
    if quote_lower:
        for chunk in page_chunks:
            if quote_lower in chunk.text.lower():
                return {
                    "source_excerpt": chunk.text,
                    "source_section": chunk.section_hint,
                }

    return {
        "source_excerpt": "\n\n".join(chunk.text for chunk in page_chunks),
        "source_section": next(
            (chunk.section_hint for chunk in page_chunks if chunk.section_hint),
            None,
        ),
    }


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
            quote = (citation.get("quote") or "").strip()
            quote_lower = quote.lower()
            grounded = False
            if on_page and quote_lower:
                for chunk in chunks:
                    if chunk.page == page and quote_lower in chunk.text.lower():
                        grounded = True
                        break

            entry = {
                **citation,
                "valid": on_page and grounded,
                "retrieved": on_page,
                "quote_grounded": grounded,
            }
            if not on_page:
                issues.append(f"Page {page} was cited but not in retrieved context")
                entry["issue"] = "page not in retrieval"
            elif not quote_lower:
                issues.append(f"Citation on page {page} is missing a quote")
                entry["issue"] = "missing quote"
            elif not grounded:
                issues.append(f"Quote on page {page} could not be verified in source text")
                entry["issue"] = "quote not grounded"
            source = _source_for_citation(page, quote, chunks)
            entry.update(source)
            validated.append(entry)

        all_valid = bool(validated) and all(c.get("valid") for c in validated)
        return {
            "agent": "citation",
            "citations_checked": len(validated),
            "all_valid": all_valid,
            "citations": validated,
            "issues": issues,
        }
