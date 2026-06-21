import { grafico1 } from "./grafico1.js";
import { grafico2 } from "./grafico2.js";
import { grafico3 } from "./grafico3.js";
import { grafico4 } from "./grafico4.js";
import { initializeDatabase, executeQuery } from "./dataLoader.js";
import { filterState, updateFilter } from "./filterState.js";
import { populateCountryNames, getName } from "./countryNames.js";

document.addEventListener("DOMContentLoaded", () => {
  const loadingOverlay = document.getElementById("loadingOverlay");
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");

  async function refreshProductOptions(year) {
    const productSel = document.getElementById("filter-product");
    const current = filterState.product;

    const products = await executeQuery(
      `SELECT DISTINCT commodity
       FROM wfp
       WHERE category NOT IN ('non-food')
         AND usdprice > 0
         AND CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) = ${year}
       ORDER BY commodity`
    );

    productSel.innerHTML = "";
    let found = false;
    products.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.commodity;
      opt.textContent = r.commodity;
      if (r.commodity === current) { opt.selected = true; found = true; }
      productSel.appendChild(opt);
    });

    if (!found && products.length) {
      productSel.value = products[0].commodity;
      updateFilter({ product: products[0].commodity });
    }
  }

  async function populateFilters() {
    const [years, products, countries] = await Promise.all([
      executeQuery(
        `SELECT DISTINCT CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) AS year
         FROM wfp ORDER BY year`
      ),
      executeQuery(
        `SELECT DISTINCT commodity
         FROM wfp
         WHERE category NOT IN ('non-food')
           AND usdprice > 0
           AND CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) = ${filterState.year}
         ORDER BY commodity`
      ),
      executeQuery(
        `SELECT DISTINCT countryiso3
         FROM wfp ORDER BY countryiso3`
      ),
    ]);

    const yearSel = document.getElementById("filter-year");
    years.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.year;
      opt.textContent = r.year;
      if (Number(r.year) === filterState.year) opt.selected = true;
      yearSel.appendChild(opt);
    });

    const productSel = document.getElementById("filter-product");
    let productFound = false;
    products.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.commodity;
      opt.textContent = r.commodity;
      if (r.commodity === filterState.product) { opt.selected = true; productFound = true; }
      productSel.appendChild(opt);
    });
    if (!productFound && products.length) {
      productSel.value = products[0].commodity;
      updateFilter({ product: products[0].commodity });
    }

    // Dropdown de países: ordenar por nome completo
    const countrySel = document.getElementById("filter-country");
    const countryOpts = countries
      .map((r) => ({ iso3: r.countryiso3, name: getName(r.countryiso3) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    countryOpts.forEach(({ iso3, name }) => {
      const opt = document.createElement("option");
      opt.value = iso3;
      opt.textContent = name;
      countrySel.appendChild(opt);
    });

    yearSel.addEventListener("change", async (e) => {
      const year = Number(e.target.value);
      updateFilter({ year });
      await refreshProductOptions(year);
    });
    productSel.addEventListener("change", (e) =>
      updateFilter({ product: e.target.value })
    );
    countrySel.addEventListener("change", (e) =>
      updateFilter({ country: e.target.value })
    );
  }

  async function main() {
    try {
      progressText.textContent = "Inicializando banco de dados...";
      await initializeDatabase();
      progressBar.style.width = "30%";

      progressText.textContent = "Carregando GeoJSON do mundo...";
      progressBar.style.width = "50%";
      const geoData = await d3.json("./data/world.geojson");
      populateCountryNames(geoData);

      progressText.textContent = "Preparando filtros...";
      progressBar.style.width = "65%";
      await populateFilters();

      progressText.textContent = "Construindo gráficos...";
      progressBar.style.width = "80%";

      await grafico1(geoData);
      await grafico2();
      await grafico3();
      await grafico4();

      progressBar.style.width = "100%";
      progressText.textContent = "Tudo pronto!";
      await new Promise((r) => setTimeout(r, 400));
      loadingOverlay.style.display = "none";
    } catch (error) {
      console.error("Erro no carregamento:", error);
      progressText.textContent = "Erro ao carregar dados — verifique o console.";
    }
  }

  main();
});
