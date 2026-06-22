import { executeQuery } from "./dataLoader.js";
import { filterState, onFilterChange } from "./filterState.js";
import { getName } from "./countryNames.js";
import { UNIT_NORM_SQL } from "./priceUtils.js";

async function loadData() {
  const { country, countryB, product, yearStart, yearEnd } = filterState;
  if (!countryB) return null;

  const safe = product.replace(/'/g, "''");
  const cA = country === "ALL" ? null : country;

  // Se país A for ALL, usamos a média global
  const baseWhere = `commodity = '${safe}' AND usdprice > 0
    AND CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) BETWEEN ${yearStart} AND ${yearEnd}`;

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

  if (!countryB) {
    const W = svg.node().clientWidth || 400;
    const containerH = svg.node().clientHeight || 200;
    svg.attr("width", W).attr("height", containerH);
    svg.append("text").attr("x", W / 2).attr("y", containerH / 2)
      .attr("text-anchor", "middle").style("fill", "#aaa").style("font-size", "14px")
      .text("Clique em um país no mapa para comparar");
    return;
  }

  const res = await loadData();
  if (!res) return;

  const { rowsA, rowsB } = res;

  // Unir por ano
  const mapA = new Map(rowsA.map((r) => [r.year, +r.avg_price]));
  const mapB = new Map(rowsB.map((r) => [r.year, +r.avg_price]));
  const unitA = rowsA[0]?.unit || "";
  const unitB = rowsB[0]?.unit || "";

  const years = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort((a, b) => a - b);
  const dumbData = years.map((y) => ({
    year: y,
    priceA: mapA.get(y) ?? null,
    priceB: mapB.get(y) ?? null,
  })).filter((d) => d.priceA !== null || d.priceB !== null);

  if (!dumbData.length) {
    const W = svg.node().clientWidth || 400;
    svg.attr("width", W).attr("height", 200);
    svg.append("text").attr("x", W / 2).attr("y", 100)
      .attr("text-anchor", "middle").style("fill", "#aaa").style("font-size", "13px")
      .text(`Sem dados de '${product}' para os países selecionados`);
    return;
  }

  const margin = { top: 30, right: 30, bottom: 50, left: 80 };
  const totalW = svg.node().getBoundingClientRect().width || 480;

  // determine container inner height more robustly (account for card padding and heading)
  const chartEl = svg.node().closest('.chart') || svg.node().parentNode;
  const chartRect = chartEl.getBoundingClientRect();
  const cs = window.getComputedStyle(chartEl);
  const paddingTop = parseFloat(cs.paddingTop) || 0;
  const paddingBottom = parseFloat(cs.paddingBottom) || 0;
  const header = svg.node().previousElementSibling;
  const headerRect = header ? header.getBoundingClientRect() : { height: 0 };
  const headerMarginBottom = header ? (parseFloat(window.getComputedStyle(header).marginBottom) || 0) : 0;

  const containerInnerH = Math.max(120, chartRect.height - paddingTop - paddingBottom - headerRect.height - headerMarginBottom);

  const W = totalW - margin.left - margin.right;
  // compute row height to fit all rows inside the available inner height
  const rowH = Math.max(20, Math.floor(containerInnerH / Math.max(1, dumbData.length)));
  const H = rowH * dumbData.length;

  // set svg size to match chart inner area (including margins)
  const svgHeight = Math.max(H + margin.top + margin.bottom, headerRect.height + paddingTop + paddingBottom + 60);
  svg.attr("width", totalW).attr("height", svgHeight).style("display", "block");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const allPrices = dumbData.flatMap((d) => [d.priceA, d.priceB].filter((v) => v !== null));
  const [pMin, pMax] = d3.extent(allPrices);
  const xScale = d3.scaleLinear().domain([Math.max(0, pMin * 0.85), pMax * 1.12]).range([0, W]);
  const yScale = d3.scaleBand().domain(dumbData.map((d) => d.year)).range([0, H]).padding(0.3);

  const labelA = country === "ALL" ? "Média Global" : getName(country);
  const labelB = getName(countryB);

  // Eixos
  g.append("g").attr("transform", `translate(0,${H})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat((v) => `$${v.toFixed(2)}`));
  g.append("g").call(d3.axisLeft(yScale).tickFormat(d3.format("d")));

  g.append("text")
    .attr("transform", `translate(${W / 2},${H + margin.bottom - 6})`)
    .style("text-anchor", "middle").style("font-size", "12px")
    .text(`Preço médio USD — ${product} (${unitA || unitB})`);

  // Tooltip
  const tooltip = d3.select("body").selectAll(".tooltip-dumbbell").data([null]).join("div")
    .attr("class", "tooltip-dumbbell")
    .style("position", "absolute").style("padding", "9px 13px")
    .style("background", "#fff").style("border", "1px solid #ccc")
    .style("border-radius", "6px").style("font-size", "13px")
    .style("pointer-events", "none").style("opacity", 0)
    .style("box-shadow", "0 4px 10px rgba(0,0,0,.12)");

  // Dumbbell por ano
  dumbData.forEach((d) => {
    const cy = (yScale(d.year) || 0) + yScale.bandwidth() / 2;
    const xA = d.priceA !== null ? xScale(d.priceA) : null;
    const xB = d.priceB !== null ? xScale(d.priceB) : null;

    // Linha conectora
    if (xA !== null && xB !== null) {
      g.append("line")
        .attr("x1", xA).attr("x2", xB).attr("y1", cy).attr("y2", cy)
        .attr("stroke", "#ccc").attr("stroke-width", 2);
    }

    // Dot País A (verde)
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

    // Dot País B (laranja/vermelho)
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

    // Diferença (gap label)
    if (xA !== null && xB !== null) {
      const gap = Math.abs(d.priceA - d.priceB);
      const midX = (xA + xB) / 2;
      g.append("text")
        .attr("x", midX).attr("y", cy - 10)
        .attr("text-anchor", "middle").style("font-size", "9px").style("fill", "#888")
        .text(`Δ$${gap.toFixed(2)}`);
    }
  });

  // Legenda
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

export async function grafico4() {
  await render();
  onFilterChange(["countryB", "country", "product", "yearStart", "yearEnd"], async () => await render());
}
