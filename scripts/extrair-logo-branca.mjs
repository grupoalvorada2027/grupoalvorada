/**
 * Gera web/logo-branca.png: só os traços brancos da logo, sobre fundo
 * transparente, para pousar a marca direto sobre o vermelho da tela.
 *
 * A transparência vem do canal verde: o fundo da logo é vermelho (verde ≈ 12)
 * e os traços são brancos (verde = 255). Usar a proporção, e não um corte
 * seco, preserva a suavização das bordas — senão a casa ficaria serrilhada.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const ORIGEM = 'web/logo.png';
const DESTINO = 'web/logo-branca.png';

const b = readFileSync(ORIGEM);
let pos = 8, W = 0, H = 0, prof = 0, tipo = 0;
const idat = [];
while (pos < b.length) {
  const tam = b.readUInt32BE(pos);
  const nome = b.slice(pos + 4, pos + 8).toString();
  const dados = b.slice(pos + 8, pos + 8 + tam);
  if (nome === 'IHDR') { W = dados.readUInt32BE(0); H = dados.readUInt32BE(4); prof = dados[8]; tipo = dados[9]; }
  if (nome === 'IDAT') idat.push(dados);
  if (nome === 'IEND') break;
  pos += 12 + tam;
}
if (prof !== 8 || (tipo !== 2 && tipo !== 6)) throw new Error(`PNG nao suportado (prof ${prof}, tipo ${tipo})`);

const C = tipo === 6 ? 4 : 3;
const bruto = zlib.inflateSync(Buffer.concat(idat));
const L = W * C;
const px = Buffer.alloc(H * L);
for (let y = 0; y < H; y++) {
  const f = bruto[y * (L + 1)], s = y * (L + 1) + 1, d = y * L;
  for (let x = 0; x < L; x++) {
    const a = x >= C ? px[d + x - C] : 0;
    const up = y > 0 ? px[d - L + x] : 0;
    const c = x >= C && y > 0 ? px[d - L + x - C] : 0;
    let v = bruto[s + x];
    if (f === 1) v += a;
    else if (f === 2) v += up;
    else if (f === 3) v += (a + up) >> 1;
    else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
    px[d + x] = v & 255;
  }
}

// Alfa a partir do verde: 12 (fundo) -> 0, 255 (traço) -> 255.
const alfa = new Uint8Array(W * H);
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * L + x * C;
  const r = px[i], g = px[i + 1], bl = px[i + 2];
  // Pixel escuro de borda (sombra do quadrado) não é traço.
  let v = r < 120 ? 0 : Math.round(Math.max(0, Math.min(1, (Math.min(g, bl) - 30) / (240 - 30))) * 255);
  alfa[y * W + x] = v;
  if (v > 12) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
}

// Recorta a margem vazia, deixando 2px de respiro.
x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2);
x1 = Math.min(W - 1, x1 + 2); y1 = Math.min(H - 1, y1 + 2);
const NW = x1 - x0 + 1, NH = y1 - y0 + 1;

const linhas = Buffer.alloc(NH * (NW * 4 + 1));
for (let y = 0; y < NH; y++) {
  const o = y * (NW * 4 + 1);
  linhas[o] = 0;
  for (let x = 0; x < NW; x++) {
    const k = o + 1 + x * 4;
    linhas[k] = 255; linhas[k + 1] = 255; linhas[k + 2] = 255;
    linhas[k + 3] = alfa[(y + y0) * W + (x + x0)];
  }
}

const bloco = (nome, dados) => {
  const t = Buffer.alloc(4); t.writeUInt32BE(dados.length);
  const nd = Buffer.concat([Buffer.from(nome), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(nd) >>> 0);
  return Buffer.concat([t, nd, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(NW, 0); ihdr.writeUInt32BE(NH, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

writeFileSync(DESTINO, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  bloco('IHDR', ihdr),
  bloco('IDAT', zlib.deflateSync(linhas, { level: 9 })),
  bloco('IEND', Buffer.alloc(0)),
]));
console.log(`${DESTINO}: ${NW}x${NH}px (recorte de ${W}x${H})`);

// ------------------------------------------------------------------
// Variante só com a casa, para ícones pequenos (barra lateral, favicon):
// abaixo de uns 40px o "ALVORADA" vira um borrão. A casa termina na primeira
// faixa horizontal totalmente transparente abaixo dela.
// ------------------------------------------------------------------
{
  const alfaRecorte = (x, y) => alfa[(y + y0) * W + (x + x0)];
  let fimCasa = NH - 1;
  let viuTraco = false;
  for (let y = 0; y < NH; y++) {
    let vazia = true;
    for (let x = 0; x < NW; x++) if (alfaRecorte(x, y) > 12) { vazia = false; break; }
    if (!vazia) viuTraco = true;
    else if (viuTraco) { fimCasa = y; break; }
  }
  const CH = fimCasa;
  const lin = Buffer.alloc(CH * (NW * 4 + 1));
  for (let y = 0; y < CH; y++) {
    const o = y * (NW * 4 + 1);
    for (let x = 0; x < NW; x++) {
      const k = o + 1 + x * 4;
      lin[k] = 255; lin[k + 1] = 255; lin[k + 2] = 255; lin[k + 3] = alfaRecorte(x, y);
    }
  }
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(NW, 0); ih.writeUInt32BE(CH, 4); ih[8] = 8; ih[9] = 6;
  writeFileSync('web/logo-casa.png', Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ih), bloco('IDAT', zlib.deflateSync(lin, { level: 9 })), bloco('IEND', Buffer.alloc(0)),
  ]));
  console.log(`web/logo-casa.png: ${NW}x${CH}px`);
}
