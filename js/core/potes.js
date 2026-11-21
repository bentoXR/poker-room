// Motor puro de potes principal/laterais e divisão oficial de empates
// 100% independente da interface — reutilizável nos modos Presencial e Online
import { estado, nomeDe, passoSala } from './estado.js?v=4';

export function nomePote(indice, total) {
  if (indice === 0) return 'Pote Principal';
  return total === 2 ? 'Pote Lateral' : 'Pote Lateral ' + indice;
}

export function nomePoteCurto(indice, total) {
  if (indice === 0) return 'Princ.';
  return total === 2 ? 'Lateral' : 'Lat. ' + indice;
}

export function nomePoteLog(indice, total) {
  if (indice === 0) return 'Pote principal';
  return total === 2 ? 'Pote lateral' : 'Pote lateral ' + indice;
}

// Regra oficial do poker para ficha ímpar em empate:
// sentido horário começando pelo primeiro jogador à esquerda do Dealer.
export function ordenarParaSobra(ids, jogadores, dealerId) {
  const n = jogadores.length;
  if (!n) return ids.slice();
  let idxD = jogadores.findIndex((j) => j.id === dealerId);
  if (idxD < 0) idxD = n - 1;
  const dist = {};
  jogadores.forEach((j, idx) => { dist[j.id] = (idx - idxD - 1 + n) % n; });
  return ids.slice().sort((a, b) => (dist[a] != null ? dist[a] : n) - (dist[b] != null ? dist[b] : n));
}

// Divide um valor entre vencedores empatados respeitando passo da sala e ordem à esquerda do Dealer
export function dividirValorPote(valor, vencedorIds, jogadores, dealerId, passoOverride) {
  const mapa = {};
  if (!(valor > 0) || !vencedorIds || !vencedorIds.length) return { mapa, sobraPara: [] };
  const ordenados = ordenarParaSobra(vencedorIds, jogadores, dealerId);
  const passo = passoOverride != null ? passoOverride : passoSala();
  const unidade = (passo > 1 && valor % passo === 0) ? passo : 1;
  const unidades = Math.floor(valor / unidade);
  const base = Math.floor(unidades / ordenados.length) * unidade;
  const restoUnid = unidades % ordenados.length;
  const sobraPara = [];
  ordenados.forEach((id, i) => {
    const extra = i < restoUnid ? unidade : 0;
    mapa[id] = base + extra;
    if (extra > 0) sobraPara.push(id);
  });
  return { mapa, sobraPara };
}

export function textoSobra(sobraPara, jogadores = estado.jogadoresAtuais) {
  if (!sobraPara || !sobraPara.length) return '';
  const nomes = sobraPara
    .map((id) => {
      const j = jogadores.find((x) => x.id === id);
      return j ? nomeDe(j.nome) : '';
    })
    .filter(Boolean);
  if (!nomes.length) return '';
  return (nomes.length === 1 ? 'Ficha extra para ' : 'Fichas extras para ')
    + nomes.join(', ') + ' (à esquerda do Dealer)';
}

// Calcula pote principal e laterais a partir de jogadores[].total_mao
export function calcularPotes(jogadores, poteTotal, emAndamento) {
  if (!(poteTotal > 0) || !jogadores || !jogadores.length) return null;

  const contrib = jogadores
    .map((j) => ({
      id: j.id,
      nome: j.nome,
      ordem: j.ordem,
      total: Number(j.total_mao) || 0,
      saldo: Number(j.saldo) || 0,
      desistiu: !!j.desistiu
    }))
    .filter((j) => j.total > 0);

  const somaContrib = contrib.reduce((s, j) => s + j.total, 0);
  const ativos = contrib.filter((j) => !j.desistiu);
  if (somaContrib !== poteTotal || !ativos.length) return null;

  const maxAtivo = ativos.reduce((m, j) => Math.max(m, j.total), 0);
  const niveisSet = {};
  if (emAndamento) {
    ativos.forEach((j) => { if (j.saldo === 0 && j.total > 0) niveisSet[j.total] = true; });
    if (maxAtivo > 0) niveisSet[maxAtivo] = true;
  } else {
    ativos.forEach((j) => { niveisSet[j.total] = true; });
  }

  const niveis = Object.keys(niveisSet).map(Number).sort((a, b) => a - b);
  const potes = [];
  let anterior = 0;

  niveis.forEach((nivel) => {
    let valor = 0;
    let morto = 0;
    contrib.forEach((j) => {
      const fatia = Math.max(0, Math.min(j.total, nivel) - anterior);
      if (fatia > 0) {
        valor += fatia;
        if (j.desistiu) morto += fatia;
      }
    });

    const elegiveis = emAndamento
      ? ativos.filter((j) => (nivel < maxAtivo ? (j.total >= nivel || j.saldo > 0) : (j.saldo > 0 || j.total >= nivel)))
      : ativos.filter((j) => j.total >= nivel);

    if (valor > 0 && elegiveis.length > 0) {
      potes.push({
        valor,
        morto,
        nivel,
        elegiveis,
        automatico: !emAndamento && elegiveis.length === 1
      });
    }
    anterior = nivel;
  });

  // Proteção: qualquer ficha morta acima do maior nível ativo vai para o último pote
  let sobraMorta = 0;
  contrib.forEach((j) => { if (j.total > anterior) sobraMorta += (j.total - anterior); });
  if (sobraMorta > 0 && potes.length > 0) {
    potes[potes.length - 1].valor += sobraMorta;
    potes[potes.length - 1].morto += sobraMorta;
  }

  const somaPotes = potes.reduce((s, p) => s + p.valor, 0);
  return somaPotes === poteTotal ? potes : null;
}

// Só mostra divisão na mesa quando há de fato pote lateral formado
export function potesVisiveisNaMesa(partida, jogadores) {
  if (!partida || !partida.iniciada || !(partida.pote > 0) || partida.fase_blind > 0) return null;
  const emAndamento = partida.fase < 4 && !partida.aguardando_cartas;
  const potes = calcularPotes(jogadores, partida.pote, emAndamento);
  if (!potes || potes.length < 2) return null;
  if (partida.fase < 4) {
    const acima = jogadores.filter((j) => (Number(j.total_mao) || 0) > potes[0].nivel).length;
    if (acima < 2) return null;
  }
  return potes;
}
