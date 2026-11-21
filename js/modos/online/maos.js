// Avaliador local de mãos de poker: serve só de ASSISTENTE visual (luzinha + nome da mão).
// O resultado oficial do showdown continua sendo decidido pelo servidor (avaliar_mao_online).
import { parseCarta, NOMES_NAIPE } from './cartas.js?v=15';

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
