import {
  Hct,
  TonalPalette,
  argbFromHex,
  hexFromArgb
} from "@material/material-color-utilities";

const utilityApi = globalThis.SuiteMateV3Utilities;

const SHADE_TONES = Object.freeze({
  50: 95,
  100: 90,
  200: 80,
  300: 70,
  400: 60,
  500: 50,
  600: 40,
  700: 30,
  800: 20,
  900: 10
});

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(left, right) {
  const light = Math.max(left, right);
  const dark = Math.min(left, right);
  return (light + 0.05) / (dark + 0.05);
}

function readableTextColor(hex) {
  const luminance = relativeLuminance(hex);
  return contrastRatio(luminance, 0) >= contrastRatio(luminance, 1) ? "#000000" : "#ffffff";
}

function generateMaterialShades(value) {
  const source = utilityApi?.normalizeHexColor(value);
  if (!source) {
    return null;
  }

  const sourceHct = Hct.fromInt(argbFromHex(source));
  const chroma = sourceHct.chroma < 5 ? 0 : sourceHct.chroma;
  const palette = TonalPalette.fromHueAndChroma(sourceHct.hue, chroma);
  const shades = {};
  const tones = {};
  const onShades = {};

  for (const [shade, tone] of Object.entries(SHADE_TONES)) {
    const hex = hexFromArgb(palette.tone(tone)).toLowerCase();
    shades[shade] = hex;
    tones[shade] = tone;
    onShades[shade] = readableTextColor(hex);
  }

  return Object.freeze({
    source,
    hue: Math.round(sourceHct.hue * 10) / 10,
    chroma: Math.round(chroma * 10) / 10,
    shades: Object.freeze(shades),
    tones: Object.freeze(tones),
    onShades: Object.freeze(onShades)
  });
}

globalThis.SuiteMateV3MaterialPalette = Object.freeze({
  SHADE_TONES,
  generateMaterialShades
});

export { SHADE_TONES, generateMaterialShades };
