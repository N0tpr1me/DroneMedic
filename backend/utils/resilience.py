"""Backend resilience: retry, circuit breaker, rate limiting, timeouts, metrics."""

import time
import logging
import functools
from collections import defaultdict

from backend.services.ops_metrics_service import get_ops_metrics

logger = logging.getLogger(__name__)

# ── Retry Decorator (using tenacity) ──────────────────────────

def with_retry(max_attempts: int = 3, min_wait: int = 1, max_wait: int = 10):
    """Retry decorator with exponential backoff."""
    try:
        from tenacity import (
            retry,
            stop_after_attempt,
            wait_exponential,
            retry_if_exception_type,
            before_sleep_log,
        )
        import httpx

        return retry(
            stop=stop_after_attempt(max_attempts),
            wait=wait_exponential(multiplier=1, min=min_wait, max=max_wait),
            retry=retry_if_exception_type(
                (httpx.TimeoutException, httpx.ConnectError, ConnectionError, TimeoutError)
            ),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True,
        )
    except ImportError:
        # tenacity not installed — return no-op decorator
        def noop(fn):
            return fn
        return noop


# ── Circuit Breaker ───────────────────────────────────────────

class CircuitBreaker:
    """Simple circuit breaker pattern."""

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failures = 0
        self.state = self.CLOSED
        self.last_failure_time = 0.0

    def __call__(self, func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            if self.state == self.OPEN:
                if time.time() - self.last_failure_time > self.recovery_timeout:
                    self.state = self.HALF_OPEN
                    logger.info(f"Circuit {self.name}: half-open, testing...")
                else:
                    raise CircuitOpenError(
                        f"Circuit {self.name} is OPEN. Service unavailable."
                    )
            try:
                result = await func(*args, **kwargs)
                if self.state == self.HALF_OPEN:
                    self.state = self.CLOSED
                    self.failures = 0
                    logger.info(f"Circuit {self.name}: closed (recovered)")
                return result
            except Exception:
                self.failures += 1
                if self.failures >= self.failure_threshold:
                    self.state = self.OPEN
                    self.last_failure_time = time.time()
                    logger.error(
                        f"Circuit {self.name}: OPEN after {self.failures} failures"
                    )
                raise

        return wrapper


class CircuitOpenError(Exception):
    pass


# ── Rate Limiter Middleware ────────────────────────────────────

class RateLimiterMiddleware:
    """Simple in-memory rate limiter for FastAPI."""

    def __init__(self, app, requests_per_minute: int = 60):
        self.app = app
        self.rpm = requests_per_minute
        self.requests: dict[str, list[float]] = defaultdict(list)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            client = scope.get("client", ("unknown", 0))
            client_ip = client[0] if client else "unknown"
            now = time.time()
            # Clean old entries
            self.requests[client_ip] = [
                t for t in self.requests[client_ip] if now - t < 60
            ]
            if len(self.requests[client_ip]) >= self.rpm:
                # Rate limited
                response_body = (
                    b'{"detail":"Rate limit exceeded. Try again in 60 seconds."}'
                )
                await send(
                    {
                        "type": "http.response.start",
                        "status": 429,
                        "headers": [[b"content-type", b"application/json"]],
                    }
                )
                await send({"type": "http.response.body", "body": response_body})
                return
            self.requests[client_ip].append(now)
        await self.app(scope, receive, send)


# ── Ops Metrics Middleware ─────────────────────────────────────

class OpsMetricsMiddleware:
    """Record per-request latency and status code into OpsMetricsService."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status_holder: dict[str, int] = {"code": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["code"] = int(message.get("status", 500))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            latency_ms = (time.perf_counter() - start) * 1000.0
            try:
                get_ops_metrics().record_request(latency_ms, status_holder["code"])
            except Exception:
                # Never let metrics recording break request handling
                logger.debug("ops metrics recording failed", exc_info=True)
