"""
Rate Limit Sentinel & Auto-Pause/Auto-Resume Coordinator
Guarantees zero work loss when hitting AI token limits or API throttling.
"""

import time
import math
from typing import Optional, Callable


class RateLimitSentinel:
    """
    Monitors provider rate limits, pauses execution gracefully,
    and resumes automatically once quota resets.
    """

    def __init__(self, base_cooldown_seconds: float = 30.0, max_cooldown_seconds: float = 3600.0):
        self.base_cooldown = base_cooldown_seconds
        self.max_cooldown = max_cooldown_seconds
        self.consecutive_rate_limits = 0
        self.is_cooling_down = False
        self.cooldown_ends_at = 0.0

    def compute_cooldown_seconds(self, provider_suggested: Optional[float] = None) -> float:
        if provider_suggested and provider_suggested > 0:
            return min(provider_suggested, self.max_cooldown)
        
        # Exponential backoff with ceiling
        backoff = self.base_cooldown * (2 ** min(self.consecutive_rate_limits, 6))
        return min(backoff, self.max_cooldown)

    def handle_rate_limit(
        self,
        provider_name: str,
        provider_suggested: Optional[float] = None,
        on_countdown_tick: Optional[Callable[[float, str], None]] = None
    ) -> float:
        """
        Pauses current thread safely, executing countdown notifications,
        then returns control once the rate-limit window clears.
        """
        self.consecutive_rate_limits += 1
        wait_seconds = self.compute_cooldown_seconds(provider_suggested)
        self.is_cooling_down = True
        self.cooldown_ends_at = time.time() + wait_seconds

        step = 2.0
        remaining = wait_seconds
        while remaining > 0:
            msg = f"API Limit Exhausted for {provider_name}. Sleeping {int(remaining)}s before Auto-Resume..."
            if on_countdown_tick:
                on_countdown_tick(remaining, msg)
            
            sleep_duration = min(step, remaining)
            time.sleep(sleep_duration)
            remaining = self.cooldown_ends_at - time.time()

        self.is_cooling_down = False
        return wait_seconds

    def record_success(self):
        """Reset consecutive rate limit counter on successful request."""
        if self.consecutive_rate_limits > 0:
            self.consecutive_rate_limits = max(0, self.consecutive_rate_limits - 1)
