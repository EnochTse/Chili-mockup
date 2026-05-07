import type { PantoneOption } from "@/lib/types";

export const QUICK_BLACK_CODE = "__quick_black__";
export const QUICK_WHITE_CODE = "__quick_white__";

const quickColorOptions: PantoneOption[] = [
  {
    code: QUICK_BLACK_CODE,
    label: "Black",
    previewHex: "#000000"
  },
  {
    code: QUICK_WHITE_CODE,
    label: "White",
    previewHex: "#FFFFFF"
  }
];

export function getQuickColorOptions() {
  return quickColorOptions;
}

export function resolveColorOption(
  pantoneOptions: PantoneOption[],
  code: string
) {
  return (
    pantoneOptions.find((option) => option.code === code) ||
    quickColorOptions.find((option) => option.code === code)
  );
}
