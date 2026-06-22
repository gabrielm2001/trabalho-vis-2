// grafico2.js — Gráfico de linha: evolução temporal do preço de alimentos (Gráfico 2).
//
// Exibe o preço médio anual normalizado (USD/kg equiv.) do produto selecionado,
// filtrado opcionalmente por país. Anotações verticais marcam crises históricas.
//
// Interações:
//   - Hover nos pontos → tooltip com preço e número de registros
//   - Clique em ponto → define o ano no filterState (destaca o ponto e atualiza Gráfico 1)
//                      → abre painel de detalhes
//   - Brush horizontal → seleciona um intervalo de anos que filtra os Gráficos 3 e 4
//
// Re-renderiza quando: year, country ou product mudam.

import { executeQuery } from "./dataLoader.js";
import { filterState, updateFilter, onFilterChange } from "./filterState.js";
import { getName } from "./countryNames.js";
import { UNIT_NORM_SQL } from "./priceUtils.js";

const TIME_DOMAIN = [2015, 2026];
const TIME_TICKS = d3.range(2015, 2027);

async function loadData() {
  const { country, product } = filterState;
  const safe = product.replace(/'/g, "''");
  const cf = country === "ALL" ? "" : `AND countryiso3 = '${country}'`;
  return await executeQuery(`
    WITH norm AS (
      SELECT CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) AS year,
             unit,
             (${UNIT_NORM_SQL}) AS norm_price
      FROM wfp
      WHERE category NOT IN ('non-food')
        AND commodity = '${safe}'
        ${cf}
        AND usdprice > 0
    )
    SELECT year,
           ROUND(AVG(norm_price), 4)  AS avg_price,
           CAST(COUNT(*) AS INTEGER)   AS records,
           'kg equiv.'                 AS unit
    FROM norm
    WHERE norm_price IS NOT NULL AND norm_price > 0
    GROUP BY year
    ORDER BY year
  `);
}

/** Preenche o painel "Detalhes do Ponto Selecionado" ao clicar em um ponto da linha. */
function showDetails(d) {
  const panel = document.getElementById("details-panel");
  const content = document.getElementById("details-content");
  panel.style.display = "block";
  content.innerHTML = `
    <table class="details-table">
      <tr><th>Ano</th><td>${d.year}</td></tr>
      <tr><th>Produto</th><td>${filterState.product}</td></tr>
      <tr><th>País</th><td>${filterState.country === "ALL" ? "Todos" : getName(filterState.country)}</td></tr>
      <tr><th>Preço médio (USD)</th><td>$${(+d.avg_price).toFixed(4)}</td></tr>
      <tr><th>Unidade</th><td>${d.unit || "—"}</td></tr>
      <tr><th>Registros</th><td>${d.records?.toLocaleString()}</td></tr>
    </table>`;
}

// Crises históricas como anotações verticais no gráfico.
// Usadas tanto aqui quanto no Gráfico 3 para contextualizar picos de preço.
const CRISES = [
  { year: 2019, label: "COVID-19 (início)" },
  { year: 2021, label: "Pós-COVID / Guerra UKR" },
  { year: 2022, label: "Crise energética" },
  { year: 2026, label: "Tensões Oriente Médio" },
];

async function render() {
  const data = await loadData();
  const svg = d3.select("#chart2 svg");
  // Limpa todo o SVG antes de redesenhar — abordagem "clear and redraw"
  // adequada pois os dados mudam completamente a cada filtro alterado.
  svg.selectAll("*").remove();

  // Convenção de margens do D3: margin define o espaço para eixos ao redor
  // da área de plotagem. O grupo <g> é transladado por (left, top) para que
  // coordenadas [0, W] x [0, H] correspondam exatamente à área de dados.
  const margin = { top: 30, right: 40, bottom: 50, left: 75 };
  const totalW = svg.node().getBoundingClientRect().width || 800;
  const W = totalW - margin.left - margin.right;
  const H = 360 - margin.top - margin.bottom;

  svg.attr("width", totalW).attr("height", H + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  if (!data.length) {
    g.append("text").attr("x", W / 2).attr("y", H / 2)
      .attr("text-anchor", "middle").style("fill", "#aaa")
      .text("Sem dados para o produto/país selecionado");
    return;
  }

  const xScale = d3.scaleLinear().domain(TIME_DOMAIN).range([0, W]);
  const yScale = d3.scaleLinear()
    .domain([0, d3.max(data, (d) => +d.avg_price) * 1.12])
    .nice().range([H, 0]);

  // Grade horizontal: eixo esquerdo com tickSize negativo estende as marcas
  // por toda a largura do gráfico, criando linhas de grade sem código extra.
  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(yScale).ticks(5).tickSize(-W).tickFormat(""))
    .call((gg) => gg.select(".domain").remove()) // remove a linha do eixo, mantendo só as grades
    .selectAll("line").style("stroke", "#f0f0f0");

  // Anotações de crise
  const [yMin, yMax] = TIME_DOMAIN;
  CRISES.forEach((c) => {
    if (c.year < yMin || c.year > yMax) return;
    const isRightEdge = c.year >= yMax - 1;
    const labelX = isRightEdge ? xScale(c.year) - 4 : xScale(c.year) + 4;
    g.append("line")
      .attr("x1", xScale(c.year)).attr("x2", xScale(c.year))
      .attr("y1", 0).attr("y2", H)
      .attr("stroke", "#e63946").attr("stroke-dasharray", "4,3")
      .attr("stroke-width", 1).attr("opacity", 0.5);
    g.append("text")
      .attr("x", labelX).attr("y", 13)
      .attr("text-anchor", isRightEdge ? "end" : "start")
      .style("font-size", "9px").style("fill", "#e63946").style("opacity", 0.75)
      .text(c.label);
  });

  // Eixos: format("d") exibe anos sem vírgula de milhar (2021, não 2,021)
  g.append("g").attr("transform", `translate(0,${H})`)
    .call(
      d3.axisBottom(xScale)
        .tickValues(TIME_TICKS)
        .tickFormat(d3.format("d"))
    ).attr("class", "x-axis");
  g.append("g").call(d3.axisLeft(yScale).tickFormat((v) => `$${v}`)).attr("class", "y-axis");

  // Label do eixo Y rotacionado: transform rotate(-90) + translate para centralizar
  g.append("text").attr("transform", "rotate(-90)")
    .attr("y", -margin.left + 15).attr("x", -H / 2)
    .attr("dy", "1em").style("text-anchor", "middle").style("font-size", "12px")
    .text("Preço Médio (USD / kg equiv.)");
  g.append("text")
    .attr("transform", `translate(${W / 2},${H + margin.bottom - 6})`)
    .style("text-anchor", "middle").style("font-size", "12px").text("Ano");

  // curveMonotoneX preserva monotonicidade local entre pontos consecutivos,
  // produzindo uma curva suave que não oscila para cima/baixo de forma artificial
  // em regiões com poucos dados — mais fiel à tendência real do que curveCardinal.
  const line = d3.line().x((d) => xScale(d.year)).y((d) => yScale(+d.avg_price)).curve(d3.curveMonotoneX);
  g.append("path").datum(data)
    .attr("fill", "none").attr("stroke", "#2d7d2d").attr("stroke-width", 2.5)
    .attr("class", "food-line").attr("d", line);

  // Tooltip: .data([null]).join("div") garante um único elemento no DOM,
  // reutilizado em todos os eventos — evita criar N divs ao re-renderizar.
  const tooltip = d3.select("body").selectAll(".tooltip-food").data([null]).join("div")
    .attr("class", "tooltip-food")
    .style("position", "absolute").style("padding", "10px 13px")
    .style("background", "#fff").style("border", "1px solid #ccc")
    .style("border-radius", "6px").style("font-size", "13px")
    .style("pointer-events", "none").style("opacity", 0)
    .style("box-shadow", "0 4px 10px rgba(0,0,0,.12)");

  // Pontos interativos: .enter().append() (não .join()) pois os dados não mudam
  // durante a vida dos elementos — a re-renderização completa (clear + redraw) já
  // garante consistência entre dados e DOM.
  g.selectAll(".dot").data(data).enter().append("circle")
    .attr("class", "dot")
    .attr("cx", (d) => xScale(d.year))
    .attr("cy", (d) => yScale(+d.avg_price))
    .attr("r", 5)
    // Ponto do ano selecionado é vermelho para correlacionar com o mapa (Gráfico 1)
    .attr("fill", (d) => (Number(d.year) === filterState.year ? "#e63946" : "#2d7d2d"))
    .attr("stroke", "#fff").attr("stroke-width", 1.5)
    .style("cursor", "pointer")
    .on("mouseover", function (event, d) {
      d3.select(this).attr("r", 7).attr("fill", "#e8a838");
      tooltip.style("opacity", 1)
        .html(
          `<strong>${d.year}</strong>${Number(d.year) === filterState.year ? " <span style='color:#e63946'>◀ selecionado</span>" : ""}<br>
           Preço médio: <strong>USD ${(+d.avg_price).toFixed(4)}</strong><br>
           Unidade: ${d.unit || "—"} &nbsp;|&nbsp; Registros: ${d.records?.toLocaleString()}`
        )
        .style("left", `${event.pageX + 12}px`)
        .style("top", `${event.pageY - 36}px`);
    })
    .on("mousemove", (event) => {
      tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY - 36}px`);
    })
    .on("mouseout", function (event, d) {
      // Restaura a cor correta (vermelho se é o ano selecionado, verde caso contrário)
      d3.select(this).attr("r", 5).attr("fill", Number(d.year) === filterState.year ? "#e63946" : "#2d7d2d");
      tooltip.style("opacity", 0);
    })
    .on("click", (event, d) => {
      showDetails(d);
      // Propaga o novo ano para o filterState → Gráfico 1 atualiza o mapa para esse ano
      updateFilter({ year: Number(d.year) });
    });


}

/**
 * Ponto de entrada do Gráfico 2.
 * Ouve year (para destacar o ponto correto), country e product (para re-query).
 * Não ouve yearStart/yearEnd pois o brush é quem os define — ouvir criaria um ciclo.
 */
export async function grafico2() {
  await render();
  onFilterChange(["year", "country", "product"], async () => await render());
}
