"""    
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Email service for sending PIN codes and notifications
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 """
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig, MessageType
from pydantic import EmailStr,BaseModel
import os
import json
import loguru

from os import getenv

CONF_EMAIL_FILE_ENV = "CONF_EMAIL_FILE"
email_config = getenv(CONF_EMAIL_FILE_ENV, "conf_emails.json")



class EmailConfig(BaseModel):
    smtp_server: str
    port: int
    username: str
    password: str
    tls: bool

class AppConfig(BaseModel):
    email: EmailConfig
    # ... autres sections

def load_config():

    if not os.path.exists(email_config):
        loguru.logger.error(f"Le fichier de configuration des emails {email_config} est introuvable.")
        return None
    
    with open(email_config, "r") as f:
        data = json.load(f)
    return EmailConfig(**data)



async def send_pin_email(email_to: EmailStr, pin_code: str):
    """
    Envoie le code PIN au pilote.
    """
    try:
        email_config = load_config()
        if email_config is None:
            loguru.logger.warning(f"Configuration email non disponible, PIN non envoyé à {email_to}")
            return False
        

        conf = ConnectionConfig(
            MAIL_USERNAME = email_config.username,
            MAIL_PASSWORD = email_config.password,
            MAIL_FROM = email_config.username,
            MAIL_PORT = email_config.port,
            MAIL_SERVER = email_config.smtp_server,
            MAIL_STARTTLS = not email_config.tls,
            MAIL_SSL_TLS = email_config.tls,
            USE_CREDENTIALS = True,
            VALIDATE_CERTS = True
        )


        html = f"""
        <h3>Demande de validation de code PIN</h3>
        <p>Bonjour,</p>
        <p>Votre code de validation est : <strong>{pin_code}</strong></p>
        <p>Ce code expire dans 15 minutes.</p>
        """

        message = MessageSchema(
            subject="ERP-CLUB : Code de validation",
            recipients=[email_to],
            body=html,
            subtype=MessageType.html
        )

        fm = FastMail(conf)

        loguru.logger.info(f"Envoi email PIN à {email_to}") 
        
        # Envoi asynchrone
        await fm.send_message(message)
        return True
    
    except Exception as e:
        loguru.logger.error(f"Erreur lors de l'envoi du PIN à {email_to}: {type(e).__name__}: {str(e)}")
        return False

