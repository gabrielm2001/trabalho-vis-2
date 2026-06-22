// grafico3.js — Gráfico multi-linha: combustíveis e insumos agrícolas (Gráfico 3).
//
// Exibe a evolução anual de 5 commodities "non-food" que afetam diretamente o custo
// de produção e transporte de alimentos. Filtrado pelo intervalo selecionado no brush
// do Gráfico 2 (yearStart/yearEnd) e pelo País A.
//
// Uma linha por commodity, com cor fixa. A legenda fica dentro do margin.right
// para não ocupar espaço adicional fora do SVG.
//
// Re-renderiza quando: country, yearStart, yearEnd ou year (para atualizar o destaque) mudam.

import { executeQuery } from "./dataLoader.js";
import { filterState, onFilterChange } from "./filterState.js";
import { getName } from "./countryNames.js";

// Commodities non-food exibidas por padrão.
// Escolhidas por representar os principais vetores de custo: gasolina (transporte),
// diesel (logística e maquinário), querosene (cocção), ureia e NPK (fertilizantes).
const NON_FOOD_COMMODITIES = [
  "Fuel (petrol-gasoline)",
  "Fuel (diesel)",
  "Fertilizer (urea)",
  "Fertilizer (NPK)",
  "Fuel (kerosene)",
];

// Paleta fixa por commodity: cores escolhidas para serem distinguíveis entre si
// mesmo em condições de daltonismo parcial (vermelho + azul + teal + amarelo + marrom).
const COMMODITY_COLORS = {
  "Fuel (petrol-gasoline)": "#e63946",
  "Fuel (diesel)":          "#457b9d",
  "Fertilizer (urea)":      "#2a9d8f",
  "Fertilizer (NPK)":       "#e9c46a",
  "Fuel (kerosene)":        "#6d4c41",
};

// Crises históricas contextuais (as mesmas do Gráfico 2 para consistência visual).
const CRISES = [
  { year: 2019, label: "COVID-19" },
  { year: 2021, label: "Guerra UKR" },
  { year: 2022, label: "Crise energética" },
  { year: 2026, label: "Estreito de Ormuz" },
];

/**
 * Query única que retorna todas as commodities de uma vez (não uma por commodity).
 * O GROUP BY (commodity, year) produz uma linha por par, que depois é agrupada
 * em JS via d3.group() para alimentar as linhas individuais.
 *
 * Nota: Gráfico 3 NÃO normaliza por unidade (UNIT_NORM_SQL não é usado aqui)
 * porque combustíveis e fertilizantes usam unidades consistentes por país,
 * e a comparação relativa de tendências é mais relevante que o valor absoluto.
 */
async function loadData() {
  const { country, yearStart, yearEnd } = filterState;
  const cf = country === "ALL" ? "" : `AND countryiso3 = '${country}'`;
  // Lista de commodities escapada para interpolação segura em SQL
  const list = NON_FOOD_COMMODITIES.map((c) => `'${c.replace(/'/g, "''")}'`).join(", ");
  return await executeQuery(`
    SELECT commodity,
           CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) AS year,
           ROUND(AVG(usdprice), 4)    AS avg_price,
           MAX(unit)                  AS unit,
           CAST(COUNT(*) AS INTEGER)   AS records
    FROM wfp
    WHERE category = 'non-food'
      AND commodity IN (${list})
      ${cf}
      AND usdprice > 0
      AND CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) BETWEEN ${yearStart} AND ${yearEnd}
    GROUP BY commodity, year
    ORDER BY commodity, year
  `);
}

async function render() {
  const raw = await loadData();
  const svg = d3.select("#chart3 svg");
  svg.selectAll("*").remove();

  // margin.right = 170px: espaço reservado para a legenda lateral (dentro do SVG),
  // evitando que ela vaze fora do elemento ou sobreponha as linhas.
  const margin = { top: 35, right: 170, bottom: 50, left: 75 };
  const totalW = svg.node().getBoundingClientRect().width || 600;
  const W = Math.max(200, totalW - margin.left - margin.right);
  const H = 380 - margin.top - margin.bottom;

  svg.attr("width", totalW).attr("height", H + margin.top + margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // d3.group() transforma o array flat em um Map<commodity, rows[]>,
  // que é percorrido para desenhar uma linha por commodity.
  const byComm = d3.group(raw, (d) => d.commodity);

  if (!raw.length) {
    g.append("text").attr("x", W / 2).attr("y", H / 2)
      .attr("text-anchor", "middle").style("fill", "#aaa")
      .text("Sem dados non-food para o país/período selecionado");
    return;
  }

  const allYears = raw.map((d) => d.year);
  const xScale = d3.scaleLinear().domain(d3.extent(allYears)).range([0, W]);
  const yScale = d3.scaleLinear()
    .domain([0, d3.max(raw, (d) => +d.avg_price) * 1.12])
    .nice().range([H, 0]);

  // Grade horizontal com o mesmo padrão do Gráfico 2
  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(yScale).ticks(5).tickSize(-W).tickFormat(""))
    .call((gg) => gg.select(".domain").remove())
    .selectAll("line").style("stroke", "#f0f0f0");

  // Anotações de crise — exibidas apenas se o ano cair dentro do domínio atual
  CRISES.forEach((c) => {
    const [y0, y1] = xScale.domain();
    if (c.year < y0 || c.year > y1) return;
    g.append("line")
      .attr("x1", xScale(c.year)).attr("x2", xScale(c.year))
      .attr("y1", 0).attr("y2", H)
      .attr("stroke", "#aaa").attr("stroke-dasharray", "4,3").attr("stroke-width", 1).attr("opacity", 0.6);
    g.append("text")
      .attr("x", xScale(c.year) + 4).attr("y", 12)
      .style("font-size", "9px").style("fill", "#999").text(c.label);
  });

  // Faixa vertical semitransparente destacando o ano selecionado no filterState.
  // Correlaciona visualmente com o ponto vermelho do Gráfico 2.
  const selYear = filterState.year;
  const [dy0, dy1] = xScale.domain();
  if (selYear >= dy0 && selYear <= dy1) {
    g.append("rect")
      .attr("x", xScale(selYear) - 6).attr("y", 0)
      .attr("width", 12).attr("height", H)
      .attr("fill", "#e63946").attr("opacity", 0.08);
  }

  g.append("g").attr("transform", `translate(0,${H})`)
    .call(d3.axisBottom(xScale).tickFormat(d3.format("d")));
  g.append("g").call(d3.axisLeft(yScale).tickFormat((v) => `$${v}`));

  g.append("text").attr("transform", "rotate(-90)")
    .attr("y", -margin.left + 15).attr("x", -H / 2)
    .attr("dy", "1em").style("text-anchor", "middle").style("font-size", "12px")
    .text("Preço Médio (USD)");
  g.append("text")
    .attr("transform", `translate(${W / 2},${H + margin.bottom - 6})`)
    .style("text-anchor", "middle").style("font-size", "12px").text("Ano");

  // Tooltip reutilizável (padrão .data([null]).join)
  const tooltip = d3.select("body").selectAll(".tooltip-nonfood").data([null]).join("div")
    .attr("class", "tooltip-nonfood")
    .style("position", "absolute").style("padding", "9px 12px")
    .style("background", "#fff").style("border", "1px solid #ccc")
    .style("border-radius", "6px").style("font-size", "13px")
    .style("pointer-events", "none").style("opacity", 0)
    .style("box-shadow", "0 4px 10px rgba(0,0,0,.12)");

  const line = d3.line().x((d) => xScale(d.year)).y((d) => yScale(+d.avg_price)).curve(d3.curveMonotoneX);

  // Itera sobre o Map de commodities — cada entrada é (commodity, points[])
  byComm.forEach((points, comm) => {
    const col = COMMODITY_COLORS[comm] || "#888";

    // path para a linha da commodity usando .datum() (dados únicos, não array de joins)
    g.append("path").datum(points)
      .attr("fill", "none").attr("stroke", col).attr("stroke-width", 2)
      .attr("d", line);

    // selectAll(null) como seletor vazio garante que circles de commodities diferentes
    // não colidam entre si no namespace de seleção do D3
    g.selectAll(null).data(points).enter().append("circle")
      .attr("cx", (d) => xScale(d.year))
      .attr("cy", (d) => yScale(+d.avg_price))
      .attr("r", 4)
      .attr("fill", col).attr("stroke", "#fff").attr("stroke-width", 1)
      .style("cursor", "pointer")
      .on("mouseover", function (event, d) {
        d3.select(this).attr("r", 6);
        tooltip.style("opacity", 1)
          .html(
            `<strong>${d.commodity}</strong><br>
             Ano: <strong>${d.year}</strong>${d.year === selYear ? " <span style='color:#e63946'>◀</span>" : ""}<br>
             Preço médio: <strong>USD ${(+d.avg_price).toFixed(4)}</strong> / ${d.unit || "—"}<br>
             Registros: ${d.records?.toLocaleString()}`
          )
          .style("left", `${event.pageX + 14}px`)
          .style("top", `${event.pageY - 36}px`);
      })
      .on("mousemove", (event) => {
        tooltip.style("left", `${event.pageX + 14}px`).style("top", `${event.pageY - 36}px`);
      })
      .on("mouseout", function () {
        d3.select(this).attr("r", 4);
        tooltip.style("opacity", 0);
      })
      .on("click", (event, d) => {
        const panel = document.getElementById("details-panel");
        const content = document.getElementById("details-content");
        panel.style.display = "block";
        content.innerHTML = `
          <table class="details-table">
            <tr><th>Commodity</th><td>${d.commodity}</td></tr>
            <tr><th>Categoria</th><td>non-food</td></tr>
            <tr><th>Ano</th><td>${d.year}</td></tr>
            <tr><th>País</th><td>${filterState.country === "ALL" ? "Todos" : getName(filterState.country)}</td></tr>
            <tr><th>Preço médio (USD)</th><td>$${(+d.avg_price).toFixed(4)}</td></tr>
            <tr><th>Unidade</th><td>${d.unit || "—"}</td></tr>
            <tr><th>Registros</th><td>${d.records?.toLocaleString()}</td></tr>
          </table>`;
      });
  });

  // Legenda lateral dentro do margin.right para não ampliar o SVG.
  // legendX = W + 12px (12px de afastamento da área de plotagem).
  // Nomes curtos evitam que a legenda exceda os 170px do margin.right.
  const legendX = W + 12;
  const shortNames = {
    "Fuel (petrol-gasoline)": "Gasolina",
    "Fuel (diesel)":          "Diesel",
    "Fertilizer (urea)":      "Ureia",
    "Fertilizer (NPK)":       "Fert. NPK",
    "Fuel (kerosene)":        "Querosene",
  };
  // Usa a ordem de NON_FOOD_COMMODITIES (não a do Map) para manter a legenda estável
  NON_FOOD_COMMODITIES.forEach((comm, i) => {
    if (!byComm.has(comm)) return; // Pula commodities sem dados no período
    const col = COMMODITY_COLORS[comm] || "#888";
    const ly = i * 24;
    // Mini-linha + círculo como ícone da legenda, replicando o visual do gráfico
    g.append("line")
      .attr("x1", legendX).attr("x2", legendX + 14)
      .attr("y1", ly + 2).attr("y2", ly + 2)
      .attr("stroke", col).attr("stroke-width", 3);
    g.append("circle").attr("cx", legendX + 7).attr("cy", ly + 2).attr("r", 4).attr("fill", col);
    g.append("text").attr("x", legendX + 20).attr("y", ly + 6)
      .style("font-size", "11px").style("fill", "#333")
      .text(shortNames[comm] || comm);
  });
}

/**
 * Ponto de entrada do Gráfico 3.
 * Ouve country e yearStart/yearEnd (definidos pelo brush do Gráfico 2)
 * e year (para atualizar o destaque da faixa vertical sem re-query necessária —
 * re-renderiza mesmo assim por simplicidade).
 */
export async function grafico3() {
  await render();
  onFilterChange(["country", "yearStart", "yearEnd", "year"], async () => await render());
}
