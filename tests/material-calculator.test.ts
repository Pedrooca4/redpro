import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateBlocks,
  formatMaterialList,
  materialTotals,
  MAX_DIMENSION,
  MAX_MATERIALS,
  MAX_QUANTITY,
  parseWholeNumber,
  stackBreakdown,
  type Material,
  type StackSize,
} from "../src/features/materials/calculations.ts";

test("platform and filled volume use the expected dimensions", () => {
  assert.equal(estimateBlocks("platform", { length: 12, width: 5 }), 60);
  assert.equal(estimateBlocks("volume", { length: 12, width: 5, height: 3 }), 180);
});

test("walls count corner blocks once and support a two-block base", () => {
  assert.equal(estimateBlocks("walls", { length: 12, width: 5, height: 3 }), 90);
  assert.equal(estimateBlocks("walls", { length: 2, width: 2, height: 1 }), 4);
  assert.equal(estimateBlocks("walls", { length: 2, width: 5, height: 2 }), 20);
  assert.throws(() => estimateBlocks("walls", { length: 1, width: 2, height: 1 }), RangeError);
  assert.throws(() => estimateBlocks("walls", { length: 2, width: 1, height: 1 }), RangeError);
});

test("stack conversion distinguishes full stacks, remainder and occupied slots", () => {
  assert.deepEqual(stackBreakdown(150, 64), { fullStacks: 2, remainder: 22, slots: 3 });
  assert.deepEqual(stackBreakdown(128, 64), { fullStacks: 2, remainder: 0, slots: 2 });
  assert.deepEqual(stackBreakdown(7, 64), { fullStacks: 0, remainder: 7, slots: 1 });
  assert.deepEqual(stackBreakdown(33, 16), { fullStacks: 2, remainder: 1, slots: 3 });
  assert.deepEqual(stackBreakdown(32, 16), { fullStacks: 2, remainder: 0, slots: 2 });
  assert.deepEqual(stackBreakdown(12, 1), { fullStacks: 12, remainder: 0, slots: 12 });
});

test("non-integers, alternate numeric syntax and unsafe inputs are rejected", () => {
  for (const raw of [
    "",
    " ",
    "0",
    "-1",
    "2.5",
    "2,5",
    "1e2",
    "0x10",
    "Infinity",
    "NaN",
    "9007199254740993",
  ]) {
    assert.equal(parseWholeNumber(raw, 1, MAX_QUANTITY), null, raw);
  }
  for (const value of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => stackBreakdown(value, 64), RangeError);
    assert.throws(() => estimateBlocks("platform", { length: value, width: 2 }), RangeError);
  }
  assert.throws(() => stackBreakdown(5, 32 as StackSize), RangeError);
  assert.throws(() => estimateBlocks("volume", { length: 2, width: 2 }), RangeError);
  assert.throws(() => estimateBlocks("walls", { length: 2, width: 2, height: 0 }), RangeError);
  assert.equal(parseWholeNumber(" 007 ", 1, MAX_QUANTITY), 7);
});

test("maximum dimensions and a full inventory remain exactly representable", () => {
  const max = { length: MAX_DIMENSION, width: MAX_DIMENSION, height: MAX_DIMENSION };
  assert.equal(estimateBlocks("platform", max), 1_000_000);
  assert.equal(estimateBlocks("volume", max), MAX_QUANTITY);
  assert.equal(estimateBlocks("walls", max), 3_996_000);
  assert.throws(() => estimateBlocks("volume", { ...max, height: MAX_DIMENSION + 1 }), RangeError);
  assert.throws(() => stackBreakdown(MAX_QUANTITY + 1, 64), RangeError);
  assert.equal(parseWholeNumber(String(MAX_QUANTITY), 1, MAX_QUANTITY), MAX_QUANTITY);
  assert.equal(parseWholeNumber(String(MAX_QUANTITY + 1), 1, MAX_QUANTITY), null);
  const fullList: Material[] = Array.from({ length: MAX_MATERIALS }, (_, id) => ({
    id,
    name: "Material",
    quantity: MAX_QUANTITY,
    stackSize: 1,
  }));
  assert.deepEqual(materialTotals(fullList), { units: 100_000_000_000, slots: 100_000_000_000 });
});

test("shared material summary preserves individual capacity and slot accounting", () => {
  const list: Material[] = [
    { id: 1, name: "Pedra lisa", quantity: 150, stackSize: 64 },
    { id: 2, name: "Balde", quantity: 4, stackSize: 1 },
  ];
  assert.deepEqual(materialTotals(list), { units: 154, slots: 7 });
  assert.deepEqual(materialTotals([]), { units: 0, slots: 0 });
  assert.match(
    formatMaterialList(list),
    /Pedra lisa: 150 un\. \| stack de 64 \| 2 completas, 22 restantes \| 3 slots/,
  );
  assert.match(formatMaterialList(list), /Total: 154 unidades · 7 slots estimados/);
});
