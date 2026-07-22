-- 084_member_recap_message_templates.sql
-- Predefined free-text message templates for member recap emails (flight count,
-- hours, balance + a short custom message). Picked from a dropdown, still
-- editable before sending. See docs/plans/plan-membersRegistrationLifecycleAndSelfService.prompt.md.

CREATE TABLE member_recap_message_templates (
    uuid UUID PRIMARY KEY,
    label VARCHAR(120) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by INTEGER NOT NULL REFERENCES users(id)
);
