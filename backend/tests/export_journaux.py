import pandas as pd
import zipfile
import os
import unicodedata

# 1. Chargement des données
accounting_df = pd.read_csv('V_comptabilité_validée.csv', encoding='latin-1', sep=';', decimal=',', engine='python')
members_df = pd.read_csv('members.csv', sep=';', encoding='latin-1', engine='python')

# 2. Mapping des journaux (Ancien -> Nouveau)
journal_mapping = {
    'AC': 'AC',
    'BQ': 'BQ',
    'RPT': 'AN',
    'EXP': 'OD', 'INV': 'OD', 'MEM': 'OD', 'ORG': 'OD', 'PER': 'OD',
    'CA': 'CA'
}

# Mapping des membres
members_df['legacy_account_id'] = pd.to_numeric(members_df['legacy_account_id'], errors='coerce')
mapping_dict = dict(zip(members_df['legacy_account_id'], members_df['account_id']))

def normalize_column_name(name):
    return (
        unicodedata.normalize('NFKD', str(name))
        .encode('ascii', 'ignore')
        .decode('ascii')
        .lower()
        .strip()
    )

normalized_columns = {col: normalize_column_name(col) for col in accounting_df.columns}

def find_column(*parts):
    for col, normalized in normalized_columns.items():
        if all(part in normalized for part in parts):
            return col
    raise KeyError(f"Colonne introuvable pour les critères: {parts}")

# Identification des colonnes
col_journal = find_column('journal')
col_date = find_column('date')
col_label = find_column('libell')
col_account = find_column('compte')
col_debit = find_column('debit')
col_credit = find_column('credit')
col_pilot_num = find_column('num_pilote')
col_entry_num = find_column('num_ecriture')

# Nettoyage des montants
for col in [col_debit, col_credit]:
    if accounting_df[col].dtype == object:
        accounting_df[col] = (
            accounting_df[col].str.replace('\xa0', '', regex=False)
            .str.replace(' ', '', regex=False)
            .str.replace(',', '.', regex=False)
            .astype(float)
        )
    accounting_df[col] = accounting_df[col].fillna(0.0)

def row_target_journal(row):
    old_journal = str(row[col_journal]).strip()
    old_account = str(row[col_account]).strip()

    if old_journal == 'VVO' or old_account.startswith(('7062', '7063')):
        return 'VL'
    if old_journal in ['VIN', 'VDI'] or old_account.startswith('706'):
        return 'VT'
    return journal_mapping.get(old_journal, 'OD')

def resolve_entry_journal(group):
    candidate_journals = group.apply(row_target_journal, axis=1)

    if (candidate_journals == 'VL').any():
        return 'VL'
    if (candidate_journals == 'VT').any():
        return 'VT'
    return candidate_journals.iloc[0]

def transform_account_and_tier(row):
    old_account = str(row[col_account]).strip()
    n_ref = row[col_pilot_num]

    new_account = old_account[:3]
    target_id = None

    if old_account.startswith('411'):
        new_account = '411'
        try:
            n_val = int(float(n_ref))
            target_id = mapping_dict.get(n_val, None if n_val == 0 else f"UNKNOWN_PILOT_N_{n_val}")
        except Exception:
            target_id = "SYSTEM_EQUITY" if n_ref in [0, '0'] else "UNKNOWN_FORMAT"
    elif n_ref in [0, '0']:
        target_id = 'SYSTEM_EQUITY'

    return pd.Series([new_account, target_id])

# 4. Application
accounting_df['_entry_key'] = accounting_df[col_entry_num].astype('string')
missing_entry_mask = accounting_df['_entry_key'].isna() | (accounting_df['_entry_key'].str.strip() == '')
accounting_df.loc[missing_entry_mask, '_entry_key'] = accounting_df.index[missing_entry_mask].map(lambda idx: f"ROW_{idx}")

entry_journal_map = accounting_df.groupby('_entry_key', sort=False).apply(resolve_entry_journal)
accounting_df['target_journal'] = accounting_df['_entry_key'].map(entry_journal_map)

accounting_df[['account_code', 'member_account_id']] = accounting_df.apply(transform_account_and_tier, axis=1)
accounting_df = accounting_df.drop(columns=['_entry_key'])

# Préparation de l'export final
final_df = accounting_df[[
    col_entry_num,col_date, 'target_journal', col_label, 'account_code', 'member_account_id', col_debit, col_credit
]].rename(columns={
    col_entry_num: 'entry_number',
    col_date: 'date',
    'target_journal': 'journal',
    col_label: 'label',
    col_debit: 'debit',
    col_credit: 'credit'
})


# 5. Export ZIP
zip_filename = 'import_ecritures_par_journal.zip'
exported_line_count = 0
exported_indexes = set()

with zipfile.ZipFile(zip_filename, 'w') as csv_zip:
    for journal_name, group in final_df.groupby('journal'):
        exported_line_count += len(group)
        exported_indexes.update(group.index.tolist())
        filename = f"import_journal_{journal_name}.csv"
        # float_format évite les guillemets sur les nombres
        group.to_csv(filename, index=False, encoding='utf-8', float_format='%.2f') 
        csv_zip.write(filename)
        os.remove(filename)

print(f"Archive générée : {zip_filename}")

source_line_count = len(final_df)
if exported_line_count != source_line_count:
    print(
        "ERREUR: nombre de lignes exportées différent de la source "
        f"(source={source_line_count}, exportees={exported_line_count})"
    )
    missing_df = final_df.loc[~final_df.index.isin(exported_indexes)]
    if missing_df.empty:
        print("Aucune ligne manquante identifiable par index. Vérifiez la colonne journal.")
    else:
        print("Lignes non exportées:")
        print(missing_df.to_string(index=False))
else:
    print(f"Controle OK: {exported_line_count} lignes exportees sur {source_line_count}.")