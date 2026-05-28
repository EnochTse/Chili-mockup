export const productCategoryOptions = [
  "Writing Instruments",
  "Drinkware",
  "Office & Desk",
  "Bags & Travel",
  "Accessories"
] as const;

export type ProductCategoryOption = (typeof productCategoryOptions)[number];

const categoryAliases: Record<string, ProductCategoryOption> = {
  "writing-instruments": "Writing Instruments",
  "writing instruments": "Writing Instruments",
  drinkware: "Drinkware",
  "office & desk": "Office & Desk",
  "office and desk": "Office & Desk",
  office: "Office & Desk",
  desk: "Office & Desk",
  bag: "Bags & Travel",
  bags: "Bags & Travel",
  "bags & travel": "Bags & Travel",
  travel: "Bags & Travel",
  accessory: "Accessories",
  accessories: "Accessories",
  umbrella: "Accessories"
};

export function normalizeProductCategory(value: string | undefined): ProductCategoryOption {
  const normalized = (value || "").trim().toLowerCase();
  return categoryAliases[normalized] || "Accessories";
}
