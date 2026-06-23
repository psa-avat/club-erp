import pandas as pd
import re

# Chargement du fichier AC généré précédemment
ac_df = pd.read_csv('import_journal_AC.csv')

# Conversion de la date
ac_df['date'] = pd.to_datetime(ac_df['date'], dayfirst=True, errors='coerce')

# Filtrage pour l'année 2025
ac_2025 = ac_df[ac_df['date'].dt.year == 2025].copy()

# On identifie les fournisseurs à partir des lignes au Crédit (paiement ou dette enregistrée)
# sur les comptes de trésorerie (5xx) ou tiers (4xx)
suppliers_entries = ac_2025[
    (ac_2025['credit'] > 0) & 
    (ac_2025['account_code'].astype(str).str.startswith(('5', '4')))
].copy()

# Fonction de nettoyage pour extraire le nom du fournisseur du libellé
# Exemple : "AMAZON N°140" -> "AMAZON"
def clean_supplier_name(label):
    if pd.isna(label):
        return "INCONNU"
    # Supprime " N°..." ou " DU ..." ou " DECEMBRE" etc.
    name = re.split(r'\sN°|\sDU\s|\sDECEMBRE|\sNOVEMBRE|\sOCTOBRE|\sJANVIER', str(label), flags=re.IGNORECASE)[0]
    return name.strip().upper()

suppliers_entries['supplier_name'] = suppliers_entries['label'].apply(clean_supplier_name)

# Agrégation par fournisseur
summary = suppliers_entries.groupby('supplier_name').agg(
    total_paye=('credit', 'sum'),
    nombre_factures=('entry_number', 'nunique')
).sort_values(by='total_paye', ascending=False)

# Affichage des 20 premiers
print(summary.head(20))

# Sauvegarde pour le rapport
summary.to_csv('top_fournisseurs_2025.csv')