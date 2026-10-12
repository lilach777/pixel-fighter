import { findSourceSheets, readPng, px } from './lib/sheets';
const [id, xs, ys, ws, hs] = process.argv.slice(2);
const p = readPng(findSourceSheets().find(s => s.id === id)!.file!);
const x0=+xs,y0=+ys;
for (let y=y0;y<y0+ +hs;y+=3){let line='';for(let x=x0;x<x0+ +ws;x+=3){const [r,g,b]=px(p,x,y);const L=Math.round(.299*r+.587*g+.114*b);const C=Math.max(r,g,b)-Math.min(r,g,b);line+=`${L}/${C} `;}console.log(line);}
