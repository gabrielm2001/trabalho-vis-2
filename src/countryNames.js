const isoToName = new Map();

export function populateCountryNames(geoData) {
  geoData.features.forEach((f) => {
    const iso3 = f.id;
    const name = f.properties?.name || f.properties?.ADMIN || iso3;
    if (iso3) isoToName.set(iso3, name);
  });
}

export function getName(iso3) {
  if (!iso3 || iso3 === "ALL") return "Todos os países";
  return isoToName.get(iso3) || iso3;
}
