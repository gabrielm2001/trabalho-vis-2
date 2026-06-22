// grafico4.js — Dumbbell plot: comparativo de preços País A vs País B (Gráfico 4).
//
// Cada linha horizontal representa um ano. Dois círculos conectados por uma linha
// mostram o preço médio do produto selecionado para dois países:
//   - Círculo verde (#2d7d2d) → País A (selecionado no dropdown de filtros)
//   - Círculo laranja (#e8a838) → País B (selecionado clicando no mapa)
//
// O gap (Δ$) entre os círculos é exibido acima da linha conectora.
//
// Dumbbell foi escolhido sobre barras agrupadas porque compara uma única métrica
// (preço) entre dois sujeitos ao longo de múltiplos anos — o gap entre os círculos
// é imediatamente legível sem necessidade de decoding de barras lado a lado.
//
// Re-renderiza quando: countryB, country, product, yearStart ou yearEnd mudam.

import { executeQuery } from "./dataLoader.js";
import { filterState, onFilterChange } from "./filterState.js";
import { getName } from "./countryNames.js";
import { UNIT_NORM_SQL } from "./priceUtils.js";

/**
 * Carrega dados de preços normalizados para País A e País B em paralelo.
 * Retorna null se countryB ainda não foi selecionado (estado inicial).
 *
 * País A pode ser "ALL" (média global) ou um país específico — a query
 * correspondente é selecionada condicionalmente para evitar a cláusula AND
 * desnecessária em caso global.
 *
 * As queries usam CTE (WITH norm AS ...) para normalizar as unidades antes
 * de agregar, garantindo comparabilidade entre países com unidades diferentes.
 * Promise.all() executa as duas queries em paralelo — o DuckDB-WASM suporta
 * concorrência dentro da mesma conexão via filas internas.
 */
async function loadData() {
  const { country, countryB, product, yearStart, yearEnd } = filterState;
  if (!countryB) return null;

  const safe = product.replace(/'/g, "''");
  const cA = country === "ALL" ? null : country;

  // WHERE base compartilhado pelas queries A e B para evitar repetição
  const baseWhere = `commodity = '${safe}' AND usdprice > 0
    AND CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) BETWEEN ${yearStart} AND ${yearEnd}`;

  // Query A: país específico ou média global (sem filtro de país)
  const queryA = cA
    ? `WITH norm AS (SELECT CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) AS year,
                           (${UNIT_NORM_SQL}) AS norm_price
                    FROM wfp WHERE ${baseWhere} AND countryiso3 = '${cA}')
       SELECT year, ROUND(AVG(norm_price),4) AS avg_price, 'kg equiv.' AS unit
       FROM norm WHERE norm_price IS NOT NULL AND norm_price > 0 GROUP BY year ORDER BY year`
    : `WITH norm AS (SELECT CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) AS year,
                           (${UNIT_NORM_SQL}) AS norm_price
                    FROM wfp WHERE ${baseWhere})
       SELECT year, ROUND(AVG(norm_price),4) AS avg_price, 'kg equiv.' AS unit
       FROM norm WHERE norm_price IS NOT NULL AND norm_price > 0 GROUP BY year ORDER BY year`;

  // Query B: sempre para um país específico (countryB vem do clique no mapa)
  const queryB =
    `WITH norm AS (SELECT CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) AS year,
                         (${UNIT_NORM_SQL}) AS norm_price
                  FROM wfp WHERE ${baseWhere} AND countryiso3 = '${countryB}')
     SELECT year, ROUND(AVG(norm_price),4) AS avg_price, 'kg equiv.' AS unit
     FROM norm WHERE norm_price IS NOT NULL AND norm_price > 0 GROUP BY year ORDER BY year`;

  const [rowsA, rowsB] = await Promise.all([executeQuery(queryA), executeQuery(queryB)]);
  return { rowsA, rowsB };
}

async function render() {
  const svg = d3.select("#chart4 svg");
  svg.selectAll("*").remove();

  const { country, countryB, product, yearStart, yearEnd } = filterState;

  // Estado inicial: País B ainda não foi selecionado no mapa
  if (!countryB) {
    const W = svg.node().getBoundingClientRect().width || 400;
    svg.attr("width", W).attr("height", 200);
    svg.append("text").attr("x", W / 2).attr("y", 100)
      .attr("text-anchor", "middle").style("fill", "#aaa").style("font-size", "14px")
      .text("Clique em um país no mapa para comparar");
    return;
  }

  const res = await loadData();
  if (!res) return;

  const { rowsA, rowsB } = res;

  // Transforma os arrays em Maps para lookup O(1) por ano durante a renderização
  const mapA = new Map(rowsA.map((r) => [r.year, +r.avg_price]));
  const mapB = new Map(rowsB.map((r) => [r.year, +r.avg_price]));
  const unitA = rowsA[0]?.unit || "";
  const unitB = rowsB[0]?.unit || "";

  // União dos anos presentes em A e/ou B — um país pode ter dados em anos que o outro não tem
  const years = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort((a, b) => a - b);
  const dumbData = years.map((y) => ({
    year: y,
    priceA: mapA.get(y) ?? null,
    priceB: mapB.get(y) ?? null,
  })).filter((d) => d.priceA !== null || d.priceB !== null);

  if (!dumbData.length) {
    const W = svg.node().getBoundingClientRect().width || 400;
    svg.attr("width", W).attr("height", 200);
    svg.append("text").attr("x", W / 2).attr("y", 100)
      .attr("text-anchor", "middle").style("fill", "#aaa").style("font-size", "13px")
      .text(`Sem dados de '${product}' para os países selecionados`);
    return;
  }

  const margin = { top: 30, right: 30, bottom: 50, left: 80 };
  const totalW = svg.node().getBoundingClientRect().width || 480;
  const W = totalW - margin.left - margin.right;

  // Altura calculada dinamicamente: cada linha de ano ocupa rowH pixels.
  // Dumbbell cresce verticalmente com o número de anos — diferente dos outros
  // gráficos que têm altura fixa.
  const rowH = 38;
  const H = dumbData.length * rowH;

  svg.attr("width", totalW).attr("height", H + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const allPrices = dumbData.flatMap((d) => [d.priceA, d.priceB].filter((v) => v !== null));
  const [pMin, pMax] = d3.extent(allPrices);

  // Escala X: domínio expandido 15% abaixo do mínimo e 12% acima do máximo
  // para que os círculos extremos não toquem as bordas do gráfico.
  const xScale = d3.scaleLinear().domain([Math.max(0, pMin * 0.85), pMax * 1.12]).range([0, W]);

  // scaleBand organiza os anos como faixas horizontais de largura uniforme.
  // bandwidth() retorna a altura de cada faixa; metade dela é usada para centralizar
  // os círculos verticalmente dentro da faixa.
  // padding(0.3) adiciona 30% de espaço entre as faixas para legibilidade.
  const yScale = d3.scaleBand().domain(dumbData.map((d) => d.year)).range([0, H]).padding(0.3);

  // Rótulos legíveis dos países (nomes completos via getName())
  const labelA = country === "ALL" ? "Média Global" : getName(country);
  const labelB = getName(countryB);

  // Eixo X: formato de moeda; eixo Y: anos como inteiros (sem vírgula de milhar)
  g.append("g").attr("transform", `translate(0,${H})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat((v) => `$${v.toFixed(2)}`));
  g.append("g").call(d3.axisLeft(yScale).tickFormat(d3.format("d")));

  g.append("text")
    .attr("transform", `translate(${W / 2},${H + margin.bottom - 6})`)
    .style("text-anchor", "middle").style("font-size", "12px")
    .text(`Preço médio USD — ${product} (${unitA || unitB})`);

  // Tooltip único reutilizado (padrão .data([null]).join)
  const tooltip = d3.select("body").selectAll(".tooltip-dumbbell").data([null]).join("div")
    .attr("class", "tooltip-dumbbell")
    .style("position", "absolute").style("padding", "9px 13px")
    .style("background", "#fff").style("border", "1px solid #ccc")
    .style("border-radius", "6px").style("font-size", "13px")
    .style("pointer-events", "none").style("opacity", 0)
    .style("box-shadow", "0 4px 10px rgba(0,0,0,.12)");

  // Renderiza um dumbbell por ano — linha conectora + dois círculos + label de gap
  dumbData.forEach((d) => {
    // cy: centro vertical da faixa do ano (yScale + metade do bandwidth)
    const cy = (yScale(d.year) || 0) + yScale.bandwidth() / 2;
    const xA = d.priceA !== null ? xScale(d.priceA) : null;
    const xB = d.priceB !== null ? xScale(d.priceB) : null;

    // Linha conectora — só desenhada quando ambos os países têm dado para o ano
    if (xA !== null && xB !== null) {
      g.append("line")
        .attr("x1", xA).attr("x2", xB).attr("y1", cy).attr("y2", cy)
        .attr("stroke", "#ccc").attr("stroke-width", 2);
    }

    // Círculo País A (verde)
    if (xA !== null) {
      g.append("circle")
        .attr("cx", xA).attr("cy", cy).attr("r", 7)
        .attr("fill", "#2d7d2d").attr("stroke", "#fff").attr("stroke-width", 1.5)
        .style("cursor", "pointer")
        .on("mouseover", (event) => {
          tooltip.style("opacity", 1)
            .html(`<strong>${labelA}</strong> (${d.year})<br>USD ${d.priceA?.toFixed(4)} / ${unitA || "—"}`)
            .style("left", `${event.pageX + 12}px`).style("top", `${event.pageY - 30}px`);
        })
        .on("mousemove", (event) => tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY - 30}px`))
        .on("mouseout", () => tooltip.style("opacity", 0));
    }

    // Círculo País B (laranja)
    if (xB !== null) {
      g.append("circle")
        .attr("cx", xB).attr("cy", cy).attr("r", 7)
        .attr("fill", "#e8a838").attr("stroke", "#fff").attr("stroke-width", 1.5)
        .style("cursor", "pointer")
        .on("mouseover", (event) => {
          tooltip.style("opacity", 1)
            .html(`<strong>${labelB}</strong> (${d.year})<br>USD ${d.priceB?.toFixed(4)} / ${unitB || "—"}`)
            .style("left", `${event.pageX + 12}px`).style("top", `${event.pageY - 30}px`);
        })
        .on("mousemove", (event) => tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY - 30}px`))
        .on("mouseout", () => tooltip.style("opacity", 0));
    }

    // Label Δ$ entre os dois círculos — posicionado no ponto médio da linha conectora
    if (xA !== null && xB !== null) {
      const gap = Math.abs(d.priceA - d.priceB);
      const midX = (xA + xB) / 2;
      g.append("text")
        .attr("x", midX).attr("y", cy - 10)
        .attr("text-anchor", "middle").style("font-size", "9px").style("fill", "#888")
        .text(`Δ$${gap.toFixed(2)}`);
    }
  });

  // Legenda acima dos dumbbells: dois itens lado a lado, um por metade da largura
  const legendY = -25;
  [
    { label: labelA, color: "#2d7d2d" },
    { label: labelB, color: "#e8a838" },
  ].forEach((l, i) => {
    const lx = i * (W / 2);
    g.append("circle").attr("cx", lx + 8).attr("cy", legendY).attr("r", 7).attr("fill", l.color);
    g.append("text").attr("x", lx + 20).attr("y", legendY + 4)
      .style("font-size", "12px").style("fill", "#333").text(l.label);
  });
}

/**
 * Ponto de entrada do Gráfico 4.
 * Ouve countryB (clique no mapa), country e product (dropdown de filtros)
 * e yearStart/yearEnd (brush do Gráfico 2) para refletir todos os filtros ativos.
 */
export async function grafico4() {
  await render();
  onFilterChange(["countryB", "country", "product", "yearStart", "yearEnd"], async () => await render());
}
