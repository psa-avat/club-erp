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


async def send_member_recap_email(
    email_to: EmailStr,
    member_name: str,
    message_text: str,
    flight_count: int,
    flight_hours: str,
    balance: str,
    portal_url: str,
) -> bool:
    """
    Envoie un récapitulatif (vols, solde) à un adhérent, avec un message libre.
    `message_text` est déjà échappé HTML par l'appelant.
    """
    try:
        email_config = load_config()
        if email_config is None:
            loguru.logger.warning(f"Configuration email non disponible, récapitulatif non envoyé à {email_to}")
            return False

        conf = ConnectionConfig(
            MAIL_USERNAME=email_config.username,
            MAIL_PASSWORD=email_config.password,
            MAIL_FROM=email_config.username,
            MAIL_PORT=email_config.port,
            MAIL_SERVER=email_config.smtp_server,
            MAIL_STARTTLS=not email_config.tls,
            MAIL_SSL_TLS=email_config.tls,
            USE_CREDENTIALS=True,
            VALIDATE_CERTS=True,
        )

        message_html = message_text.replace("\n", "<br>")

        html = f"""
        <h3>Bonjour {member_name},</h3>
        <p>{message_html}</p>
        <table style="border-collapse: collapse; margin: 16px 0;">
            <tr>
                <td style="padding: 4px 12px 4px 0; color: #555;">Vols effectués</td>
                <td style="padding: 4px 0; font-weight: bold;">{flight_count}</td>
            </tr>
            <tr>
                <td style="padding: 4px 12px 4px 0; color: #555;">Heures de vol</td>
                <td style="padding: 4px 0; font-weight: bold;">{flight_hours}</td>
            </tr>
            <tr>
                <td style="padding: 4px 12px 4px 0; color: #555;">Solde du compte</td>
                <td style="padding: 4px 0; font-weight: bold;">{balance}</td>
            </tr>
        </table>
        <p><a href="{portal_url}">Accéder à mon espace membre</a></p>
        """

        message = MessageSchema(
            subject="ERP-CLUB : Votre récapitulatif",
            recipients=[email_to],
            body=html,
            subtype=MessageType.html,
        )

        fm = FastMail(conf)

        loguru.logger.info(f"Envoi email récapitulatif à {email_to}")

        await fm.send_message(message)
        return True

    except Exception as e:
        loguru.logger.error(f"Erreur lors de l'envoi du récapitulatif à {email_to}: {type(e).__name__}: {str(e)}")
        return False

