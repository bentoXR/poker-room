// Desenho único das cartas (SVG): limpo, legível e clássico (só número + naipe grande, vermelho e preto).
// Usado igualmente na sua mão, nas cartas da mesa, nos assentos e no Guia de Mãos.

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

// Carta principal (mão e mesa): apenas número grande e naipe bem desenhado em destaque
export function htmlCarta(raw, extra) {
  const c = parseCarta(raw);
  if (!c) return '';
  const tamNum = c.val === '10' ? 54 : 62;
  return '<span class="carta n-' + c.n + (extra ? ' ' + extra : '') + '" data-raw="' + c.raw + '" role="img"'
    + ' aria-label="' + c.val + ' de ' + NOMES_NAIPE[c.n] + '">'
    + '<svg viewBox="0 0 100 140" aria-hidden="true" focusable="false">'
    + '<text class="idx" x="50" y="57" text-anchor="middle" font-size="' + tamNum + '">' + c.val + '</text>'
    + '<use class="nv" href="#nv-' + c.n + '" x="19" y="66" width="62" height="62"/>'
    + '</svg></span>';
}

// Carta compacta (assentos e guia): mesmo visual limpo, ainda mais legível em tamanhos pequenos
export function htmlCartaMini(raw, extra) {
  const c = parseCarta(raw);
  if (!c) return '';
  const tamNum = c.val === '10' ? 58 : 68;
  return '<span class="carta mini n-' + c.n + (extra ? ' ' + extra : '') + '" data-raw="' + c.raw + '" role="img"'
    + ' aria-label="' + c.val + ' de ' + NOMES_NAIPE[c.n] + '">'
    + '<svg viewBox="0 0 100 140" aria-hidden="true" focusable="false">'
    + '<text class="idx" x="50" y="60" text-anchor="middle" font-size="' + tamNum + '">' + c.val + '</text>'
    + '<use class="nv" href="#nv-' + c.n + '" x="20" y="68" width="60" height="60"/>'
    + '</svg></span>';
}

export function htmlVersoMini(extra) {
  return '<span class="carta mini verso' + (extra ? ' ' + extra : '') + '" aria-label="Carta virada"></span>';
}
