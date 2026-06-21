// Estado global compartilhado entre todos os gráficos.
// Todos os campos são ISO3 (ex: 'COL', 'UKR') ou 'ALL'.
export const filterState = {
  year: 2021,
  country: "ALL",    // País A: filtro principal (gráficos 2 e 3)
  product: "Wheat",  // Commodity selecionada (gráficos 1, 2, 4)
  yearStart: 2015,   // Início do intervalo selecionado pelo brush
  yearEnd: 2026,     // Fim do intervalo selecionado pelo brush
  countryB: null,    // País B: clicado no mapa (gráfico 4)
};

const _listeners = new Map();

/**
 * Atualiza um ou mais campos do filterState e notifica listeners.
 * @param {Object} updates - ex: { year: 2022 } ou { yearStart: 2019, yearEnd: 2022 }
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
  (_listeners.get("*") || []).forEach(notify);
}

/**
 * Registra uma função de callback para ser chamada quando qualquer
 * dos keys listados for alterado via updateFilter.
 * @param {string|string[]} keys - 'year', ['year','product'], ou '*' (qualquer)
 * @param {Function} fn - (filterState) => void
 */
export function onFilterChange(keys, fn) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  keyList.forEach((k) => {
    if (!_listeners.has(k)) _listeners.set(k, []);
    _listeners.get(k).push(fn);
  });
}
