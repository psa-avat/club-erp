-- ERP-CLUB Database Schema for PostgreSQL
-- Clean break auth model: roles/capabilities + 2FA

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Core identity
-- ============================================================================

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nom VARCHAR(255),
    prenom VARCHAR(255),
    auth_expiration_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT email_not_empty CHECK (email <> '')
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_is_active ON users(is_active);

-- ============================================================================
-- Authorization catalog
-- ============================================================================

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    code SMALLINT NOT NULL UNIQUE,
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_roles_code ON roles(code);
CREATE INDEX idx_roles_slug ON roles(slug);

CREATE TABLE capabilities (
    id SERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_capabilities_code ON capabilities(code);

CREATE TABLE user_roles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role_id)
);

CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);

CREATE TABLE role_capabilities (
    id SERIAL PRIMARY KEY,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    capability_id INTEGER NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    scope VARCHAR(32) NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'own')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_role_capabilities_role_cap UNIQUE (role_id, capability_id)
);

CREATE INDEX idx_role_capabilities_role_id ON role_capabilities(role_id);
CREATE INDEX idx_role_capabilities_capability_id ON role_capabilities(capability_id);

-- ============================================================================
-- User settings
-- ============================================================================

CREATE TABLE user_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    language VARCHAR(10) NOT NULL DEFAULT 'fr',
    timezone VARCHAR(50) NOT NULL DEFAULT 'Europe/Paris',
    can_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);

-- ============================================================================
-- 2FA and session model
-- ============================================================================

CREATE TABLE auth_challenges (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pin_hash VARCHAR(255) NOT NULL,
    attempts_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_challenges_user_id ON auth_challenges(user_id);
CREATE INDEX idx_auth_challenges_expires_at ON auth_challenges(expires_at);

CREATE TABLE trusted_devices (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    device_name VARCHAR(255),
    ip_address TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trusted_devices_user_id ON trusted_devices(user_id);
CREATE INDEX idx_trusted_devices_expires_at ON trusted_devices(expires_at);

CREATE TABLE session_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    token_kind SMALLINT NOT NULL CHECK (token_kind IN (1, 2)),
    auth_level SMALLINT NOT NULL CHECK (auth_level IN (1, 2)),
    challenge_id INTEGER REFERENCES auth_challenges(id) ON DELETE SET NULL,
    trusted_device_id INTEGER REFERENCES trusted_devices(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_session_tokens_user_id ON session_tokens(user_id);
CREATE INDEX idx_session_tokens_expires_at ON session_tokens(expires_at);
CREATE INDEX idx_session_tokens_challenge_id ON session_tokens(challenge_id);
CREATE INDEX idx_session_tokens_trusted_device_id ON session_tokens(trusted_device_id);

-- ============================================================================
-- Generic updated_at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_capabilities_updated_at BEFORE UPDATE ON capabilities FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_user_roles_updated_at BEFORE UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_role_capabilities_updated_at BEFORE UPDATE ON role_capabilities FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_user_settings_updated_at BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_auth_challenges_updated_at BEFORE UPDATE ON auth_challenges FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_trusted_devices_updated_at BEFORE UPDATE ON trusted_devices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_session_tokens_updated_at BEFORE UPDATE ON session_tokens FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- Seed roles and capabilities
-- ============================================================================

INSERT INTO roles (code, slug, name)
VALUES
    (1, 'admin', 'Administrateur'),
    (2, 'member', 'Membre'),
    (3, 'finance', 'Finance'),
    (4, 'instructor', 'Instructeur'),
    (5, 'maintenance', 'Maintenance')
ON CONFLICT (code) DO NOTHING;

INSERT INTO capabilities (code, name, description)
VALUES
    ('EDIT_FLIGHTS', 'Gestion des vols', 'Creer et modifier des vols'),
    ('MANAGE_PRICES', 'Gestion des tarifs', 'Modifier la tarification du club'),
    ('VIEW_FINANCIALS', 'Lecture finance', 'Consulter les donnees financieres'),
    ('MANAGE_USERS', 'Gestion des utilisateurs', 'Creer et administrer des comptes'),
    ('MEMBER_PORTAL', 'Portail membre', 'Acces self-service du membre')
ON CONFLICT (code) DO NOTHING;

-- Admin gets all capabilities
INSERT INTO role_capabilities (role_id, capability_id, scope)
SELECT r.id, c.id, 'all'
FROM roles r
CROSS JOIN capabilities c
WHERE r.slug = 'admin'
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- Member capabilities (self scope)
INSERT INTO role_capabilities (role_id, capability_id, scope)
SELECT r.id, c.id, 'own'
FROM roles r
JOIN capabilities c ON c.code IN ('MEMBER_PORTAL', 'EDIT_FLIGHTS')
WHERE r.slug = 'member'
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- Finance capabilities
INSERT INTO role_capabilities (role_id, capability_id, scope)
SELECT r.id, c.id, 'all'
FROM roles r
JOIN capabilities c ON c.code IN ('VIEW_FINANCIALS')
WHERE r.slug = 'finance'
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- Instructor capabilities
INSERT INTO role_capabilities (role_id, capability_id, scope)
SELECT r.id, c.id, CASE WHEN c.code = 'MEMBER_PORTAL' THEN 'own' ELSE 'all' END
FROM roles r
JOIN capabilities c ON c.code IN ('EDIT_FLIGHTS', 'MEMBER_PORTAL')
WHERE r.slug = 'instructor'
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- Maintenance capabilities
INSERT INTO role_capabilities (role_id, capability_id, scope)
SELECT r.id, c.id, 'own'
FROM roles r
JOIN capabilities c ON c.code = 'MEMBER_PORTAL'
WHERE r.slug = 'maintenance'
ON CONFLICT (role_id, capability_id) DO NOTHING;

-- ============================================================================
-- Useful views
-- ============================================================================

CREATE OR REPLACE VIEW v_user_roles AS
SELECT
    u.id AS user_id,
    u.email,
    r.code AS role_code,
    r.slug AS role_slug,
    r.name AS role_name
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id;

CREATE OR REPLACE VIEW v_user_capabilities AS
SELECT DISTINCT
    u.id AS user_id,
    u.email,
    c.code AS capability_code,
    c.name AS capability_name,
    rc.scope
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id
JOIN role_capabilities rc ON rc.role_id = r.id
JOIN capabilities c ON c.id = rc.capability_id;

CREATE OR REPLACE VIEW v_active_full_sessions AS
SELECT
    st.id,
    st.user_id,
    u.email,
    st.expires_at,
    st.ip_address,
    st.user_agent,
    td.device_name,
    td.expires_at AS trusted_device_expires_at
FROM session_tokens st
JOIN users u ON u.id = st.user_id
LEFT JOIN trusted_devices td ON td.id = st.trusted_device_id
WHERE st.auth_level = 2
  AND st.token_kind = 2
  AND st.revoked_at IS NULL
  AND st.expires_at > CURRENT_TIMESTAMP;
