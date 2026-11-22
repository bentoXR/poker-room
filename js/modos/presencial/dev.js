// Modo DEV: sala de teste com jogadores fictícios controlados no mesmo aparelho
import { banco } from '../../core/supabase.js?v=89';
import { estado, nomeDe, contaParams, ehContaDev, limparCachesMesa } from '../../core/estado.js?v=89';
import { lerDevSala, salvarDevSala, esquecerDevSala, esquecerPartida } from '../../core/storage.js?v=89';
import { $id, escapar, aviso, mostrar, mostrarErro, limparErro, abrirFolha, fecharFolhas } from '../../core/ui.js?v=89';
import { desligarTempoReal } from '../../core/realtime.js?v=89';
import { registrarRealCriacao, obterConfigOnline } from '../../lobby/config-sala.js?v=89';
import { executar } from '../../mesa/apostas.js?v=89';

const NOMES_DEV = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabi', 'Hugo', 'Iris'];
const MAX_DEV = 9;
const apagandoDevIds = new Set();
let geracaoDev = 0;
let criandoDev = false;
let timerAutoVez = null;
let chaveAutoVez = '';

export function cancelarCriacaoDev() {
  geracaoDev++;
}

function garantirContaDev(mostrarAviso = true) {
  if (ehContaDev()) return true;
  estado.modoDev = false;
  esquecerDevSala();
  if (mostrarAviso) aviso('Acesso à Sala DEV restrito.');
  return false;
}

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
  if (!garantirContaDev()) return;
  if (estado.abrindoSala) return;
  estado.abrindoSala = true;
  cancelarCriacaoDev();
  desligarTempoReal();
  limparErro('erro-salas');
  try {
    if (lerDevSala()) {
      await apagarSalaDev();
    }
    estado.modoDev = false;
    limparErro('erro-dev-criar');
    mostrar('tela-dev');
  } finally {
    estado.abrindoSala = false;
  }
}

export async function criarSalaDev() {
  if (!garantirContaDev() || criandoDev) return;
  limparErro('erro-dev-criar');
  const saldo = parseInt($id('campo-dev-saldo').value);
  const small = parseInt($id('campo-dev-small').value);
  const big = parseInt($id('campo-dev-big').value);
  const qtd = parseInt($id('campo-dev-qtd').value);
  const cfg = obterConfigOnline('dev');
  const ehBj = cfg.modo === 'blackjack';

  if (ehBj) {
    if (!(saldo > 0) || !(cfg.apostaMin > 0) || cfg.apostaMin > saldo) {
      mostrarErro('erro-dev-criar', 'Saldo e aposta mínima inválidos.');
      return;
    }
    if (!(qtd >= 1 && qtd <= 6)) {
      mostrarErro('erro-dev-criar', 'No Blackjack, escolha entre 1 e 6 jogadores.');
      return;
    }
  } else {
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
  }

  criandoDev = true;
  const minhaGeracao = ++geracaoDev;
  const botao = $id('botao-criar-dev');
  botao.disabled = true;
  botao.textContent = 'Criando sala DEV...';

  const cancelado = () => (
    minhaGeracao !== geracaoDev
    || !ehContaDev()
    || !$id('tela-dev').classList.contains('ativa')
  );

  try {
    desligarTempoReal();
    esquecerPartida();
    if (lerDevSala()) {
      await apagarSalaDev();
    }
    if (cancelado()) return;

    let resp;
    try {
      resp = ehBj
        ? await banco.rpc('dev_criar_sala_blackjack', Object.assign({}, contaParams(), {
            p_nome: NOMES_DEV[0],
            p_saldo: saldo,
            p_aposta_min: cfg.apostaMin,
            p_tempo_turno: cfg.tempoTurno
          }))
        : (cfg.modo === 'online'
          ? await banco.rpc('dev_criar_sala_online', Object.assign({}, contaParams(), {
              p_nome: NOMES_DEV[0],
              p_saldo: saldo,
              p_small: small,
              p_big: big,
              p_tempo_turno: cfg.tempoTurno,
              p_subir_blinds_min: cfg.subirBlindsMin
            }))
          : await banco.rpc('dev_criar_sala', Object.assign({}, contaParams(), {
              p_nome: NOMES_DEV[0],
              p_saldo: saldo,
              p_small: small,
              p_big: big
            })));
    } catch (erro) {
      resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
    }
    if (resp.error) {
      if (!cancelado()) mostrarErro('erro-dev-criar', resp.error.message);
      return;
    }

    const sala = { partida_id: resp.data.partida_id, modo: cfg.modo, jogadores: [jogadorDevDe(resp.data)] };
    if (cancelado()) {
      await apagarSalaDev(sala);
      return;
    }

    await registrarRealCriacao('dev', sala.partida_id, saldo, sala.jogadores[0].id, sala.jogadores[0].segredo);
    if (cancelado()) {
      await apagarSalaDev(sala);
      return;
    }

    let falhou = null;
    for (let i = 1; i < qtd && !falhou; i++) {
      if (cancelado()) {
        await apagarSalaDev(sala);
        return;
      }
      botao.textContent = 'Adicionando jogador ' + (i + 1) + ' de ' + qtd + '...';
      let r;
      try {
        r = await banco.rpc('dev_adicionar_jogador', Object.assign({}, contaParams(), {
          p_partida: sala.partida_id,
          p_nome: NOMES_DEV[i]
        }));
      } catch (erro) {
        r = { error: { message: 'Não consegui falar com o servidor.' } };
      }
      if (cancelado()) {
        await apagarSalaDev(sala);
        return;
      }
      if (r.error) {
        falhou = r.error.message;
      } else {
        sala.jogadores.push(jogadorDevDe(r.data));
      }
    }

    if (cancelado()) {
      await apagarSalaDev(sala);
      return;
    }

    salvarDevSala(sala);
    esquecerPartida();
    hooksDev.pararSalas();
    if (falhou) aviso('Sala criada com ' + sala.jogadores.length + ' jogadores. ' + falhou);
    abrirMesaDev(0);
  } finally {
    criandoDev = false;
    botao.disabled = false;
    botao.textContent = 'Criar sala DEV';
  }
}

export function abrirMesaDev(indice) {
  if (!garantirContaDev(false)) { hooksDev.abrirSalas(); return; }
  const sala = lerDevSala();
  if (!sala) { hooksDev.abrirSalas(); return; }
  estado.modoDev = true;
  controlarDev(indice, sala);
  hooksDev.abrirMesa({ id: sala.partida_id, modo: sala.modo || 'presencial', dev: true });
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
  if (!garantirContaDev()) return;
  desenharPainelDev();
  abrirFolha('painel-dev');
}

export function desenharPainelDev() {
  const sala = lerDevSala();
  if (!sala) return;

  const iniciada = !!(estado.partidaAtual && estado.partidaAtual.iniciada);
  const pausa = iniciada && !!estado.partidaAtual.aguardando_proxima_mao;
  const ehOnline = !!(estado.partidaAtual && estado.partidaAtual.modo === 'online');
  const ehBj = !!(estado.partidaAtual && estado.partidaAtual.modo === 'blackjack');
  const devDica = $id('dev-dica');
  if (devDica) {
    devDica.textContent = ehBj
      ? 'Modo Blackjack: alterne entre os jogadores para testar apostas, Pedir, Parar, Dobrar e Dividir contra a Banca.'
      : (ehOnline
        ? 'Modo Online: escolha qual jogador você controla para testar cartas privadas, turnos e confirmações.'
        : 'Escolha qual jogador você controla: as jogadas valem para ele. Iniciar, próxima mão, subir nível e reiniciar são feitos pelo criador da sala.');
  }
  const devConf = $id('dev-confirmar-todos');
  if (devConf) devConf.hidden = !(ehOnline && (!iniciada || pausa));
  $id('dev-acoes-presencial').hidden = ehOnline || ehBj;
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
  if (!garantirContaDev()) return;
  const sala = lerDevSala();
  if (!sala || sala.jogadores.length >= MAX_DEV) return;
  limparErro('erro-dev');

  const botao = $id('botao-add-dev');
  botao.disabled = true;
  let resp;
  try {
    resp = await banco.rpc('dev_adicionar_jogador', Object.assign({}, contaParams(), {
      p_partida: sala.partida_id,
      p_nome: NOMES_DEV[sala.jogadores.length]
    }));
  } catch (erro) {
    resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  }
  botao.disabled = false;
  if (resp.error) { mostrarErro('erro-dev', resp.error.message); return; }

  sala.jogadores.push(jogadorDevDe(resp.data));
  salvarDevSala(sala);
  estado.htmlDevVisto = null;
  desenharPainelDev();
  hooksDev.buscarMesa(true);
}

export function devAcao(funcao, extra, mensagem) {
  if (!garantirContaDev()) return Promise.resolve(false);
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

export async function apagarSalaDev(salaAlvo) {
  const salaSalva = lerDevSala();
  const sala = salaAlvo || salaSalva;
  if (!salaAlvo || (salaSalva && sala && salaSalva.partida_id === sala.partida_id)) {
    esquecerDevSala();
  }
  if (!sala || !sala.partida_id || apagandoDevIds.has(sala.partida_id)) return false;
  apagandoDevIds.add(sala.partida_id);
  const criador = sala.jogadores && sala.jogadores[0];
  try {
    if (criador && criador.conta_id && criador.token) {
      try {
        await banco.rpc('encerrar_sala', {
          p_conta: criador.conta_id,
          p_token: criador.token,
          p_partida_id: sala.partida_id
        });
      } catch (erro) {}
    }
    if (ehContaDev() && estado.minhaConta && estado.minhaConta.token) {
      try {
        await banco.rpc('dev_apagar_sala', Object.assign({}, contaParams(), {
          p_partida: sala.partida_id
        }));
      } catch (erro) {}
    }
    return true;
  } catch (erro) {
    return true;
  } finally {
    apagandoDevIds.delete(sala.partida_id);
  }
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
