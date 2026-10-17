// Counts are provider evidence. A missing field is never an empty balance.
export function resetCount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function bankedResets(payload) {
  return resetCount(payload?.rateLimitResetCredits?.availableCount)
    ?? resetCount(payload?.rate_limit_reset_credits?.available_count)
    ?? resetCount(payload?.bankedResets)
    ?? resetCount(payload?.banked_resets);
}
