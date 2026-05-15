import requests
import os

class HelloAssoAPI:
    def __init__(self, client_id, client_secret):
        self.base_url = "https://api.helloasso.com/v5"
        self.client_id = client_id
        self.client_secret = client_secret
        self.token = None

    def get_token(self):
        """Récupère le jeton d'accès OAuth2"""
        auth_url = "https://api.helloasso.com/oauth2/token"
        data = {
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'grant_type': 'client_credentials'
        }
        
        # Le header doit être en x-www-form-urlencoded (géré par le paramètre 'data' de requests)
        response = requests.post(auth_url, data=data)
        
        if response.status_code == 200:
            self.token = response.json().get('access_token')
            print("Jeton récupéré avec succès.")
            return self.token
        else:
            print(f"Erreur d'authentification : {response.status_code}")
            print(response.text)
            return None

    def get_organization_info(self):
        """Exemple : Récupérer les informations d'une organisation"""
        if not self.token:
            self.get_token()

        print(f"Utilisation du jeton : {self.token}")  # Debug: Affiche le jeton utilisé
        headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json'
        }
        
        endpoint = f"{self.base_url}/users/me/organizations"
        response = requests.get(endpoint, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            return f"Erreur lors de la requête : {response.status_code} - {response.text}"

    def get_organization_infos(self, infos : str, organization_slug: str):
        """Exemple : Récupérer les événements d'une organisation"""
        if not self.token:
            self.get_token()

        headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json'
        }
        
        endpoint = f"{self.base_url}/organizations/{organization_slug}/{infos}"
        response = requests.get(endpoint, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            return f"Erreur lors de la requête : {response.status_code} - {response.text}"
     

        

# --- CONFIGURATION ET TEST ---

# Remplacez par vos vrais identifiants
CLIENT_ID = os.getenv("HELLOASSO_API_KEY","")
CLIENT_SECRET = os.getenv("HELLOASSO_API_SECRET","")

api = HelloAssoAPI(CLIENT_ID, CLIENT_SECRET)

# Test de récupération
info = api.get_organization_info()
#print(info)

organization_slug = info[0]['organizationSlug'] if info and isinstance(info, list) and len(info) > 0 else None

items  = api.get_organization_infos("items", organization_slug)  # Remplacez par un ID d'organisation valide
#print(items)
orders = api.get_organization_infos("orders", organization_slug)  # Remplacez par un ID d'organisation valide
#print(orders)
