# Script de preparação de dados WFP -> Parquet
# Execute na raiz do projeto: python prepare_data.py
# Requer: pip install pandas pyarrow

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import glob
import os
import sys

CSV_DIR = r"C:\Users\Gabriel Machado\Downloads\archive"
OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "wfp_food_prices.parquet")


def main():
    if not os.path.isdir(CSV_DIR):
        print(f"Pasta não encontrada: {CSV_DIR}")
        print("Ajuste a variável CSV_DIR no script.")
        sys.exit(1)

    pattern = os.path.join(CSV_DIR, "wfp_food_prices_global_*.csv")
    files = sorted(glob.glob(pattern))

    if not files:
        print(f"Nenhum CSV encontrado em: {CSV_DIR}")
        sys.exit(1)

    print(f"Encontrados {len(files)} arquivos CSV")

    dfs = []
    for path in files:
        basename = os.path.basename(path)
        print(f"  Lendo {basename}...", end=" ", flush=True)
        try:
            df = pd.read_csv(path, low_memory=False)
            df = df[df["usdprice"].notna() & (df["usdprice"] > 0)]
            dfs.append(df)
            print(f"{len(df):,} linhas")
        except Exception as e:
            print(f"ERRO: {e}")

    if not dfs:
        print("Nenhum dado carregado.")
        sys.exit(1)

    combined = pd.concat(dfs, ignore_index=True)

    combined["usdprice"] = pd.to_numeric(combined["usdprice"], errors="coerce")
    combined["price"] = pd.to_numeric(combined["price"], errors="coerce")
    combined["date"] = pd.to_datetime(combined["date"], errors="coerce").dt.strftime("%Y-%m-%d")

    combined = combined.dropna(subset=["countryiso3", "date", "commodity", "usdprice"])
    combined = combined[combined["usdprice"] > 0]

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    table = pa.Table.from_pandas(combined, preserve_index=False)
    pq.write_table(table, OUTPUT_PATH, compression="snappy")

    size_mb = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
    print(f"\nSalvo em: {OUTPUT_PATH}")
    print(f"Total de linhas: {len(combined):,}")
    print(f"Tamanho do arquivo: {size_mb:.1f} MB")
    print("\nPróximo passo: npm run dev")


if __name__ == "__main__":
    main()
