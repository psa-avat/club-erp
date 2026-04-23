"""    
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - shared constants for auth, roles, and capabilities
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



# Authentication levels
AUTH_LEVEL_PRE_AUTH = 1
AUTH_LEVEL_FULL_AUTH = 2

# Token kinds
TOKEN_KIND_PRE_AUTH = 1
TOKEN_KIND_FULL_AUTH = 2

# 2FA parameters
PIN_LENGTH = 6
PIN_EXPIRATION_MINUTES = 15
PIN_MAX_ATTEMPTS = 5
TRUSTED_DEVICE_DAYS = 30
TRUSTED_DEVICE_COOKIE_NAME = "trusted_device"

# Seed role codes (database source of truth)
ROLE_CODE_ADMIN = 1
ROLE_CODE_MEMBER = 2
ROLE_CODE_FINANCE = 3
ROLE_CODE_INSTRUCTOR = 4
ROLE_CODE_MAINTENANCE = 5

ROLE_SEEDS = (
    (ROLE_CODE_ADMIN, "admin", "Administrateur"),
    (ROLE_CODE_MEMBER, "member", "Membre"),
    (ROLE_CODE_FINANCE, "finance", "Finance"),
    (ROLE_CODE_INSTRUCTOR, "instructor", "Instructeur"),
    (ROLE_CODE_MAINTENANCE, "maintenance", "Maintenance"),
)

# Capability codes
CAP_EDIT_FLIGHTS = "EDIT_FLIGHTS"
CAP_MANAGE_PRICES = "MANAGE_PRICES"
CAP_VIEW_FINANCIALS = "VIEW_FINANCIALS"
CAP_POST_ACCOUNTING_ENTRIES = "POST_ACCOUNTING_ENTRIES"
CAP_MANAGE_ACCOUNTING_SETTINGS = "MANAGE_ACCOUNTING_SETTINGS"
CAP_MANAGE_USERS = "MANAGE_USERS"
CAP_MEMBER_PORTAL = "MEMBER_PORTAL"
CAP_MANAGE_ASSETS = "MANAGE_ASSETS"

CAPABILITY_SEEDS = (
    (CAP_EDIT_FLIGHTS, "Gestion des vols"),
    (CAP_MANAGE_PRICES, "Gestion des tarifs"),
    (CAP_VIEW_FINANCIALS, "Lecture finance"),
    (CAP_POST_ACCOUNTING_ENTRIES, "Validation des ecritures comptables"),
    (CAP_MANAGE_ACCOUNTING_SETTINGS, "Parametrage comptable"),
    (CAP_MANAGE_USERS, "Gestion des utilisateurs"),
    (CAP_MEMBER_PORTAL, "Acces portail membre"),
)
