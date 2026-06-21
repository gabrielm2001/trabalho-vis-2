import { executeQuery } from "./dataLoader.js";
import { filterState, updateFilter, onFilterChange } from "./filterState.js";
import { UNIT_NORM_SQL } from "./priceUtils.js";

let _geoData = null;

async function loadData() {
  const { year, product } = filterState;
  const safe = product.replace(/'/g, "''");
  const result = await executeQuery(`
    WITH norm AS (
      SELECT countryiso3, unit,
             (${UNIT_NORM_SQL}) AS norm_price
      FROM wfp
      WHERE CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) = ${year}
        AND commodity = '${safe}'
        AND usdprice > 0
    )
    SELECT countryiso3,
           ROUND(AVG(norm_price), 4)  AS avg_price,
           MAX(unit)                   AS unit,
           CAST(COUNT(*) AS INTEGER)   AS records
    FROM norm
    WHERE norm_price IS NOT NULL AND norm_price > 0
    GROUP BY countryiso3
  `);
  return result;
}

async function renderMap() {
  if (!_geoData) return;

  const container = d3.select("#worldmap");
  let svg = container.select("svg");
  if (svg.empty()) {
    svg = container.append("svg").style("width", "100%").style("height", "500px").style("display", "block");
  }
  svg.selectAll("*").remove();

  const width = svg.node().clientWidth || 900;
  const height = svg.node().clientHeight || 500;

  const projection = d3.geoMercator().fitSize([width, height], _geoData);
  const path = d3.geoPath().projection(projection);

  const rows = await loadData();

  const priceMap = new Map();
  const unitMap = new Map();
  rows.forEach((r) => {
    if (r.countryiso3) {
      priceMap.set(r.countryiso3.trim(), +r.avg_price);
      unitMap.set(r.countryiso3.trim(), r.unit || "");
    }
  });

  const vals = Array.from(priceMap.values()).filter((v) => v > 0);

  if (!vals.length) {
    svg.append("text")
      .attr("x", (svg.node().clientWidth || 900) / 2)
      .attr("y", (svg.node().clientHeight || 500) / 2)
      .attr("text-anchor", "middle")
      .style("font-size", "15px")
      .style("fill", "#999")
      .text(`Sem dados para "${filterState.product}" no ano ${filterState.year} — tente outro produto ou ano.`);

    // Renderiza o mapa em cinza mesmo assim
    svg.selectAll("path").data(_geoData.features).join("path")
      .attr("d", d3.geoPath().projection(d3.geoMercator().fitSize(
        [svg.node().clientWidth || 900, svg.node().clientHeight || 500], _geoData)))
      .attr("fill", "#e8e8e8").attr("stroke", "#ccc").attr("stroke-width", 0.4);
    return;
  }

  const [minP, maxP] = d3.extent(vals);
  const color = d3.scaleSequential(d3.interpolateGreens).domain([minP, maxP * 1.1]);

  const tooltip = d3.select("body").selectAll(".tooltip-map").data([null]).join("div")
    .attr("class", "tooltip-map")
    .style("position", "absolute")
    .style("padding", "8px 12px")
    .style("background", "#fff")
    .style("border", "1px solid #ccc")
    .style("border-radius", "6px")
    .style("font-size", "13px")
    .style("pointer-events", "none")
    .style("opacity", 0)
    .style("box-shadow", "0 2px 8px rgba(0,0,0,.15)");

  svg.selectAll("path")
    .data(_geoData.features)
    .join("path")
    .attr("d", path)
    .attr("fill", (d) => {
      const v = priceMap.get(d.id);
      return v !== undefined ? color(v) : "#e8e8e8";
    })
    .attr("stroke", (d) => (filterState.countryB === d.id ? "#e63946" : "#ccc"))
    .attr("stroke-width", (d) => (filterState.countryB === d.id ? 2.5 : 0.4))
    .on("mouseover", function (event, d) {
      const v = priceMap.get(d.id);
      if (v === undefined) return;
      d3.select(this).attr("stroke", "#333").attr("stroke-width", 1.5);
      const name = d.properties?.name || d.properties?.ADMIN || d.id;
      const unit = unitMap.get(d.id);
      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${name}</strong><br>Preço médio: <strong>USD ${v.toFixed(3)}</strong> / ${unit}<br><small>Clique para comparar no Gráfico 4</small>`
        )
        .style("left", `${event.pageX + 15}px`)
        .style("top", `${event.pageY - 20}px`);
    })
    .on("mousemove", (event) => {
      tooltip.style("left", `${event.pageX + 15}px`).style("top", `${event.pageY - 20}px`);
    })
    .on("mouseout", function (event, d) {
      d3.select(this)
        .attr("stroke", filterState.countryB === d.id ? "#e63946" : "#ccc")
        .attr("stroke-width", filterState.countryB === d.id ? 2.5 : 0.4);
      tooltip.style("opacity", 0);
    })
    .on("click", function (event, d) {
      const v = priceMap.get(d.id);
      if (v === undefined) return;
      const name = d.properties?.name || d.properties?.ADMIN || d.id;
      d3.select("#selected-country-label").text(
        `País B selecionado: ${name} (${d.id}) — USD ${v.toFixed(3)} / ${unitMap.get(d.id) || "un"}`
      );
      updateFilter({ countryB: d.id });

      // Detalhes on demand
      showDetails({
        pais: name,
        iso: d.id,
        produto: filterState.product,
        preco: `USD ${v.toFixed(4)}`,
        unidade: unitMap.get(d.id) || "—",
        ano: filterState.year,
      });
    });

  // Legenda
  const legendWidth = 180;
  const legendHeight = 10;
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", "mapGrad")
    .attr("x1", "0%").attr("x2", "100%").attr("y1", "0%").attr("y2", "0%");
  d3.range(0, 1.01, 0.1).forEach((s) => {
    grad.append("stop").attr("offset", `${s * 100}%`)
      .attr("stop-color", color(minP + s * (maxP - minP)));
  });

  const lx = Math.max(10, width - legendWidth - 20);
  const ly = height - 45;

  svg.append("rect").attr("x", lx).attr("y", ly)
    .attr("width", legendWidth).attr("height", legendHeight)
    .style("fill", "url(#mapGrad)").style("stroke", "#ccc");

  const lScale = d3.scaleLinear().domain([minP, maxP]).range([0, legendWidth]);
  svg.append("g").attr("transform", `translate(${lx},${ly + legendHeight})`)
    .call(d3.axisBottom(lScale).ticks(4).tickFormat((v) => `$${v.toFixed(2)}`))
    .selectAll("text").style("font-size", "10px");

  svg.append("text").attr("x", lx).attr("y", ly - 5)
    .text(`USD/kg equiv. — ${filterState.product} (${filterState.year})`)
    .style("font-size", "11px").style("fill", "#444");
}

function showDetails(info) {
  const panel = document.getElementById("details-panel");
  const content = document.getElementById("details-content");
  panel.style.display = "block";
  content.innerHTML = `
    <table class="details-table">
      <tr><th>País</th><td>${info.pais}</td></tr>
      <tr><th>ISO3</th><td>${info.iso}</td></tr>
      <tr><th>Produto</th><td>${info.produto}</td></tr>
      <tr><th>Preço médio</th><td>${info.preco}</td></tr>
      <tr><th>Unidade</th><td>${info.unidade}</td></tr>
      <tr><th>Ano</th><td>${info.ano}</td></tr>
    </table>`;
}

export async function grafico1(geoData) {
  _geoData = geoData;
  await renderMap();
  onFilterChange(["year", "product"], async () => await renderMap());
  onFilterChange(["countryB"], async () => await renderMap());
}
