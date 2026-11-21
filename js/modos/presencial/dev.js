// Modo DEV: sala de teste com jogadores fictícios controlados no mesmo aparelho
import { banco } from '../../core/supabase.js?v=43';
import { estado, nomeDe, limparCachesMesa } from '../../core/estado.js?v=43';
import { lerDevSala, salvarDevSala, esquecerDevSala } from '../../core/storage.js?v=43';
import { $id, escapar, aviso, mostrar, mostrarErro, limparErro, abrirFolha, fecharFolhas } from '../../core/ui.js?v=43';
import { registrarRealCriacao, obterConfigOnline } from '../../lobby/config-sala.js?v=43';
import { executar } from '../../mesa/apostas.js?v=43';

const NOMES_DEV = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabi', 'Hugo', 'Iris'];
const MAX_DEV = 9;
let apagandoDev = false;
let timerAutoVez = null;
let chaveAutoVez = '';

let hooksDev = {
  abrirSalas: () => {},
  pararSalas: () => {},
  abrirMesa: () => Promise.resolve(),
  buscarMesa: () => Promise.resolve(),
  voltarParaSalas: () => {},
  onTrocarJogador: () => {},
  onRedesenhar: () => {}
};

export function registrarHooksDev(hooks) {
  hooksDev = Object.assign(hooksDev, hooks);
}

function jogadorDevDe(resp) {
  return {
    id: resp.jogador_id,
    segredo: resp.segredo,
    conta_id: resp.conta_id,
    token: resp.token,
    nome: resp.nome
  };
}

export async function abrirSalaDev() {
  if (estado.abrindoSala) return;
  estado.abrindoSala = true;
  limparErro('erro-salas');
  try {
    const sala = lerDevSala();
    if (sala) {
      let resp;
      try { resp = await banco.rpc('estado_mesa', { p_partida: sala.partida_id }); }
      catch (erro) { resp = { error: erro }; }
      if (resp.error) { mostrarErro('erro-salas', 'Não consegui abrir a sala DEV. Confira a internet.'); return; }
      const viva = resp.data && resp.data.partida && !resp.data.partida.encerrada;
      if (viva) { hooksDev.pararSalas(); await abrirMesaDev(0); return; }
      esquecerDevSala();
      aviso('A sala DEV anterior já tinha sido encerrada. Crie uma nova.');
    }
    limparErro('erro-dev-criar');
    mostrar('tela-dev');
  } finally {
    estado.abrindoSala = false;
  }
}

export async function criarSalaDev() {
  limparErro('erro-dev-criar');
  const saldo = parseInt($id('campo-dev-saldo').value);
  const small = parseInt($id('campo-dev-small').value);
  const big = parseInt($id('campo-dev-big').value);
  const qtd = parseInt($id('campo-dev-qtd').value);

  if (!(saldo > 0) || !(small > 0) || !(big > 0)) {
    mostrarErro('erro-dev-criar', 'Saldo e blinds precisam ser números maiores que zero.');
    return;
  }
  if (big <= small) {
    mostrarErro('erro-dev-criar', 'O big blind precisa ser maior que o small blind.');
    return;
  }
  if (!(qtd >= 2 && qtd <= MAX_DEV)) {
    mostrarErro('erro-dev-criar', 'Escolha entre 2 e 9 jogadores.');
    return;
  }

  const botao = $id('botao-criar-dev');
  botao.disabled = true;
  botao.textContent = 'Criando sala DEV...';

  const cfg = obterConfigOnline('dev');
  let resp;
  try {
    resp = cfg.modo === 'online'
      ? await banco.rpc('dev_criar_sala_online', {
          p_nome: NOMES_DEV[0],
          p_saldo: saldo,
          p_small: small,
          p_big: big,
          p_tempo_turno: cfg.tempoTurno,
          p_subir_blinds_min: cfg.subirBlindsMin
        })
      : await banco.rpc('dev_criar_sala', { p_nome: NOMES_DEV[0], p_saldo: saldo, p_small: small, p_big: big });
  } catch (erro) {
    resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  }
  if (resp.error) {
    botao.disabled = false;
    botao.textContent = 'Criar sala DEV';
    mostrarErro('erro-dev-criar', resp.error.message);
    return;
  }

  const sala = { partida_id: resp.data.partida_id, jogadores: [jogadorDevDe(resp.data)] };
  salvarDevSala(sala);
  await registrarRealCriacao('dev', sala.partida_id, saldo, sala.jogadores[0].id, sala.jogadores[0].segredo);

  let falhou = null;
  for (let i = 1; i < qtd && !falhou; i++) {
    botao.textContent = 'Adicionando jogador ' + (i + 1) + ' de ' + qtd + '...';
    let r;
    try {
      r = await banco.rpc('dev_adicionar_jogador', { p_partida: sala.partida_id, p_nome: NOMES_DEV[i] });
    } catch (erro) {
      r = { error: { message: 'Não consegui falar com o servidor.' } };
    }
    if (r.error) {
      falhou = r.error.message;
    } else {
      sala.jogadores.push(jogadorDevDe(r.data));
      salvarDevSala(sala);
    }
  }

  botao.disabled = false;
  botao.textContent = 'Criar sala DEV';
  if (falhou) aviso('Sala criada com ' + sala.jogadores.length + ' jogadores. ' + falhou);
  abrirMesaDev(0);
}

export function abrirMesaDev(indice) {
  const sala = lerDevSala();
  if (!sala) { hooksDev.abrirSalas(); return; }
  estado.modoDev = true;
  controlarDev(indice, sala);
  hooksDev.abrirMesa({ id: sala.partida_id });
}

export function controlarDev(indice, sala) {
  const s = sala || lerDevSala();
  const j = s.jogadores[indice] || s.jogadores[0];
  estado.meuJogadorId = j.id;
  estado.meuSegredo = j.segredo;
  limparCachesMesa();
  estado.apostaEditada = false;
  estado.apostaAberta = false;
  $id('campo-valor').value = '';
  if (hooksDev.onTrocarJogador) hooksDev.onTrocarJogador();
}

export function trocarJogadorDev(indice) {
  clearTimeout(timerAutoVez);
  controlarDev(indice);
  fecharFolhas();
  hooksDev.buscarMesa(true);
}

// No modo DEV, a troca de jogador agora é manual pelo botão "Passar para próximo"
export function autoSeguirVezDev() {
  clearTimeout(timerAutoVez);
}

export function proximoJogadorDev() {
  const sala = lerDevSala();
  if (!sala || sala.jogadores.length < 2) return;
  const p = estado.partidaAtual;
  if (p && p.vez_jogador_id && p.vez_jogador_id !== estado.meuJogadorId) {
    const idxVez = sala.jogadores.findIndex((j) => j.id === p.vez_jogador_id);
    if (idxVez >= 0) {
      trocarJogadorDev(idxVez);
      return;
    }
  }
  const i = sala.jogadores.findIndex((j) => j.id === estado.meuJogadorId);
  trocarJogadorDev((i + 1) % sala.jogadores.length);
}

export function abrirPainelDev() {
  desenharPainelDev();
  abrirFolha('painel-dev');
}

export function desenharPainelDev() {
  const sala = lerDevSala();
  if (!sala) return;

  const iniciada = !!(estado.partidaAtual && estado.partidaAtual.iniciada);
  const pausa = iniciada && !!estado.partidaAtual.aguardando_proxima_mao;
  const ehOnline = !!(estado.partidaAtual && estado.partidaAtual.modo === 'online');
  const devDica = $id('dev-dica');
  if (devDica) {
    devDica.textContent = ehOnline
      ? 'Modo Online: escolha qual jogador você controla para testar cartas privadas, turnos e confirmações.'
      : 'Escolha qual jogador você controla: as jogadas valem para ele. Iniciar, próxima mão, subir nível e reiniciar são feitos pelo criador da sala.';
  }
  const devConf = $id('dev-confirmar-todos');
  if (devConf) devConf.hidden = !(ehOnline && (!iniciada || pausa));
  $id('dev-acoes-presencial').hidden = ehOnline;
  $id('dev-iniciar').hidden = iniciada;
  $id('dev-proxima').hidden = !pausa;

  const add = $id('botao-add-dev');
  add.disabled = sala.jogadores.length >= MAX_DEV;
  add.textContent = 'Adicionar jogador (' + sala.jogadores.length + ' de ' + MAX_DEV + ')';

  const html = sala.jogadores.map((j, i) => {
    const naMesa = estado.jogadoresAtuais.find((x) => x.id === j.id);
    const controlando = j.id === estado.meuJogadorId;
    const partes = [];
    if (i === 0) partes.push('criador');
    if (controlando) partes.push('você está controlando');
    partes.push('fichas: ' + (naMesa ? naMesa.saldo : '—'));
    return '<div class="linha-dev' + (controlando ? ' atual' : '') + '">'
      + '<div class="info-dev">' + escapar(nomeDe(j.nome)) + '<small>' + partes.join(' · ') + '</small></div>'
      + (controlando ? '' : '<button type="button" class="secundario" onclick="trocarJogadorDev(' + i + ')">Controlar</button>')
      + '</div>';
  }).join('');

  if (html !== estado.htmlDevVisto) {
    estado.htmlDevVisto = html;
    $id('lista-dev').innerHTML = html;
  }
}

export async function adicionarJogadorDev() {
  const sala = lerDevSala();
  if (!sala || sala.jogadores.length >= MAX_DEV) return;
  limparErro('erro-dev');

  const botao = $id('botao-add-dev');
  botao.disabled = true;
  let resp;
  try {
    resp = await banco.rpc('dev_adicionar_jogador', {
      p_partida: sala.partida_id,
      p_nome: NOMES_DEV[sala.jogadores.length]
    });
  } catch (erro) {
    resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  }
  botao.disabled = false;
  if (resp.error) { mostrarErro('erro-dev', resp.error.message); return; }

  sala.jogadores.push(jogadorDevDe(resp.data));
  salvarDevSala(sala);
  estado.htmlDevVisto = '';
  desenharPainelDev();
  hooksDev.buscarMesa(true);
}

export function devAcao(funcao, extra, mensagem) {
  const sala = lerDevSala();
  if (!sala) return Promise.resolve(false);
  const criador = sala.jogadores[0];
  limparErro('erro-dev');
  const params = Object.assign({ p_jogador: criador.id, p_segredo: criador.segredo }, extra || {});
  return executar(funcao, params, 'erro-dev').then((ok) => {
    if (ok) { fecharFolhas(); if (mensagem) aviso(mensagem); }
    return ok;
  });
}

export async function apagarSalaDev() {
  const sala = lerDevSala();
  if (!sala || apagandoDev) return false;
  apagandoDev = true;
  const criador = sala.jogadores[0];
  try {
    try {
      await banco.rpc('encerrar_sala', {
        p_conta: criador.conta_id,
        p_token: criador.token,
        p_partida_id: sala.partida_id
      });
    } catch (erro) {}
    try { await banco.rpc('dev_apagar_sala', { p_partida: sala.partida_id }); } catch (erro) {}
    const chk = await banco.rpc('estado_mesa', { p_partida: sala.partida_id });
    if (!chk.error && (!chk.data || !chk.data.partida || chk.data.partida.encerrada)) {
      esquecerDevSala();
      return true;
    }
  } catch (erro) {
  } finally {
    apagandoDev = false;
  }
  return false;
}

export async function excluirSalaDev() {
  if (!lerDevSala() || estado.ocupado) return;
  if (!confirm('Encerrar e excluir a sala DEV? Os jogadores fictícios também saem deste aparelho.')) return;
  limparErro('erro-dev');
  const ok = await apagarSalaDev();
  if (!ok) { mostrarErro('erro-dev', 'Não consegui excluir agora. Confira a internet e tente de novo.'); return; }
  aviso('Sala DEV excluída.');
  hooksDev.voltarParaSalas();
}
