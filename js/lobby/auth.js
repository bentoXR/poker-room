// Autenticação de conta (nome único, senha protegida, criação com confirmação e sessão)
import { banco, SUPABASE_URL, SUPABASE_KEY } from '../core/supabase.js?v=107';
import { estado, limparCachesMesa, invalidarListaSalas } from '../core/estado.js?v=107';
import { guardarConta, esquecerConta, esquecerPartida, esquecerDevSala, lembrarNome, lerNome } from '../core/storage.js?v=107';
import { $id, aviso, mostrar, mostrarErro, limparErro, confirmarDialogo } from '../core/ui.js?v=120';
import { desligarTempoReal } from '../core/realtime.js?v=119';
import { limparTodosModos } from '../mesa/modos.js?v=107';
import { t } from '../core/i18n.js?v=110';

const TURNSTILE_SITEKEY = '0x4AAAAAAGTtapFQALjkyBX8';
let turnstileWidgetId = null;
let turnstileToken = '';
let turnstileActionAtual = 'guest';
let timerEsperaTurnstile = null;

function temaTurnstileAtual() {
  const tAtual = document.documentElement.getAttribute('data-tema');
  return tAtual === 'claro' ? 'light' : 'dark';
}

function resetarTurnstile() {
  turnstileToken = '';
  try {
    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
    }
  } catch (erro) {}
}

function renderizarTurnstile(action) {
  const alvoAction = action === 'signup' ? 'signup' : 'guest';
  turnstileActionAtual = alvoAction;
  const box = $id('turnstile-box');
  if (!box) return;

  if (!window.turnstile) {
    if (!timerEsperaTurnstile) {
      let tentativas = 0;
      timerEsperaTurnstile = setInterval(() => {
        tentativas += 1;
        if (window.turnstile || tentativas >= 60) {
          clearInterval(timerEsperaTurnstile);
          timerEsperaTurnstile = null;
          if (window.turnstile) renderizarTurnstile(turnstileActionAtual);
        }
      }, 150);
    }
    return;
  }

  if (turnstileWidgetId !== null) {
    try { window.turnstile.remove(turnstileWidgetId); } catch (erro) {}
    turnstileWidgetId = null;
    turnstileToken = '';
  }

  try {
    turnstileWidgetId = window.turnstile.render(box, {
      sitekey: TURNSTILE_SITEKEY,
      action: alvoAction,
      theme: temaTurnstileAtual(),
      appearance: 'interaction-only',
      callback: (tok) => { turnstileToken = tok || ''; },
      'expired-callback': () => { turnstileToken = ''; },
      'error-callback': () => { turnstileToken = ''; }
    });
  } catch (erro) {
    turnstileWidgetId = null;
  }
}

async function obterTokenTurnstile(action, timeoutMs = 5000) {
  if (turnstileActionAtual !== action || turnstileWidgetId === null) {
    renderizarTurnstile(action);
  }
  const lerResp = () => {
    if (turnstileToken) return turnstileToken;
    try {
      if (window.turnstile && turnstileWidgetId !== null && window.turnstile.getResponse) {
        const r = window.turnstile.getResponse(turnstileWidgetId);
        if (r) { turnstileToken = r; return r; }
      }
    } catch (erro) {}
    return '';
  };

  let tok = lerResp();
  if (tok) return tok;

  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    await new Promise((r) => setTimeout(r, 120));
    tok = lerResp();
    if (tok) return tok;
  }
  return '';
}

export function aoCarregarTurnstile() {
  renderizarTurnstile(modoLoginAtual === 'criar' ? 'signup' : 'guest');
}
window.aoCarregarTurnstile = aoCarregarTurnstile;

async function chamarTurnstileAuth(rpc, payload) {
  const token = turnstileToken;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/turnstile-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY
      },
      body: JSON.stringify(Object.assign({ rpc, turnstile_token: token }, payload || {}))
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: { message: data.message || data.error || 'Falha na verificação de segurança.' } };
    }
    return { data };
  } catch (erro) {
    return { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  } finally {
    resetarTurnstile();
  }
}

let modoLoginAtual = 'entrar';
let hooksAuth = {
  abrirSalas: () => {},
  pararSalas: () => {},
  onLogout: () => {},
  onPosLogin: () => {}
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
  if (lblNome) lblNome.textContent = t(ehCriar ? 'login.escolha_nome' : 'login.seu_nome');

  const campoNome = $id('campo-login-nome');
  if (campoNome) {
    campoNome.maxLength = ehCriar ? 10 : 20;
    campoNome.placeholder = t(ehCriar ? 'login.ph_nome_criar' : 'login.ph_nome_entrar');
    if (ehCriar && campoNome.value.length > 10) campoNome.value = campoNome.value.slice(0, 10);
  }

  const campoSenha = $id('campo-login-senha');
  if (campoSenha) campoSenha.placeholder = t(ehCriar ? 'login.ph_senha_criar' : 'login.ph_senha_entrar');

  const btn = $id('botao-login');
  if (btn) {
    btn.textContent = t(ehCriar ? 'login.btn_criar' : 'login.btn_entrar');
    btn.classList.toggle('secundario', !ehCriar);
  }

  const dica = $id('dica-login');
  if (dica) {
    dica.innerHTML = t(ehCriar ? 'login.dica_criar' : 'login.dica_entrar');
  }

  const btnGuest = $id('botao-convidado');
  if (btnGuest) btnGuest.hidden = ehCriar;

  renderizarTurnstile(ehCriar ? 'signup' : 'guest');
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
  if (ehCriar && nome.length > 10) {
    mostrarErro('erro-login', 'O nome pode ter no máximo 10 caracteres.');
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
    botao.textContent = t(ehCriar ? 'login.criando' : 'login.entrando');
  }

  let resp;
  try {
    if (ehCriar) {
      const tok = await obterTokenTurnstile('signup');
      if (!tok) {
        resp = { error: { message: 'Confirme a verificação de segurança (desative bloqueadores se necessário) e tente novamente.' } };
      } else {
        resp = await chamarTurnstileAuth('criar_conta', { p_nome: nome, p_senha: senha });
      }
    } else {
      resp = await banco.rpc(funcao, { p_nome: nome, p_senha: senha });
    }
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
      avatar_versao: Number(resp.data.avatar_versao) || 0,
      convidado: !!resp.data.convidado
    };
    guardarConta(estado.minhaConta);
    lembrarNome(estado.minhaConta.nome);
    $id('campo-login-senha').value = '';
    const confEl = $id('campo-login-senha-conf');
    if (confEl) confEl.value = '';
    hooksAuth.abrirSalas();
    hooksAuth.onPosLogin();
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

export async function entrarComoConvidado() {
  limparErro('erro-login');
  const campoNome = $id('campo-login-nome');
  const nomeDigitado = campoNome ? (campoNome.value || '').trim().replace(/\s+/g, ' ').slice(0, 10) : '';

  const btnGuest = $id('botao-convidado');
  const btnLogin = $id('botao-login');
  const txtOriginal = btnGuest ? btnGuest.textContent : '';
  if (btnGuest) {
    btnGuest.disabled = true;
    btnGuest.textContent = t('login.entrando_convidado');
  }
  if (btnLogin) btnLogin.disabled = true;

  let resp;
  try {
    const tok = await obterTokenTurnstile('guest');
    if (!tok) {
      resp = { error: { message: 'Confirme a verificação de segurança (desative bloqueadores se necessário) e tente novamente.' } };
    } else {
      resp = await chamarTurnstileAuth('criar_conta_convidado', { p_nome: nomeDigitado.length >= 2 ? nomeDigitado : null });
    }
  } catch (erro) {
    resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  }

  if (btnGuest) {
    btnGuest.disabled = false;
    btnGuest.textContent = txtOriginal;
  }
  if (btnLogin) btnLogin.disabled = false;

  if (resp.error) {
    mostrarErro('erro-login', resp.error.message);
    return;
  }

  estado.minhaConta = {
    id: resp.data.conta_id,
    token: resp.data.token,
    nome: resp.data.nome,
    avatar_url: resp.data.avatar_url || null,
    avatar_versao: Number(resp.data.avatar_versao) || 0,
    convidado: true
  };
  guardarConta(estado.minhaConta);
  lembrarNome(estado.minhaConta.nome);
  const sEl = $id('campo-login-senha');
  if (sEl) sEl.value = '';
  const confEl = $id('campo-login-senha-conf');
  if (confEl) confEl.value = '';
  hooksAuth.abrirSalas();
  hooksAuth.onPosLogin();
}

export async function sairDaConta() {
  if (estado.minhaConta && estado.minhaConta.convidado) {
    const ok = await confirmarDialogo({
      titulo: 'Sair da conta Convidado?',
      mensagem: 'Você está em uma conta Convidado (sem senha). Se sair agora, não poderá entrar nela novamente nem recuperar as fichas salvas nas salas. Deseja sair mesmo assim?',
      textoConfirmar: 'Sair mesmo assim',
      perigo: true
    });
    if (!ok) return;
  }
  encerrarSessaoLocal();
}

export function encerrarSessaoLocal() {
  desligarTempoReal();
  hooksAuth.pararSalas();
  hooksAuth.onLogout();
  limparTodosModos();

  estado.partidaAtual = null;
  estado.meuJogadorId = null;
  estado.meuSegredo = null;
  estado.jogadoresAtuais = [];
  estado.ultimoEstado = null;
  estado.relogio.ini = null;
  estado.relogio.vez = null;
  limparCachesMesa();
  invalidarListaSalas();
  esquecerPartida();
  esquecerDevSala();
  estado.modoDev = false;
  esquecerConta();
  estado.minhaConta = null;
  const btnDev = $id('btn-sala-dev');
  if (btnDev) btnDev.hidden = true;

  $id('campo-login-nome').value = lerNome();
  $id('campo-login-senha').value = '';
  const confEl = $id('campo-login-senha-conf');
  if (confEl) confEl.value = '';
  escolherModoLogin('entrar');
  limparErro('erro-login');
  mostrar('tela-login');
}
