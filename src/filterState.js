// filterState.js — Estado global compartilhado e sistema de pub/sub entre os gráficos.
//
// Padrão arquitetural: Observer (pub/sub).
// Cada gráfico se registra como ouvinte (onFilterChange) para as chaves que lhe interessam.
// Quando o usuário interage com um filtro, updateFilter() notifica apenas os ouvintes daquela
// chave — evitando re-renders desnecessários nos gráficos que não dependem do valor alterado.

export const filterState = {
  year: 2021,            // Ano de referência para o mapa (Gráfico 1)
  country: "ALL",        // ISO3 do País A, ou "ALL" para média global (Gráficos 2 e 3)
  product: "Wheat flour",// Commodity alimentar selecionada (Gráficos 1, 2, 4)
  yearStart: 2015,       // Início do intervalo temporal selecionado pelo brush do Gráfico 2
  yearEnd: 2026,         // Fim do intervalo — alimenta os Gráficos 3 e 4
  countryB: null,        // ISO3 do País B clicado no mapa — usado exclusivamente pelo Gráfico 4
};

// Mapa interno: chave do filterState → lista de callbacks registrados para ela.
// Cada chamada a onFilterChange() empurra um novo callback na lista da chave.
const _listeners = new Map();

/**
 * Atualiza campos do filterState e notifica apenas os ouvintes das chaves alteradas.
 *
 * O Set `notified` impede que um mesmo callback seja chamado duas vezes quando
 * o chamador altera múltiplas chaves que têm o mesmo ouvinte registrado
 * (ex.: updateFilter({ yearStart: 2019, yearEnd: 2022 }) notifica Gráficos 3 e 4
 *  apenas uma vez, mesmo que ambas as chaves tenham o mesmo callback).
 */
export function updateFilter(updates) {
  Object.assign(filterState, updates);

  const keys = Object.keys(updates);
  const notified = new Set();

  const notify = (fn) => {
    if (!notified.has(fn)) {
      notified.add(fn);
      fn(filterState);
    }
  };

  keys.forEach((k) => (_listeners.get(k) || []).forEach(notify));
  // Listeners registrados em "*" recebem qualquer alteração (uso genérico).
  (_listeners.get("*") || []).forEach(notify);
}

/**
 * Registra um callback para ser chamado quando qualquer das chaves listadas for alterada.
 *
 * Uso típico nos gráficos:
 *   onFilterChange(["year", "product"], () => render());
 *
 * A função é chamada com o filterState atualizado, mas geralmente os gráficos leem
 * o estado diretamente de filterState ao invés de usar o argumento, pois as queries
 * SQL são construídas a partir do estado completo.
 */
export function onFilterChange(keys, fn) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  keyList.forEach((k) => {
    if (!_listeners.has(k)) _listeners.set(k, []);
    _listeners.get(k).push(fn);
  });
}
