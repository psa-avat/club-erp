"""    
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Backend API principale
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

"""Application-wide constants and mappings."""

# User Role Codes (SMALLINT)
ROLE_PILOT = 1      # Regular pilot user
ROLE_ADMIN = 2      # Administrator with full access
ROLE_CLUB = 3       # Club manager/staff account

# Role code to string mapping (for display/logging)
ROLE_CODE_TO_NAME = {
    ROLE_PILOT: "pilot",
    ROLE_ADMIN: "admin",
    ROLE_CLUB: "club",
}

# Role string to code mapping (for input validation)
ROLE_NAME_TO_CODE = {
    "pilot": ROLE_PILOT,
    "admin": ROLE_ADMIN,
    "club": ROLE_CLUB,
}

# Role code to display name (French)
ROLE_CODE_TO_DISPLAY = {
    ROLE_PILOT: "Pilote",
    ROLE_ADMIN: "Administrateur",
    ROLE_CLUB: "Club",
}


def role_to_code(role_name: str) -> int:
    """Convert role name string to numeric code.
    
    Args:
        role_name: Role name string ('pilot', 'admin', 'club')
        
    Returns:
        Numeric role code (1, 2, or 3)
        
    Raises:
        ValueError: If role_name is not recognized
    """
    if role_name not in ROLE_NAME_TO_CODE:
        raise ValueError(f"Unknown role: {role_name}. Valid roles: {list(ROLE_NAME_TO_CODE.keys())}")
    return ROLE_NAME_TO_CODE[role_name]


def code_to_role(role_code: int) -> str:
    """Convert numeric role code to name string.
    
    Args:
        role_code: Numeric role code (1, 2, or 3)
        
    Returns:
        Role name string ('pilot', 'admin', 'club')
        
    Raises:
        ValueError: If role_code is not recognized
    """
    if role_code not in ROLE_CODE_TO_NAME:
        raise ValueError(f"Unknown role code: {role_code}. Valid codes: {list(ROLE_CODE_TO_NAME.keys())}")
    return ROLE_CODE_TO_NAME[role_code]


def get_display_name(role_code: int) -> str:
    """Get display name (French) for a role code.
    
    Args:
        role_code: Numeric role code (1, 2, or 3)
        
    Returns:
        Display name in French
    """
    return ROLE_CODE_TO_DISPLAY.get(role_code, "Inconnu")
