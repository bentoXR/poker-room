// Registro de modos de jogo ('presencial' agora; pronto para plugar 'online' sem refatorar a mesa)
// Cada modo implementa os ganchos específicos do seu tipo de partida:
//   - desenharBoard(partida, jogadores)
//   - desenharFaixa(partida, jogadores, ctx)
//   - desenharCriador(partida, jogadores, ctx)
//   - aoSairDaMesa()

const modos = {};

export function registrarModo(nome, impl) {
  modos[nome] = impl;
}

export function obterModo(nome) {
  return modos[nome] || modos.presencial || null;
}
