import { executeQuery } from "./dataLoader.js";
import { filterState, onFilterChange } from "./filterState.js";
import { getName } from "./countryNames.js";

// Commodities non-food de interesse — exibidas por padrão
const NON_FOOD_COMMODITIES = [
  "Fuel (petrol-gasoline)",
  "Fuel (diesel)",
  "Fertilizer (urea)",
  "Fertilizer (NPK)",
  "Fuel (kerosene)",
];

// Paleta fixa por commodity
const COMMODITY_COLORS = {
  "Fuel (petrol-gasoline)": "#e63946",
  "Fuel (diesel)":          "#457b9d",
  "Fertilizer (urea)":      "#2a9d8f",
  "Fertilizer (NPK)":       "#e9c46a",
  "Fuel (kerosene)":        "#6d4c41",
};

// Marcos históricos
const CRISES = [
  { year: 2019, label: "COVID-19" },
  { year: 2021, label: "Guerra UKR" },
  { year: 2022, label: "Crise energética" },
  { year: 2026, label: "Estreito de Ormuz" },
];

async function loadData() {
  const { country, yearStart, yearEnd } = filterState;
  const cf = country === "ALL" ? "" : `AND countryiso3 = '${country}'`;
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

  const margin = { top: 35, right: 170, bottom: 50, left: 75 };
  const totalW = svg.node().getBoundingClientRect().width || 600;
  const containerH = svg.node().clientHeight || 380; // read height from CSS-sized container
  const W = Math.max(200, totalW - margin.left - margin.right);
  const availableH = Math.max(120, containerH - margin.top - margin.bottom);
  const H = availableH;

  // set svg to container height so it fits the card without overflow
  svg.attr("width", totalW).attr("height", containerH);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Agrupar por commodity
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

  // Grade
  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(yScale).ticks(5).tickSize(-W).tickFormat(""))
    .call((gg) => gg.select(".domain").remove())
    .selectAll("line").style("stroke", "#f0f0f0");

  // Anotações
  CRISES.forEach((c) => {
    const [y0, y1] = xScale.domain();
    if (c.year < y0 || c.year > y1) return;
    const cx = xScale(c.year);
    g.append("line")
      .attr("x1", cx).attr("x2", cx)
      .attr("y1", 0).attr("y2", H)
      .attr("stroke", "#aaa").attr("stroke-dasharray", "4,3").attr("stroke-width", 1).attr("opacity", 0.6);
    // position label with a safety margin from the right edge to avoid overlapping legend
    const labelPadding = 6;
    const maxLabelX = W - 60;
    let labelX = cx + labelPadding;
    if (labelX > maxLabelX) labelX = cx - 60; // shift left if too close to right edge
    g.append("text")
      .attr("x", labelX).attr("y", 12)
      .style("font-size", "9px").style("fill", "#999").text(c.label);
  });

  // Destaque do ano selecionado
  const selYear = filterState.year;
  const [dy0, dy1] = xScale.domain();
  if (selYear >= dy0 && selYear <= dy1) {
    g.append("rect")
      .attr("x", xScale(selYear) - 6).attr("y", 0)
      .attr("width", 12).attr("height", H)
      .attr("fill", "#e63946").attr("opacity", 0.08);
  }

  // Eixos
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

  // Tooltip
  const tooltip = d3.select("body").selectAll(".tooltip-nonfood").data([null]).join("div")
    .attr("class", "tooltip-nonfood")
    .style("position", "absolute").style("padding", "9px 12px")
    .style("background", "#fff").style("border", "1px solid #ccc")
    .style("border-radius", "6px").style("font-size", "13px")
    .style("pointer-events", "none").style("opacity", 0)
    .style("box-shadow", "0 4px 10px rgba(0,0,0,.12)");

  const line = d3.line().x((d) => xScale(d.year)).y((d) => yScale(+d.avg_price)).curve(d3.curveMonotoneX);

  // Linha + pontos por commodity
  byComm.forEach((points, comm) => {
    const col = COMMODITY_COLORS[comm] || "#888";
    g.append("path").datum(points)
      .attr("fill", "none").attr("stroke", col).attr("stroke-width", 2)
      .attr("d", line);

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

  // Legenda lateral — posicionada dentro do margin.right
  const legendX = W + 12;
  const shortNames = {
    "Fuel (petrol-gasoline)": "Gasolina",
    "Fuel (diesel)":          "Diesel",
    "Fertilizer (urea)":      "Ureia",
    "Fertilizer (NPK)":       "Fert. NPK",
    "Fuel (kerosene)":        "Querosene",
  };
  NON_FOOD_COMMODITIES.forEach((comm, i) => {
    if (!byComm.has(comm)) return;
    const col = COMMODITY_COLORS[comm] || "#888";
    const ly = i * 24;
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

export async function grafico3() {
  await render();
  onFilterChange(["country", "yearStart", "yearEnd", "year"], async () => await render());
}
