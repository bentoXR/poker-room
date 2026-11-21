// Persistência local (localStorage) — isolada por conta para evitar mistura no mesmo aparelho

const CHAVE_CONTA = 'poker-conta';
const CHAVE_PARTIDA = 'poker-partida-atual';
const CHAVE_NOME = 'poker-nome';
const CHAVE_DEV_SALA = 'poker-dev-sala';

export function chaveJogador(contaId, partidaId) {
  return 'poker-jogador-' + (contaId || 'x') + '-' + partidaId;
}

export function guardarMeuJogador(contaId, partidaId, jogadorId, segredo) {
  try {
    localStorage.setItem(chaveJogador(contaId, partidaId),
      JSON.stringify({ id: jogadorId, segredo: segredo }));
  } catch (erro) {}
}

export function lerMeuJogador(contaId, partidaId) {
  try {
    const texto = localStorage.getItem(chaveJogador(contaId, partidaId));
    if (!texto) return null;
    const dados = JSON.parse(texto);
    return (dados && dados.id && dados.segredo) ? dados : null;
  } catch (erro) {
    return null;
  }
}

export function esquecerSegredo(contaId, partidaId) {
  try { localStorage.removeItem(chaveJogador(contaId, partidaId)); } catch (erro) {}
}

export function lerContaSalva() {
  try {
    const texto = localStorage.getItem(CHAVE_CONTA);
    if (!texto) return null;
    const dados = JSON.parse(texto);
    return (dados && dados.id && dados.token && dados.nome) ? dados : null;
  } catch (erro) {
    return null;
  }
}

export function guardarConta(conta) {
  try { localStorage.setItem(CHAVE_CONTA, JSON.stringify(conta)); } catch (erro) {}
}

export function esquecerConta() {
  try { localStorage.removeItem(CHAVE_CONTA); } catch (erro) {}
}

export function guardarPartidaAtual(partidaId) {
  try { localStorage.setItem(CHAVE_PARTIDA, String(partidaId)); } catch (erro) {}
}

export function lerPartidaSalva() {
  try { return localStorage.getItem(CHAVE_PARTIDA) || null; } catch (erro) { return null; }
}

export function esquecerPartida() {
  try { localStorage.removeItem(CHAVE_PARTIDA); } catch (erro) {}
}

export function lembrarNome(nome) {
  try { localStorage.setItem(CHAVE_NOME, nome); } catch (erro) {}
}

export function lerNome() {
  try { return localStorage.getItem(CHAVE_NOME) || ''; } catch (erro) { return ''; }
}

export function lerDevSala() {
  try {
    const dados = JSON.parse(localStorage.getItem(CHAVE_DEV_SALA) || 'null');
    return (dados && dados.partida_id && dados.jogadores && dados.jogadores.length) ? dados : null;
  } catch (erro) {
    return null;
  }
}

export function salvarDevSala(dados) {
  try { localStorage.setItem(CHAVE_DEV_SALA, JSON.stringify(dados)); } catch (erro) {}
}

export function esquecerDevSala() {
  try { localStorage.removeItem(CHAVE_DEV_SALA); } catch (erro) {}
}
