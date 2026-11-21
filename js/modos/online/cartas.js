// Desenho único das cartas (SVG): mão, mesa, assentos e guia usam o MESMO visual.
// Os naipes são formas bem distintas (sprite #nv-s/#nv-h/#nv-d/#nv-c no index.html)
// e cada naipe tem sua cor, para ninguém confundir copas com ouros ou espadas com paus.

export const NOMES_NAIPE = { s: 'Espadas', h: 'Copas', d: 'Ouros', c: 'Paus' };

const VALORES = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

// Aceita 'As', 'Td', '10h'
export function parseCarta(raw) {
  if (!raw || raw.length < 2) return null;
  const naipe = raw[raw.length - 1];
  const r = raw.slice(0, raw.length - 1);
  const chave = r === '10' ? 'T' : r;
  if (!NOMES_NAIPE[naipe] || !VALORES[chave]) return null;
  const v = VALORES[chave];
  const val = v === 10 ? '10' : (v <= 9 ? String(v) : chave);
  return { raw: chave + naipe, val, v, n: naipe, verm: naipe === 'h' || naipe === 'd' };
}

// Pequeno ícone de naipe para usar dentro de textos e botões
export function iconeNaipe(n) {
  return '<svg class="nv-ico n-' + n + '" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
    + '<use class="nv" href="#nv-' + n + '"/></svg>';
}

export function textoCarta(raw) {
  const c = parseCarta(raw);
  return c ? c.val + iconeNaipe(c.n) : '';
}

// Posições (centro x, centro y) dos símbolos em cada carta numerada (viewBox 100x140)
const COL_E = 38;
const COL_C = 50;
const COL_D = 62;
const PIPS = {
  2: [[COL_C, 32], [COL_C, 108]],
  3: [[COL_C, 32], [COL_C, 70], [COL_C, 108]],
  4: [[COL_E, 32], [COL_D, 32], [COL_E, 108], [COL_D, 108]],
  5: [[COL_E, 32], [COL_D, 32], [COL_C, 70], [COL_E, 108], [COL_D, 108]],
  6: [[COL_E, 32], [COL_D, 32], [COL_E, 70], [COL_D, 70], [COL_E, 108], [COL_D, 108]],
  7: [[COL_E, 32], [COL_D, 32], [COL_C, 51], [COL_E, 70], [COL_D, 70], [COL_E, 108], [COL_D, 108]],
  8: [[COL_E, 32], [COL_D, 32], [COL_C, 51], [COL_E, 70], [COL_D, 70], [COL_C, 89], [COL_E, 108], [COL_D, 108]],
  9: [[COL_E, 32], [COL_D, 32], [COL_E, 57], [COL_D, 57], [COL_C, 70], [COL_E, 83], [COL_D, 83], [COL_E, 108], [COL_D, 108]],
  10: [[COL_E, 32], [COL_D, 32], [COL_C, 45], [COL_E, 57], [COL_D, 57], [COL_E, 83], [COL_D, 83], [COL_C, 95], [COL_E, 108], [COL_D, 108]]
};

function pip(n, cx, cy, tam, girar) {
  const m = tam / 2;
  return '<use class="nv" href="#nv-' + n + '" x="' + (cx - m) + '" y="' + (cy - m) + '" width="' + tam + '" height="' + tam + '"'
    + (girar ? ' transform="rotate(180 ' + cx + ' ' + cy + ')"' : '') + '/>';
}

function canto(c) {
  const tamFonte = c.val === '10' ? 26 : 31;
  return '<text class="idx" x="14" y="31" text-anchor="middle" font-size="' + tamFonte + '">' + c.val + '</text>'
    + '<use class="nv" href="#nv-' + c.n + '" x="4" y="35" width="20" height="20"/>';
}

function corpo(c) {
  if (c.v === 14) return pip(c.n, 50, 70, 56, false);
  if (c.v >= 11) {
    return '<rect class="moldura" x="29" y="30" width="42" height="80" rx="5"/>'
      + '<text class="fig" x="50" y="85" text-anchor="middle" font-size="46">' + c.val + '</text>'
      + pip(c.n, 50, 43, 17, false)
      + pip(c.n, 50, 97, 17, true);
  }
  return PIPS[c.v].map((p) => pip(c.n, p[0], p[1], 18, p[1] > 70)).join('');
}

// Carta inteira (mão, mesa): índices nos cantos + símbolos no centro
export function htmlCarta(raw, extra) {
  const c = parseCarta(raw);
  if (!c) return '';
  return '<span class="carta n-' + c.n + (extra ? ' ' + extra : '') + '" data-raw="' + c.raw + '" role="img"'
    + ' aria-label="' + c.val + ' de ' + NOMES_NAIPE[c.n] + '">'
    + '<svg viewBox="0 0 100 140" aria-hidden="true" focusable="false">'
    + canto(c)
    + '<g transform="rotate(180 50 70)">' + canto(c) + '</g>'
    + corpo(c)
    + '</svg></span>';
}

// Carta compacta (assentos e guia): valor grande + naipe, legível em tamanhos pequenos
export function htmlCartaMini(raw, extra) {
  const c = parseCarta(raw);
  if (!c) return '';
  return '<span class="carta mini n-' + c.n + (extra ? ' ' + extra : '') + '" data-raw="' + c.raw + '" role="img"'
    + ' aria-label="' + c.val + ' de ' + NOMES_NAIPE[c.n] + '">'
    + '<svg viewBox="0 0 100 140" aria-hidden="true" focusable="false">'
    + '<text class="idx" x="50" y="66" text-anchor="middle" font-size="' + (c.val === '10' ? 66 : 78) + '">' + c.val + '</text>'
    + '<use class="nv" href="#nv-' + c.n + '" x="25" y="76" width="50" height="50"/>'
    + '</svg></span>';
}

export function htmlVersoMini(extra) {
  return '<span class="carta mini verso' + (extra ? ' ' + extra : '') + '" aria-label="Carta virada"></span>';
}
