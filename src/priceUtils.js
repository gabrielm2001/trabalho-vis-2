// priceUtils.js — Normalização de usdprice para preço por unidade base (kg, L, etc.).
//
// Problema: o campo usdprice do WFP armazena o preço na unidade original de cada país.
// Países diferentes usam unidades diferentes para o mesmo produto:
//   - Síria (SYR): Wheat em MT (tonelada métrica) → usdprice ≈ $493–1716
//   - Etiópia (ETH): Wheat em 100 KG → usdprice ≈ $56–70
//   - Maioria: Wheat em KG → usdprice ≈ $0.40–1.00
//
// Calcular AVG(usdprice) sem normalização produz médias globais sem sentido:
// a Síria entrava e saía do dataset causando variação de $120 (2019) → $5 (2021),
// obscurecendo a tendência real de alta pós-COVID.
//
// Solução: CASE WHEN em SQL que converte tudo para preço por kg (ou por L para líquidos).
// Padrões como "% KG" e "% G" são extraídos com split_part() + TRY_CAST() do DuckDB,
// o que permite normalizar automaticamente variantes como "100 KG", "2.5 KG", "500 G"
// sem listar cada unidade individualmente.
// NULLIF(..., 0) previne divisão por zero caso split_part retorne um valor inválido.
// Unidades não reconhecidas (Unit, Head, Piece) retornam usdprice sem alteração,
// pois dentro de uma única commodity elas são consistentes entre países.

export const UNIT_NORM_SQL = `
  CASE
    WHEN unit = 'KG'         THEN usdprice
    WHEN unit = 'MT'         THEN usdprice / 1000.0
    WHEN unit = 'L'          THEN usdprice
    WHEN unit = 'Pound'      THEN usdprice / 0.453592
    WHEN unit = 'Libra'      THEN usdprice / 0.453592
    WHEN unit = '100 Pounds' THEN usdprice / 45.3592
    WHEN unit LIKE '% KG'    THEN usdprice / NULLIF(TRY_CAST(split_part(unit, ' ', 1) AS DOUBLE), 0)
    WHEN unit LIKE '% G'     THEN usdprice / (NULLIF(TRY_CAST(split_part(unit, ' ', 1) AS DOUBLE), 0) / 1000.0)
    WHEN unit LIKE '% L'     THEN usdprice / NULLIF(TRY_CAST(split_part(unit, ' ', 1) AS DOUBLE), 0)
    ELSE usdprice
  END
`.trim();
