/**
 * Safely coerces an unknown value to a Record (plain object) or returns null.
 *
 * @param value - The value to coerce
 * @returns The value as a Record if it's a plain object, null otherwise
 *
 * @example
 * ```typescript
 * asRecord({ foo: "bar" })  // { foo: "bar" }
 * asRecord([1, 2, 3])       // null (arrays are not records)
 * asRecord(null)            // null
 * asRecord("string")        // null
 * ```
 */
export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Safely coerces an unknown value to a string or returns null.
 *
 * @param value - The value to coerce
 * @returns The value if it's a string, null otherwise
 *
 * @example
 * ```typescript
 * asString("hello")  // "hello"
 * asString(42)       // null
 * asString(null)     // null
 * ```
 */
export const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * Safely coerces an unknown value to a finite number or returns null.
 *
 * If the value is a string, attempts to parse it as a number.
 * Returns null for Infinity, NaN, and non-numeric values.
 *
 * @param value - The value to coerce
 * @returns The value as a finite number, or null if coercion fails
 *
 * @example
 * ```typescript
 * asNumber(42)          // 42
 * asNumber("3.14")      // 3.14
 * asNumber("hello")     // null
 * asNumber(Infinity)    // null
 * asNumber(NaN)         // null
 * ```
 */
export const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};
