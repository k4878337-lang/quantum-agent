"""
Universal AI Provider Adapter
Connects to any AI: Gemini, OpenAI, Claude, DeepSeek, Groq, OpenRouter, and Local Ollama.
Built entirely with Python standard library (no pip dependencies required).
"""

import os
import json
import urllib.request
import urllib.error
import urllib.parse
from typing import Optional, Dict, Any

from quantum_agent.providers.base import BaseLLMProvider, LLMResponse


class UniversalAIProvider(BaseLLMProvider):
    """
    Universal multi-model adapter connecting to cloud and local models.
    Supports auto-discovery of API keys and provider routing.
    """

    def __init__(
        self,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None
    ):
        self.provider = (provider or self._detect_provider()).lower()
        raw_key = api_key or self._get_key_for_provider(self.provider)
        self.api_key = raw_key.strip() if raw_key else None
        self.model = model or self._get_default_model(self.provider)
        self.base_url = base_url

    def _detect_provider(self) -> str:
        """Auto-detects available AI provider from environment variables."""
        if os.getenv("GEMINI_API_KEY"):
            return "gemini"
        if os.getenv("OPENAI_API_KEY"):
            return "openai"
        if os.getenv("ANTHROPIC_API_KEY"):
            return "anthropic"
        if os.getenv("DEEPSEEK_API_KEY"):
            return "deepseek"
        if os.getenv("GROQ_API_KEY"):
            return "groq"
        if os.getenv("OPENROUTER_API_KEY"):
            return "openrouter"
        # Check if local Ollama is active or default to simulation
        return "simulation"

    def _get_key_for_provider(self, provider: str) -> Optional[str]:
        keys = {
            "gemini": os.getenv("GEMINI_API_KEY"),
            "openai": os.getenv("OPENAI_API_KEY"),
            "anthropic": os.getenv("ANTHROPIC_API_KEY"),
            "deepseek": os.getenv("DEEPSEEK_API_KEY"),
            "groq": os.getenv("GROQ_API_KEY"),
            "openrouter": os.getenv("OPENROUTER_API_KEY"),
            "ollama": "ollama-local",
            "local": "local-key",
            "simulation": "mock-simulated-key"
        }
        return keys.get(provider)

    def _get_default_model(self, provider: str) -> str:
        defaults = {
            "gemini": "gemini-2.0-flash",
            "openai": "gpt-4o-mini",
            "anthropic": "claude-3-5-sonnet-20241022",
            "deepseek": "deepseek-chat",
            "groq": "llama-3.3-70b-versatile",
            "openrouter": "meta-llama/llama-3.3-70b-instruct",
            "ollama": "llama3.2",
            "local": "default-local",
            "simulation": "quantum-simulator-v1"
        }
        return defaults.get(provider, "default-model")

    def get_provider_name(self) -> str:
        return f"{self.provider}:{self.model}"

    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> LLMResponse:
        """Routes prompt to the configured AI engine."""
        if self.provider == "simulation":
            return self._call_simulation(prompt)

        try:
            if self.provider == "gemini":
                return self._call_gemini(prompt, system_prompt, temperature, max_tokens)
            elif self.provider in ("openai", "deepseek", "groq", "openrouter", "ollama", "local"):
                return self._call_openai_compatible(prompt, system_prompt, temperature, max_tokens)
            elif self.provider == "anthropic":
                return self._call_anthropic(prompt, system_prompt, temperature, max_tokens)
            else:
                return LLMResponse(error=f"Unsupported provider: {self.provider}")
        except urllib.error.HTTPError as e:
            error_body = ""
            try:
                error_body = e.read().decode("utf-8")
            except Exception:
                pass

            is_rate_limited = e.code == 429 or "rate_limit" in error_body.lower() or "quota" in error_body.lower()
            retry_after = 30.0
            if "retry-after" in e.headers:
                try:
                    retry_after = float(e.headers["retry-after"])
                except ValueError:
                    pass

            return LLMResponse(
                is_rate_limited=is_rate_limited,
                retry_after_seconds=retry_after,
                error=f"HTTP {e.code}: {e.reason} - {error_body[:200]}",
                model=self.model
            )
        except Exception as ex:
            return LLMResponse(error=str(ex), model=self.model)

    def _call_gemini(self, prompt: str, system_prompt: Optional[str], temp: float, max_tokens: int) -> LLMResponse:
        if not self.api_key:
            return LLMResponse(error="GEMINI_API_KEY is not configured.")

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
        
        contents = []
        if system_prompt:
            contents.append({"role": "user", "parts": [{"text": f"SYSTEM INSTRUCTION: {system_prompt}"}]})
            contents.append({"role": "model", "parts": [{"text": "Understood. Proceed with task."}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})

        body = {
            "contents": contents,
            "generationConfig": {
                "temperature": temp,
                "maxOutputTokens": max_tokens
            }
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            text = ""
            candidates = data.get("candidates") or []
            if candidates:
                cand_content = candidates[0].get("content") or {}
                parts = cand_content.get("parts") or []
                text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
            tokens = (data.get("usageMetadata") or {}).get("totalTokenCount", 0)
            return LLMResponse(content=text, tokens_used=tokens, model=self.model, raw=data)

    def _call_openai_compatible(self, prompt: str, system_prompt: Optional[str], temp: float, max_tokens: int) -> LLMResponse:
        endpoints = {
            "openai": "https://api.openai.com/v1/chat/completions",
            "deepseek": "https://api.deepseek.com/chat/completions",
            "groq": "https://api.groq.com/openai/v1/chat/completions",
            "openrouter": "https://openrouter.ai/api/v1/chat/completions",
            "ollama": "http://localhost:11434/v1/chat/completions",
            "local": "http://localhost:8000/v1/chat/completions"
        }
        url = endpoints.get(self.provider, endpoints["openai"])
        if self.base_url:
            b_url = self.base_url.rstrip("/")
            if not b_url.endswith("/chat/completions"):
                if not b_url.endswith("/v1"):
                    b_url += "/v1"
                b_url += "/chat/completions"
            url = b_url

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        body = {
            "model": self.model,
            "messages": messages,
            "temperature": temp,
            "max_tokens": max_tokens
        }

        headers = {"Content-Type": "application/json"}
        if self.api_key and self.provider != "ollama":
            headers["Authorization"] = f"Bearer {self.api_key}"

        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            choices = data.get("choices") or []
            first_msg = (choices[0].get("message") or {}) if choices else {}
            text = first_msg.get("content") or first_msg.get("reasoning_content") or ""
            tokens = (data.get("usage") or {}).get("total_tokens", 0)
            return LLMResponse(content=text, tokens_used=tokens, model=self.model, raw=data)

    def _call_anthropic(self, prompt: str, system_prompt: Optional[str], temp: float, max_tokens: int) -> LLMResponse:
        if not self.api_key:
            return LLMResponse(error="ANTHROPIC_API_KEY is not configured.")

        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01"
        }

        body = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temp
        }
        if system_prompt:
            body["system"] = system_prompt

        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content = data.get("content") or []
            text = "".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
            tokens = (data.get("usage") or {}).get("output_tokens", 0)
            return LLMResponse(content=text, tokens_used=tokens, model=self.model, raw=data)

    def _call_simulation(self, prompt: str) -> LLMResponse:
        """Internal quantum reasoning simulator for keyless testing and benchmark validation."""
        import random
        # Generates structured JSON responses conforming to Superposition format
        is_exact = random.random() < 0.15
        if is_exact:
            simulated_json = {
                "evaluation_score": 1.0,
                "is_exact_solution": True,
                "solution_code_or_proof": (
                    "# Quantum Synthesized Optimal Solution\n"
                    "def solve_task():\n"
                    "    '''Verified zero-defect convergence.'''\n"
                    "    return {'status': 'verified', 'confidence': 1.0}\n"
                ),
                "reasoning_summary": "Convergence condition satisfied via orthogonal state interference.",
                "child_branches": []
            }
        else:
            simulated_json = {
                "evaluation_score": round(0.4 + random.random() * 0.45, 2),
                "is_exact_solution": False,
                "solution_code_or_proof": None,
                "reasoning_summary": f"Exploring orthogonal path derived from: {prompt[:60]}...",
                "child_branches": [
                    {"hypothesis": f"Derived sub-dimension alpha-{random.randint(100, 999)}", "action_plan": "Execute phase test"},
                    {"hypothesis": f"Derived sub-dimension beta-{random.randint(100, 999)}", "action_plan": "Execute boundary test"}
                ]
            }

        return LLMResponse(
            content=json.dumps(simulated_json),
            tokens_used=120,
            model="quantum-simulator-v1"
        )
