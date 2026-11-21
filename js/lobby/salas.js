// Lista de salas, criação de sala e entrada na mesa (compartilhado entre modos)
import { banco } from '../core/supabase.js?v=64';
import { estado, ICONE_COROA, contaParams } from '../core/estado.js?v=64';
import { guardarMeuJogador } from '../core/storage.js?v=64';
import { $id, escapar, aviso, mostrar, mostrarErro, limparErro } from '../core/ui.js?v=64';
import { tratarErroConta } from './auth.js?v=64';
import { atualizarCabecalhoPerfil, sincronizarMeuPerfil } from './perfil.js?v=64';
import { registrarRealCriacao, obterConfigOnline } from './config-sala.js?v=64';
import { abrirMesa } from '../mesa/mesa.js?v=64';

export function abrirSalas() {
  pararSalas();
  atualizarCabecalhoPerfil();
  sincronizarMeuPerfil();
  limparErro('erro-salas');
  mostrar('tela-salas');
  if (!estado.htmlSalas) {
    $id('lista-salas').innerHTML = '<div class="vazio"><p>Buscando salas abertas…</p></div>';
  }
  carregarSalas();
  estado.temporizadorSalas = setInterval(carregarSalas, 4000);
}

export function pararSalas() {
  if (estado.temporizadorSalas) {
    clearInterval(estado.temporizadorSalas);
    estado.temporizadorSalas = null;
  }
}

export async function carregarSalas() {
  if (!estado.minhaConta || document.hidden) return;
  const minha = ++estado.versaoSalas;

  let resp;
  try {
    resp = await banco.rpc('listar_salas', contaParams());
  } catch (erro) {
    resp = { error: { message: 'sem conexão' } };
  }

  if (minha !== estado.versaoSalas || !$id('tela-salas').classList.contains('ativa')) return;

  if (resp.error) {
    if (tratarErroConta(resp.error)) return;
    mostrarErro('erro-salas', 'Não consegui carregar as salas. Confira a internet.');
    return;
  }
  limparErro('erro-salas');
  estado.salasAtuais = resp.data || [];
  desenharSalas();
}

export function desenharSalas() {
  let html;
  if (estado.salasAtuais.length === 0) {
    html = `
      <div class="vazio">
        <div class="vazio-naipes" aria-hidden="true"><span>♠</span><span class="r">♥</span><span>♣</span><span class="r">♦</span></div>
        <strong>Nenhuma sala aberta agora</strong>
        <p>Toque em <b>+ Criar sala</b> para chamar seus amigos ou teste sozinho na <b>Sala DEV</b>.</p>
      </div>
    `;
  } else {
    html = estado.salasAtuais.map((s) => {
      const ehOnline = s.modo === 'online';
      const statusChip = s.iniciada
        ? '<span class="meta-chip vivo"><i></i><b>Mão ' + s.mao + '</b></span>'
        : '<span class="meta-chip">Aguardando</span>';
      const jogTxt = '<b>' + s.n_jogadores + '</b> ' + (s.n_jogadores === 1 ? 'jogador' : 'jogadores');
      const blindsTxt = 'Blinds <b>' + s.small_blind + '/' + s.big_blind + '</b>';
      const tempoChip = ehOnline
        ? '<span class="meta-chip">' + (Number(s.tempo_turno) === 0 ? '<b>Sem limite</b>' : 'Turno <b>' + (s.tempo_turno || 30) + 's</b>') + '</span>'
        : '';
      const subirChip = (ehOnline && s.subir_blinds_min > 0)
        ? '<span class="meta-chip">↑ <b>' + s.subir_blinds_min + 'm</b></span>'
        : '';
      const modoTag = ehOnline
        ? '<span class="tag modo-online">🃏 Online</span>'
        : '<span class="tag modo-presencial">🪙 Presencial</span>';
      const tag = s.sou_jogador ? '<span class="tag vez">Continuar</span>' : '';
      return `
        <button type="button" class="sala ${ehOnline ? 'eh-online' : 'eh-presencial'} ${s.sou_jogador ? 'minha' : ''}" onclick="abrirSala('${s.id}')">
          <div class="sala-info">
            <div class="sala-topo-linha">
              <div class="sala-nome">${!ehOnline && s.sou_criador ? ICONE_COROA : ''}${escapar(s.nome)}</div>
              <div class="sala-badges">${modoTag}${tag}</div>
            </div>
            <div class="sala-meta">
              ${statusChip}
              <span class="meta-chip">${jogTxt}</span>
              <span class="meta-chip">${blindsTxt}</span>
              ${tempoChip}${subirChip}
            </div>
          </div>
          <svg class="ic sala-seta" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
        </button>
      `;
    }).join('');
  }
  if (html === estado.htmlSalas) return;
  estado.htmlSalas = html;
  $id('lista-salas').innerHTML = html;
}

export async function abrirSala(id) {
  if (estado.abrindoSala) return;
  estado.abrindoSala = true;
  limparErro('erro-salas');

  try {
    const sala = estado.salasAtuais.find((x) => x.id === id);

    if (sala && sala.sou_jogador) {
      pararSalas();
      const entrou = await conectarNaSala({ id }, 'erro-salas');
      if (!entrou && $id('tela-salas').classList.contains('ativa')) {
        carregarSalas();
        estado.temporizadorSalas = setInterval(carregarSalas, 4000);
      }
      return;
    }

    const resp = await banco.from('partidas').select('*').eq('id', id).maybeSingle();
    if (resp.error) {
      mostrarErro('erro-salas', 'Não consegui abrir a sala. Confira a internet.');
      return;
    }
    if (!resp.data || resp.data.encerrada) {
      aviso('Essa sala não existe mais.');
      carregarSalas();
      return;
    }
    pararSalas();
    await conectarNaSala(resp.data, 'erro-salas');
  } finally {
    estado.abrindoSala = false;
  }
}

export function abrirCriar() {
  limparErro('erro-criar');
  $id('criar-nome-sala').value = 'Sala do ' + estado.minhaConta.nome;
  mostrar('tela-criar');
}

export async function criarSala() {
  limparErro('erro-criar');

  const nomeSala = ($id('criar-nome-sala').value || '').trim().replace(/\s+/g, ' ');
  const saldo = parseInt($id('campo-saldo').value);
  const small = parseInt($id('campo-small').value);
  const big = parseInt($id('campo-big').value);

  if (!(saldo > 0) || !(small > 0) || !(big > 0)) {
    mostrarErro('erro-criar', 'Saldo e blinds precisam ser números maiores que zero.');
    return;
  }
  if (big <= small) {
    mostrarErro('erro-criar', 'O big blind precisa ser maior que o small blind.');
    return;
  }

  const botao = $id('botao-criar');
  botao.disabled = true;
  botao.textContent = 'Criando...';

  const cfg = obterConfigOnline('');
  const resp = cfg.modo === 'online'
    ? await banco.rpc('criar_sala_online', Object.assign({}, contaParams(), {
        p_saldo: saldo,
        p_small: small,
        p_big: big,
        p_tempo_turno: cfg.tempoTurno,
        p_subir_blinds_min: cfg.subirBlindsMin,
        p_nome: nomeSala || null
      }))
    : await banco.rpc('criar_sala', Object.assign({}, contaParams(), {
        p_saldo: saldo,
        p_small: small,
        p_big: big,
        p_nome: nomeSala || null
      }));

  if (resp.error) {
    if (!tratarErroConta(resp.error)) mostrarErro('erro-criar', resp.error.message);
  } else {
    const dados = resp.data;
    guardarMeuJogador(estado.minhaConta.id, dados.partida_id, dados.jogador_id, dados.segredo);
    await registrarRealCriacao('', dados.partida_id, saldo, dados.jogador_id, dados.segredo);
    await abrirMesa({ id: dados.partida_id });
  }

  botao.disabled = false;
  botao.textContent = 'Criar e ir para a mesa';
}

export async function conectarNaSala(partida, idDoErro) {
  let resp;
  try {
    resp = await banco.rpc('entrar_sala', Object.assign({}, contaParams(), { p_partida_id: partida.id }));
  } catch (erro) {
    resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  }

  if (resp.error) {
    if (!tratarErroConta(resp.error)) mostrarErro(idDoErro, resp.error.message);
    return false;
  }

  const reconectou = !!resp.data.reconectado;
  guardarMeuJogador(estado.minhaConta.id, partida.id, resp.data.jogador_id, resp.data.segredo);
  await abrirMesa(partida);

  if (reconectou) {
    const eu = estado.jogadoresAtuais.find((j) => j.id === estado.meuJogadorId);
    if (eu) aviso('Bem-vindo de volta, ' + eu.nome + '! Você tem ' + eu.saldo + ' fichas.');
  }
  return true;
}

export async function entrarComoJogador() {
  limparErro('erro-escolha');
  const botao = $id('botao-jogar');
  botao.disabled = true;
  botao.textContent = 'Entrando...';
  await conectarNaSala(estado.partidaAtual, 'erro-escolha');
  botao.disabled = false;
  botao.textContent = 'Entrar como jogador';
}
