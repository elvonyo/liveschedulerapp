/**
 * generate-icons.mjs
 * Run once with: node generate-icons.mjs
 * Requires: npm install sharp
 *
 * Generates all required PWA icons for iOS and Android
 * from the SVG source below.
 */

import sharp from "sharp";
import { writeFileSync } from "fs";

// The 📡 satellite dish as a styled SVG icon
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Dark background -->
  <rect width="512" height="512" rx="100" fill="#0d0f1c"/>
  
  <!-- Amber glow circle -->
  <circle cx="256" cy="240" r="180" fill="rgba(251,191,36,0.08)"/>
  
  <!-- Satellite dish emoji rendered as shapes -->
  <!-- Dish base -->
  <ellipse cx="256" cy="320" rx="90" ry="20" fill="#fbbf24" opacity="0.9"/>
  <!-- Dish bowl -->
  <path d="M 166 320 Q 200 200 256 180 Q 312 200 346 320 Z" fill="#fbbf24"/>
  <!-- Dish center hub -->
  <circle cx="256" cy="250" r="18" fill="#0d0f1c"/>
  <circle cx="256" cy="250" r="12" fill="#fbbf24"/>
  <!-- Signal waves -->
  <path d="M 290 200 Q 320 220 310 260" stroke="#fbbf24" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.6"/>
  <path d="M 310 180 Q 360 210 345 270" stroke="#fbbf24" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.4"/>
  <path d="M 330 158 Q 400 198 380 280" stroke="#fbbf24" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.25"/>
  <!-- Stand -->
  <rect x="246" y="320" width="20" height="50" rx="5" fill="#fbbf24" opacity="0.8"/>
  <rect x="220" y="368" width="72" height="14" rx="7" fill="#fbbf24" opacity="0.7"/>
</svg>`;

const svgBuffer = Buffer.from(svgIcon);

const sizes = [
  { size: 512, name: "icon-512.png" },
  { size: 192, name: "icon-192.png" },
  { size: 180, name: "icon-180.png" },
  { size: 152, name: "icon-152.png" },
  { size: 120, name: "icon-120.png" },
  { size: 72,  name: "badge-72.png" },
];

async function generate() {
  for (const { size, name } of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(`public/${name}`);
    console.log(`✓ Generated public/${name}`);
  }
  console.log("\nAll icons generated! Add to Home Screen will now show the LiveSupport icon.");
}

generate().catch(console.error);
