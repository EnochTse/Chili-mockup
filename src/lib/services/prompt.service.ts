export const printingMethodPrompts: Record<
  string,
  { label: string; prompt: string }
> = {
  silk_screen: {
    label: "Silk screen",
    prompt:
      "Apply the logo as flat screen-printed ink with clean edges and a slight matte finish."
  },
  uv_print: {
    label: "UV print",
    prompt:
      "Apply the logo as crisp UV print with sharp edges and a slightly raised glossy finish."
  },
  heat_transfer: {
    label: "Heat transfer",
    prompt:
      "Apply the logo as a smooth heat-transfer print that follows the material curvature."
  },
  embroidery: {
    label: "Embroidery",
    prompt:
      "Render the logo as embroidered thread texture, slightly raised, with stitched edges."
  },
  laser_engraving: {
    label: "Laser engraving",
    prompt:
      "Render the logo as a subtle monochrome engraved mark etched into the material surface."
  },
  mirror_laser_engraving: {
    label: "Mirror laser engraving",
    prompt:
      "Render the logo as a polished mirror-finish laser engraving with a reflective black-to-white metallic gradient, crisp etched edges, and realistic chrome-like highlights that stay engraved in the material rather than printed on top."
  }
};

export function getPrintingMethodPrompt(method: string) {
  return (
    printingMethodPrompts[method] || {
      label: method,
      prompt: `Apply the logo using the selected ${method} method.`
    }
  );
}
