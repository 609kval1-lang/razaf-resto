export const RAW_MATERIAL_UNIT_OPTIONS = [
  { value: 'kg', label: 'Kilogramme (kg)' },
  { value: 'g', label: 'Gramme (g)' },
  { value: 'mg', label: 'Milligramme (mg)' },
  { value: 'L', label: 'Litre (L)' },
  { value: 'cl', label: 'Centilitre (cl)' },
  { value: 'ml', label: 'Millilitre (ml)' },
  { value: 'pièce', label: 'Pièce' },
  { value: 'unité', label: 'Unité' },
];

export const INGREDIENT_PORTION_UNIT_OPTIONS = [
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'mg', label: 'mg' },
  { value: 'L', label: 'L' },
  { value: 'cl', label: 'cl' },
  { value: 'ml', label: 'ml' },
  { value: 'pièce', label: 'pièce' },
  { value: 'unité', label: 'unité' },
];

const UNIT_MAP = {
  kg: { dimension: 'mass', factor: 1000 },
  kilogramme: { dimension: 'mass', factor: 1000 },
  kilogrammes: { dimension: 'mass', factor: 1000 },
  g: { dimension: 'mass', factor: 1 },
  gr: { dimension: 'mass', factor: 1 },
  gramme: { dimension: 'mass', factor: 1 },
  grammes: { dimension: 'mass', factor: 1 },
  mg: { dimension: 'mass', factor: 0.001 },
  l: { dimension: 'volume', factor: 1000 },
  litre: { dimension: 'volume', factor: 1000 },
  litres: { dimension: 'volume', factor: 1000 },
  ml: { dimension: 'volume', factor: 1 },
  cl: { dimension: 'volume', factor: 10 },
  pcs: { dimension: 'count', factor: 1 },
  pc: { dimension: 'count', factor: 1 },
  piece: { dimension: 'count', factor: 1 },
  pieces: { dimension: 'count', factor: 1 },
  unite: { dimension: 'count', factor: 1 },
  unites: { dimension: 'count', factor: 1 },
  u: { dimension: 'count', factor: 1 },
};

export const normalizeUnit = (unit) => String(unit || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

export const getUnitMeta = (unit) => UNIT_MAP[normalizeUnit(unit)] || null;

export const isVolumeUnit = (unit) => getUnitMeta(unit)?.dimension === 'volume';

export const getLinkedPortionUnit = (rawMaterialUnit) => {
  const dimension = getUnitMeta(rawMaterialUnit)?.dimension;

  if (dimension === 'mass') return 'g';
  if (dimension === 'volume') return 'ml';
  if (dimension === 'count') return 'pièce';

  return '';
};

export const convertUnitValue = (value, fromUnit, toUnit) => {
  const from = getUnitMeta(fromUnit);
  const to = getUnitMeta(toUnit);

  if (!from || !to) {
    throw new Error(`Unité non supportée (${fromUnit} ou ${toUnit})`);
  }

  if (from.dimension !== to.dimension) {
    throw new Error(`Unités incompatibles (${fromUnit} et ${toUnit})`);
  }

  const inBase = Number(value || 0) * from.factor;
  return inBase / to.factor;
};
