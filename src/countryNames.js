// countryNames.js — Mapa ISO3 → nome completo do país.
//
// Construído a partir do GeoJSON world.geojson já carregado na inicialização,
// evitando uma requisição extra ou um arquivo de mapeamento hardcoded.
// Todos os gráficos importam getName() para exibir nomes legíveis no lugar de códigos ISO3.

const isoToName = new Map();

/**
 * Popula o mapa a partir das features do GeoJSON.
 * Chamado uma única vez em main.js logo após o fetch do geojson,
 * antes de populateFilters() e da criação dos gráficos.
 *
 * A ordem de fallback (name → ADMIN → iso3) cobre diferentes variantes
 * de GeoJSON que usam propriedades distintas para o nome do país.
 */
export function populateCountryNames(geoData) {
  geoData.features.forEach((f) => {
    const iso3 = f.id;
    const name = f.properties?.name || f.properties?.ADMIN || iso3;
    if (iso3) isoToName.set(iso3, name);
  });
}

/**
 * Retorna o nome completo do país para um código ISO3.
 * Retorna "Todos os países" para o valor sentinela "ALL".
 * Retorna o próprio ISO3 como fallback quando o código não está no GeoJSON
 * (ex.: países do WFP que não têm polígono no mapa, como Kosovo — XKX).
 */
export function getName(iso3) {
  if (!iso3 || iso3 === "ALL") return "Todos os países";
  return isoToName.get(iso3) || iso3;
}
