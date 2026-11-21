// Controles de aposta (slider, atalhos de pote, passo R$, envio de ações via RPC)
// 100% reutilizável nos modos Presencial e Online
import { banco } from '../core/supabase.js?v=59';
import { estado, passoSala, nomeDe } from '../core/estado.js?v=59';
import { $id, aviso, mostrarErro, limparErro } from '../core/ui.js?v=59';
import { tocarSom, marcarAcaoLocal } from '../core/som.js?v=59';

let hooksMesa = {
  publicarEstado: () => {},
  buscarMesa: () => Promise.resolve(),
  restaurarTela: () => {}
};

export function registrarHooksApostas(hooks) {
  hooksMesa = Object.assign(hooksMesa, hooks);
}

// Executor genérico de RPCs da mesa (bloqueia toque duplo, publica broadcast e trata erros)
export async function executar(funcao, parametros, idDoErro, aoEnviar) {
  if (estado.ocupado) return false;
  estado.ocupado = true;
  if (aoEnviar) aoEnviar();
  limparErro('erro-barra');
  limparErro('erro-criador');
  limparErro('erro-distribuir');
  limparErro('erro-faixa');

  let deuCerto = false;
  try {
    const resp = await banco.rpc(funcao, parametros);
    if (resp.error) {
      mostrarErro(idDoErro, resp.error.message);
      hooksMesa.restaurarTela();
    } else {
      deuCerto = true;
      if (resp.data && resp.data.partida) hooksMesa.publicarEstado(resp.data);
      else await hooksMesa.buscarMesa(false);
    }
  } catch (erro) {
    mostrarErro(idDoErro, 'Não consegui falar com o servidor. Confira a internet.');
    hooksMesa.restaurarTela();
  } finally {
    estado.ocupado = false;
  }
  return deuCerto;
}

// Limites: mínima = o que falta pagar + 1 big blind (alinhada ao passo); máxima = todas as fichas (all-in)
export function limitesAposta() {
  if (!estado.partidaAtual) return null;
  const eu = estado.jogadoresAtuais.find((j) => j.id === estado.meuJogadorId);
  if (!eu) return null;
  const falta = Math.max(0, estado.partidaAtual.aposta_atual - eu.apostou);
  const passo = passoSala();
  const max = eu.saldo;
  let min = falta + Math.max(1, estado.partidaAtual.big_blind);
  if (passo > 1) min = Math.ceil((eu.apostou + min) / passo) * passo - eu.apostou;
  min = Math.min(min, max);
  return {
    falta,
    passo,
    passoBotoes: passo > 1 ? passo : Math.max(1, estado.partidaAtual.small_blind),
    min,
    max,
    apostou: eu.apostou
  };
}

export function ajustaValor(valor, lim) {
  valor = Math.round(valor);
  if (valor >= lim.max) return lim.max;
  if (lim.passo > 1) {
    valor = Math.round((lim.apostou + valor) / lim.passo) * lim.passo - lim.apostou;
    if (valor >= lim.max) return lim.max;
  }
  return Math.max(lim.min, valor);
}

export function definirAposta(valor, mexeu) {
  const lim = limitesAposta();
  if (!lim || !(lim.max > 0)) return;
  valor = ajustaValor(valor, lim);
  $id('campo-valor').value = valor;
  if (mexeu) estado.apostaEditada = true;
  atualizarRotuloApostar();
}

export function ajustarAposta(direcao) {
  const lim = limitesAposta();
  if (!lim) return;
  const atual = parseInt($id('campo-valor').value) || lim.min;
  definirAposta(atual + direcao * lim.passoBotoes, true);
  tocarSom('clique');
}

export function apostaPote(fracao) {
  const lim = limitesAposta();
  if (!lim || !(lim.max > 0)) return;
  const bruto = lim.falta + fracao * (estado.partidaAtual.pote + lim.falta);
  tocarSom('clique');
  if (lim.passo > 1) { definirAposta(bruto, true); return; }
  const passo = Math.max(1, estado.partidaAtual.small_blind);
  definirAposta(Math.round(bruto / passo) * passo, true);
}

export function apostaAllIn() {
  const lim = limitesAposta();
  if (!lim || !(lim.max > 0)) return;
  definirAposta(lim.max, true);
  tocarSom('clique');
}

function infoSlider(lim) {
  const passoS = lim.passo > 1 ? lim.passo : (estado.partidaAtual.big_blind >= 10 ? 10 : 1);
  const total = lim.apostou + lim.max;
  const Lmin = Math.ceil((lim.apostou + lim.min) / passoS) * passoS;
  const Lmax = Math.floor(total / passoS) * passoS;
  const extra = total > Lmax;
  const ativo = Lmin <= Lmax && lim.max > lim.min;
  return { passoS, Lmin, Lmax, extra, top: Lmax + (extra ? passoS : 0), ativo };
}

function configurarSlider(lim, valor) {
  const sl = $id('campo-slider');
  const inf = infoSlider(lim);
  if (!inf.ativo) { sl.min = 0; sl.max = 0; sl.step = 1; sl.value = 0; return; }
  sl.step = inf.passoS;
  sl.min = inf.Lmin;
  sl.max = inf.top;
  sl.value = (valor >= lim.max) ? inf.top : Math.max(inf.Lmin, Math.min(inf.Lmax, lim.apostou + valor));
}

export function aoMoverSlider() {
  const lim = limitesAposta();
  if (!lim || !(lim.max > 0)) return;
  const inf = infoSlider(lim);
  if (!inf.ativo) return;
  const nivel = parseInt($id('campo-slider').value);
  let valor = (inf.extra && nivel >= inf.top) ? lim.max : nivel - lim.apostou;
  valor = Math.max(lim.min, Math.min(lim.max, valor));
  $id('campo-valor').value = valor;
  estado.apostaEditada = true;
  atualizarRotuloApostar(true);
}

export function aoDigitarAposta() {
  estado.apostaEditada = true;
  atualizarRotuloApostar();
}

export function alternarAposta() {
  tocarSom('clique');
  estado.apostaAberta = !estado.apostaAberta;
  estado.apostaAbertaEm = Date.now();
  $id('caixa-aposta').hidden = !estado.apostaAberta;
  $id('btn-aumentar').classList.toggle('aberto', estado.apostaAberta);
  $id('tela-mesa').classList.toggle('apostando', estado.apostaAberta);
  $id('barra-acoes').classList.toggle('apostando', estado.apostaAberta);
  sincronizarModoAposta();
  if (estado.apostaAberta) {
    estado.apostaEditada = false;
    const lim = limitesAposta();
    if (lim && lim.max > 0) definirAposta(lim.min, false);
  }
}

export function sincronizarModoAposta() {
  const g = document.querySelector('#barra-normal .grade-simples');
  if (g) g.classList.toggle('modo-aposta', estado.apostaAberta);
  const btn = $id('btn-aumentar');
  if (btn) {
    const eu = estado.jogadoresAtuais.find((j) => j.id === estado.meuJogadorId);
    const falta = estado.ultimoEstado && estado.ultimoEstado.partida
      ? Math.max(0, estado.ultimoEstado.partida.aposta_atual - ((eu && eu.apostou) || 0))
      : 0;
    btn.textContent = estado.apostaAberta ? 'Cancelar' : (falta > 0 ? 'Aumentar' : 'Apostar');
  }
}

export function atualizarRotuloApostar(semSlider) {
  const lim = limitesAposta();
  const valor = parseInt($id('campo-valor').value);
  let texto = 'Apostar';
  if (valor > 0) {
    texto += ' ' + valor;
    if (lim && valor === lim.max) texto += ' (all-in)';
  }
  $id('btn-apostar').textContent = texto;
  $id('btn-confirmar-aposta').textContent = texto;
  if (lim && !semSlider) configurarSlider(lim, valor);
}

export function modoEnviando() {
  try { if (navigator.vibrate) navigator.vibrate(15); } catch (erro) {}
  estado.apostaAberta = false;
  sincronizarModoAposta();
  $id('tela-mesa').classList.remove('apostando');
  $id('barra-acoes').classList.remove('apostando');
  $id('barra-normal').hidden = true;
  $id('barra-blind').hidden = true;
  const devProx = $id('barra-dev-prox');
  if (devProx) devProx.hidden = true;
  $id('barra-titulo').textContent = 'Enviando…';
  $id('barra-acoes').classList.remove('minha-vez');
}

export function agir(acao) {
  marcarAcaoLocal();
  if (acao === 'check') {
    tocarSom('check');
  } else if (acao === 'desistir') {
    tocarSom('desistir');
  } else if (acao === 'pagar') {
    const eu = estado.jogadoresAtuais.find((j) => j.id === estado.meuJogadorId);
    const falta = (estado.partidaAtual && eu)
      ? Math.max(0, estado.partidaAtual.aposta_atual - eu.apostou)
      : 0;
    tocarSom(eu && falta >= eu.saldo ? 'allin' : 'ficha');
  }
  return executar('jogar', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo,
    p_acao: acao,
    p_valor: 0
  }, 'erro-barra', modoEnviando);
}

export async function apostar() {
  if (Date.now() - estado.apostaAbertaEm < 450) return;
  const campo = $id('campo-valor');
  const valor = parseInt(campo.value);
  if (!(valor > 0)) {
    mostrarErro('erro-barra', 'Digite um valor para apostar.');
    return;
  }
  const lim = limitesAposta();
  if (lim && lim.passo > 1 && valor < lim.max) {
    const aj = ajustaValor(valor, lim);
    if (aj !== valor) {
      definirAposta(aj, true);
      aviso('Valor ajustado para ' + aj + ' (apostas em múltiplos de ' + lim.passo + ')');
      return;
    }
  }
  marcarAcaoLocal();
  tocarSom(lim && valor >= lim.max ? 'allin' : 'ficha');
  const deuCerto = await executar('jogar', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo,
    p_acao: 'apostar',
    p_valor: valor
  }, 'erro-barra', modoEnviando);
  if (deuCerto) estado.apostaEditada = false;
}

export function desenharBarraAcoes({ partida, jogadores, eu, minhaVez, emJogo, falta, status }) {
  const barra = $id('barra-acoes');
  const mostrarBarra = !!eu && (partida.iniciada || partida.modo === 'online');
  $id('mesa-status').hidden = mostrarBarra;
  barra.classList.toggle('visivel', mostrarBarra);
  barra.classList.toggle('minha-vez', mostrarBarra && minhaVez);

  if (!mostrarBarra) {
    const esperaEl = $id('barra-online-espera');
    if (esperaEl) { esperaEl.hidden = true; esperaEl.innerHTML = ''; }
    return;
  }

  const emBlind = partida.fase_blind > 0;
  const minhaVezBlind = emBlind && minhaVez;
  const podeAgir = minhaVez && !emBlind && !eu.desistiu && emJogo;

  $id('barra-blind').hidden = !minhaVezBlind;
  $id('barra-normal').hidden = !(minhaVez && !emBlind && emJogo);

  const barraDevProx = $id('barra-dev-prox');
  const btnDevPassar = $id('btn-dev-passar');
  if (barraDevProx && btnDevPassar) {
    const mostrarPassarDev = estado.modoDev && !minhaVez && emJogo;
    barraDevProx.hidden = !mostrarPassarDev;
    if (mostrarPassarDev) {
      const daVez = jogadores.find((j) => j.id === partida.vez_jogador_id);
      btnDevPassar.textContent = daVez
        ? 'Passar para ' + nomeDe(daVez.nome) + ' ▶'
        : 'Próximo jogador ▶';
    }
  }

  if (minhaVezBlind) {
    const valorBlind = Math.min(
      partida.fase_blind === 1 ? partida.small_blind : partida.big_blind,
      eu.saldo
    );
    $id('btn-blind').textContent =
      'PAGAR ' + (partida.fase_blind === 1 ? 'SMALL' : 'BIG') + ' BLIND (' + valorBlind + ')';
  }

  let titulo = status;
  if (eu.esperando) titulo = 'Você está esperando a próxima mão. ' + status;
  else if (eu.desistiu && emJogo && !emBlind) titulo = 'Você desistiu desta mão. ' + status;
  $id('barra-titulo').textContent = titulo;

  const valorPagar = Math.min(falta, eu.saldo);
  const outrosComFichas = jogadores.filter((j) => j.id !== eu.id && !j.desistiu && j.saldo > 0).length;
  const podeAumentar = podeAgir && eu.saldo > 0 && outrosComFichas > 0 && eu.saldo > falta;

  $id('btn-desistir').disabled = !podeAgir;
  $id('btn-check').disabled = !podeAgir || falta > 0;
  $id('btn-pagar').disabled = !podeAgir || falta <= 0;
  $id('btn-check').hidden = falta > 0;
  $id('btn-pagar').hidden = falta <= 0;
  $id('campo-slider').disabled = !podeAumentar;
  $id('btn-pagar').textContent =
    falta > 0 ? 'Pagar ' + valorPagar + (valorPagar >= eu.saldo ? ' (all-in)' : '') : 'Pagar';
  $id('dica-pagar').textContent =
    (podeAgir && outrosComFichas === 0 && falta > 0)
      ? 'Demais jogadores em all-in: pague ou desista.'
      : '';
  $id('campo-valor').disabled = !podeAumentar;
  $id('btn-apostar').disabled = !podeAumentar;
  $id('btn-menos').disabled = !podeAumentar;
  $id('btn-mais').disabled = !podeAumentar;

  if (!podeAumentar) estado.apostaAberta = false;
  $id('caixa-aposta').hidden = !estado.apostaAberta;
  $id('tela-mesa').classList.toggle('apostando', estado.apostaAberta);
  $id('barra-acoes').classList.toggle('apostando', estado.apostaAberta);
  $id('btn-aumentar').disabled = !podeAumentar;
  $id('btn-aumentar').classList.toggle('aberto', estado.apostaAberta);
  $id('btn-confirmar-aposta').disabled = !podeAumentar;
  sincronizarModoAposta();

  const campoAposta = $id('campo-valor');
  if (podeAgir && eu.saldo > 0) {
    if (!estado.apostaEditada || !(parseInt(campoAposta.value) > 0)) {
      const limIni = limitesAposta();
      campoAposta.value = limIni ? limIni.min : Math.min(falta + partida.big_blind, eu.saldo);
    } else if (parseInt(campoAposta.value) > eu.saldo) {
      campoAposta.value = eu.saldo;
    }
  } else if (!minhaVez) {
    campoAposta.value = '';
    estado.apostaEditada = false;
  }
  atualizarRotuloApostar();
}
