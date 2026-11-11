export const MAX_DIMENSION = 1000;
export const MAX_QUANTITY = MAX_DIMENSION ** 3;
export const MAX_MATERIALS = 100;
export const MAX_NAME_LENGTH = 80;
export const STACK_SIZES = [64, 16, 1] as const;

export type StackSize = (typeof STACK_SIZES)[number];
export type Shape = "platform" | "volume" | "walls";
export type Material = { id: number; name: string; quantity: number; stackSize: StackSize };
type Dimensions = { length: number; width: number; height?: number };

const format = new Intl.NumberFormat("pt-BR");
export const formatQuantity = (quantity: number) => format.format(quantity);

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

export function parseWholeNumber(input: string, min: number, max: number): number | null {
  const text = input.trim();
  const value = Number(text);
  return /^\d+$/.test(text) && isIntegerInRange(value, min, max) ? value : null;
}

export function estimateBlocks(shape: Shape, { length, width, height }: Dimensions): number {
  const minimum = shape === "walls" ? 2 : 1;
  if (![length, width].every((value) => isIntegerInRange(value, minimum, MAX_DIMENSION)))
    throw new RangeError("Dimensões da base inválidas.");
  if (shape === "platform") return length * width;
  if (height === undefined || !isIntegerInRange(height, 1, MAX_DIMENSION))
    throw new RangeError("Altura inválida.");
  if (shape === "walls") return (2 * length + 2 * width - 4) * height;
  return length * width * height;
}

export function stackBreakdown(quantity: number, stackSize: StackSize) {
  if (!isIntegerInRange(quantity, 1, MAX_QUANTITY) || !STACK_SIZES.includes(stackSize))
    throw new RangeError("Quantidade ou capacidade de stack inválida.");

  const fullStacks = Math.floor(quantity / stackSize);
  const remainder = quantity % stackSize;
  return { fullStacks, remainder, slots: fullStacks + Number(remainder > 0) };
}

export function materialTotals(materials: readonly Material[]) {
  // At most MAX_MATERIALS entries of MAX_QUANTITY each. Slots are counted per line.
  return materials.reduce(
    (total, { quantity, stackSize }) => ({
      units: total.units + quantity,
      slots: total.slots + stackBreakdown(quantity, stackSize).slots,
    }),
    { units: 0, slots: 0 },
  );
}

export function formatMaterialList(materials: readonly Material[]): string {
  const { units, slots } = materialTotals(materials);
  return [
    "Lista de materiais · MinePRO",
    "",
    ...materials.map(({ name, quantity, stackSize }) => {
      const { fullStacks, remainder, slots } = stackBreakdown(quantity, stackSize);
      return `- ${name}: ${formatQuantity(quantity)} un. | stack de ${stackSize} | ${formatQuantity(fullStacks)} completas, ${formatQuantity(remainder)} restantes | ${formatQuantity(slots)} slots`;
    }),
    "",
    `Total: ${formatQuantity(units)} unidades · ${formatQuantity(slots)} slots estimados`,
  ].join("\n");
}
