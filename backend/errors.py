class RateLimitError(Exception):
    """Anthropic API rate limit or quota exceeded."""

    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            message
            or "The referee is handling too many questions right now. Wait a minute and try again.",
        )
