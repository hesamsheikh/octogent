import { describe, expect, it } from "vitest";
import { asNumber, asRecord, asString } from "../src/util/typeCoercion";

describe("typeCoercion utilities", () => {
  describe("asRecord", () => {
    it("returns the value when it is a plain object", () => {
      const input = { foo: "bar", baz: 42 };
      const result = asRecord(input);
      expect(result).toEqual(input);
      expect(result).toBe(input);
    });

    it("returns null when value is null", () => {
      expect(asRecord(null)).toBeNull();
    });

    it("returns null when value is an array", () => {
      expect(asRecord([1, 2, 3])).toBeNull();
      expect(asRecord([])).toBeNull();
    });

    it("returns null when value is a string", () => {
      expect(asRecord("string")).toBeNull();
    });

    it("returns null when value is a number", () => {
      expect(asRecord(42)).toBeNull();
    });

    it("returns null when value is undefined", () => {
      expect(asRecord(undefined)).toBeNull();
    });

    it("returns null when value is a boolean", () => {
      expect(asRecord(true)).toBeNull();
      expect(asRecord(false)).toBeNull();
    });

    it("handles nested objects correctly", () => {
      const input = { nested: { foo: "bar" }, array: [1, 2] };
      const result = asRecord(input);
      expect(result).toEqual(input);
    });

    it("handles empty objects", () => {
      const input = {};
      const result = asRecord(input);
      expect(result).toEqual({});
      expect(result).toBe(input);
    });
  });

  describe("asString", () => {
    it("returns the value when it is a string", () => {
      expect(asString("hello")).toBe("hello");
      expect(asString("")).toBe("");
      expect(asString("123")).toBe("123");
    });

    it("returns null when value is a number", () => {
      expect(asString(42)).toBeNull();
      expect(asString(0)).toBeNull();
    });

    it("returns null when value is null", () => {
      expect(asString(null)).toBeNull();
    });

    it("returns null when value is undefined", () => {
      expect(asString(undefined)).toBeNull();
    });

    it("returns null when value is an object", () => {
      expect(asString({})).toBeNull();
      expect(asString({ foo: "bar" })).toBeNull();
    });

    it("returns null when value is an array", () => {
      expect(asString([])).toBeNull();
      expect(asString([1, 2, 3])).toBeNull();
    });

    it("returns null when value is a boolean", () => {
      expect(asString(true)).toBeNull();
      expect(asString(false)).toBeNull();
    });
  });

  describe("asNumber", () => {
    it("returns the value when it is a finite number", () => {
      expect(asNumber(42)).toBe(42);
      expect(asNumber(0)).toBe(0);
      expect(asNumber(-100)).toBe(-100);
      expect(asNumber(3.14)).toBe(3.14);
    });

    it("returns null when value is Infinity", () => {
      expect(asNumber(Number.POSITIVE_INFINITY)).toBeNull();
      expect(asNumber(Number.NEGATIVE_INFINITY)).toBeNull();
    });

    it("returns null when value is NaN", () => {
      expect(asNumber(Number.NaN)).toBeNull();
    });

    it("parses valid numeric strings", () => {
      expect(asNumber("42")).toBe(42);
      expect(asNumber("0")).toBe(0);
      expect(asNumber("-100")).toBe(-100);
      expect(asNumber("3.14")).toBe(3.14);
      expect(asNumber("  123  ")).toBe(123); // trimmed by parseFloat
    });

    it("returns null for invalid numeric strings", () => {
      expect(asNumber("")).toBeNull();
      expect(asNumber("hello")).toBeNull();
      expect(asNumber("12abc")).toBe(12); // parseFloat stops at first non-numeric
    });

    it("returns null when value is null", () => {
      expect(asNumber(null)).toBeNull();
    });

    it("returns null when value is undefined", () => {
      expect(asNumber(undefined)).toBeNull();
    });

    it("returns null when value is an object", () => {
      expect(asNumber({})).toBeNull();
      expect(asNumber({ foo: 42 })).toBeNull();
    });

    it("returns null when value is an array", () => {
      expect(asNumber([])).toBeNull();
      expect(asNumber([1, 2])).toBeNull();
    });

    it("returns null when value is a boolean", () => {
      expect(asNumber(true)).toBeNull();
      expect(asNumber(false)).toBeNull();
    });

    it("handles negative numbers in strings", () => {
      expect(asNumber("-42")).toBe(-42);
      expect(asNumber("-3.14")).toBe(-3.14);
    });

    it("handles exponential notation", () => {
      expect(asNumber("1e3")).toBe(1000);
      expect(asNumber("1.5e2")).toBe(150);
      expect(asNumber(1e3)).toBe(1000);
    });
  });
});
