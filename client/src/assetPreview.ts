/**
 * Development tool (served at /asset-preview.html by `npm run dev`; not part of the
 * production build). Shows source sheet, processed atlas, an extracted frame and that
 * frame composited over contrasting backgrounds, with a count of checker-coloured
 * pixels still opaque in the frame.
 */
import { ROSTER } from '../../shared/src/characters/roster';

interface Frame {
  key: string;
  src: { x: number; y: number; w: number; h: number };
  rect: { x: number; y: number; w: number; h: number };
}
interface Meta {
  source: string;
  atlas: string;
  frames: Frame[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const base = import.meta.env.BASE_URL + 'assets/characters/';
const charSel = $<HTMLSelectElement>('char');
const frameSel = $<HTMLSelectElement>('frame');
const zoomIn = $<HTMLInputElement>('zoom');
const params = new URLSearchParams(location.search);

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

for (const c of ROSTER) charSel.add(new Option(c.name, c.id));
charSel.value = params.get('char') ?? 'max-sanchez';
let meta: Meta;
let source: HTMLImageElement;
let atlas: HTMLImageElement;

async function loadCharacter() {
  meta = await (await fetch(`${base}metadata/${charSel.value}.json`)).json();
  [source, atlas] = await Promise.all([load(base + meta.source), load(base + meta.atlas)]);
  frameSel.innerHTML = '';
  for (const f of meta.frames) frameSel.add(new Option(f.key, f.key));
  frameSel.value = params.get('frame') && meta.frames.some((f) => f.key === params.get('frame')) ? params.get('frame')! : meta.frames[0].key;
  draw();
}

function sheet(canvas: HTMLCanvasElement, img: HTMLImageElement, bg: string | null, highlight?: Frame['src']) {
  const s = 0.5;
  canvas.width = img.width * s;
  canvas.height = img.height * s;
  const g = canvas.getContext('2d')!;
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
  }
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (highlight) {
    g.strokeStyle = '#0f0';
    g.lineWidth = 2;
    g.strokeRect(highlight.x * s, highlight.y * s, highlight.w * s, highlight.h * s);
  }
}

function draw() {
  const f = meta.frames.find((x) => x.key === frameSel.value)!;
  const z = Math.max(1, Number(zoomIn.value) || 3);
  sheet($('source'), source, null, f.src);
  sheet($('atlas'), atlas, '#ff00ff', f.rect);
  const holder = $('frames');
  holder.innerHTML = '';
  const panels: [string, string | null][] = [
    ['source crop', null],
    ['magenta', '#ff00ff'],
    ['in-game dark', '#28123f'],
    ['white', '#ffffff'],
    ['black', '#000000'],
  ];
  let leftover = 0;
  for (const [label, bg] of panels) {
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.textContent = label;
    const c = document.createElement('canvas');
    c.width = f.rect.w * z;
    c.height = f.rect.h * z;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    if (bg === null) {
      g.drawImage(source, f.src.x - 2, f.src.y - 2, f.rect.w, f.rect.h, 0, 0, c.width, c.height);
    } else {
      g.fillStyle = bg;
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(atlas, f.rect.x, f.rect.y, f.rect.w, f.rect.h, 0, 0, c.width, c.height);
    }
    fig.append(cap, c);
    holder.append(fig);
  }
  // Count opaque checker-coloured pixels in the processed frame.
  const t = document.createElement('canvas');
  t.width = f.rect.w;
  t.height = f.rect.h;
  const tg = t.getContext('2d')!;
  tg.drawImage(atlas, f.rect.x, f.rect.y, f.rect.w, f.rect.h, 0, 0, f.rect.w, f.rect.h);
  const d = tg.getImageData(0, 0, f.rect.w, f.rect.h).data;
  let opaque = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    opaque++;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 175 && mx - mn < 30) leftover++;
  }
  $('stats').textContent = `${f.key}: ${opaque} opaque px, ${leftover} light-neutral (checker-coloured or white art) px`;
  history.replaceState(null, '', `?char=${charSel.value}&frame=${f.key}`);
}

charSel.onchange = () => void loadCharacter();
frameSel.onchange = draw;
zoomIn.onchange = draw;
void loadCharacter();
