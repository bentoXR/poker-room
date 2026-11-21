// Avaliador local de mãos de poker: serve só de ASSISTENTE visual (luzinha + nome da mão).
// O resultado oficial do showdown continua sendo decidido pelo servidor (avaliar_mao_online).
import { parseCarta, NOMES_NAIPE } from './cartas.js?v=82';

const SING = { 14: 'Ás', 13: 'Rei', 12: 'Dama', 11: 'Valete', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2' };
const PLUR = { 14: 'Ases', 13: 'Reis', 12: 'Damas', 11: 'Valetes', 10: '10s', 9: '9s', 8: '8s', 7: '7s', 6: '6s', 5: '5s', 4: '4s', 3: '3s', 2: '2s' };

function combinacoes5(lista) {
  const saida = [];
  const n = lista.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) saida.push([lista[a], lista[b], lista[c], lista[d], lista[e]]);
        }
      }
    }
  }
  return saida;
}

function comparar(x, y) {
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Classifica exatamente 5 cartas
function avaliar5(cartas) {
  const valores = cartas.map((c) => c.v).sort((a, b) => b - a);
  const mesmoNaipe = cartas.every((c) => c.n === cartas[0].n);
  const cont = {};
  valores.forEach((v) => { cont[v] = (cont[v] || 0) + 1; });
  const grupos = Object.keys(cont).map(Number).sort((a, b) => (cont[b] - cont[a]) || (b - a));
  const padrao = grupos.map((g) => cont[g]).join('');

  let reta = false;
  let topo = 0;
  if (grupos.length === 5) {
    if (valores[0] - valores[4] === 4) { reta = true; topo = valores[0]; }
    else if (valores[0] === 14 && valores[1] === 5 && valores[4] === 2) { reta = true; topo = 5; }
  }

  let cat;
  if (reta && mesmoNaipe) cat = topo === 14 ? 9 : 8;
  else if (padrao === '41') cat = 7;
  else if (padrao === '32') cat = 6;
  else if (mesmoNaipe) cat = 5;
  else if (reta) cat = 4;
  else if (padrao === '311') cat = 3;
  else if (padrao === '221') cat = 2;
  else if (padrao === '2111') cat = 1;
  else cat = 0;

  return { cat, desempate: reta ? [topo] : grupos, topo, mesmoNaipe };
}

function cartasUsadas(cat, cartas, desempate) {
  if (cat === 0) {
    const maior = cartas.reduce((m, c) => (c.v > m.v ? c : m), cartas[0]);
    return [maior.raw];
  }
  if (cat === 1 || cat === 2 || cat === 3 || cat === 7) {
    const minimo = cat === 7 ? 4 : cat === 3 ? 3 : 2;
    const cont = {};
    cartas.forEach((c) => { cont[c.v] = (cont[c.v] || 0) + 1; });
    return cartas.filter((c) => cont[c.v] >= minimo).map((c) => c.raw);
  }
  return cartas.map((c) => c.raw);
}

function descrever(cat, desempate, cartas) {
  const d = desempate;
  switch (cat) {
    case 9: return { nome: 'Royal Flush', detalhe: 'Royal Flush de ' + NOMES_NAIPE[cartas[0].n] };
    case 8: return { nome: 'Straight Flush', detalhe: 'Straight Flush até o ' + SING[d[0]] };
    case 7: return { nome: 'Quadra', detalhe: 'Quadra de ' + PLUR[d[0]] };
    case 6: return { nome: 'Full House', detalhe: 'Full House: ' + PLUR[d[0]] + ' e ' + PLUR[d[1]] };
    case 5: return { nome: 'Flush', detalhe: 'Flush de ' + NOMES_NAIPE[cartas[0].n] };
    case 4: return { nome: 'Sequência', detalhe: 'Sequência até o ' + SING[d[0]] };
    case 3: return { nome: 'Trinca', detalhe: 'Trinca de ' + PLUR[d[0]] };
    case 2: return { nome: 'Dois Pares', detalhe: 'Dois Pares: ' + PLUR[d[0]] + ' e ' + PLUR[d[1]] };
    case 1: return { nome: 'Um Par', detalhe: 'Um Par de ' + PLUR[d[0]] };
    default: return { nome: 'Carta Alta', detalhe: 'Carta Alta: ' + SING[d[0]] };
  }
}

// Procura "projetos" (falta 1 carta) úteis para quem está no flop ou no turn
function descobrirProjeto(cartas, catAtual) {
  if (cartas.length < 5 || cartas.length > 6) return '';
  const minhas = cartas.slice(0, 2);
  const partes = [];

  if (catAtual < 5) {
    const porNaipe = {};
    cartas.forEach((c) => { porNaipe[c.n] = (porNaipe[c.n] || 0) + 1; });
    Object.keys(porNaipe).forEach((n) => {
      if (porNaipe[n] === 4 && minhas.some((c) => c.n === n)) partes.push('Projeto de Flush de ' + NOMES_NAIPE[n]);
    });
  }
  if (catAtual < 4) {
    const tem = {};
    cartas.forEach((c) => { tem[c.v] = true; if (c.v === 14) tem[1] = true; });
    const minhasV = {};
    minhas.forEach((c) => { minhasV[c.v] = true; if (c.v === 14) minhasV[1] = true; });
    let achou = false;
    for (let ini = 1; ini <= 10 && !achou; ini++) {
      let presentes = 0;
      let usaMinha = false;
      for (let k = 0; k < 5; k++) {
        if (tem[ini + k]) {
          presentes++;
          if (minhasV[ini + k]) usaMinha = true;
        }
      }
      if (presentes === 4 && usaMinha) achou = true;
    }
    if (achou) partes.push('Projeto de Sequência');
  }
  return partes.join(' · ');
}

// cartasRaw: suas 2 cartas + cartas já abertas na mesa (ex.: ['As','Kh','Ad','7c','2s'])
export function avaliarMaoLocal(cartasRaw) {
  const cartas = (cartasRaw || []).map(parseCarta).filter(Boolean);
  if (cartas.length < 2) return null;

  // Pré-flop (só 2 cartas): par ou carta alta
  if (cartas.length < 5) {
    const [a, b] = cartas;
    if (a.v === b.v) {
      return { cat: 1, nome: 'Um Par', detalhe: 'Um Par de ' + PLUR[a.v], usadas: [a.raw, b.raw], projeto: '' };
    }
    const maior = a.v > b.v ? a : b;
    const menor = a.v > b.v ? b : a;
    const extra = a.n === b.n ? ' · mesmo naipe' : '';
    return {
      cat: 0,
      nome: 'Carta Alta',
      detalhe: 'Carta Alta: ' + SING[maior.v] + ' e ' + SING[menor.v] + extra,
      usadas: [maior.raw],
      projeto: ''
    };
  }

  let melhor = null;
  combinacoes5(cartas).forEach((cinco) => {
    const av = avaliar5(cinco);
    const chave = [av.cat].concat(av.desempate);
    if (!melhor || comparar(chave, melhor.chave) > 0) melhor = { chave, av, cinco };
  });

  const desc = descrever(melhor.av.cat, melhor.av.desempate, melhor.cinco);
  return {
    cat: melhor.av.cat,
    nome: desc.nome,
    detalhe: desc.detalhe,
    usadas: cartasUsadas(melhor.av.cat, melhor.cinco, melhor.av.desempate),
    projeto: descobrirProjeto(cartas, melhor.av.cat)
  };
}

// ----- Cálculo rápido de Equity % no All-In (enumeração exata no Flop/Turn; Monte Carlo no Pré-Flop) -----
const NAIPE_IDX = { s: 0, h: 1, d: 2, c: 3 };
const RC = new Int32Array(13);
const SC = new Int32Array(4);
const SM = new Int32Array(4);

function cardInt(raw) {
  const c = parseCarta(raw);
  if (!c) return -1;
  return (c.v - 2) * 4 + (NAIPE_IDX[c.n] ?? 0);
}

function maiorSeq(mask) {
  for (let top = 12; top >= 4; top--) {
    const sub = 0x1f << (top - 4);
    if ((mask & sub) === sub) return top + 2;
  }
  if ((mask & 0x100f) === 0x100f) return 5;
  return 0;
}

function topBits(mask, qtd) {
  let out = 0;
  let k = 0;
  for (let r = 12; r >= 0 && k < qtd; r--) {
    if (mask & (1 << r)) {
      out = (out << 4) | (r + 2);
      k++;
    }
  }
  while (k < qtd) { out <<= 4; k++; }
  return out;
}

function pontuar7(a, b, c, d, e, f, g) {
  RC.fill(0);
  SC.fill(0);
  SM.fill(0);
  let mask = 0;
  const arr = [a, b, c, d, e, f, g];
  for (let i = 0; i < 7; i++) {
    const x = arr[i];
    const r = x >> 2;
    const s = x & 3;
    RC[r]++;
    SC[s]++;
    SM[s] |= (1 << r);
    mask |= (1 << r);
  }

  let flushS = -1;
  for (let s = 0; s < 4; s++) {
    if (SC[s] >= 5) { flushS = s; break; }
  }
  if (flushS >= 0) {
    const sf = maiorSeq(SM[flushS]);
    if (sf > 0) return (8 << 20) | (sf << 16);
  }

  let quad = 0; let trip1 = 0; let trip2 = 0; let pair1 = 0; let pair2 = 0;
  for (let r = 12; r >= 0; r--) {
    const cnt = RC[r];
    if (cnt === 4 && !quad) quad = r + 2;
    else if (cnt === 3) {
      if (!trip1) trip1 = r + 2;
      else if (!trip2) trip2 = r + 2;
    } else if (cnt === 2) {
      if (!pair1) pair1 = r + 2;
      else if (!pair2) pair2 = r + 2;
    }
  }

  if (quad) {
    let k = 0;
    for (let r = 12; r >= 0; r--) { if (RC[r] && (r + 2) !== quad) { k = r + 2; break; } }
    return (7 << 20) | (quad << 16) | (k << 12);
  }
  if (trip1 && (trip2 || pair1)) {
    return (6 << 20) | (trip1 << 16) | ((trip2 > pair1 ? trip2 : pair1) << 12);
  }
  if (flushS >= 0) {
    return (5 << 20) | topBits(SM[flushS], 5);
  }
  const st = maiorSeq(mask);
  if (st > 0) return (4 << 20) | (st << 16);
  if (trip1) {
    return (3 << 20) | (trip1 << 16) | (topBits(mask & ~(1 << (trip1 - 2)), 2) << 8);
  }
  if (pair1 && pair2) {
    let k = 0;
    for (let r = 12; r >= 0; r--) {
      if (RC[r] && (r + 2) !== pair1 && (r + 2) !== pair2) { k = r + 2; break; }
    }
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (k << 8);
  }
  if (pair1) {
    return (1 << 20) | (pair1 << 16) | (topBits(mask & ~(1 << (pair1 - 2)), 3) << 4);
  }
  return topBits(mask, 5);
}

export function calcularEquities(jogadoresComCartas, boardAberto) {
  const res = {};
  if (!Array.isArray(jogadoresComCartas) || jogadoresComCartas.length < 2) return res;

  const usadas = new Uint8Array(52);
  const hands = [];
  for (let i = 0; i < jogadoresComCartas.length; i++) {
    const j = jogadoresComCartas[i];
    if (!j || !Array.isArray(j.cartas) || j.cartas.length < 2) continue;
    const h0 = cardInt(j.cartas[0]);
    const h1 = cardInt(j.cartas[1]);
    if (h0 < 0 || h1 < 0) continue;
    usadas[h0] = 1;
    usadas[h1] = 1;
    hands.push({ id: j.id, h0, h1 });
  }
  const nH = hands.length;
  if (nH < 2) return res;

  const board = [];
  for (let i = 0; i < (boardAberto ? boardAberto.length : 0) && board.length < 5; i++) {
    const bi = cardInt(boardAberto[i]);
    if (bi >= 0) {
      usadas[bi] = 1;
      board.push(bi);
    }
  }

  const deck = [];
  for (let x = 0; x < 52; x++) {
    if (!usadas[x]) deck.push(x);
  }

  const pts = new Float64Array(nH);
  const scores = new Int32Array(nH);
  let total = 0;

  const computar = (b0, b1, b2, b3, b4) => {
    let best = -1;
    let ties = 0;
    for (let i = 0; i < nH; i++) {
      const s = pontuar7(hands[i].h0, hands[i].h1, b0, b1, b2, b3, b4);
      scores[i] = s;
      if (s > best) { best = s; ties = 1; }
      else if (s === best) ties++;
    }
    const share = 1 / ties;
    for (let i = 0; i < nH; i++) {
      if (scores[i] === best) pts[i] += share;
    }
    total++;
  };

  const bLen = board.length;
  const falta = 5 - bLen;
  if (falta === 0) {
    computar(board[0], board[1], board[2], board[3], board[4]);
  } else if (falta === 1) {
    for (let i = 0; i < deck.length; i++) {
      computar(board[0], board[1], board[2], board[3], deck[i]);
    }
  } else if (falta === 2) {
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        computar(board[0], board[1], board[2], deck[i], deck[j]);
      }
    }
  } else {
    const ITER = 700;
    const len = deck.length;
    for (let t = 0; t < ITER; t++) {
      for (let k = 0; k < falta; k++) {
        const r = k + Math.floor(Math.random() * (len - k));
        const tmp = deck[k];
        deck[k] = deck[r];
        deck[r] = tmp;
      }
      if (bLen === 2) computar(board[0], board[1], deck[0], deck[1], deck[2]);
      else if (bLen === 1) computar(board[0], deck[0], deck[1], deck[2], deck[3]);
      else computar(deck[0], deck[1], deck[2], deck[3], deck[4]);
    }
  }

  if (total > 0) {
    for (let i = 0; i < nH; i++) {
      res[hands[i].id] = Math.round((pts[i] * 100) / total);
    }
  }
  return res;
}
