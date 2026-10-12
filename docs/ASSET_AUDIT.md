# Asset Audit

Audit date: 2026-10-12. Tools: `npm run assets:inspect`, `npm run assets:process`, visual review of labelled previews.

## 1. Discovery

| Item | Result |
|---|---|
| Project folder at start | Empty — the project was created from scratch. |
| Character sheets | Supplied by the owner and placed in `client/public/assets/characters/source/`. |
| Reference video | A local gameplay video of *Agent Fighter* (not included in this repository) was used only as a style reference for the presentation: CRT-framed title, character select, night-city stage, HUD with centre timer, "N HIT" combo text, round/winner banners, VS screen and named super banners. |

## 2. Character-to-sheet mapping (verified visually)

| Character | Source file (unchanged) | Identity check |
|---|---|---|
| Rick | `rick.png.png` | black "hemi" beanie, grey beard, black hoodie, baseball bat |
| Jeremy | `jeremy.png.png` | black "hemi" cap, full beard, navy hoodie, khakis, bat |
| JCV | `jcv.png.png` | long brown hair, black zip jacket, jeans, bat |
| Joshua | `joshua.png.png` | messy brown hair, black "Hemi" tee, black pants; kicks |
| Max Sanchez | `max sanchez.png.png` | brown hair, black hoodie, khakis; kicks |
| Koala (The Fired Intern) | `Koala ( The Fired Intern ).png.png` | koala, pixel sunglasses, orange jumpsuit, chainsaw |
| Migo | `migo.png.png` | white ram with golden horns, orange cape, sword |
| Jeff Garzik | `jeff garzik.png.png` | glasses, grey-brown hair, black jacket, jeans; kicks |

The filename matchers live in `scripts/lib/sheets.ts` (they tolerate the double `.png.png` extensions and spaces).
**Missing assets: none.** All eight roster characters are integrated with their own art.


## 3. Format and transparency

Every sheet is **1536×1024, 8-bit RGBA**, but **100.0% of pixels are fully opaque**: the grey/white checkerboard is painted *into* the image, not real transparency. The checker is noisy (AI-generated: uneven 4–11 px cells, compression-like speckle, warm glow tint near fire effects), and several characters contain light-grey or white regions that match the checker colours (Koala's fur, Migo's wool, Rick's beard, white sneakers).

A global colour key would have destroyed those regions, so the pipeline uses a **controlled, multi-stage removal** (`scripts/lib/bgremove.ts`):

1. Estimate the sheet's background luma range and its two checker tones (2-means on the border).
2. Flood-fill from the image border through background-like pixels, **restricted to regions ≥ 5 px wide** so the fill cannot squeeze through 1–2 px gaps in an outline; then regrow ≤ 3 px back up to the outline.
3. Remove neutral drop shadows reachable from removed background (never continuing into light pixels).
4. Remove painted glow halos: a ≤ 5 px band of warm low-chroma pixels next to background (saturated flame and the white-hot core are untouched).
5. Remove checker trapped between a fist and its fire arc (tinted glow anywhere; neutral checker only within 8 px of saturated fire).
6. Enclosed pockets (gap between arm and body) are removed only if they are **bimodal at the two measured checker tones** *and* their same-tone horizontal runs are short (checker flips tone every 4–11 px; shaded fur forms broad patches). Light fur/wool fails these tests and is kept.
6b. **Glow-tinted pockets (second pass).** Checker trapped inside a fire ring is painted over with an orange glow (mean chroma 15–27), so the neutral test rejects it. A separate pass over the *remaining* pixels removes a tinted region only if all of these hold:
   * checker texture: bimodal tones, short same-tone runs (≥ 2.5 px), and anti-correlation at one cell (periodicity ≤ −0.08);
   * at most 15% of its border is near-white, which rules out shading inside white wool or fur;
   * at most 40% of its border is dark outline.

   The first pass is unchanged, so earlier results cannot regress. A pixel diff against the previous output confirmed this: Koala, Migo, JCV, Rick, Joshua and Jeff changed by 0 pixels; only checker was removed from Max (9,687 px) and Jeremy (156).
7. Defringe: light neutral pixels touching background are removed; remaining grey edge pixels become semi-transparent black so outlines keep their anti-aliasing.

Measured per sheet (generated, `docs/asset-audit-data.md`):

| Character | Source file | Size | Alpha in source | Checker tones (luma) | Frames (r0..r5) | Pockets removed / kept |
|---|---|---|---|---|---|---|
| Rick | `rick.png.png` | 1536×1024 RGBA | 100% opaque (checker baked in) | 188 / 226 | 13/9/7/9/9/10 = 57 | 39 / 552 |
| Jeremy | `jeremy.png.png` | 1536×1024 RGBA | 100% opaque (checker baked in) | 195 / 223 | 13/8/7/8/9/10 = 55 | 33 / 209 |
| JCV | `jcv.png.png` | 1536×1024 RGBA | 100% opaque (checker baked in) | 193 / 227 | 13/9/7/8/9/10 = 56 | 45 / 315 |
| Joshua | `joshua.png.png` | 1536×1024 RGBA | 100% opaque (checker baked in) | 210 / 224 | 13/9/7/7/9/10 = 55 | 67 / 167 |
| Max Sanchez | `max sanchez.png.png` | 1536×1024 RGBA | 100% opaque (checker baked in) | 194 / 227 | 13/9/7/7/9/10 = 55 | 31 / 260 |
| Koala | `Koala ( The Fired Intern ).png.png` | 1536×1024 RGBA | 100% opaque (checker baked in) | 181 / 223 | 12/9/7/8/9/10 = 55 | 37 / 817 |
| Migo | `migo.png.png` | 1536×1024 RGBA | 100% opaque (checker baked in) | 177 / 224 | 11/9/8/8/10/11 = 57 | 18 / 796 |
| Jeff Garzik | `jeff garzik.png.png` | 1536×1024 RGBA | 100% opaque (checker baked in) | 203 / 228 | 13/9/7/8/9/10 = 56 | 36 / 221 |

### How the method was validated

The labelled previews in `docs/asset-previews/<id>-frames.png` (dark background, frame boxes, ground anchors, `row:col` labels) were inspected after each iteration. Problems found and fixed along the way:

| Iteration | Problem seen in previews | Fix |
|---|---|---|
| 1 | Koala's fur erased (edge-density pocket test mistook fur for checker) | bimodal checker-tone pocket test |
| 2 | Koala heads hollow (flood leaked through tiny outline gaps) | wide-corridor flood + bounded regrowth |
| 3 | Large checker patches left in Max's punch frames | measured warm glow tint (chroma 15–25) near fire; flood chroma limit raised to 30 |
| 4 | Faint checker inside glow next to fire arcs | glow-band pass + near-fire pass |
| 6 | **Bug report: checkerboard visible behind Max Sanchez during his super** (frame `r3c5`, flame ring). The source is 100% opaque, so the checker is baked in. Checker enclosed by the ring is glow-tinted (chroma 15–27), and the neutral pocket test kept it. Candidate fixes were checked against hand-labelled regions. Relaxing the colour limit alone also ate Migo's wool, Koala's face fur and Rick's beard; a "match the checker grid" approach failed because the AI-painted grid isn't regular enough over distance. The final rule above removes all labelled checker and keeps all labelled art. | second pass for glow-tinted checker; in-game checker-grey pixels on that frame dropped from 1284 to 153 |
| 5 | Koala heads hollow in run/crouch frames (two-tone shaded fur passed the bimodal test) | measured same-tone run lengths (fur 6.8–8.4 px vs checker 2–6 px) and added a run-length condition; only Koala output changed |

`tests/unit/roster.test.ts` also asserts every processed atlas has substantial real transparency.

### Known residual artifacts (honest list)

* Max `r3c5` (and similar flame-ring frames): faint peach flame wisps inside the ring stay. They are painted art, and the 1–2 px fringe hugging them can be checker-blended; a test asserts no *isolated* checker pixels remain. A thin pale glow line above the hair and a soft grey drop shadow under the feet also remain.

* Some fire-arc frames keep a thin speckle of light pixels next to the flame (e.g. Max `r2c2–r2c4`), visible only up close.
* Light-beige dust clouds under running feet are partly thinned by the glow pass.
* Source images are never modified; re-running `npm run assets:process` regenerates everything.

## 4. Frame slicing

Sheets do **not** share a grid and frames are not equal-sized, so slicing is content-driven (`scripts/lib/slice.ts`):

* **Body cores** = connected components of the alpha mask eroded by 4 px (erosion removes sparks and particle trails that bridge neighbouring figures).
* **Rows** = cores clustered by foot line (bottom y). Cores taller than 1.4× a standing figure (an arc touching the row above) are split at their narrowest scanline.
* Figures still joined by a weapon/flame are split at an empty **head-band valley** with legs on both sides.
* **Effect-only groups** (detached fire crescents/blasts, < 3% near-black pixels) are merged into the figure on their left (all figures face right).
* **Ownership**: every opaque pixel belongs to exactly one frame (bridged components are split per pixel), so crops never contain a neighbour's limbs.
* **Ground anchor** = centre of the lowest 16 px of the figure at its foot line; the renderer aligns this point with the fighter's world position.
* The slicer supports documented manual corrections (`scripts/slice-overrides.json`); none are needed for the current roster.

Frame counts per row were checked against a manual count of each sheet.

## 5. Outputs

| Output | Path |
|---|---|
| Original sheets (untouched) | `client/public/assets/characters/source/` |
| Packed atlases (transparent PNG, 2 px padding per frame) | `client/public/assets/characters/processed/<id>.png` |
| Portraits / HUD busts | `client/public/assets/characters/processed/portraits/` |
| Metadata (frames, rects, anchors, animations, background stats) | `client/public/assets/characters/metadata/<id>.json` |
| Visual previews | `docs/asset-previews/<id>-frames.png` |
| Cleaned full sheets (debug, git-ignored) | `.cache/clean/` |

Visual verification tools:
* `/asset-preview.html` on the dev server (`npm run dev`, then http://localhost:5173/asset-preview.html?char=max-sanchez&frame=r3c5). It shows the original sheet, the processed atlas, the extracted frame, and that frame over magenta, dark, white and black. It is not part of the production build. Screenshot: `docs/screenshots/07-asset-preview.png`.
* `npx tsx scripts/preview-frame.ts <id> <frameKey...> [--scale N]` writes the same four-panel comparison to `docs/asset-previews/frames/`.

Scripts: `npm run assets:inspect` (format/alpha/checker report), `npm run assets:process` (full pipeline; fails loudly if any animation references a frame that does not exist), `npx tsx scripts/probe-pixels.ts <id> x y w h` (pixel probe).

## 6. Other assets

All stages (Neon Rooftop, Arcade Floor, Server Vault), effects (hit sparks, block shield, dust, projectiles, super rays), UI art and audio (synthesized SFX + chiptune loop) are **original and procedurally generated** in code. No third-party art or audio files are used. Fonts: *Press Start 2P* and *VT323* from Google Fonts (SIL Open Font License), loaded at runtime with monospace fallbacks.
