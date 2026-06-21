// Normalizes usdprice to price per base unit (per kg for weight, per L for liquid).
// Fixes the composition bias from countries reporting in different units:
//   e.g. Syria (MT=1000kg → $493-1716), Ethiopia (100KG → $56-70), most countries (KG → $0.40).
// Without normalization, the global AVG swings wildly as the mix of reporting countries changes.
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
