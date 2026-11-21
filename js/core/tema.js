// Gerenciamento de tema visual ('azul' = Azul Royal | 'classico' = Cassino Verde/Preto/Vermelho)
const CHAVE_TEMA = 'poker-tema';
const CORES_META = {
  azul: '#0b1b3a',
  classico: '#0d1612'
};

export function lerTemaSalvo() {
  try {
    const salvo = localStorage.getItem(CHAVE_TEMA);
    return salvo === 'classico' ? 'classico' : 'azul';
  } catch (erro) {
    return 'azul';
  }
}

function aplicarTemaDOM(tema) {
  const ativo = tema === 'classico' ? 'classico' : 'azul';
  if (ativo === 'classico') document.documentElement.setAttribute('data-tema', 'classico');
  else document.documentElement.removeAttribute('data-tema');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', CORES_META[ativo]);

  document.querySelectorAll('.tema-btn[data-tema]').forEach((btn) => {
    const sel = btn.dataset.tema === ativo;
    btn.classList.toggle('sel', sel);
    btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
  });

  const btnTopo = document.getElementById('btn-tema-mesa');
  if (btnTopo) {
    btnTopo.title = ativo === 'classico'
      ? 'Tema: Cassino Verde (clique para trocar para Azul)'
      : 'Tema: Azul Royal (clique para trocar para Cassino Verde)';
  }
}

export function escolherTema(tema) {
  const ativo = tema === 'classico' ? 'classico' : 'azul';
  try { localStorage.setItem(CHAVE_TEMA, ativo); } catch (erro) {}
  aplicarTemaDOM(ativo);
}

export function alternarTema() {
  const atual = document.documentElement.getAttribute('data-tema') === 'classico' ? 'classico' : 'azul';
  escolherTema(atual === 'classico' ? 'azul' : 'classico');
}

export function iniciarTema() {
  aplicarTemaDOM(lerTemaSalvo());
}
