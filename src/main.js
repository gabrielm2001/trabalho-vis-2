// main.js — Orquestrador da aplicação.
//
// Responsabilidades:
//   1. Inicializar o banco DuckDB-WASM e carregar o GeoJSON
//   2. Popular os dropdowns de filtro com dados reais do banco
//   3. Vincular eventos dos dropdowns ao filterState (pub/sub)
//   4. Instanciar os quatro gráficos em sequência

import { grafico1 } from "./grafico1.js";
import { grafico2 } from "./grafico2.js";
import { grafico3 } from "./grafico3.js";
import { grafico4 } from "./grafico4.js";
import { initializeDatabase, executeQuery } from "./dataLoader.js";
import { filterState, updateFilter, onFilterChange } from "./filterState.js";
import { populateCountryNames, getName } from "./countryNames.js";

document.addEventListener("DOMContentLoaded", () => {
  const loadingOverlay = document.getElementById("loadingOverlay");
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");

  // Contador de requisição para evitar race condition no dropdown de produtos:
  // se o usuário trocar de ano/país rapidamente, apenas a última resposta é aplicada.
  let productOptionsRequestId = 0;

  /** Escapa aspas simples em valores interpolados em SQL (prevenção de SQL injection). */
  function escapeSql(value) {
    return String(value).replace(/'/g, "''");
  }

  /**
   * Recarrega as opções do dropdown de produto conforme ano e país atuais.
   *
   * A lista de commodities disponíveis muda quando o usuário troca de ano
   * (nem todo produto está em todos os anos) ou de país (nem todo país reporta
   * todos os produtos). Por isso este dropdown é dinâmico e recarregado via query.
   *
   * O padrão requestId garante que somente a última chamada pendente atualize o DOM,
   * descartando respostas de chamadas anteriores que chegaram depois (stale responses).
   */
  async function refreshProductOptions() {
    const requestId = ++productOptionsRequestId;
    const productSel = document.getElementById("filter-product");
    const current = filterState.product;
    const { year, country } = filterState;

    const countryFilter = country === "ALL"
      ? ""
      : `AND countryiso3 = '${escapeSql(country)}'`;

    const products = await executeQuery(
      `SELECT DISTINCT commodity
       FROM wfp
       WHERE category NOT IN ('non-food')
         AND usdprice > 0
         AND CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) = ${year}
         ${countryFilter}
       ORDER BY commodity`
    );

    // Descarta respostas de requisições desatualizadas
    if (requestId !== productOptionsRequestId) return;

    productSel.innerHTML = "";

    if (!products.length) {
      // Exibe estado vazio e desabilita o select quando não há dados
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Sem alimentos disponíveis";
      opt.disabled = true;
      opt.selected = true;
      productSel.appendChild(opt);
      productSel.disabled = true;
      return;
    }

    productSel.disabled = false;

    let found = false;
    products.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.commodity;
      opt.textContent = r.commodity;
      if (r.commodity === current) { opt.selected = true; found = true; }
      productSel.appendChild(opt);
    });

    // Se o produto atual não existe no novo contexto (ano/país), seleciona o primeiro disponível
    // e propaga via updateFilter para que os gráficos re-renderizem com o novo produto.
    if (!found && products.length) {
      productSel.value = products[0].commodity;
      updateFilter({ product: products[0].commodity });
      return;
    }
  }

  /**
   * Popula os três dropdowns de filtro (ano, produto, país) e registra event listeners.
   *
   * Anos e países são carregados em paralelo com Promise.all.
   * Produtos são carregados depois, pois dependem do ano inicial (filterState.year).
   *
   * Os países são ordenados por nome completo (não por ISO3) para melhor usabilidade.
   * O value do <option> continua sendo o ISO3, que é o que o filterState usa internamente.
   */
  async function populateFilters() {
    const [years, countries] = await Promise.all([
      executeQuery(
        `SELECT DISTINCT CAST(EXTRACT(year FROM CAST(date AS DATE)) AS INTEGER) AS year
         FROM wfp ORDER BY year`
      ),
      executeQuery(
        `SELECT DISTINCT countryiso3
         FROM wfp ORDER BY countryiso3`
      ),
    ]);

    const yearSel = document.getElementById("filter-year");
    yearSel.innerHTML = "";
    years.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.year;
      opt.textContent = r.year;
      if (Number(r.year) === filterState.year) opt.selected = true;
      yearSel.appendChild(opt);
    });

    const productSel = document.getElementById("filter-product");
    productSel.innerHTML = "";
    productSel.disabled = false;

    // Países ordenados por nome legível; value permanece ISO3 para o filterState
    const countrySel = document.getElementById("filter-country");
    countrySel.innerHTML = '<option value="ALL">Todos os países</option>';
    const countryOpts = countries
      .map((r) => ({ iso3: r.countryiso3, name: getName(r.countryiso3) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    countryOpts.forEach(({ iso3, name }) => {
      const opt = document.createElement("option");
      opt.value = iso3;
      opt.textContent = name;
      countrySel.appendChild(opt);
    });

    // Cada dropdown propaga a mudança para o filterState, que notifica os gráficos inscritos.
    yearSel.addEventListener("change", async (e) => {
      const year = Number(e.target.value);
      updateFilter({ year });
    });
    productSel.addEventListener("change", (e) =>
      updateFilter({ product: e.target.value })
    );
    countrySel.addEventListener("change", (e) =>
      updateFilter({ country: e.target.value })
    );

    // O dropdown de produtos precisa ser recarregado quando ano, país ou período muda,
    // pois a disponibilidade de produtos varia com esses filtros.
    onFilterChange(["year", "country", "yearStart", "yearEnd", "countryB"], async () => {
      await refreshProductOptions();
    });

    // Carga inicial dos produtos para o ano/país padrão
    await refreshProductOptions();
  }

  /** Ponto de entrada: inicializa banco → geojson → filtros → gráficos. */
  async function main() {
    try {
      progressText.textContent = "Inicializando banco de dados...";
      await initializeDatabase();
      progressBar.style.width = "30%";

      progressText.textContent = "Carregando GeoJSON do mundo...";
      progressBar.style.width = "50%";
      const geoData = await d3.json("./data/world.geojson");
      // Popula o mapa ISO3 → nome antes de qualquer gráfico ou dropdown que precise de nomes
      populateCountryNames(geoData);

      progressText.textContent = "Preparando filtros...";
      progressBar.style.width = "65%";
      await populateFilters();

      progressText.textContent = "Construindo gráficos...";
      progressBar.style.width = "80%";

      // Gráfico 1 recebe geoData pois precisa do GeoJSON para projeção e nomes
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
