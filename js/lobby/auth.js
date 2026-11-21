// Autenticação de conta (um nome e uma senha para todas as salas e modos)
import { banco } from '../core/supabase.js?v=13';
import { estado, limparCachesMesa } from '../core/estado.js?v=13';
import { guardarConta, esquecerConta, esquecerPartida, lembrarNome, lerNome } from '../core/storage.js?v=13';
import { $id, aviso, mostrar, mostrarErro, limparErro } from '../core/ui.js?v=13';
import { desligarTempoReal } from '../core/realtime.js?v=13';
import { obterModo } from '../mesa/modos.js?v=13';

let hooksAuth = {
  abrirSalas: () => {},
  pararSalas: () => {}
};

export function registrarHooksAuth(hooks) {
  hooksAuth = Object.assign(hooksAuth, hooks);
}

export function tratarErroConta(erro) {
  if (erro && /Sessão inválida/.test(erro.message || '')) {
    aviso('Sua sessão expirou. Entre de novo.');
    encerrarSessaoLocal();
    return true;
  }
  return false;
}

async function entrarNaConta(funcao) {
  limparErro('erro-login');

  const nome = $id('campo-login-nome').value.trim();
  const senha = $id('campo-login-senha').value.trim();
  if (!nome) { mostrarErro('erro-login', 'Digite seu nome.'); return; }
  if (senha.length < 3) { mostrarErro('erro-login', 'A senha precisa ter pelo menos 3 caracteres.'); return; }

  const botoes = [$id('botao-login'), $id('botao-criar-conta')];
  botoes.forEach((b) => { b.disabled = true; });

  let resp;
  try {
    resp = await banco.rpc(funcao, { p_nome: nome, p_senha: senha });
  } catch (erro) {
    resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  }

  if (resp.error) {
    mostrarErro('erro-login', resp.error.message);
  } else {
    estado.minhaConta = { id: resp.data.conta_id, token: resp.data.token, nome: resp.data.nome };
    guardarConta(estado.minhaConta);
    lembrarNome(estado.minhaConta.nome);
    $id('campo-login-senha').value = '';
    hooksAuth.abrirSalas();
  }

  botoes.forEach((b) => { b.disabled = false; });
}

export function fazerLogin() { return entrarNaConta('login_conta'); }
export function criarConta() { return entrarNaConta('criar_conta'); }
export function sairDaConta() { encerrarSessaoLocal(); }

export function encerrarSessaoLocal() {
  desligarTempoReal();
  hooksAuth.pararSalas();
  const modo = obterModo(estado.modoAtual);
  if (modo && modo.aoSairDaMesa) modo.aoSairDaMesa();

  estado.partidaAtual = null;
  estado.meuJogadorId = null;
  estado.meuSegredo = null;
  limparCachesMesa();
  estado.salasAtuais = [];
  estado.htmlSalas = '';
  esquecerPartida();
  estado.modoDev = false;
  esquecerConta();
  estado.minhaConta = null;

  $id('campo-login-nome').value = lerNome();
  $id('campo-login-senha').value = '';
  limparErro('erro-login');
  mostrar('tela-login');
}
