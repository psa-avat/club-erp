-- ERP-CLUB Database Schema for PostgreSQL
-- Logiciel libre de gestion d'un club de vol à voile
-- Copyright (C) 2026  SAFORCADA Patrick
-- Licensed under GNU Affero General Public License v3.0

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Enumerations (using SMALLINT)
-- ============================================================================

-- User Role Codes
-- 1 = pilot (regular pilot user)
-- 2 = admin (administrator with full access)
-- 3 = club (club manager/staff account)

-- ============================================================================
-- Tables
-- ============================================================================

-- Users table: User/Pilot accounts
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nom VARCHAR(255),
    prenom VARCHAR(255),
    role SMALLINT NOT NULL DEFAULT 1 CHECK (role IN (1, 2, 3)),
    auth_expiration_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT email_not_empty CHECK (email != '')
);

-- Create indexes on users table
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_role ON users(role);

-- UserSettings table: User-specific settings
CREATE TABLE user_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    language VARCHAR(10) NOT NULL DEFAULT 'fr',
    timezone VARCHAR(50) NOT NULL DEFAULT 'Europe/Paris',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_settings_user_id 
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE
);

-- Create indexes on user_settings table
CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);

-- SessionToken table: JWT session tokens for authentication
CREATE TABLE session_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_session_tokens_user_id 
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE
);

-- Create indexes on session_tokens table
CREATE INDEX idx_session_tokens_user_id ON session_tokens(user_id);
CREATE INDEX idx_session_tokens_token_hash ON session_tokens(token_hash);
CREATE INDEX idx_session_tokens_expires_at ON session_tokens(expires_at);

-- ============================================================================
-- Triggers
-- ============================================================================

-- Function to update updated_at timestamp on users table
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for users table
CREATE TRIGGER trigger_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_users_updated_at();

-- Function to update updated_at timestamp on user_settings table
CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for user_settings table
CREATE TRIGGER trigger_user_settings_updated_at
BEFORE UPDATE ON user_settings
FOR EACH ROW
EXECUTE FUNCTION update_user_settings_updated_at();

-- Function to update updated_at timestamp on session_tokens table
CREATE OR REPLACE FUNCTION update_session_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for session_tokens table
CREATE TRIGGER trigger_session_tokens_updated_at
BEFORE UPDATE ON session_tokens
FOR EACH ROW
EXECUTE FUNCTION update_session_tokens_updated_at();

-- ============================================================================
-- Views (optional, for common queries)
-- ============================================================================

-- Active users view (with role text representation)
CREATE OR REPLACE VIEW v_active_users AS
SELECT 
    u.id,
    u.email,
    u.nom,
    u.prenom,
    u.role,
    CASE u.role 
        WHEN 1 THEN 'pilot'
        WHEN 2 THEN 'admin'
        WHEN 3 THEN 'club'
        ELSE 'unknown'
    END AS role_name,
    u.auth_expiration_date,
    u.is_active,
    u.updated_at
FROM users u
WHERE u.is_active = TRUE;

-- User sessions view (not expired, with role text representation)
CREATE OR REPLACE VIEW v_active_sessions AS
SELECT 
    st.id,
    st.user_id,
    st.token_hash,
    st.expires_at,
    st.ip_address,
    st.user_agent,
    st.updated_at,
    u.email,
    u.nom,
    u.prenom,
    u.role,
    CASE u.role 
        WHEN 1 THEN 'pilot'
        WHEN 2 THEN 'admin'
        WHEN 3 THEN 'club'
        ELSE 'unknown'
    END AS role_name
FROM session_tokens st
JOIN users u ON st.user_id = u.id
WHERE st.expires_at > CURRENT_TIMESTAMP;

-- ============================================================================
-- Grants (for application user)
-- ============================================================================

-- Uncomment and adjust as needed for production
-- CREATE ROLE erp_club WITH LOGIN PASSWORD 'secure_password_here';
-- GRANT CONNECT ON DATABASE erp_club_db TO erp_club;
-- GRANT USAGE ON SCHEMA public TO erp_club;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO erp_club;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO erp_club;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO erp_club;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO erp_club;

-- ============================================================================
-- Sample Data (optional, for testing)
-- ============================================================================

-- Uncomment below to insert sample data
-- INSERT INTO users (email, password_hash, nom, prenom, role, is_active)
-- VALUES 
--     ('admin@erp-club.local', '$argon2id$v=19$m=65540,t=3,p=4$...', 'Admin', 'Initial', 2, TRUE),
--     ('pilot@erp-club.local', '$argon2id$v=19$m=65540,t=3,p=4$...', 'Pilot', 'Test', 1, TRUE);

-- ============================================================================
-- Schema Documentation
-- ============================================================================

-- Table: users
-- Purpose: Store user/pilot account information
-- Relationships: One-to-One with user_settings, One-to-Many with session_tokens
-- Key fields:
--   - email: Unique identifier for login (email format)
--   - password_hash: Argon2 hashed password
--   - role: User type as SMALLINT (1=pilot, 2=admin, 3=club)
--   - is_active: Soft delete flag
--   - auth_expiration_date: License/subscription expiration

-- Table: user_settings
-- Purpose: Store user-specific preferences and settings
-- Relationships: Many-to-One with users (cascading delete)
-- Key fields:
--   - language: User interface language preference
--   - timezone: User's timezone for scheduling

-- Table: session_tokens
-- Purpose: Store active JWT session tokens for authentication
-- Relationships: Many-to-One with users (cascading delete)
-- Key fields:
--   - token_hash: SHA256 hash of JWT token for secure storage
--   - expires_at: Token expiration timestamp
--   - ip_address: Client IP address for security audit
--   - user_agent: Client user agent for security audit

-- ============================================================================
-- End of Schema
-- ============================================================================
