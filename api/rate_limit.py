"""轻量内存限流器（单进程部署适用）。

用于登录失败锁定、验证码发送冷却等场景。数据只存内存，
进程重启后自动清零。
"""

from __future__ import annotations

import time
from threading import Lock


class MemoryRateLimiter:
    """基于失败时间戳窗口的限流器。

    key 一般取 IP 或 IP|账号 的组合。窗口期内失败次数达到
    max_attempts 后 is_blocked 返回 True，直到窗口滑动。
    """

    def __init__(self, max_attempts: int, window_secs: int):
        self.max_attempts = max_attempts
        self.window_secs = window_secs
        self._lock = Lock()
        self._failures: dict[str, list[float]] = {}

    def _prune(self, key: str) -> list[float]:
        now = time.time()
        recent = [t for t in self._failures.get(key, []) if now - t < self.window_secs]
        if recent:
            self._failures[key] = recent
        else:
            self._failures.pop(key, None)
        return recent

    def is_blocked(self, key: str) -> bool:
        with self._lock:
            return len(self._prune(key)) >= self.max_attempts

    def record_failure(self, key: str) -> None:
        with self._lock:
            recent = self._prune(key)
            recent.append(time.time())
            self._failures[key] = recent

    def clear(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)


# 登录失败锁定：同 IP+账号 5 次失败后锁定 15 分钟
login_limiter = MemoryRateLimiter(max_attempts=5, window_secs=15 * 60)
# 验证码发送冷却：同 IP 每分钟最多 3 次
code_limiter = MemoryRateLimiter(max_attempts=3, window_secs=60)
