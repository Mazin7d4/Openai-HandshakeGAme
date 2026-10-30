import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { Material } from '@babylonjs/core/Materials/material.js';

const SWATCHES: Readonly<Record<string, string>> = {
  Oak: '#AD9B83', Porcelain: '#D9D5C9', Sage: '#858E86', Coral: '#A39787',
  Aluminium: '#A5ADAD', Rubber: '#303638', Graphite: '#566067', Mustard: '#AAA293',
  Teal: '#7B8583', Leaf: '#7B8478', LeafLight: '#939C8B', Terracotta: '#A19585',
  Screen: '#596268', LedCyan: '#778085', LedAmber: '#8C8B83', Pink: '#B6ADA1',
  Yellow: '#B6ADA1', Blue: '#89949B', Fabric: '#8A908D',
};

/** Only call for decorative imports. Mascot and interactable materials never pass through here. */
export function finishDecorMaterial(material: Material | null): void {
  if (!(material instanceof PBRMaterial)) return;
  material.unfreeze();
  material.maxSimultaneousLights = 4;
  material.emissiveColor.setAll(0);
  material.emissiveIntensity = 0;
  material.emissiveTexture = null;
  const swatch = SWATCHES[material.name.replace(/\.\d+$/, '')];
  if (swatch) material.albedoColor.copyFrom(Color3.FromHexString(swatch));
  material.roughness = Math.max(material.roughness ?? 0.72, 0.52);
}
