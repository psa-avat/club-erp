import pandas as pd
import zipfile
import os

# 1. Chargement des données
accounting_df = pd.read_csv('V_comptabilité_validée_2026.csv', encoding='latin-1', sep=';', decimal=',' , engine='python')
members_df = pd.read_csv('members.csv')

# 2. Mapping des journaux (Ancien -> Nouveau)
# On ajoute 'VL' pour les vols
journal_mapping = {
    'AC': 'AC',                             # Achats
    'BQ': 'BQ',                             # Banque
    'RPT': 'AN',                            # A-nouveaux
    'EXP': 'OD', 'INV': 'OD', 'MEM': 'OD', 'ORG': 'OD', 'PER': 'OD', # OD
    'CA': 'CA'                              # Caisse
}

# Mapping des membres
members_df['legacy_account_id'] = pd.to_numeric(members_df['legacy_account_id'], errors='coerce')
mapping_dict = dict(zip(members_df['legacy_account_id'], members_df['account_id']))

# Identification des colonnes
col_journal = [c for c in accounting_df.columns if 'journal' in c.lower()][0]
col_date = [c for c in accounting_df.columns if 'date' in c.lower()][0]
col_label = [c for c in accounting_df.columns if 'libell' in c.lower()][0]
col_account = [c for c in accounting_df.columns if 'compte' in c.lower()][0]
col_debit = [c for c in accounting_df.columns if 'bit' in c.lower()][0]
col_credit = [c for c in accounting_df.columns if 'dit' in c.lower()][0]
col_pilot_num = [c for c in accounting_df.columns if 'num_pilote' in c.lower()][0]

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

# 3. Fonction de tri et transformation
def process_row(row):
    old_journal = str(row[col_journal])
    old_account = str(row[col_account])
    n_ref = row[col_pilot_num]
    
    # --- LOGIQUE DE TRI DU JOURNAL ---
    # Si c'est le journal des vols (VVO) OU si le compte commence par 7062 (Heures de vol) ou 7063 (Lancements)
    if old_journal == 'VVO' or old_account.startswith(('7062', '7063')):
        target_journal = 'VL'
    # Si c'est une vente membre/divers (hors vol)
    elif old_journal in ['VIN', 'VDI'] or old_account.startswith('706'):
        target_journal = 'VT'
    else:
        # Utilise le mapping par défaut, sinon OD
        target_journal = journal_mapping.get(old_journal, 'OD')
    
    # --- TRANSFORMATION COMPTE ET TIERS ---
    new_account = old_account[:3]
    target_id = None
    
    if old_account.startswith('411'):
        new_account = '411'
        try:
            n_val = int(float(n_ref))
            target_id = mapping_dict.get(n_val, None if n_val == 0 else f"UNKNOWN_PILOT_N_{n_val}")
        except:
            target_id = "SYSTEM_EQUITY" if n_ref in [0, '0'] else "UNKNOWN_FORMAT"
    elif n_ref in [0, '0']:
        target_id = 'SYSTEM_EQUITY'
        
    return pd.Series([target_journal, new_account, target_id])

# 4. Application
accounting_df[['target_journal', 'account_code', 'member_account_id']] = accounting_df.apply(process_row, axis=1)

# Préparation de l'export final
final_df = accounting_df[[
    col_date, 'target_journal', col_label, 'account_code', 'member_account_id', col_debit, col_credit
]].rename(columns={
    col_date: 'date',
    'target_journal': 'journal',
    col_label: 'label',
    col_debit: 'debit',
    col_credit: 'credit'
})



# 5. Export ZIP
zip_filename = 'import_ecritures_par_journal_2026.zip'
with zipfile.ZipFile(zip_filename, 'w') as csv_zip:
    for journal_name, group in final_df.groupby('journal'):
        filename = f"import_journal_{journal_name}.csv"
        # float_format évite les guillemets sur les nombres
        group.to_csv(filename, index=False, encoding='utf-8', float_format='%.2f') 
        csv_zip.write(filename)
        os.remove(filename)

print(f"Archive générée : {zip_filename}")