import { RE2JS } from "re2js";

// Keep compiled state bounded within a Workers isolate's memory budget.
const compiled = new Map<string, RE2JS>();
const MAX_CACHED_PATTERNS = 2;

export function compileFlagRegex(pattern: string): RE2JS | null {
  if (pattern.length > 128 || /\)[*+{]/.test(pattern)) return null;
  if ((pattern.match(/[+*]|\{\d+,\}/g) ?? []).length > 2) return null;
  const cached = compiled.get(pattern);
  if (cached) return cached;
  try {
    // LOOKBEHINDS is deliberately not enabled: grading must remain linear-time.
    const regex = RE2JS.compile(RE2JS.translateRegExp(pattern), RE2JS.CASE_INSENSITIVE);
    if (regex.programSize() > 4096) return null;
    if (compiled.size >= MAX_CACHED_PATTERNS) compiled.delete(compiled.keys().next().value!);
    compiled.set(pattern, regex);
    return regex;
  } catch {
    return null;
  }
}
