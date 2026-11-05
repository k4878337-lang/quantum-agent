"""
Base LLM Provider Interface with Rate-Limit & Backoff Metadata
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Dict, Any


@dataclass
class LLMResponse:
    content: str = ""
    tokens_used: int = 0
    model: str = ""
    is_rate_limited: bool = False
    retry_after_seconds: float = 0.0
    error: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_success(self) -> bool:
        return self.error is None and not self.is_rate_limited and bool(self.content)


class BaseLLMProvider(ABC):
    """Abstract interface for all AI model adapters."""

    @abstractmethod
    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> LLMResponse:
        """Generates completion for a prompt."""
        pass

    @abstractmethod
    def get_provider_name(self) -> str:
        """Returns the identifier of the provider."""
        pass
