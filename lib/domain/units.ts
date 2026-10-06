// Product quantities and mix rates (FR-TEC-06, R-BUG-07).
//
// Every number a technician types is paired with a unit chosen from a list, so
// "0.06" can never be read as both 0.06% and 6%. Percent is always stored as
// percent (0.06 means 0.06 parts per hundred), and the form shows what that
// means in product before the technician moves on.
//
// Unit codes must match the CHECK constraints in
// supabase/migrations/*_scheduling.sql and *_records.sql (a unit test enforces this).

export const AMOUNT_UNITS = ["fl_oz", "gal", "ml", "l", "oz", "lb", "g", "kg", "each"] as const;
export const MIX_UNITS = [
  "pct",
  "fl_oz_per_gal",
  "oz_per_gal",
  "ml_per_l",
  "g_per_l",
  "fl_oz_per_1000_sq_ft",
  "oz_per_1000_sq_ft",
  "lb_per_1000_sq_ft",
  "lb_per_acre",
] as const;
export const AREA_UNITS = ["sq_ft", "linear_ft", "cu_ft", "acre", "each"] as const;

export type AmountUnit = (typeof AMOUNT_UNITS)[number];
export type MixUnit = (typeof MIX_UNITS)[number];
export type AreaUnit = (typeof AREA_UNITS)[number];
export type Dimension = "volume" | "mass" | "count";

export interface Quantity<U extends string = AmountUnit> {
  value: number;
  unit: U;
}

export class UnitError extends Error {
  override name = "UnitError";
}

const AMOUNT: Record<AmountUnit, { dim: Dimension; toBase: number; label: string; short: string }> = {
  // volume base: millilitre
  fl_oz: { dim: "volume", toBase: 29.5735295625, label: "fluid ounces", short: "fl oz" },
  gal: { dim: "volume", toBase: 3785.411784, label: "gallons", short: "gal" },
  ml: { dim: "volume", toBase: 1, label: "millilitres", short: "mL" },
  l: { dim: "volume", toBase: 1000, label: "litres", short: "L" },
  // mass base: gram
  oz: { dim: "mass", toBase: 28.349523125, label: "ounces (weight)", short: "oz wt" },
  lb: { dim: "mass", toBase: 453.59237, label: "pounds", short: "lb" },
  g: { dim: "mass", toBase: 1, label: "grams", short: "g" },
  kg: { dim: "mass", toBase: 1000, label: "kilograms", short: "kg" },
  each: { dim: "count", toBase: 1, label: "each", short: "ea" },
};

const AREA: Record<AreaUnit, { label: string; short: string }> = {
  sq_ft: { label: "square feet", short: "sq ft" },
  linear_ft: { label: "linear feet", short: "lin ft" },
  cu_ft: { label: "cubic feet", short: "cu ft" },
  acre: { label: "acres", short: "ac" },
  each: { label: "each (stations, devices)", short: "ea" },
};

type MixBasis = "solution" | "area";
const MIX: Record<MixUnit, { basis: MixBasis; label: string; product: AmountUnit; per?: AmountUnit; perArea?: { unit: AreaUnit; amount: number } }> = {
  pct: { basis: "solution", label: "% of finished mix", product: "fl_oz" },
  fl_oz_per_gal: { basis: "solution", label: "fl oz per gallon of mix", product: "fl_oz", per: "gal" },
  oz_per_gal: { basis: "solution", label: "oz (weight) per gallon of mix", product: "oz", per: "gal" },
  ml_per_l: { basis: "solution", label: "mL per litre of mix", product: "ml", per: "l" },
  g_per_l: { basis: "solution", label: "g per litre of mix", product: "g", per: "l" },
  fl_oz_per_1000_sq_ft: { basis: "area", label: "fl oz per 1,000 sq ft", product: "fl_oz", perArea: { unit: "sq_ft", amount: 1000 } },
  oz_per_1000_sq_ft: { basis: "area", label: "oz (weight) per 1,000 sq ft", product: "oz", perArea: { unit: "sq_ft", amount: 1000 } },
  lb_per_1000_sq_ft: { basis: "area", label: "lb per 1,000 sq ft", product: "lb", perArea: { unit: "sq_ft", amount: 1000 } },
  lb_per_acre: { basis: "area", label: "lb per acre", product: "lb", perArea: { unit: "acre", amount: 1 } },
};

const SQ_FT_PER_ACRE = 43_560;

export function isAmountUnit(u: string): u is AmountUnit {
  return (AMOUNT_UNITS as readonly string[]).includes(u);
}
export function isMixUnit(u: string): u is MixUnit {
  return (MIX_UNITS as readonly string[]).includes(u);
}
export function isAreaUnit(u: string): u is AreaUnit {
  return (AREA_UNITS as readonly string[]).includes(u);
}

export function dimensionOf(unit: AmountUnit): Dimension {
  return AMOUNT[unit].dim;
}

export function amountLabel(unit: AmountUnit): string {
  return AMOUNT[unit].short;
}
export function areaLabel(unit: AreaUnit): string {
  return AREA[unit].short;
}
export function mixLabel(unit: MixUnit): string {
  return MIX[unit].label;
}

export function convert(q: Quantity, to: AmountUnit): Quantity {
  const from = AMOUNT[q.unit];
  const target = AMOUNT[to];
  if (from.dim !== target.dim) {
    throw new UnitError(`Cannot convert ${from.label} to ${target.label}`);
  }
  return { value: (q.value * from.toBase) / target.toBase, unit: to };
}

function areaInSqFt(area: Quantity<AreaUnit>): number {
  if (area.unit === "sq_ft") return area.value;
  if (area.unit === "acre") return area.value * SQ_FT_PER_ACRE;
  throw new UnitError(`An area rate needs square feet or acres, not ${AREA[area.unit].label}`);
}

/**
 * How much product (concentrate) a mix rate implies.
 * - Solution rates (%, fl oz/gal ...) need the finished mix volume applied.
 * - Area rates (lb/1,000 sq ft ...) need the treated area.
 */
export function productNeeded(
  mix: { rate: number; unit: MixUnit },
  basis: { finishedMix?: Quantity; area?: Quantity<AreaUnit> },
): Quantity {
  if (!(mix.rate > 0) || !Number.isFinite(mix.rate)) throw new UnitError("Mix rate must be more than zero");
  const spec = MIX[mix.unit];
  if (spec.basis === "solution") {
    if (!basis.finishedMix) throw new UnitError("Enter how much finished mix was applied");
    if (dimensionOf(basis.finishedMix.unit) !== "volume") throw new UnitError("Finished mix is measured by volume");
    if (mix.unit === "pct") {
      if (mix.rate > 100) throw new UnitError("A percentage cannot be more than 100");
      const asFlOz = convert(basis.finishedMix, "fl_oz").value;
      return { value: (asFlOz * mix.rate) / 100, unit: "fl_oz" };
    }
    const carrier = convert(basis.finishedMix, spec.per!).value;
    return { value: mix.rate * carrier, unit: spec.product };
  }
  if (!basis.area) throw new UnitError("Enter the area treated");
  const sqFt = areaInSqFt(basis.area);
  const perSqFt = spec.perArea!.unit === "acre" ? SQ_FT_PER_ACRE : spec.perArea!.amount;
  return { value: (mix.rate * sqFt) / perSqFt, unit: spec.product };
}

/** Up to 3 significant decimals, trailing zeros removed: 0.7500 -> "0.75". */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
  return Number(value.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatQuantity(q: Quantity): string {
  return `${formatNumber(q.value)} ${AMOUNT[q.unit].short}`;
}

/** The sentence under the mix-rate field, e.g. "0.75 fl oz of product in 1.5 gal of mix". */
export function mixPreview(
  mix: { rate: number; unit: MixUnit },
  basis: { finishedMix?: Quantity; area?: Quantity<AreaUnit> },
): string {
  const product = productNeeded(mix, basis);
  const where =
    MIX[mix.unit].basis === "solution"
      ? `in ${formatQuantity(basis.finishedMix!)} of mix`
      : `over ${formatNumber(basis.area!.value)} ${AREA[basis.area!.unit].short}`;
  const percentNote = mix.unit === "pct" ? ` (${formatNumber(mix.rate)}% means ${formatNumber(mix.rate / 100)} of every unit)` : "";
  return `${formatQuantity(product)} of product ${where}${percentNote}`;
}
