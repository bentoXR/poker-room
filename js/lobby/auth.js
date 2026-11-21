// Autenticação de conta (nome único, senha protegida, criação com confirmação e sessão)
import { banco } from '../core/supabase.js?v=23';
import { estado, limparCachesMesa } from '../core/estado.js?v=23';
import { guardarConta, esquecerConta, esquecerPartida, lembrarNome, lerNome } from '../core/storage.js?v=23';
import { $id, aviso, mostrar, mostrarErro, limparErro } from '../core/ui.js?v=23';
import { desligarTempoReal } from '../core/realtime.js?v=23';
import { obterModo } from '../mesa/modos.js?v=23';

let modoLoginAtual = 'entrar';
let hooksAuth = {
  abrirSalas: () => {},
  pararSalas: () => {},
  onLogout: () => {}
};

export function registrarHooksAuth(hooks) {
  hooksAuth = Object.assign(hooksAuth, hooks);
}

export function escolherModoLogin(modo) {
  modoLoginAtual = modo === 'criar' ? 'criar' : 'entrar';
  const ehCriar = modoLoginAtual === 'criar';
  limparErro('erro-login');

  document.querySelectorAll('.auth-aba[data-auth]').forEach((b) => {
    const sel = b.dataset.auth === modoLoginAtual;
    b.classList.toggle('sel', sel);
    b.setAttribute('aria-selected', sel ? 'true' : 'false');
  });

  const grpConf = $id('grupo-confirmar-senha');
  if (grpConf) grpConf.hidden = !ehCriar;

  const lblNome = $id('lbl-login-nome');
  if (lblNome) lblNome.textContent = ehCriar ? 'Escolha um nome único' : 'Seu nome';

  const campoSenha = $id('campo-login-senha');
  if (campoSenha) campoSenha.placeholder = ehCriar ? 'Mínimo 6 caracteres' : 'Digite sua senha';

  const btn = $id('botao-login');
  if (btn) btn.textContent = ehCriar ? 'Criar minha conta' : 'Entrar';

  const dica = $id('dica-login');
  if (dica) {
    dica.innerHTML = ehCriar
      ? 'Seu <strong>nome é único</strong> e sua senha fica criptografada. Você poderá adicionar <strong>foto de perfil</strong> logo em seguida.'
      : 'Use o mesmo <strong>nome</strong> e <strong>senha</strong> sempre que voltar. Ainda não tem? Toque em <strong>Criar conta</strong>.';
  }
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

  const nome = ($id('campo-login-nome').value || '').trim().replace(/\s+/g, ' ');
  const senha = ($id('campo-login-senha').value || '').trim();
  const ehCriar = funcao === 'criar_conta';

  if (nome.length < 2) {
    mostrarErro('erro-login', 'Digite um nome com pelo menos 2 caracteres.');
    return;
  }
  if (ehCriar) {
    if (senha.length < 6) {
      mostrarErro('erro-login', 'A senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    const conf = ($id('campo-login-senha-conf').value || '').trim();
    if (senha !== conf) {
      mostrarErro('erro-login', 'As senhas não conferem. Confira e tente novamente.');
      return;
    }
  } else if (senha.length < 3) {
    mostrarErro('erro-login', 'Digite sua senha.');
    return;
  }

  const botao = $id('botao-login');
  const textoOriginal = botao ? botao.textContent : '';
  if (botao) {
    botao.disabled = true;
    botao.textContent = ehCriar ? 'Criando conta...' : 'Entrando...';
  }

  let resp;
  try {
    resp = await banco.rpc(funcao, { p_nome: nome, p_senha: senha });
  } catch (erro) {
    resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  }

  if (resp.error) {
    mostrarErro('erro-login', resp.error.message);
  } else {
    estado.minhaConta = {
      id: resp.data.conta_id,
      token: resp.data.token,
      nome: resp.data.nome,
      avatar_url: resp.data.avatar_url || null,
      avatar_versao: Number(resp.data.avatar_versao) || 0
    };
    guardarConta(estado.minhaConta);
    lembrarNome(estado.minhaConta.nome);
    $id('campo-login-senha').value = '';
    const confEl = $id('campo-login-senha-conf');
    if (confEl) confEl.value = '';
    hooksAuth.abrirSalas();
  }

  if (botao) {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

export function enviarAuth() {
  return entrarNaConta(modoLoginAtual === 'criar' ? 'criar_conta' : 'login_conta');
}
export function fazerLogin() { return entrarNaConta('login_conta'); }
export function criarConta() { return entrarNaConta('criar_conta'); }
export function sairDaConta() { encerrarSessaoLocal(); }

export function encerrarSessaoLocal() {
  desligarTempoReal();
  hooksAuth.pararSalas();
  hooksAuth.onLogout();
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
  const confEl = $id('campo-login-senha-conf');
  if (confEl) confEl.value = '';
  escolherModoLogin('entrar');
  limparErro('erro-login');
  mostrar('tela-login');
}
