--
-- PostgreSQL database dump
--

\restrict j86ChAM3tQfxcNm0LBUdmeeHDB5C56R7xCS89XsAiqF1YBF0kvnsKLz4uSsMqii

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: backfill_member_registrations_from_last_date(smallint, smallint, text); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.backfill_member_registrations_from_last_date(IN p_year smallint, IN p_status smallint DEFAULT 1, IN p_notes text DEFAULT NULL::text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    inserted_count INTEGER;
    v_end_date DATE;
    v_threshold_date DATE;
BEGIN
    IF p_year < 2000 OR p_year > 9999 THEN
        RAISE EXCEPTION
            'Invalid year: % (expected 2000..9999)',
            p_year
            USING ERRCODE = '23514';
    END IF;

    IF p_status < 1 OR p_status > 3 THEN
        RAISE EXCEPTION
            'Invalid status: % (expected 1..3)',
            p_status
            USING ERRCODE = '23514';
    END IF;

    -- Validity rule for year YYYY:
    -- threshold = (YYYY - 1)-10-01, end = YYYY-12-31.
    -- start_date is each member last_registration_date.
    v_threshold_date := make_date(p_year - 1, 10, 1);
    v_end_date := make_date(p_year, 12, 31);

    INSERT INTO member_registrations (
        member_uuid,
        start_date,
        end_date,
        registered_for_year,
        registration_type,
        status,
        notes
    )
    SELECT
        m.uuid,
                m.last_registration_date,
                v_end_date,
                p_year,
        m.member_category,
        p_status,
        p_notes
    FROM members m
        WHERE m.last_registration_date IS NOT NULL
            AND m.last_registration_date > v_threshold_date
			AND m.last_registration_date < v_end_date
      		AND m.member_category NOT IN (5, 7, 8)

    ON CONFLICT (member_uuid, start_date, end_date) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    RAISE NOTICE
        'backfill_member_registrations_from_last_date inserted % row(s) for year % (start=member.last_registration_date, end %, threshold: %)',
        inserted_count,
        p_year,
        v_end_date,
        v_threshold_date;
END;
$$;


--
-- Name: check_accounting_entry_balance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_accounting_entry_balance() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    balance NUMERIC(10,4);
BEGIN
    IF NEW.state = 2 THEN
        SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)
          INTO balance
          FROM accounting_lines
         WHERE entry_uuid = NEW.uuid;

        IF balance <> 0 THEN
            RAISE EXCEPTION
                'Accounting entry % is not balanced. Difference: %', NEW.uuid, balance;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: check_entry_fiscal_year_boundary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_entry_fiscal_year_boundary() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    fy_start DATE;
    fy_end   DATE;
    fy_state SMALLINT;
BEGIN
    SELECT start_date, end_date, state
      INTO fy_start, fy_end, fy_state
      FROM accounting_fiscal_years
     WHERE uuid = NEW.fiscal_year_uuid;

    IF NEW.entry_date < fy_start OR NEW.entry_date > fy_end THEN
        RAISE EXCEPTION
            'entry_date % is outside fiscal year boundaries [%, %]',
            NEW.entry_date, fy_start, fy_end;
    END IF;

    -- Allow posting only in Open/Reopened fiscal years (1/3)
    IF NEW.state = 2 AND fy_state NOT IN (1, 3) THEN
        RAISE EXCEPTION
            'Cannot post entry into closed fiscal year %', NEW.fiscal_year_uuid;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_unlink_flights_on_entry_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_unlink_flights_on_entry_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- 1) Reset has_discount sur les vols liés à cette écriture
    UPDATE validated_flights
    SET
        accounting_entry_uuid = NULL,
        billing_quote_state = 'pending',
        has_discount = FALSE,
        erp_status = CASE
            WHEN erp_status = 1 THEN 2  -- was transferred → modified_after_transfer
            ELSE erp_status
        END
    WHERE accounting_entry_uuid = OLD.uuid;

    -- 2) Nettoyer les consommations de pack liées à cette écriture REM
    DELETE FROM member_pack_consumptions
    WHERE accounting_entry_uuid = OLD.uuid;

    RETURN OLD;
END;
$$;


--
-- Name: FUNCTION fn_unlink_flights_on_entry_delete(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_unlink_flights_on_entry_delete() IS 'When an accounting entry is deleted: (1) reset any validated_flights that reference it, (2) delete member_pack_consumptions rows linked to that entry, (3) update has_discount on affected flights.';


--
-- Name: generate_member_account_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_member_account_id() RETURNS character varying
    LANGUAGE plpgsql
    AS $$
DECLARE
  current_year SMALLINT := EXTRACT(YEAR FROM CURRENT_DATE)::SMALLINT;
  allocated_value INTEGER;
BEGIN
  INSERT INTO member_account_counters (year, next_value)
  VALUES (current_year, 2)
  ON CONFLICT (year)
  DO UPDATE
  SET next_value = member_account_counters.next_value + 1
  RETURNING next_value - 1 INTO allocated_value;

  RETURN format('ME%s-%s', current_year, lpad(allocated_value::TEXT, 4, '0'));
END;
$$;


--
-- Name: generate_member_account_id(smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_member_account_id(member_category smallint) RETURNS character varying
    LANGUAGE plpgsql
    AS $$
DECLARE
  current_year SMALLINT := EXTRACT(YEAR FROM CURRENT_DATE)::SMALLINT;
  counter_key VARCHAR(16);
  account_prefix VARCHAR(8);
  counter_year SMALLINT;
  allocated_value INTEGER;
BEGIN
  IF member_category IN (5, 7) THEN
    account_prefix := 'EXT-';
    counter_year := NULL;
    counter_key := 'EXT';
  ELSIF member_category = 8 THEN
    account_prefix := 'FO-';
    counter_year := NULL;
    counter_key := 'FO';
  ELSE
    account_prefix := format('ME%s-', current_year);
    counter_year := current_year;
    counter_key := format('ME-%s', current_year);
  END IF;

  INSERT INTO member_account_counters (counter_key, account_prefix, account_year, next_value)
  VALUES (counter_key, account_prefix, counter_year, 2)
  ON CONFLICT (counter_key)
  DO UPDATE
  SET next_value = member_account_counters.next_value + 1
  RETURNING next_value - 1 INTO allocated_value;

  RETURN format('%s%s', account_prefix, lpad(allocated_value::TEXT, 4, '0'));
END;
$$;


--
-- Name: prevent_permanent_member_registrations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_permanent_member_registrations() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    current_category SMALLINT;
BEGIN
    SELECT member_category
      INTO current_category
      FROM members
     WHERE uuid = NEW.member_uuid;

    IF current_category IN (5, 7, 8) THEN
        RAISE EXCEPTION
            'Permanent members (categories 5, 7, 8) are managed from the edit screen and do not use annual registration periods'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: prevent_posted_entry_modification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_posted_entry_modification() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.state = 2 THEN
        RAISE EXCEPTION 'Cannot modify a posted accounting entry (uuid: %)', OLD.uuid;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: prevent_posted_line_modification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_posted_line_modification() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    entry_state SMALLINT;
BEGIN
    SELECT state INTO entry_state
      FROM accounting_entries
     WHERE uuid = COALESCE(NEW.entry_uuid, OLD.entry_uuid);

    IF entry_state = 2 THEN
        RAISE EXCEPTION 'Cannot modify lines of a posted accounting entry.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: set_member_account_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_member_account_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.account_id IS NULL OR btrim(NEW.account_id) = '' THEN
    NEW.account_id := generate_member_account_id(NEW.member_category);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounting_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_accounts (
    uuid uuid NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(255) NOT NULL,
    type smallint NOT NULL,
    parent_account_uuid uuid,
    is_posting_allowed boolean DEFAULT true NOT NULL,
    normal_balance smallint NOT NULL,
    is_reconcilable boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    archived_at timestamp with time zone,
    replacement_account_uuid uuid,
    require_id smallint DEFAULT 0 NOT NULL,
    CONSTRAINT chk_account_normal_balance CHECK ((normal_balance = ANY (ARRAY[1, 2]))),
    CONSTRAINT chk_account_require_id CHECK ((require_id = ANY (ARRAY[0, 1, 2, 3]))),
    CONSTRAINT chk_account_type CHECK ((type = ANY (ARRAY[1, 2, 3, 4, 5])))
);


--
-- Name: accounting_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_entries (
    uuid uuid NOT NULL,
    fiscal_year_uuid uuid NOT NULL,
    journal_uuid uuid NOT NULL,
    entry_date date NOT NULL,
    sequence_number character varying(64),
    reference character varying(255),
    source_document_ref character varying(255),
    source_document_date date,
    description character varying(255) NOT NULL,
    state smallint DEFAULT 1 NOT NULL,
    source_system character varying(64),
    external_id character varying(255),
    import_batch_id character varying(64),
    original_created_at timestamp with time zone,
    original_posted_at timestamp with time zone,
    reversal_of_entry_uuid uuid,
    reversal_reason character varying(255),
    entry_hash character varying(64),
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer NOT NULL,
    CONSTRAINT chk_entry_state CHECK ((state = ANY (ARRAY[1, 2, 3])))
)
PARTITION BY LIST (fiscal_year_uuid);


--
-- Name: accounting_entries_default; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_entries_default (
    uuid uuid CONSTRAINT accounting_entries_uuid_not_null NOT NULL,
    fiscal_year_uuid uuid CONSTRAINT accounting_entries_fiscal_year_uuid_not_null NOT NULL,
    journal_uuid uuid CONSTRAINT accounting_entries_journal_uuid_not_null NOT NULL,
    entry_date date CONSTRAINT accounting_entries_entry_date_not_null NOT NULL,
    sequence_number character varying(64),
    reference character varying(255),
    source_document_ref character varying(255),
    source_document_date date,
    description character varying(255) CONSTRAINT accounting_entries_description_not_null NOT NULL,
    state smallint DEFAULT 1 CONSTRAINT accounting_entries_state_not_null NOT NULL,
    source_system character varying(64),
    external_id character varying(255),
    import_batch_id character varying(64),
    original_created_at timestamp with time zone,
    original_posted_at timestamp with time zone,
    reversal_of_entry_uuid uuid,
    reversal_reason character varying(255),
    entry_hash character varying(64),
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT accounting_entries_created_at_not_null NOT NULL,
    created_by integer CONSTRAINT accounting_entries_created_by_not_null NOT NULL,
    CONSTRAINT chk_entry_state CHECK ((state = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: accounting_entries_fy2025; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_entries_fy2025 (
    uuid uuid CONSTRAINT accounting_entries_uuid_not_null NOT NULL,
    fiscal_year_uuid uuid CONSTRAINT accounting_entries_fiscal_year_uuid_not_null NOT NULL,
    journal_uuid uuid CONSTRAINT accounting_entries_journal_uuid_not_null NOT NULL,
    entry_date date CONSTRAINT accounting_entries_entry_date_not_null NOT NULL,
    sequence_number character varying(64),
    reference character varying(255),
    source_document_ref character varying(255),
    source_document_date date,
    description character varying(255) CONSTRAINT accounting_entries_description_not_null NOT NULL,
    state smallint DEFAULT 1 CONSTRAINT accounting_entries_state_not_null NOT NULL,
    source_system character varying(64),
    external_id character varying(255),
    import_batch_id character varying(64),
    original_created_at timestamp with time zone,
    original_posted_at timestamp with time zone,
    reversal_of_entry_uuid uuid,
    reversal_reason character varying(255),
    entry_hash character varying(64),
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT accounting_entries_created_at_not_null NOT NULL,
    created_by integer CONSTRAINT accounting_entries_created_by_not_null NOT NULL,
    CONSTRAINT chk_entry_state CHECK ((state = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: accounting_entries_fy2026; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_entries_fy2026 (
    uuid uuid CONSTRAINT accounting_entries_uuid_not_null NOT NULL,
    fiscal_year_uuid uuid CONSTRAINT accounting_entries_fiscal_year_uuid_not_null NOT NULL,
    journal_uuid uuid CONSTRAINT accounting_entries_journal_uuid_not_null NOT NULL,
    entry_date date CONSTRAINT accounting_entries_entry_date_not_null NOT NULL,
    sequence_number character varying(64),
    reference character varying(255),
    source_document_ref character varying(255),
    source_document_date date,
    description character varying(255) CONSTRAINT accounting_entries_description_not_null NOT NULL,
    state smallint DEFAULT 1 CONSTRAINT accounting_entries_state_not_null NOT NULL,
    source_system character varying(64),
    external_id character varying(255),
    import_batch_id character varying(64),
    original_created_at timestamp with time zone,
    original_posted_at timestamp with time zone,
    reversal_of_entry_uuid uuid,
    reversal_reason character varying(255),
    entry_hash character varying(64),
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT accounting_entries_created_at_not_null NOT NULL,
    created_by integer CONSTRAINT accounting_entries_created_by_not_null NOT NULL,
    CONSTRAINT chk_entry_state CHECK ((state = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: accounting_entry_template_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_entry_template_lines (
    uuid uuid NOT NULL,
    template_uuid uuid NOT NULL,
    account_uuid uuid NOT NULL,
    sort_order smallint NOT NULL,
    debit numeric(10,4) NOT NULL,
    credit numeric(10,4) NOT NULL,
    description character varying(255),
    formula_type character varying(16) DEFAULT 'fixed'::character varying NOT NULL,
    formula_params jsonb,
    tiers_uuid uuid,
    CONSTRAINT chk_entry_template_line_amounts_positive CHECK (((debit >= (0)::numeric) AND (credit >= (0)::numeric))),
    CONSTRAINT chk_entry_template_line_at_least_one_amount CHECK ((((formula_type)::text = 'rounding_adjustment'::text) OR (debit > (0)::numeric) OR (credit > (0)::numeric))),
    CONSTRAINT chk_template_line_formula_type CHECK (((formula_type)::text = ANY ((ARRAY['fixed'::character varying, 'percentage'::character varying, 'previous_period'::character varying, 'rounding_adjustment'::character varying])::text[])))
);


--
-- Name: COLUMN accounting_entry_template_lines.formula_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounting_entry_template_lines.formula_type IS 'Type de calcul : fixed, percentage, previous_period, rounding_adjustment';


--
-- Name: COLUMN accounting_entry_template_lines.formula_params; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounting_entry_template_lines.formula_params IS 'Paramètres JSON pour le calcul (ex: {"percentage": 20, "source_line_index": 0})';


--
-- Name: accounting_entry_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_entry_templates (
    uuid uuid NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(120) NOT NULL,
    journal_uuid uuid NOT NULL,
    description character varying(255),
    default_reference character varying(255),
    recurrence_type smallint NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    created_by integer NOT NULL,
    valid_from date,
    valid_until date,
    next_scheduled_date date,
    last_generated_at timestamp with time zone,
    last_generated_entry_uuid uuid,
    CONSTRAINT chk_entry_template_recurrence_type CHECK ((recurrence_type = ANY (ARRAY[1, 2, 3, 4])))
);


--
-- Name: COLUMN accounting_entry_templates.valid_from; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounting_entry_templates.valid_from IS 'Date à partir de laquelle le modèle est applicable (inclusive)';


--
-- Name: COLUMN accounting_entry_templates.valid_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounting_entry_templates.valid_until IS 'Date jusqu''à laquelle le modèle est applicable (inclusive)';


--
-- Name: COLUMN accounting_entry_templates.next_scheduled_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounting_entry_templates.next_scheduled_date IS 'Prochaine date d''échéance calculée après la dernière génération';


--
-- Name: COLUMN accounting_entry_templates.last_generated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounting_entry_templates.last_generated_at IS 'Horodatage de la dernière génération';


--
-- Name: COLUMN accounting_entry_templates.last_generated_entry_uuid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounting_entry_templates.last_generated_entry_uuid IS 'UUID de la dernière écriture générée (référence applicative, pas de FK)';


--
-- Name: accounting_fiscal_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_fiscal_years (
    uuid uuid NOT NULL,
    code character varying(16) NOT NULL,
    label character varying(64) NOT NULL,
    year smallint NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    state smallint DEFAULT 1 NOT NULL,
    closed_at timestamp with time zone,
    closed_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_fy_dates CHECK ((end_date > start_date)),
    CONSTRAINT chk_fy_state CHECK ((state = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: accounting_journals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_journals (
    uuid uuid NOT NULL,
    code character varying(10) NOT NULL,
    name character varying(100) NOT NULL,
    type smallint NOT NULL,
    default_account_uuid uuid,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_journal_type CHECK ((type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7])))
);


--
-- Name: accounting_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_lines (
    uuid uuid NOT NULL,
    fiscal_year_uuid uuid NOT NULL,
    entry_uuid uuid NOT NULL,
    account_uuid uuid NOT NULL,
    debit numeric(10,4) DEFAULT 0.0000 NOT NULL,
    credit numeric(10,4) DEFAULT 0.0000 NOT NULL,
    description character varying(255),
    tax_id uuid,
    tax_code character varying(64),
    tax_rate numeric(10,4),
    tax_base numeric(10,4),
    tax_amount numeric(10,4),
    tiers_uuid uuid,
    CONSTRAINT chk_line_amounts_positive CHECK (((debit >= (0)::numeric) AND (credit >= (0)::numeric))),
    CONSTRAINT chk_line_at_least_one_amount CHECK (((debit > (0)::numeric) OR (credit > (0)::numeric)))
)
PARTITION BY LIST (fiscal_year_uuid);


--
-- Name: accounting_lines_default; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_lines_default (
    uuid uuid CONSTRAINT accounting_lines_uuid_not_null NOT NULL,
    fiscal_year_uuid uuid CONSTRAINT accounting_lines_fiscal_year_uuid_not_null NOT NULL,
    entry_uuid uuid CONSTRAINT accounting_lines_entry_uuid_not_null NOT NULL,
    account_uuid uuid CONSTRAINT accounting_lines_account_uuid_not_null NOT NULL,
    debit numeric(10,4) DEFAULT 0.0000 CONSTRAINT accounting_lines_debit_not_null NOT NULL,
    credit numeric(10,4) DEFAULT 0.0000 CONSTRAINT accounting_lines_credit_not_null NOT NULL,
    description character varying(255),
    tax_id uuid,
    tax_code character varying(64),
    tax_rate numeric(10,4),
    tax_base numeric(10,4),
    tax_amount numeric(10,4),
    tiers_uuid uuid,
    CONSTRAINT chk_line_amounts_positive CHECK (((debit >= (0)::numeric) AND (credit >= (0)::numeric))),
    CONSTRAINT chk_line_at_least_one_amount CHECK (((debit > (0)::numeric) OR (credit > (0)::numeric)))
);


--
-- Name: accounting_lines_fy2025; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_lines_fy2025 (
    uuid uuid CONSTRAINT accounting_lines_uuid_not_null NOT NULL,
    fiscal_year_uuid uuid CONSTRAINT accounting_lines_fiscal_year_uuid_not_null NOT NULL,
    entry_uuid uuid CONSTRAINT accounting_lines_entry_uuid_not_null NOT NULL,
    account_uuid uuid CONSTRAINT accounting_lines_account_uuid_not_null NOT NULL,
    debit numeric(10,4) DEFAULT 0.0000 CONSTRAINT accounting_lines_debit_not_null NOT NULL,
    credit numeric(10,4) DEFAULT 0.0000 CONSTRAINT accounting_lines_credit_not_null NOT NULL,
    description character varying(255),
    tax_id uuid,
    tax_code character varying(64),
    tax_rate numeric(10,4),
    tax_base numeric(10,4),
    tax_amount numeric(10,4),
    tiers_uuid uuid,
    CONSTRAINT chk_line_amounts_positive CHECK (((debit >= (0)::numeric) AND (credit >= (0)::numeric))),
    CONSTRAINT chk_line_at_least_one_amount CHECK (((debit > (0)::numeric) OR (credit > (0)::numeric)))
);


--
-- Name: accounting_lines_fy2026; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_lines_fy2026 (
    uuid uuid CONSTRAINT accounting_lines_uuid_not_null NOT NULL,
    fiscal_year_uuid uuid CONSTRAINT accounting_lines_fiscal_year_uuid_not_null NOT NULL,
    entry_uuid uuid CONSTRAINT accounting_lines_entry_uuid_not_null NOT NULL,
    account_uuid uuid CONSTRAINT accounting_lines_account_uuid_not_null NOT NULL,
    debit numeric(10,4) DEFAULT 0.0000 CONSTRAINT accounting_lines_debit_not_null NOT NULL,
    credit numeric(10,4) DEFAULT 0.0000 CONSTRAINT accounting_lines_credit_not_null NOT NULL,
    description character varying(255),
    tax_id uuid,
    tax_code character varying(64),
    tax_rate numeric(10,4),
    tax_base numeric(10,4),
    tax_amount numeric(10,4),
    tiers_uuid uuid,
    CONSTRAINT chk_line_amounts_positive CHECK (((debit >= (0)::numeric) AND (credit >= (0)::numeric))),
    CONSTRAINT chk_line_at_least_one_amount CHECK (((debit > (0)::numeric) OR (credit > (0)::numeric)))
);


--
-- Name: asset_account_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_account_snapshots (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    asset_uuid uuid NOT NULL,
    account_uuid uuid NOT NULL,
    account_code character varying(64) NOT NULL,
    account_name character varying(255) NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_depreciation_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_depreciation_schedules (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    asset_uuid uuid NOT NULL,
    fiscal_year_uuid uuid NOT NULL,
    depreciation_amount numeric(10,4) NOT NULL,
    accumulated_depreciation numeric(10,4) NOT NULL,
    net_book_value numeric(10,4) NOT NULL,
    accounting_entry_uuid uuid,
    status smallint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    CONSTRAINT chk_asset_depr_non_negative CHECK (((depreciation_amount >= (0)::numeric) AND (accumulated_depreciation >= (0)::numeric) AND (net_book_value >= (0)::numeric))),
    CONSTRAINT chk_asset_depr_status CHECK ((status = ANY (ARRAY[1, 2])))
);


--
-- Name: asset_flight_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_flight_types (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    launch_type integer
);


--
-- Name: COLUMN asset_flight_types.launch_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.asset_flight_types.launch_type IS 'Planche launch_type (tow: 0=remorquage, 1=dépannage, 2=convoyage; winch: 0=normal, 1=exercise, 2=cable break)';


--
-- Name: asset_private_owners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_private_owners (
    asset_uuid uuid NOT NULL,
    member_uuid uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by integer
);


--
-- Name: asset_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_products (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(120) NOT NULL,
    category smallint NOT NULL,
    unit_type character varying(32) NOT NULL,
    unit_price numeric(10,4) DEFAULT 0.0000 NOT NULL,
    asset_type_uuid uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_asset_products_category CHECK ((category = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT chk_asset_products_price CHECK ((unit_price >= (0)::numeric))
);


--
-- Name: asset_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_status_history (
    uuid uuid NOT NULL,
    asset_uuid uuid NOT NULL,
    status smallint NOT NULL,
    reason character varying(255),
    changed_at timestamp with time zone NOT NULL,
    changed_by integer,
    CONSTRAINT chk_asset_sh_status CHECK ((status = ANY (ARRAY[1, 2, 3, 4, 5])))
);


--
-- Name: asset_stock_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_stock_entries (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    stock_item_uuid uuid NOT NULL,
    transaction_type smallint NOT NULL,
    quantity_delta numeric(10,4) NOT NULL,
    unit_cost numeric(10,4),
    reference_document character varying(100),
    notes character varying(255),
    transaction_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    CONSTRAINT chk_stock_entries_type CHECK ((transaction_type = ANY (ARRAY[1, 2, 3, 4, 5])))
);


--
-- Name: asset_stock_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_stock_items (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_uuid uuid NOT NULL,
    asset_type_uuid uuid,
    quantity_on_hand numeric(10,4) DEFAULT 0.0000 NOT NULL,
    unit character varying(32) NOT NULL,
    cost_method smallint NOT NULL,
    standard_cost_per_unit numeric(10,4),
    reorder_point numeric(10,4) DEFAULT 0.0000 NOT NULL,
    storage_location character varying(100),
    last_restocked_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_stock_items_cost_method CHECK ((cost_method = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT chk_stock_items_non_negative CHECK (((quantity_on_hand >= (0)::numeric) AND (reorder_point >= (0)::numeric) AND ((standard_cost_per_unit IS NULL) OR (standard_cost_per_unit >= (0)::numeric))))
);


--
-- Name: asset_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_types (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(100) NOT NULL,
    category smallint NOT NULL,
    pricing_strategy smallint NOT NULL,
    is_trackable_in_ledger boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    standard_depreciation_years integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    CONSTRAINT chk_asset_types_category CHECK ((category = ANY (ARRAY[1, 2, 3, 4, 5]))),
    CONSTRAINT chk_asset_types_depr_years CHECK (((standard_depreciation_years IS NULL) OR (standard_depreciation_years > 0))),
    CONSTRAINT chk_asset_types_pricing_strategy CHECK ((pricing_strategy = ANY (ARRAY[1, 2, 3, 4, 5, 6])))
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    asset_type_uuid uuid NOT NULL,
    code character varying(64) NOT NULL,
    name character varying(150) NOT NULL,
    registration character varying(32),
    serial_number character varying(100),
    manufacturer character varying(100),
    model character varying(100),
    year_of_manufacture smallint,
    ownership smallint NOT NULL,
    purchase_date date,
    purchase_price numeric(10,4),
    acquisition_account_uuid uuid,
    accounting_account_code_snapshot character varying(32),
    status smallint DEFAULT 1 NOT NULL,
    depreciation_start_date date,
    depreciation_years smallint,
    residual_value numeric(10,4),
    useful_life_years smallint,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    osrt_sync_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_asset_status CHECK ((status = ANY (ARRAY[1, 2, 3, 4, 5]))),
    CONSTRAINT chk_assets_depr_years CHECK (((depreciation_years IS NULL) OR (depreciation_years > 0))),
    CONSTRAINT chk_assets_ownership CHECK ((ownership = ANY (ARRAY[1, 2]))),
    CONSTRAINT chk_assets_prices_positive CHECK (((purchase_price IS NULL) OR (purchase_price >= (0)::numeric))),
    CONSTRAINT chk_assets_residual_le_purchase CHECK (((residual_value IS NULL) OR (purchase_price IS NULL) OR (residual_value <= purchase_price))),
    CONSTRAINT chk_assets_residual_positive CHECK (((residual_value IS NULL) OR (residual_value >= (0)::numeric)))
);


--
-- Name: COLUMN assets.osrt_sync_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assets.osrt_sync_enabled IS 'Opt-in pour la déclaration des activités machine vers OSRT. FALSE par défaut (aucun envoi).';


--
-- Name: auth_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_challenges (
    id integer NOT NULL,
    user_id integer NOT NULL,
    pin_hash character varying(255) NOT NULL,
    attempts_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: auth_challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auth_challenges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auth_challenges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auth_challenges_id_seq OWNED BY public.auth_challenges.id;


--
-- Name: capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capabilities (
    id integer NOT NULL,
    code character varying(64) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: capabilities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.capabilities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: capabilities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.capabilities_id_seq OWNED BY public.capabilities.id;


--
-- Name: committee_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committee_members (
    committee_uuid uuid NOT NULL,
    member_uuid uuid NOT NULL,
    membership_year smallint NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by integer,
    CONSTRAINT chk_committee_members_membership_year CHECK (((membership_year >= 2000) AND (membership_year <= 9999)))
);


--
-- Name: TABLE committee_members; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.committee_members IS 'Yearly committee membership assignments for members.';


--
-- Name: committees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.committees (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(32) NOT NULL,
    description character varying(255) NOT NULL,
    budget_amount numeric(12,2),
    manager_member_uuid uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by integer,
    last_meeting_date date,
    budget_status smallint,
    CONSTRAINT chk_committees_budget_amount CHECK (((budget_amount IS NULL) OR (budget_amount >= (0)::numeric))),
    CONSTRAINT chk_committees_budget_status CHECK (((budget_status IS NULL) OR ((budget_status >= 1) AND (budget_status <= 3))))
);


--
-- Name: TABLE committees; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.committees IS 'Committees with optional manager and optional budget.';


--
-- Name: cost_accrual_staging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_accrual_staging (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cost_provision_rule_uuid uuid NOT NULL,
    asset_uuid uuid NOT NULL,
    metric_date date NOT NULL,
    metric_value numeric(10,4) NOT NULL,
    cost_amount numeric(10,4) NOT NULL,
    is_accrued boolean DEFAULT false NOT NULL,
    accrual_entry_uuid uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_cost_staging_non_negative CHECK (((metric_value >= (0)::numeric) AND (cost_amount >= (0)::numeric)))
);


--
-- Name: cost_provision_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_provision_rules (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    asset_type_uuid uuid NOT NULL,
    fiscal_year_uuid uuid NOT NULL,
    metric_name character varying(32) NOT NULL,
    cost_per_unit numeric(10,4) NOT NULL,
    gl_account_debit_uuid uuid NOT NULL,
    gl_account_credit_uuid uuid NOT NULL,
    accrual_method smallint NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    CONSTRAINT chk_cost_rules_accrual_method CHECK ((accrual_method = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT chk_cost_rules_cost_per_unit CHECK ((cost_per_unit > (0)::numeric)),
    CONSTRAINT chk_cost_rules_distinct_gl CHECK ((gl_account_debit_uuid <> gl_account_credit_uuid)),
    CONSTRAINT chk_cost_rules_metric CHECK (((metric_name)::text = ANY (ARRAY[('engine_hours'::character varying)::text, ('winch_launches'::character varying)::text, ('flight_hours'::character varying)::text, ('landings'::character varying)::text])))
);


--
-- Name: federal_sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.federal_sync_logs (
    uuid uuid NOT NULL,
    validated_flight_uuid uuid NOT NULL,
    platform character varying(16) NOT NULL,
    status smallint NOT NULL,
    external_id character varying(64),
    attempt_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT chk_fsl_platform CHECK (((platform)::text = ANY ((ARRAY['gesasso'::character varying, 'osrt'::character varying])::text[]))),
    CONSTRAINT chk_fsl_status CHECK ((status = ANY (ARRAY[0, 1, 2, 3, 4])))
);


--
-- Name: flight_billing_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flight_billing_settings (
    id integer NOT NULL,
    fiscal_year_uuid uuid NOT NULL,
    fl_journal_uuid uuid NOT NULL,
    receivable_account_uuid uuid NOT NULL,
    vt_journal_uuid uuid NOT NULL,
    default_pack_sales_account_uuid uuid,
    rem_journal_uuid uuid NOT NULL,
    default_pack_discount_expense_account_uuid uuid,
    rem_period_days integer DEFAULT 30 NOT NULL,
    allow_post_purchase_recalculation boolean DEFAULT true CONSTRAINT flight_billing_settings_allow_post_purchase_recalculat_not_null NOT NULL,
    max_days_for_post_purchase_discount integer DEFAULT 30,
    require_approval_for_late_discount boolean DEFAULT true CONSTRAINT flight_billing_settings_require_approval_for_late_disc_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by integer,
    default_initiation_charge_account_uuid uuid,
    club_member_uuid uuid,
    club_charge_account_uuid uuid,
    deposit_journal_uuid uuid,
    deposit_bank_account_uuid uuid,
    deposit_receivable_account_uuid uuid,
    CONSTRAINT flight_billing_settings_rem_period_days_check CHECK ((rem_period_days > 0))
);


--
-- Name: TABLE flight_billing_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.flight_billing_settings IS 'Typed flight billing configuration per fiscal year — journals paired with accounts';


--
-- Name: COLUMN flight_billing_settings.club_charge_account_uuid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.flight_billing_settings.club_charge_account_uuid IS 'Charge account for flights explicitly billed to the club (charge_to_erp_id matches club member)';


--
-- Name: COLUMN flight_billing_settings.deposit_journal_uuid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.flight_billing_settings.deposit_journal_uuid IS 'Journal for member deposits (e.g. BQ or CAISSE)';


--
-- Name: COLUMN flight_billing_settings.deposit_bank_account_uuid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.flight_billing_settings.deposit_bank_account_uuid IS 'Bank/cash account debited on member deposit';


--
-- Name: COLUMN flight_billing_settings.deposit_receivable_account_uuid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.flight_billing_settings.deposit_receivable_account_uuid IS 'Member receivable account credited on deposit (e.g. 411)';


--
-- Name: flight_billing_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.flight_billing_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: flight_billing_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.flight_billing_settings_id_seq OWNED BY public.flight_billing_settings.id;


--
-- Name: helloasso_vi_staging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.helloasso_vi_staging (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id bigint NOT NULL,
    full_name character varying(255),
    email character varying(255),
    phone character varying(64),
    amount_cents integer,
    form_slug character varying(128),
    purchased_at timestamp with time zone,
    promoted_vi_uuid uuid,
    promoted_at timestamp with time zone,
    status smallint DEFAULT 1 NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_helloasso_vi_staging_amount_cents CHECK (((amount_cents IS NULL) OR (amount_cents >= 0))),
    CONSTRAINT chk_helloasso_vi_staging_status CHECK (((status >= 1) AND (status <= 3)))
);


--
-- Name: member_account_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_account_counters (
    year smallint NOT NULL,
    next_value integer NOT NULL,
    CONSTRAINT member_account_counters_next_value_check CHECK ((next_value >= 1))
);


--
-- Name: member_pack_consumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_pack_consumptions (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    tiers_uuid uuid CONSTRAINT member_pack_consumptions_member_uuid_not_null NOT NULL,
    flight_uuid uuid NOT NULL,
    pack_type character varying(32) NOT NULL,
    quantity_consumed numeric(10,2) NOT NULL,
    discount_unit_price numeric(10,2) NOT NULL,
    total_discount_amount numeric(10,2) NOT NULL,
    accounting_entry_uuid uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    pack_definition_uuid uuid
);


--
-- Name: TABLE member_pack_consumptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.member_pack_consumptions IS 'Operational tracking of pack units consumed per flight per member';


--
-- Name: COLUMN member_pack_consumptions.pack_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_pack_consumptions.pack_type IS 'flight_hours | winch_launches | tow_launches | engine_time';


--
-- Name: COLUMN member_pack_consumptions.discount_unit_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_pack_consumptions.discount_unit_price IS 'base_price − pack_price';


--
-- Name: COLUMN member_pack_consumptions.total_discount_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_pack_consumptions.total_discount_amount IS 'quantity_consumed × discount_unit_price';


--
-- Name: COLUMN member_pack_consumptions.valid_from; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_pack_consumptions.valid_from IS 'Pack is applicable only to flights on or after this date';


--
-- Name: COLUMN member_pack_consumptions.pack_definition_uuid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_pack_consumptions.pack_definition_uuid IS 'Which pack definition this consumption was applied to. NULL for legacy rows.';


--
-- Name: member_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_registrations (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    member_uuid uuid NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    registered_for_year smallint NOT NULL,
    registration_type smallint NOT NULL,
    status smallint DEFAULT 1 NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    registered_by integer,
    notes text,
    CONSTRAINT chk_member_registrations_date_range CHECK ((end_date >= start_date)),
    CONSTRAINT chk_member_registrations_status CHECK (((status >= 1) AND (status <= 3))),
    CONSTRAINT chk_member_registrations_type CHECK (((registration_type >= 1) AND (registration_type <= 8))),
    CONSTRAINT chk_member_registrations_year CHECK (((registered_for_year >= 2000) AND (registered_for_year <= 9999)))
);


--
-- Name: TABLE member_registrations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.member_registrations IS 'Dated member registration periods. A member is registered for a year when an active period overlaps that calendar year.';


--
-- Name: COLUMN member_registrations.registration_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_registrations.registration_type IS 'Snapshot of member category at registration time: 1=Full, 2=Temporary, 3=Non-Flying, 4=Short Period, 5=External Pilot, 6=Volunteer.';


--
-- Name: COLUMN member_registrations.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_registrations.status IS '1=Active, 2=Cancelled, 3=Superseded.';


--
-- Name: member_sheets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_sheets (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    member_uuid uuid NOT NULL,
    year smallint NOT NULL,
    licence_number character varying(100),
    fare_type smallint NOT NULL,
    hours_count numeric(8,2) DEFAULT 0 NOT NULL,
    expense_access_token_hash character varying(255),
    expense_access_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by integer,
    portal_password_hash character varying(255),
    season_start_date date,
    season_end_date date,
    CONSTRAINT chk_member_sheets_fare_type CHECK (((fare_type >= 1) AND (fare_type <= 5))),
    CONSTRAINT chk_member_sheets_hours_count CHECK ((hours_count >= (0)::numeric)),
    CONSTRAINT chk_member_sheets_year CHECK (((year >= 2000) AND (year <= 9999)))
);


--
-- Name: TABLE member_sheets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.member_sheets IS 'Yearly flying member summary and expense access controls.';


--
-- Name: COLUMN member_sheets.fare_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_sheets.fare_type IS '1=Standard, 2=Student, 3=Discovery, 4=Pack, 5=Other.';


--
-- Name: COLUMN member_sheets.portal_password_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_sheets.portal_password_hash IS 'SHA256 hash of portal password. If NULL, default password = {ffvp_id}_{YYYYMMDD} (date of birth)';


--
-- Name: COLUMN member_sheets.season_start_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_sheets.season_start_date IS 'Début de validité de la licence GesAsso (seasonStartDate)';


--
-- Name: COLUMN member_sheets.season_end_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_sheets.season_end_date IS 'Fin de validité de la licence GesAsso (seasonEndDate) — badge Expirée si < aujourd''hui';


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    uuid uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    genre smallint DEFAULT 0 NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    date_of_birth date,
    email character varying(255),
    phone character varying(50),
    member_category smallint NOT NULL,
    ffvp_id bigint,
    account_id character varying(32) DEFAULT public.generate_member_account_id() NOT NULL,
    photo_url text,
    is_active boolean DEFAULT true NOT NULL,
    status smallint DEFAULT 1 NOT NULL,
    registration_status smallint DEFAULT 1 NOT NULL,
    is_instructor boolean DEFAULT false NOT NULL,
    is_employee boolean DEFAULT false NOT NULL,
    is_executive boolean DEFAULT false NOT NULL,
    is_board_member boolean DEFAULT false NOT NULL,
    can_fly boolean DEFAULT false NOT NULL,
    external_auth_enabled boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by integer,
    first_subscription_year smallint,
    last_registration_date date,
    trigram character varying(3),
    legacy_account_id character varying(32),
    CONSTRAINT chk_members_account_id_format CHECK (((account_id)::text ~ '^(ME[0-9]{4}-[0-9]{4}|EXT-[0-9]{4}|FO-[0-9]{4})$'::text)),
    CONSTRAINT chk_members_category CHECK (((member_category >= 1) AND (member_category <= 8))),
    CONSTRAINT chk_members_first_subscription_year CHECK (((first_subscription_year IS NULL) OR ((first_subscription_year >= 1950) AND (first_subscription_year <= 9999)))),
    CONSTRAINT chk_members_genre CHECK (((genre >= 0) AND (genre <= 3))),
    CONSTRAINT chk_members_registration_status CHECK (((registration_status >= 1) AND (registration_status <= 2))),
    CONSTRAINT chk_members_role_employee_board CHECK ((NOT (is_employee AND is_board_member))),
    CONSTRAINT chk_members_role_employee_executive CHECK ((NOT (is_employee AND is_executive))),
    CONSTRAINT chk_members_status CHECK (((status >= 1) AND (status <= 3)))
);


--
-- Name: TABLE members; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.members IS 'Club members with identity, category, operational flags, and lifecycle state.';


--
-- Name: COLUMN members.member_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.member_category IS '1=Full Member, 2=Temporary Member, 3=Non-Flying Member, 4=Short Period Member, 5=External Pilot, 6=Volunteer.';


--
-- Name: COLUMN members.account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.account_id IS 'Stable member and ledger identifier, formatted as ME<YEAR>-<SEQUENCE>.';


--
-- Name: COLUMN members.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.status IS '1=Active, 2=Suspended, 3=Resigned, 4=Anonymized.';


--
-- Name: COLUMN members.registration_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.registration_status IS '1=Draft, 2=In Progress, 3=Completed, 4=Archived.';


--
-- Name: pack_applicability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pack_applicability (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    pack_definition_uuid uuid NOT NULL,
    pricing_item_uuid uuid NOT NULL,
    discounted_unit_price numeric(10,4) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE pack_applicability; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pack_applicability IS 'Links a pack definition to a pricing item with a discounted unit price';


--
-- Name: COLUMN pack_applicability.discounted_unit_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pack_applicability.discounted_unit_price IS 'Unit price when billed under this pack (e.g. 20.0000 instead of 100.0000)';


--
-- Name: pack_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pack_definitions (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(100) NOT NULL,
    pack_type character varying(32) NOT NULL,
    quantity_allowance numeric(10,2) NOT NULL,
    quantity_unit character varying(32) DEFAULT 'hours'::character varying NOT NULL,
    pack_sales_account_uuid uuid,
    pack_discount_expense_account_uuid uuid,
    priority integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    eligible_asset_type_uuid uuid,
    flights_journal_uuid uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_pack_definitions_type CHECK (((pack_type)::text = ANY ((ARRAY['flight_hours'::character varying, 'winch_launches'::character varying, 'tow_launches'::character varying, 'engine_time'::character varying])::text[])))
);


--
-- Name: TABLE pack_definitions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pack_definitions IS 'Pack catalog template: defines type, quantity allowance, and accounts';


--
-- Name: COLUMN pack_definitions.pack_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pack_definitions.pack_type IS 'flight_hours | winch_launches | tow_launches | engine_time';


--
-- Name: COLUMN pack_definitions.quantity_allowance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pack_definitions.quantity_allowance IS 'Base quantity included in one pack purchase (e.g. 25.00 hours)';


--
-- Name: COLUMN pack_definitions.quantity_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pack_definitions.quantity_unit IS 'hours | launches | centihours';


--
-- Name: COLUMN pack_definitions.pack_sales_account_uuid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pack_definitions.pack_sales_account_uuid IS 'Credit account for pack purchase revenue, normally class 7 (overrides default)';


--
-- Name: COLUMN pack_definitions.pack_discount_expense_account_uuid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pack_definitions.pack_discount_expense_account_uuid IS 'Debit account for REM pack discount expense, normally class 6 (overrides default)';


--
-- Name: planche_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planche_audit_log (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    operation_type character varying NOT NULL,
    affected_record_id character varying,
    status smallint DEFAULT 0 NOT NULL,
    result_summary character varying,
    error_message text,
    total_records integer DEFAULT 0,
    success_count integer DEFAULT 0,
    failure_count integer DEFAULT 0,
    triggered_by character varying,
    audit_metadata text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: planche_flight_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planche_flight_snapshots (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    planche_uuid character varying NOT NULL,
    planche_revision integer DEFAULT 1 NOT NULL,
    source_hash character varying(64) NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at_source timestamp with time zone,
    corrected_at timestamp with time zone,
    corrected_by character varying,
    correction_reason text,
    ack_status character varying(32) DEFAULT 'not_acknowledged'::character varying NOT NULL,
    ack_at timestamp with time zone,
    ack_error text,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pricing_item_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_item_tiers (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    pricing_item_uuid uuid NOT NULL,
    from_qty numeric(10,4) NOT NULL,
    price numeric(10,4) NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    CONSTRAINT chk_pricing_item_tiers_from_qty CHECK ((from_qty > (0)::numeric)),
    CONSTRAINT chk_pricing_item_tiers_price CHECK ((price >= (0)::numeric))
);


--
-- Name: pricing_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_items (
    uuid uuid NOT NULL,
    pricing_version_uuid uuid NOT NULL,
    flight_type_uuid uuid,
    name character varying(120) NOT NULL,
    unit smallint NOT NULL,
    base_price numeric(10,4) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    age_discount_percent numeric(5,2) DEFAULT 0 NOT NULL,
    gl_account_credit_uuid uuid,
    is_progressive boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_pricing_items_age_discount CHECK (((age_discount_percent >= (0)::numeric) AND (age_discount_percent <= (100)::numeric))),
    CONSTRAINT chk_pricing_items_base_price CHECK ((base_price >= (0)::numeric)),
    CONSTRAINT chk_pricing_items_unit CHECK ((unit = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7])))
);


--
-- Name: pricing_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_versions (
    uuid uuid NOT NULL,
    fiscal_year_uuid uuid,
    asset_type_uuid uuid,
    name character varying(100) NOT NULL,
    from_date date NOT NULL,
    to_date date,
    status smallint DEFAULT 1 NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    use_pack boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_pricing_version_dates CHECK (((to_date IS NULL) OR (to_date >= from_date))),
    CONSTRAINT chk_pricing_version_status CHECK ((status = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: role_capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_capabilities (
    id integer NOT NULL,
    role_id integer NOT NULL,
    capability_id integer NOT NULL,
    scope character varying(32) DEFAULT 'all'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT role_capabilities_scope_check CHECK (((scope)::text = ANY (ARRAY[('all'::character varying)::text, ('own'::character varying)::text])))
);


--
-- Name: role_capabilities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_capabilities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_capabilities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.role_capabilities_id_seq OWNED BY public.role_capabilities.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    code smallint NOT NULL,
    slug character varying(64) NOT NULL,
    name character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: scheduler_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduler_locks (
    job_id character varying(64) NOT NULL,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_by character varying(128)
);


--
-- Name: TABLE scheduler_locks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.scheduler_locks IS 'Verrou distribué pour protéger la génération manuelle contre les doubles-clics';


--
-- Name: session_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token_hash character varying(255) NOT NULL,
    token_kind smallint NOT NULL,
    auth_level smallint NOT NULL,
    challenge_id integer,
    trusted_device_id integer,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    ip_address text,
    user_agent text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT session_tokens_auth_level_check CHECK ((auth_level = ANY (ARRAY[1, 2]))),
    CONSTRAINT session_tokens_token_kind_check CHECK ((token_kind = ANY (ARRAY[1, 2])))
);


--
-- Name: session_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.session_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: session_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.session_tokens_id_seq OWNED BY public.session_tokens.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id bigint NOT NULL,
    module_name character varying(64) NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by integer
);


--
-- Name: system_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_settings_id_seq OWNED BY public.system_settings.id;


--
-- Name: trusted_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trusted_devices (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token_hash character varying(255) NOT NULL,
    device_name character varying(255),
    ip_address text,
    user_agent text,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: trusted_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trusted_devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trusted_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trusted_devices_id_seq OWNED BY public.trusted_devices.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id integer NOT NULL,
    user_id integer NOT NULL,
    role_id integer NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: user_roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_roles_id_seq OWNED BY public.user_roles.id;


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id integer NOT NULL,
    user_id integer NOT NULL,
    language character varying(10) DEFAULT 'fr'::character varying NOT NULL,
    timezone character varying(50) DEFAULT 'Europe/Paris'::character varying NOT NULL,
    can_change_password boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: user_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_settings_id_seq OWNED BY public.user_settings.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    nom character varying(255),
    prenom character varying(255),
    auth_expiration_date date,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT email_not_empty CHECK (((email)::text <> ''::text))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: v_active_full_sessions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_active_full_sessions AS
 SELECT st.id,
    st.user_id,
    u.email,
    st.expires_at,
    st.ip_address,
    st.user_agent,
    td.device_name,
    td.expires_at AS trusted_device_expires_at
   FROM ((public.session_tokens st
     JOIN public.users u ON ((u.id = st.user_id)))
     LEFT JOIN public.trusted_devices td ON ((td.id = st.trusted_device_id)))
  WHERE ((st.auth_level = 2) AND (st.token_kind = 2) AND (st.revoked_at IS NULL) AND (st.expires_at > CURRENT_TIMESTAMP));


--
-- Name: v_user_capabilities; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_capabilities AS
 SELECT DISTINCT u.id AS user_id,
    u.email,
    c.code AS capability_code,
    c.name AS capability_name,
    rc.scope
   FROM ((((public.users u
     JOIN public.user_roles ur ON ((ur.user_id = u.id)))
     JOIN public.roles r ON ((r.id = ur.role_id)))
     JOIN public.role_capabilities rc ON ((rc.role_id = r.id)))
     JOIN public.capabilities c ON ((c.id = rc.capability_id)));


--
-- Name: v_user_roles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_roles AS
 SELECT u.id AS user_id,
    u.email,
    r.code AS role_code,
    r.slug AS role_slug,
    r.name AS role_name
   FROM ((public.users u
     JOIN public.user_roles ur ON ((ur.user_id = u.id)))
     JOIN public.roles r ON ((r.id = ur.role_id)));


--
-- Name: validated_flights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.validated_flights (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    planche_uuid character varying NOT NULL,
    source_snapshot_uuid uuid,
    aero character varying,
    jour date NOT NULL,
    asset_code character varying NOT NULL,
    pilot_erp_id character varying NOT NULL,
    pilot_compta_id character varying,
    second_pilot_erp_id character varying,
    second_pilot_id character varying,
    charge_to_erp_id character varying,
    charge_to_compta_id character varying,
    instruction_split integer DEFAULT 0 NOT NULL,
    vi_erp_id character varying,
    type_of_flight integer NOT NULL,
    launch_method integer NOT NULL,
    launch_type integer,
    launch_asset_code character varying,
    launch_pilot_trigram character varying,
    launch_instructor_trigram character varying,
    takeoff_time character varying NOT NULL,
    landing_time character varying NOT NULL,
    start_index double precision,
    stop_index double precision,
    engine_time double precision,
    landing_count integer DEFAULT 1 NOT NULL,
    flight_km double precision,
    takeoff_location character varying,
    landed_location character varying,
    observations text,
    erp_status integer DEFAULT 0 NOT NULL,
    validated_at timestamp with time zone DEFAULT now() NOT NULL,
    validated_by character varying NOT NULL,
    transferred_at timestamp with time zone,
    transferred_by character varying,
    last_export_hash character varying,
    revision integer DEFAULT 1 NOT NULL,
    source_status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    corrected_at timestamp with time zone,
    corrected_by character varying,
    correction_reason text,
    accounting_entry_uuid uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    glider_erp_id character varying,
    launch_machine_erp_id character varying,
    billing_quote_state character varying(32),
    charge_comment text,
    has_discount boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_vf_erp_status CHECK ((erp_status = ANY (ARRAY[0, 1, 2]))),
    CONSTRAINT chk_vf_landing_count CHECK ((landing_count >= 1)),
    CONSTRAINT chk_vf_launch_method CHECK (((launch_method >= 0) AND (launch_method <= 3))),
    CONSTRAINT chk_vf_type_of_flight CHECK (((type_of_flight >= 0) AND (type_of_flight <= 7)))
);


--
-- Name: COLUMN validated_flights.accounting_entry_uuid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.validated_flights.accounting_entry_uuid IS 'Link to the FL journal accounting entry (gross billing)';


--
-- Name: COLUMN validated_flights.billing_quote_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.validated_flights.billing_quote_state IS 'quoted | applied | superseded | corrected | NULL';


--
-- Name: COLUMN validated_flights.has_discount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.validated_flights.has_discount IS 'True when pack discount has been applied to this flight';


--
-- Name: vi_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vi_entitlements (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(64) NOT NULL,
    vi_type_uuid uuid NOT NULL,
    description text,
    validity_date date,
    scheduled_date date,
    realisation_date date,
    partner_code character varying(64),
    origin_type smallint DEFAULT 4 NOT NULL,
    origin_ref character varying(128),
    notes text,
    status smallint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by integer,
    CONSTRAINT chk_vi_entitlements_date_consistency CHECK (((realisation_date IS NULL) OR (scheduled_date IS NULL) OR (realisation_date >= scheduled_date))),
    CONSTRAINT chk_vi_entitlements_origin_type CHECK (((origin_type >= 1) AND (origin_type <= 5))),
    CONSTRAINT chk_vi_entitlements_status CHECK (((status >= 1) AND (status <= 6)))
);


--
-- Name: vi_type_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vi_type_catalog (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by integer,
    charge_account_uuid uuid
);


--
-- Name: vw_member_pack_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_member_pack_balances AS
 WITH pack_purchases AS (
         SELECT al.tiers_uuid AS member_uuid,
            p_def.pack_type,
            sum(p_def.quantity_allowance) AS total_purchased_units
           FROM ((public.accounting_lines al
             JOIN public.accounting_entries ae ON ((al.entry_uuid = ae.uuid)))
             JOIN public.pack_definitions p_def ON ((al.account_uuid = p_def.pack_sales_account_uuid)))
          WHERE ((ae.state = 2) AND (al.tiers_uuid IS NOT NULL))
          GROUP BY al.tiers_uuid, p_def.pack_type
        ), pack_consumptions AS (
         SELECT member_pack_consumptions.tiers_uuid AS member_uuid,
            member_pack_consumptions.pack_type,
            sum(member_pack_consumptions.quantity_consumed) AS total_consumed_units
           FROM public.member_pack_consumptions
          GROUP BY member_pack_consumptions.tiers_uuid, member_pack_consumptions.pack_type
        )
 SELECT p.member_uuid,
    p.pack_type,
    COALESCE(p.total_purchased_units, (0)::numeric) AS total_purchased,
    COALESCE(c.total_consumed_units, (0)::numeric) AS total_consumed,
    (COALESCE(p.total_purchased_units, (0)::numeric) - COALESCE(c.total_consumed_units, (0)::numeric)) AS units_remaining
   FROM (pack_purchases p
     LEFT JOIN pack_consumptions c ON (((p.member_uuid = c.member_uuid) AND ((p.pack_type)::text = (c.pack_type)::text))));


--
-- Name: VIEW vw_member_pack_balances; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.vw_member_pack_balances IS 'Live pack balance: GL purchases (validated entries) minus consumptions per member per pack type';


--
-- Name: accounting_entries_default; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entries ATTACH PARTITION public.accounting_entries_default DEFAULT;


--
-- Name: accounting_entries_fy2025; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entries ATTACH PARTITION public.accounting_entries_fy2025 FOR VALUES IN ('14494d79-8f1f-4281-a6ff-76c59943440c');


--
-- Name: accounting_entries_fy2026; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entries ATTACH PARTITION public.accounting_entries_fy2026 FOR VALUES IN ('c22405bb-f612-491d-85d8-d5edc24949b2');


--
-- Name: accounting_lines_default; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_lines ATTACH PARTITION public.accounting_lines_default DEFAULT;


--
-- Name: accounting_lines_fy2025; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_lines ATTACH PARTITION public.accounting_lines_fy2025 FOR VALUES IN ('14494d79-8f1f-4281-a6ff-76c59943440c');


--
-- Name: accounting_lines_fy2026; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_lines ATTACH PARTITION public.accounting_lines_fy2026 FOR VALUES IN ('c22405bb-f612-491d-85d8-d5edc24949b2');


--
-- Name: auth_challenges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_challenges ALTER COLUMN id SET DEFAULT nextval('public.auth_challenges_id_seq'::regclass);


--
-- Name: capabilities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capabilities ALTER COLUMN id SET DEFAULT nextval('public.capabilities_id_seq'::regclass);


--
-- Name: flight_billing_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings ALTER COLUMN id SET DEFAULT nextval('public.flight_billing_settings_id_seq'::regclass);


--
-- Name: role_capabilities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_capabilities ALTER COLUMN id SET DEFAULT nextval('public.role_capabilities_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: session_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_tokens ALTER COLUMN id SET DEFAULT nextval('public.session_tokens_id_seq'::regclass);


--
-- Name: system_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings ALTER COLUMN id SET DEFAULT nextval('public.system_settings_id_seq'::regclass);


--
-- Name: trusted_devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_devices ALTER COLUMN id SET DEFAULT nextval('public.trusted_devices_id_seq'::regclass);


--
-- Name: user_roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles ALTER COLUMN id SET DEFAULT nextval('public.user_roles_id_seq'::regclass);


--
-- Name: user_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings ALTER COLUMN id SET DEFAULT nextval('public.user_settings_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: accounting_accounts accounting_accounts_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_accounts
    ADD CONSTRAINT accounting_accounts_code_key UNIQUE (code);


--
-- Name: accounting_accounts accounting_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_accounts
    ADD CONSTRAINT accounting_accounts_pkey PRIMARY KEY (uuid);


--
-- Name: accounting_entries pk_accounting_entries; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entries
    ADD CONSTRAINT pk_accounting_entries PRIMARY KEY (uuid, fiscal_year_uuid);


--
-- Name: accounting_entries_default accounting_entries_default_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entries_default
    ADD CONSTRAINT accounting_entries_default_pkey PRIMARY KEY (uuid, fiscal_year_uuid);


--
-- Name: accounting_entries_fy2025 accounting_entries_fy2025_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entries_fy2025
    ADD CONSTRAINT accounting_entries_fy2025_pkey PRIMARY KEY (uuid, fiscal_year_uuid);


--
-- Name: accounting_entries_fy2026 accounting_entries_fy2026_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entries_fy2026
    ADD CONSTRAINT accounting_entries_fy2026_pkey PRIMARY KEY (uuid, fiscal_year_uuid);


--
-- Name: accounting_entry_template_lines accounting_entry_template_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entry_template_lines
    ADD CONSTRAINT accounting_entry_template_lines_pkey PRIMARY KEY (uuid);


--
-- Name: accounting_entry_templates accounting_entry_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entry_templates
    ADD CONSTRAINT accounting_entry_templates_pkey PRIMARY KEY (uuid);


--
-- Name: accounting_fiscal_years accounting_fiscal_years_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_fiscal_years
    ADD CONSTRAINT accounting_fiscal_years_code_key UNIQUE (code);


--
-- Name: accounting_fiscal_years accounting_fiscal_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_fiscal_years
    ADD CONSTRAINT accounting_fiscal_years_pkey PRIMARY KEY (uuid);


--
-- Name: accounting_fiscal_years accounting_fiscal_years_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_fiscal_years
    ADD CONSTRAINT accounting_fiscal_years_year_key UNIQUE (year);


--
-- Name: accounting_journals accounting_journals_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_journals
    ADD CONSTRAINT accounting_journals_code_key UNIQUE (code);


--
-- Name: accounting_journals accounting_journals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_journals
    ADD CONSTRAINT accounting_journals_pkey PRIMARY KEY (uuid);


--
-- Name: accounting_lines pk_accounting_lines; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_lines
    ADD CONSTRAINT pk_accounting_lines PRIMARY KEY (uuid, fiscal_year_uuid);


--
-- Name: accounting_lines_default accounting_lines_default_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_lines_default
    ADD CONSTRAINT accounting_lines_default_pkey PRIMARY KEY (uuid, fiscal_year_uuid);


--
-- Name: accounting_lines_fy2025 accounting_lines_fy2025_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_lines_fy2025
    ADD CONSTRAINT accounting_lines_fy2025_pkey PRIMARY KEY (uuid, fiscal_year_uuid);


--
-- Name: accounting_lines_fy2026 accounting_lines_fy2026_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_lines_fy2026
    ADD CONSTRAINT accounting_lines_fy2026_pkey PRIMARY KEY (uuid, fiscal_year_uuid);


--
-- Name: asset_account_snapshots asset_account_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_account_snapshots
    ADD CONSTRAINT asset_account_snapshots_pkey PRIMARY KEY (uuid);


--
-- Name: asset_depreciation_schedules asset_depreciation_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_depreciation_schedules
    ADD CONSTRAINT asset_depreciation_schedules_pkey PRIMARY KEY (uuid);


--
-- Name: asset_flight_types asset_flight_types_launch_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_flight_types
    ADD CONSTRAINT asset_flight_types_launch_type_key UNIQUE (launch_type);


--
-- Name: asset_flight_types asset_flight_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_flight_types
    ADD CONSTRAINT asset_flight_types_pkey PRIMARY KEY (uuid);


--
-- Name: asset_products asset_products_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_products
    ADD CONSTRAINT asset_products_code_key UNIQUE (code);


--
-- Name: asset_products asset_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_products
    ADD CONSTRAINT asset_products_pkey PRIMARY KEY (uuid);


--
-- Name: asset_status_history asset_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_status_history
    ADD CONSTRAINT asset_status_history_pkey PRIMARY KEY (uuid);


--
-- Name: asset_stock_entries asset_stock_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_stock_entries
    ADD CONSTRAINT asset_stock_entries_pkey PRIMARY KEY (uuid);


--
-- Name: asset_stock_items asset_stock_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_stock_items
    ADD CONSTRAINT asset_stock_items_pkey PRIMARY KEY (uuid);


--
-- Name: asset_types asset_types_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_types
    ADD CONSTRAINT asset_types_code_key UNIQUE (code);


--
-- Name: asset_types asset_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_types
    ADD CONSTRAINT asset_types_pkey PRIMARY KEY (uuid);


--
-- Name: assets assets_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_code_key UNIQUE (code);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (uuid);


--
-- Name: assets assets_registration_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_registration_key UNIQUE (registration);


--
-- Name: auth_challenges auth_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_challenges
    ADD CONSTRAINT auth_challenges_pkey PRIMARY KEY (id);


--
-- Name: capabilities capabilities_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capabilities
    ADD CONSTRAINT capabilities_code_key UNIQUE (code);


--
-- Name: capabilities capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capabilities
    ADD CONSTRAINT capabilities_pkey PRIMARY KEY (id);


--
-- Name: committee_members committee_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_members
    ADD CONSTRAINT committee_members_pkey PRIMARY KEY (committee_uuid, member_uuid, membership_year);


--
-- Name: committees committees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committees
    ADD CONSTRAINT committees_pkey PRIMARY KEY (uuid);


--
-- Name: cost_accrual_staging cost_accrual_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_accrual_staging
    ADD CONSTRAINT cost_accrual_staging_pkey PRIMARY KEY (uuid);


--
-- Name: cost_provision_rules cost_provision_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_provision_rules
    ADD CONSTRAINT cost_provision_rules_pkey PRIMARY KEY (uuid);


--
-- Name: federal_sync_logs federal_sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.federal_sync_logs
    ADD CONSTRAINT federal_sync_logs_pkey PRIMARY KEY (uuid);


--
-- Name: flight_billing_settings flight_billing_settings_fiscal_year_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_fiscal_year_uuid_key UNIQUE (fiscal_year_uuid);


--
-- Name: flight_billing_settings flight_billing_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_pkey PRIMARY KEY (id);


--
-- Name: helloasso_vi_staging helloasso_vi_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.helloasso_vi_staging
    ADD CONSTRAINT helloasso_vi_staging_pkey PRIMARY KEY (uuid);


--
-- Name: member_account_counters member_account_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_account_counters
    ADD CONSTRAINT member_account_counters_pkey PRIMARY KEY (year);


--
-- Name: member_pack_consumptions member_pack_consumptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_pack_consumptions
    ADD CONSTRAINT member_pack_consumptions_pkey PRIMARY KEY (uuid);


--
-- Name: member_registrations member_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_registrations
    ADD CONSTRAINT member_registrations_pkey PRIMARY KEY (uuid);


--
-- Name: member_sheets member_sheets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sheets
    ADD CONSTRAINT member_sheets_pkey PRIMARY KEY (uuid);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (uuid);


--
-- Name: pack_applicability pack_applicability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_applicability
    ADD CONSTRAINT pack_applicability_pkey PRIMARY KEY (uuid);


--
-- Name: pack_definitions pack_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_definitions
    ADD CONSTRAINT pack_definitions_pkey PRIMARY KEY (uuid);


--
-- Name: asset_private_owners pk_asset_private_owners; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_private_owners
    ADD CONSTRAINT pk_asset_private_owners PRIMARY KEY (asset_uuid, member_uuid);


--
-- Name: planche_audit_log planche_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planche_audit_log
    ADD CONSTRAINT planche_audit_log_pkey PRIMARY KEY (uuid);


--
-- Name: planche_flight_snapshots planche_flight_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planche_flight_snapshots
    ADD CONSTRAINT planche_flight_snapshots_pkey PRIMARY KEY (uuid);


--
-- Name: pricing_item_tiers pricing_item_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_item_tiers
    ADD CONSTRAINT pricing_item_tiers_pkey PRIMARY KEY (uuid);


--
-- Name: pricing_items pricing_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_items
    ADD CONSTRAINT pricing_items_pkey PRIMARY KEY (uuid);


--
-- Name: pricing_versions pricing_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_versions
    ADD CONSTRAINT pricing_versions_pkey PRIMARY KEY (uuid);


--
-- Name: role_capabilities role_capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_capabilities
    ADD CONSTRAINT role_capabilities_pkey PRIMARY KEY (id);


--
-- Name: roles roles_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_code_key UNIQUE (code);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_slug_key UNIQUE (slug);


--
-- Name: scheduler_locks scheduler_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduler_locks
    ADD CONSTRAINT scheduler_locks_pkey PRIMARY KEY (job_id);


--
-- Name: session_tokens session_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_tokens
    ADD CONSTRAINT session_tokens_pkey PRIMARY KEY (id);


--
-- Name: session_tokens session_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_tokens
    ADD CONSTRAINT session_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: system_settings system_settings_module_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_module_name_key UNIQUE (module_name);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: trusted_devices trusted_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_devices
    ADD CONSTRAINT trusted_devices_pkey PRIMARY KEY (id);


--
-- Name: trusted_devices trusted_devices_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_devices
    ADD CONSTRAINT trusted_devices_token_hash_key UNIQUE (token_hash);


--
-- Name: asset_depreciation_schedules uq_asset_depr_asset_year; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_depreciation_schedules
    ADD CONSTRAINT uq_asset_depr_asset_year UNIQUE (asset_uuid, fiscal_year_uuid);


--
-- Name: asset_flight_types uq_asset_flight_types_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_flight_types
    ADD CONSTRAINT uq_asset_flight_types_code UNIQUE (code);


--
-- Name: committees uq_committees_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committees
    ADD CONSTRAINT uq_committees_code UNIQUE (code);


--
-- Name: helloasso_vi_staging uq_helloasso_vi_staging_item_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.helloasso_vi_staging
    ADD CONSTRAINT uq_helloasso_vi_staging_item_id UNIQUE (item_id);


--
-- Name: member_registrations uq_member_registrations_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_registrations
    ADD CONSTRAINT uq_member_registrations_period UNIQUE (member_uuid, start_date, end_date);


--
-- Name: member_sheets uq_member_sheets_member_year; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sheets
    ADD CONSTRAINT uq_member_sheets_member_year UNIQUE (member_uuid, year);


--
-- Name: planche_flight_snapshots uq_planche_flight_snapshot_revision; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planche_flight_snapshots
    ADD CONSTRAINT uq_planche_flight_snapshot_revision UNIQUE (planche_uuid, planche_revision);


--
-- Name: role_capabilities uq_role_capabilities_role_cap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_capabilities
    ADD CONSTRAINT uq_role_capabilities_role_cap UNIQUE (role_id, capability_id);


--
-- Name: user_roles uq_user_roles_user_role; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role_id);


--
-- Name: validated_flights uq_validated_flights_planche_uuid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validated_flights
    ADD CONSTRAINT uq_validated_flights_planche_uuid UNIQUE (planche_uuid);


--
-- Name: validated_flights uq_validated_flights_uuid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validated_flights
    ADD CONSTRAINT uq_validated_flights_uuid PRIMARY KEY (uuid);


--
-- Name: vi_entitlements uq_vi_entitlements_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vi_entitlements
    ADD CONSTRAINT uq_vi_entitlements_code UNIQUE (code);


--
-- Name: vi_type_catalog uq_vi_type_catalog_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vi_type_catalog
    ADD CONSTRAINT uq_vi_type_catalog_code UNIQUE (code);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vi_entitlements vi_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vi_entitlements
    ADD CONSTRAINT vi_entitlements_pkey PRIMARY KEY (uuid);


--
-- Name: vi_type_catalog vi_type_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vi_type_catalog
    ADD CONSTRAINT vi_type_catalog_pkey PRIMARY KEY (uuid);


--
-- Name: ix_entries_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_entries_fiscal_year ON ONLY public.accounting_entries USING btree (fiscal_year_uuid);


--
-- Name: accounting_entries_default_fiscal_year_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_entries_default_fiscal_year_uuid_idx ON public.accounting_entries_default USING btree (fiscal_year_uuid);


--
-- Name: uix_entry_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uix_entry_sequence ON ONLY public.accounting_entries USING btree (fiscal_year_uuid, sequence_number) WHERE (sequence_number IS NOT NULL);


--
-- Name: accounting_entries_default_fiscal_year_uuid_sequence_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounting_entries_default_fiscal_year_uuid_sequence_number_idx ON public.accounting_entries_default USING btree (fiscal_year_uuid, sequence_number) WHERE (sequence_number IS NOT NULL);


--
-- Name: ix_entries_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_entries_import_batch ON ONLY public.accounting_entries USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);


--
-- Name: accounting_entries_default_import_batch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_entries_default_import_batch_id_idx ON public.accounting_entries_default USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);


--
-- Name: ix_entries_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_entries_external_id ON ONLY public.accounting_entries USING btree (source_system, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: accounting_entries_default_source_system_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_entries_default_source_system_external_id_idx ON public.accounting_entries_default USING btree (source_system, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: accounting_entries_fy2025_fiscal_year_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_entries_fy2025_fiscal_year_uuid_idx ON public.accounting_entries_fy2025 USING btree (fiscal_year_uuid);


--
-- Name: accounting_entries_fy2025_fiscal_year_uuid_sequence_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounting_entries_fy2025_fiscal_year_uuid_sequence_number_idx ON public.accounting_entries_fy2025 USING btree (fiscal_year_uuid, sequence_number) WHERE (sequence_number IS NOT NULL);


--
-- Name: accounting_entries_fy2025_import_batch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_entries_fy2025_import_batch_id_idx ON public.accounting_entries_fy2025 USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);


--
-- Name: accounting_entries_fy2025_source_system_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_entries_fy2025_source_system_external_id_idx ON public.accounting_entries_fy2025 USING btree (source_system, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: accounting_entries_fy2026_fiscal_year_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_entries_fy2026_fiscal_year_uuid_idx ON public.accounting_entries_fy2026 USING btree (fiscal_year_uuid);


--
-- Name: accounting_entries_fy2026_fiscal_year_uuid_sequence_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounting_entries_fy2026_fiscal_year_uuid_sequence_number_idx ON public.accounting_entries_fy2026 USING btree (fiscal_year_uuid, sequence_number) WHERE (sequence_number IS NOT NULL);


--
-- Name: accounting_entries_fy2026_import_batch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_entries_fy2026_import_batch_id_idx ON public.accounting_entries_fy2026 USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);


--
-- Name: accounting_entries_fy2026_source_system_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_entries_fy2026_source_system_external_id_idx ON public.accounting_entries_fy2026 USING btree (source_system, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: ix_lines_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_lines_account ON ONLY public.accounting_lines USING btree (account_uuid);


--
-- Name: accounting_lines_default_account_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_default_account_uuid_idx ON public.accounting_lines_default USING btree (account_uuid);


--
-- Name: ix_lines_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_lines_entry ON ONLY public.accounting_lines USING btree (entry_uuid);


--
-- Name: accounting_lines_default_entry_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_default_entry_uuid_idx ON public.accounting_lines_default USING btree (entry_uuid);


--
-- Name: ix_lines_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_lines_fiscal_year ON ONLY public.accounting_lines USING btree (fiscal_year_uuid);


--
-- Name: accounting_lines_default_fiscal_year_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_default_fiscal_year_uuid_idx ON public.accounting_lines_default USING btree (fiscal_year_uuid);


--
-- Name: ix_lines_tiers; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_lines_tiers ON ONLY public.accounting_lines USING btree (tiers_uuid) WHERE (tiers_uuid IS NOT NULL);


--
-- Name: accounting_lines_default_tiers_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_default_tiers_uuid_idx ON public.accounting_lines_default USING btree (tiers_uuid) WHERE (tiers_uuid IS NOT NULL);


--
-- Name: accounting_lines_fy2025_account_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_fy2025_account_uuid_idx ON public.accounting_lines_fy2025 USING btree (account_uuid);


--
-- Name: accounting_lines_fy2025_entry_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_fy2025_entry_uuid_idx ON public.accounting_lines_fy2025 USING btree (entry_uuid);


--
-- Name: accounting_lines_fy2025_fiscal_year_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_fy2025_fiscal_year_uuid_idx ON public.accounting_lines_fy2025 USING btree (fiscal_year_uuid);


--
-- Name: accounting_lines_fy2025_tiers_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_fy2025_tiers_uuid_idx ON public.accounting_lines_fy2025 USING btree (tiers_uuid) WHERE (tiers_uuid IS NOT NULL);


--
-- Name: accounting_lines_fy2026_account_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_fy2026_account_uuid_idx ON public.accounting_lines_fy2026 USING btree (account_uuid);


--
-- Name: accounting_lines_fy2026_entry_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_fy2026_entry_uuid_idx ON public.accounting_lines_fy2026 USING btree (entry_uuid);


--
-- Name: accounting_lines_fy2026_fiscal_year_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_fy2026_fiscal_year_uuid_idx ON public.accounting_lines_fy2026 USING btree (fiscal_year_uuid);


--
-- Name: accounting_lines_fy2026_tiers_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_lines_fy2026_tiers_uuid_idx ON public.accounting_lines_fy2026 USING btree (tiers_uuid) WHERE (tiers_uuid IS NOT NULL);


--
-- Name: idx_auth_challenges_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_challenges_expires_at ON public.auth_challenges USING btree (expires_at);


--
-- Name: idx_auth_challenges_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_challenges_user_id ON public.auth_challenges USING btree (user_id);


--
-- Name: idx_capabilities_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capabilities_code ON public.capabilities USING btree (code);


--
-- Name: idx_committee_members_committee_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_members_committee_year ON public.committee_members USING btree (committee_uuid, membership_year);


--
-- Name: idx_committee_members_member_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committee_members_member_year ON public.committee_members USING btree (member_uuid, membership_year);


--
-- Name: idx_committees_manager_member_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_committees_manager_member_uuid ON public.committees USING btree (manager_member_uuid);


--
-- Name: idx_entry_templates_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entry_templates_scheduled ON public.accounting_entry_templates USING btree (next_scheduled_date) WHERE ((is_active = true) AND (next_scheduled_date IS NOT NULL));


--
-- Name: idx_fbs_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fbs_fiscal_year ON public.flight_billing_settings USING btree (fiscal_year_uuid);


--
-- Name: idx_helloasso_vi_staging_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_helloasso_vi_staging_email ON public.helloasso_vi_staging USING btree (email);


--
-- Name: idx_helloasso_vi_staging_form_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_helloasso_vi_staging_form_slug ON public.helloasso_vi_staging USING btree (form_slug);


--
-- Name: idx_helloasso_vi_staging_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_helloasso_vi_staging_item_id ON public.helloasso_vi_staging USING btree (item_id);


--
-- Name: idx_helloasso_vi_staging_promoted_vi_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_helloasso_vi_staging_promoted_vi_uuid ON public.helloasso_vi_staging USING btree (promoted_vi_uuid);


--
-- Name: idx_helloasso_vi_staging_purchased_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_helloasso_vi_staging_purchased_at ON public.helloasso_vi_staging USING btree (purchased_at);


--
-- Name: idx_helloasso_vi_staging_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_helloasso_vi_staging_status ON public.helloasso_vi_staging USING btree (status);


--
-- Name: idx_member_registrations_member_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_registrations_member_uuid ON public.member_registrations USING btree (member_uuid);


--
-- Name: idx_member_registrations_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_registrations_period ON public.member_registrations USING btree (start_date, end_date);


--
-- Name: idx_member_registrations_registered_for_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_registrations_registered_for_year ON public.member_registrations USING btree (registered_for_year);


--
-- Name: idx_member_registrations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_registrations_status ON public.member_registrations USING btree (status);


--
-- Name: idx_member_sheets_member_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_sheets_member_uuid ON public.member_sheets USING btree (member_uuid);


--
-- Name: idx_member_sheets_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_sheets_year ON public.member_sheets USING btree (year);


--
-- Name: idx_members_can_fly; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_can_fly ON public.members USING btree (can_fly);


--
-- Name: idx_members_first_subscription_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_first_subscription_year ON public.members USING btree (first_subscription_year);


--
-- Name: idx_members_member_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_member_category ON public.members USING btree (member_category);


--
-- Name: idx_members_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_name ON public.members USING btree (last_name, first_name);


--
-- Name: idx_members_registration_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_registration_status ON public.members USING btree (registration_status);


--
-- Name: idx_members_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_status ON public.members USING btree (status);


--
-- Name: idx_mpc_accounting_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpc_accounting_entry ON public.member_pack_consumptions USING btree (accounting_entry_uuid);


--
-- Name: idx_mpc_flight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpc_flight ON public.member_pack_consumptions USING btree (flight_uuid);


--
-- Name: idx_mpc_pack_definition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpc_pack_definition ON public.member_pack_consumptions USING btree (pack_definition_uuid);


--
-- Name: idx_mpc_tiers_pack; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpc_tiers_pack ON public.member_pack_consumptions USING btree (tiers_uuid, pack_type);


--
-- Name: idx_pack_definitions_pack_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pack_definitions_pack_type ON public.pack_definitions USING btree (pack_type);


--
-- Name: idx_planche_audit_log_affected_record_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planche_audit_log_affected_record_id ON public.planche_audit_log USING btree (affected_record_id);


--
-- Name: idx_planche_audit_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planche_audit_log_created_at ON public.planche_audit_log USING btree (created_at);


--
-- Name: idx_planche_audit_log_operation_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planche_audit_log_operation_type ON public.planche_audit_log USING btree (operation_type);


--
-- Name: idx_planche_flight_snapshots_ack_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planche_flight_snapshots_ack_status ON public.planche_flight_snapshots USING btree (ack_status);


--
-- Name: idx_planche_flight_snapshots_planche_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planche_flight_snapshots_planche_uuid ON public.planche_flight_snapshots USING btree (planche_uuid);


--
-- Name: idx_planche_flight_snapshots_received_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planche_flight_snapshots_received_at ON public.planche_flight_snapshots USING btree (received_at);


--
-- Name: idx_planche_flight_snapshots_source_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planche_flight_snapshots_source_hash ON public.planche_flight_snapshots USING btree (source_hash);


--
-- Name: idx_planche_flight_snapshots_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planche_flight_snapshots_status ON public.planche_flight_snapshots USING btree (status);


--
-- Name: idx_planche_flight_snapshots_updated_at_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planche_flight_snapshots_updated_at_source ON public.planche_flight_snapshots USING btree (updated_at_source);


--
-- Name: idx_pricing_item_tiers_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_item_tiers_item ON public.pricing_item_tiers USING btree (pricing_item_uuid);


--
-- Name: idx_pricing_items_gl_account_credit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_items_gl_account_credit ON public.pricing_items USING btree (gl_account_credit_uuid);


--
-- Name: idx_role_capabilities_capability_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_capabilities_capability_id ON public.role_capabilities USING btree (capability_id);


--
-- Name: idx_role_capabilities_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_capabilities_role_id ON public.role_capabilities USING btree (role_id);


--
-- Name: idx_roles_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_code ON public.roles USING btree (code);


--
-- Name: idx_roles_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_slug ON public.roles USING btree (slug);


--
-- Name: idx_session_tokens_challenge_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_tokens_challenge_id ON public.session_tokens USING btree (challenge_id);


--
-- Name: idx_session_tokens_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_tokens_expires_at ON public.session_tokens USING btree (expires_at);


--
-- Name: idx_session_tokens_trusted_device_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_tokens_trusted_device_id ON public.session_tokens USING btree (trusted_device_id);


--
-- Name: idx_session_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_tokens_user_id ON public.session_tokens USING btree (user_id);


--
-- Name: idx_trusted_devices_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trusted_devices_expires_at ON public.trusted_devices USING btree (expires_at);


--
-- Name: idx_trusted_devices_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trusted_devices_user_id ON public.trusted_devices USING btree (user_id);


--
-- Name: idx_user_roles_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_role_id ON public.user_roles USING btree (role_id);


--
-- Name: idx_user_roles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_user_id ON public.user_roles USING btree (user_id);


--
-- Name: idx_user_settings_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_settings_user_id ON public.user_settings USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_is_active ON public.users USING btree (is_active);


--
-- Name: idx_validated_flights_accounting_entry_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validated_flights_accounting_entry_uuid ON public.validated_flights USING btree (accounting_entry_uuid);


--
-- Name: idx_validated_flights_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validated_flights_created_at ON public.validated_flights USING btree (created_at);


--
-- Name: idx_validated_flights_erp_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validated_flights_erp_status ON public.validated_flights USING btree (erp_status);


--
-- Name: idx_validated_flights_glider_erp_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validated_flights_glider_erp_id ON public.validated_flights USING btree (glider_erp_id);


--
-- Name: idx_validated_flights_launch_machine_erp_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validated_flights_launch_machine_erp_id ON public.validated_flights USING btree (launch_machine_erp_id);


--
-- Name: idx_validated_flights_planche_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validated_flights_planche_uuid ON public.validated_flights USING btree (planche_uuid);


--
-- Name: idx_validated_flights_source_snapshot_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validated_flights_source_snapshot_uuid ON public.validated_flights USING btree (source_snapshot_uuid);


--
-- Name: idx_validated_flights_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validated_flights_updated_at ON public.validated_flights USING btree (updated_at);


--
-- Name: idx_vf_accounting_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vf_accounting_entry ON public.validated_flights USING btree (accounting_entry_uuid);


--
-- Name: idx_vi_entitlements_origin_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vi_entitlements_origin_ref ON public.vi_entitlements USING btree (origin_ref);


--
-- Name: idx_vi_entitlements_partner_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vi_entitlements_partner_code ON public.vi_entitlements USING btree (partner_code);


--
-- Name: idx_vi_entitlements_realisation_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vi_entitlements_realisation_date ON public.vi_entitlements USING btree (realisation_date);


--
-- Name: idx_vi_entitlements_scheduled_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vi_entitlements_scheduled_date ON public.vi_entitlements USING btree (scheduled_date);


--
-- Name: idx_vi_entitlements_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vi_entitlements_status ON public.vi_entitlements USING btree (status);


--
-- Name: idx_vi_entitlements_validity_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vi_entitlements_validity_date ON public.vi_entitlements USING btree (validity_date);


--
-- Name: idx_vi_entitlements_vi_type_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vi_entitlements_vi_type_uuid ON public.vi_entitlements USING btree (vi_type_uuid);


--
-- Name: ix_accounting_entry_template_lines_account_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_accounting_entry_template_lines_account_uuid ON public.accounting_entry_template_lines USING btree (account_uuid);


--
-- Name: ix_accounting_entry_template_lines_template_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_accounting_entry_template_lines_template_uuid ON public.accounting_entry_template_lines USING btree (template_uuid);


--
-- Name: ix_accounting_entry_templates_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_accounting_entry_templates_code ON public.accounting_entry_templates USING btree (code);


--
-- Name: ix_accounting_entry_templates_journal_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_accounting_entry_templates_journal_uuid ON public.accounting_entry_templates USING btree (journal_uuid);


--
-- Name: ix_accounting_journals_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_accounting_journals_is_active ON public.accounting_journals USING btree (is_active);


--
-- Name: ix_accounting_journals_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_accounting_journals_type ON public.accounting_journals USING btree (type);


--
-- Name: ix_asset_account_snapshots_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_asset_account_snapshots_asset ON public.asset_account_snapshots USING btree (asset_uuid);


--
-- Name: ix_asset_depr_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_asset_depr_fiscal_year ON public.asset_depreciation_schedules USING btree (fiscal_year_uuid);


--
-- Name: ix_asset_depr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_asset_depr_status ON public.asset_depreciation_schedules USING btree (status);


--
-- Name: ix_asset_flight_types_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_asset_flight_types_active ON public.asset_flight_types USING btree (is_active);


--
-- Name: ix_asset_private_owners_member_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_asset_private_owners_member_uuid ON public.asset_private_owners USING btree (member_uuid);


--
-- Name: ix_asset_products_asset_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_asset_products_asset_type ON public.asset_products USING btree (asset_type_uuid);


--
-- Name: ix_asset_status_history_asset_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_asset_status_history_asset_uuid ON public.asset_status_history USING btree (asset_uuid);


--
-- Name: ix_asset_types_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_asset_types_category ON public.asset_types USING btree (category);


--
-- Name: ix_asset_types_trackable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_asset_types_trackable ON public.asset_types USING btree (is_trackable_in_ledger);


--
-- Name: ix_assets_asset_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_assets_asset_type ON public.assets USING btree (asset_type_uuid);


--
-- Name: ix_assets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_assets_status ON public.assets USING btree (status);


--
-- Name: ix_cost_rules_asset_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cost_rules_asset_type ON public.cost_provision_rules USING btree (asset_type_uuid);


--
-- Name: ix_cost_rules_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cost_rules_fiscal_year ON public.cost_provision_rules USING btree (fiscal_year_uuid);


--
-- Name: ix_cost_staging_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cost_staging_asset ON public.cost_accrual_staging USING btree (asset_uuid);


--
-- Name: ix_cost_staging_metric_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cost_staging_metric_date ON public.cost_accrual_staging USING btree (metric_date);


--
-- Name: ix_cost_staging_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cost_staging_pending ON public.cost_accrual_staging USING btree (is_accrued) WHERE (is_accrued = false);


--
-- Name: ix_cost_staging_rule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cost_staging_rule ON public.cost_accrual_staging USING btree (cost_provision_rule_uuid);


--
-- Name: ix_federal_sync_logs_validated_flight_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_federal_sync_logs_validated_flight_uuid ON public.federal_sync_logs USING btree (validated_flight_uuid);


--
-- Name: ix_members_last_registration_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_members_last_registration_date ON public.members USING btree (last_registration_date);


--
-- Name: ix_mpc_accounting_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_mpc_accounting_entry ON public.member_pack_consumptions USING btree (accounting_entry_uuid);


--
-- Name: ix_mpc_flight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_mpc_flight ON public.member_pack_consumptions USING btree (flight_uuid);


--
-- Name: ix_mpc_tiers_pack_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_mpc_tiers_pack_type ON public.member_pack_consumptions USING btree (tiers_uuid, pack_type);


--
-- Name: ix_pack_applicability_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pack_applicability_item ON public.pack_applicability USING btree (pricing_item_uuid);


--
-- Name: ix_pack_applicability_pack; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pack_applicability_pack ON public.pack_applicability USING btree (pack_definition_uuid);


--
-- Name: ix_pack_definitions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pack_definitions_type ON public.pack_definitions USING btree (pack_type);


--
-- Name: ix_pricing_items_flight_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pricing_items_flight_type ON public.pricing_items USING btree (flight_type_uuid) WHERE (flight_type_uuid IS NOT NULL);


--
-- Name: ix_pricing_items_pricing_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pricing_items_pricing_version ON public.pricing_items USING btree (pricing_version_uuid);


--
-- Name: ix_pricing_versions_asset_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pricing_versions_asset_type ON public.pricing_versions USING btree (asset_type_uuid);


--
-- Name: ix_pricing_versions_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pricing_versions_dates ON public.pricing_versions USING btree (fiscal_year_uuid, from_date, to_date);


--
-- Name: ix_pricing_versions_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pricing_versions_fiscal_year ON public.pricing_versions USING btree (fiscal_year_uuid);


--
-- Name: ix_stock_entries_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_stock_entries_date ON public.asset_stock_entries USING btree (transaction_date);


--
-- Name: ix_stock_entries_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_stock_entries_item ON public.asset_stock_entries USING btree (stock_item_uuid);


--
-- Name: ix_stock_items_asset_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_stock_items_asset_type ON public.asset_stock_items USING btree (asset_type_uuid);


--
-- Name: ix_stock_items_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_stock_items_product ON public.asset_stock_items USING btree (product_uuid);


--
-- Name: ix_system_settings_module_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_system_settings_module_name ON public.system_settings USING btree (module_name);


--
-- Name: ix_validated_flights_accounting_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_validated_flights_accounting_entry ON public.validated_flights USING btree (accounting_entry_uuid);


--
-- Name: uq_cost_rules_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_cost_rules_active_unique ON public.cost_provision_rules USING btree (asset_type_uuid, fiscal_year_uuid, metric_name) WHERE (is_active = true);


--
-- Name: uq_members_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_members_account_id ON public.members USING btree (account_id);


--
-- Name: uq_members_email_not_null; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_members_email_not_null ON public.members USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: uq_members_ffvp_id_not_null; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_members_ffvp_id_not_null ON public.members USING btree (ffvp_id) WHERE (ffvp_id IS NOT NULL);


--
-- Name: uq_members_legacy_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_members_legacy_account_id ON public.members USING btree (legacy_account_id) WHERE (legacy_account_id IS NOT NULL);


--
-- Name: uq_pack_applicability_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pack_applicability_item ON public.pack_applicability USING btree (pack_definition_uuid, pricing_item_uuid);


--
-- Name: uq_pack_definitions_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pack_definitions_code ON public.pack_definitions USING btree (code);


--
-- Name: accounting_entries_default_fiscal_year_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_entries_fiscal_year ATTACH PARTITION public.accounting_entries_default_fiscal_year_uuid_idx;


--
-- Name: accounting_entries_default_fiscal_year_uuid_sequence_number_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.uix_entry_sequence ATTACH PARTITION public.accounting_entries_default_fiscal_year_uuid_sequence_number_idx;


--
-- Name: accounting_entries_default_import_batch_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_entries_import_batch ATTACH PARTITION public.accounting_entries_default_import_batch_id_idx;


--
-- Name: accounting_entries_default_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.pk_accounting_entries ATTACH PARTITION public.accounting_entries_default_pkey;


--
-- Name: accounting_entries_default_source_system_external_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_entries_external_id ATTACH PARTITION public.accounting_entries_default_source_system_external_id_idx;


--
-- Name: accounting_entries_fy2025_fiscal_year_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_entries_fiscal_year ATTACH PARTITION public.accounting_entries_fy2025_fiscal_year_uuid_idx;


--
-- Name: accounting_entries_fy2025_fiscal_year_uuid_sequence_number_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.uix_entry_sequence ATTACH PARTITION public.accounting_entries_fy2025_fiscal_year_uuid_sequence_number_idx;


--
-- Name: accounting_entries_fy2025_import_batch_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_entries_import_batch ATTACH PARTITION public.accounting_entries_fy2025_import_batch_id_idx;


--
-- Name: accounting_entries_fy2025_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.pk_accounting_entries ATTACH PARTITION public.accounting_entries_fy2025_pkey;


--
-- Name: accounting_entries_fy2025_source_system_external_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_entries_external_id ATTACH PARTITION public.accounting_entries_fy2025_source_system_external_id_idx;


--
-- Name: accounting_entries_fy2026_fiscal_year_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_entries_fiscal_year ATTACH PARTITION public.accounting_entries_fy2026_fiscal_year_uuid_idx;


--
-- Name: accounting_entries_fy2026_fiscal_year_uuid_sequence_number_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.uix_entry_sequence ATTACH PARTITION public.accounting_entries_fy2026_fiscal_year_uuid_sequence_number_idx;


--
-- Name: accounting_entries_fy2026_import_batch_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_entries_import_batch ATTACH PARTITION public.accounting_entries_fy2026_import_batch_id_idx;


--
-- Name: accounting_entries_fy2026_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.pk_accounting_entries ATTACH PARTITION public.accounting_entries_fy2026_pkey;


--
-- Name: accounting_entries_fy2026_source_system_external_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_entries_external_id ATTACH PARTITION public.accounting_entries_fy2026_source_system_external_id_idx;


--
-- Name: accounting_lines_default_account_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_account ATTACH PARTITION public.accounting_lines_default_account_uuid_idx;


--
-- Name: accounting_lines_default_entry_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_entry ATTACH PARTITION public.accounting_lines_default_entry_uuid_idx;


--
-- Name: accounting_lines_default_fiscal_year_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_fiscal_year ATTACH PARTITION public.accounting_lines_default_fiscal_year_uuid_idx;


--
-- Name: accounting_lines_default_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.pk_accounting_lines ATTACH PARTITION public.accounting_lines_default_pkey;


--
-- Name: accounting_lines_default_tiers_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_tiers ATTACH PARTITION public.accounting_lines_default_tiers_uuid_idx;


--
-- Name: accounting_lines_fy2025_account_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_account ATTACH PARTITION public.accounting_lines_fy2025_account_uuid_idx;


--
-- Name: accounting_lines_fy2025_entry_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_entry ATTACH PARTITION public.accounting_lines_fy2025_entry_uuid_idx;


--
-- Name: accounting_lines_fy2025_fiscal_year_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_fiscal_year ATTACH PARTITION public.accounting_lines_fy2025_fiscal_year_uuid_idx;


--
-- Name: accounting_lines_fy2025_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.pk_accounting_lines ATTACH PARTITION public.accounting_lines_fy2025_pkey;


--
-- Name: accounting_lines_fy2025_tiers_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_tiers ATTACH PARTITION public.accounting_lines_fy2025_tiers_uuid_idx;


--
-- Name: accounting_lines_fy2026_account_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_account ATTACH PARTITION public.accounting_lines_fy2026_account_uuid_idx;


--
-- Name: accounting_lines_fy2026_entry_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_entry ATTACH PARTITION public.accounting_lines_fy2026_entry_uuid_idx;


--
-- Name: accounting_lines_fy2026_fiscal_year_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_fiscal_year ATTACH PARTITION public.accounting_lines_fy2026_fiscal_year_uuid_idx;


--
-- Name: accounting_lines_fy2026_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.pk_accounting_lines ATTACH PARTITION public.accounting_lines_fy2026_pkey;


--
-- Name: accounting_lines_fy2026_tiers_uuid_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.ix_lines_tiers ATTACH PARTITION public.accounting_lines_fy2026_tiers_uuid_idx;


--
-- Name: asset_depreciation_schedules trg_asset_depr_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_asset_depr_updated_at BEFORE UPDATE ON public.asset_depreciation_schedules FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: asset_flight_types trg_asset_flight_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_asset_flight_types_updated_at BEFORE UPDATE ON public.asset_flight_types FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: asset_products trg_asset_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_asset_products_updated_at BEFORE UPDATE ON public.asset_products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: asset_types trg_asset_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_asset_types_updated_at BEFORE UPDATE ON public.asset_types FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: assets trg_assets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assets_updated_at BEFORE UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: auth_challenges trg_auth_challenges_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auth_challenges_updated_at BEFORE UPDATE ON public.auth_challenges FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: capabilities trg_capabilities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_capabilities_updated_at BEFORE UPDATE ON public.capabilities FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: accounting_entries trg_check_entry_balance; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_entry_balance AFTER INSERT OR UPDATE ON public.accounting_entries FOR EACH ROW EXECUTE FUNCTION public.check_accounting_entry_balance();


--
-- Name: committees trg_committees_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_committees_set_updated_at BEFORE UPDATE ON public.committees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cost_provision_rules trg_cost_rules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cost_rules_updated_at BEFORE UPDATE ON public.cost_provision_rules FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: accounting_entries trg_entry_fiscal_year_boundary; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_entry_fiscal_year_boundary BEFORE INSERT OR UPDATE ON public.accounting_entries FOR EACH ROW EXECUTE FUNCTION public.check_entry_fiscal_year_boundary();


--
-- Name: member_registrations trg_member_registrations_reject_permanent_categories; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_member_registrations_reject_permanent_categories BEFORE INSERT OR UPDATE OF member_uuid, registration_type ON public.member_registrations FOR EACH ROW EXECUTE FUNCTION public.prevent_permanent_member_registrations();


--
-- Name: member_sheets trg_member_sheets_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_member_sheets_set_updated_at BEFORE UPDATE ON public.member_sheets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: members trg_members_set_account_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_members_set_account_id BEFORE INSERT ON public.members FOR EACH ROW EXECUTE FUNCTION public.set_member_account_id();


--
-- Name: members trg_members_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_members_set_updated_at BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: accounting_entries trg_prevent_posted_entry_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_posted_entry_update BEFORE UPDATE ON public.accounting_entries FOR EACH ROW EXECUTE FUNCTION public.prevent_posted_entry_modification();


--
-- Name: accounting_lines trg_prevent_posted_lines_modification; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_posted_lines_modification BEFORE INSERT OR DELETE OR UPDATE ON public.accounting_lines FOR EACH ROW EXECUTE FUNCTION public.prevent_posted_line_modification();


--
-- Name: role_capabilities trg_role_capabilities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_role_capabilities_updated_at BEFORE UPDATE ON public.role_capabilities FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: roles trg_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: session_tokens trg_session_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_session_tokens_updated_at BEFORE UPDATE ON public.session_tokens FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: asset_stock_items trg_stock_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stock_items_updated_at BEFORE UPDATE ON public.asset_stock_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: trusted_devices trg_trusted_devices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trusted_devices_updated_at BEFORE UPDATE ON public.trusted_devices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: accounting_entries trg_unlink_flights_on_entry_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_unlink_flights_on_entry_delete BEFORE DELETE ON public.accounting_entries FOR EACH ROW EXECUTE FUNCTION public.fn_unlink_flights_on_entry_delete();


--
-- Name: TRIGGER trg_unlink_flights_on_entry_delete ON accounting_entries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER trg_unlink_flights_on_entry_delete ON public.accounting_entries IS 'Automatically reset validated_flights rows linked to a deleted accounting entry.';


--
-- Name: user_roles trg_user_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_roles_updated_at BEFORE UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: user_settings trg_user_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: accounting_accounts accounting_accounts_parent_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_accounts
    ADD CONSTRAINT accounting_accounts_parent_account_uuid_fkey FOREIGN KEY (parent_account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: accounting_accounts accounting_accounts_replacement_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_accounts
    ADD CONSTRAINT accounting_accounts_replacement_account_uuid_fkey FOREIGN KEY (replacement_account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: accounting_entries accounting_entries_fiscal_year_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.accounting_entries
    ADD CONSTRAINT accounting_entries_fiscal_year_uuid_fkey FOREIGN KEY (fiscal_year_uuid) REFERENCES public.accounting_fiscal_years(uuid);


--
-- Name: accounting_entries accounting_entries_journal_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.accounting_entries
    ADD CONSTRAINT accounting_entries_journal_uuid_fkey FOREIGN KEY (journal_uuid) REFERENCES public.accounting_journals(uuid);


--
-- Name: accounting_entry_template_lines accounting_entry_template_lines_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entry_template_lines
    ADD CONSTRAINT accounting_entry_template_lines_account_uuid_fkey FOREIGN KEY (account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: accounting_entry_template_lines accounting_entry_template_lines_template_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entry_template_lines
    ADD CONSTRAINT accounting_entry_template_lines_template_uuid_fkey FOREIGN KEY (template_uuid) REFERENCES public.accounting_entry_templates(uuid) ON DELETE CASCADE;


--
-- Name: accounting_entry_templates accounting_entry_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entry_templates
    ADD CONSTRAINT accounting_entry_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: accounting_entry_templates accounting_entry_templates_journal_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_entry_templates
    ADD CONSTRAINT accounting_entry_templates_journal_uuid_fkey FOREIGN KEY (journal_uuid) REFERENCES public.accounting_journals(uuid);


--
-- Name: accounting_journals accounting_journals_default_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_journals
    ADD CONSTRAINT accounting_journals_default_account_uuid_fkey FOREIGN KEY (default_account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: accounting_lines accounting_lines_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.accounting_lines
    ADD CONSTRAINT accounting_lines_account_uuid_fkey FOREIGN KEY (account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: accounting_lines accounting_lines_fiscal_year_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.accounting_lines
    ADD CONSTRAINT accounting_lines_fiscal_year_uuid_fkey FOREIGN KEY (fiscal_year_uuid) REFERENCES public.accounting_fiscal_years(uuid);


--
-- Name: asset_account_snapshots asset_account_snapshots_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_account_snapshots
    ADD CONSTRAINT asset_account_snapshots_account_uuid_fkey FOREIGN KEY (account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: asset_account_snapshots asset_account_snapshots_asset_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_account_snapshots
    ADD CONSTRAINT asset_account_snapshots_asset_uuid_fkey FOREIGN KEY (asset_uuid) REFERENCES public.assets(uuid) ON DELETE CASCADE;


--
-- Name: asset_depreciation_schedules asset_depreciation_schedules_asset_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_depreciation_schedules
    ADD CONSTRAINT asset_depreciation_schedules_asset_uuid_fkey FOREIGN KEY (asset_uuid) REFERENCES public.assets(uuid) ON DELETE CASCADE;


--
-- Name: asset_depreciation_schedules asset_depreciation_schedules_fiscal_year_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_depreciation_schedules
    ADD CONSTRAINT asset_depreciation_schedules_fiscal_year_uuid_fkey FOREIGN KEY (fiscal_year_uuid) REFERENCES public.accounting_fiscal_years(uuid);


--
-- Name: asset_private_owners asset_private_owners_asset_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_private_owners
    ADD CONSTRAINT asset_private_owners_asset_uuid_fkey FOREIGN KEY (asset_uuid) REFERENCES public.assets(uuid) ON DELETE CASCADE;


--
-- Name: asset_private_owners asset_private_owners_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_private_owners
    ADD CONSTRAINT asset_private_owners_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: asset_private_owners asset_private_owners_member_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_private_owners
    ADD CONSTRAINT asset_private_owners_member_uuid_fkey FOREIGN KEY (member_uuid) REFERENCES public.members(uuid) ON DELETE CASCADE;


--
-- Name: asset_products asset_products_asset_type_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_products
    ADD CONSTRAINT asset_products_asset_type_uuid_fkey FOREIGN KEY (asset_type_uuid) REFERENCES public.asset_types(uuid);


--
-- Name: asset_status_history asset_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_status_history
    ADD CONSTRAINT asset_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: asset_stock_entries asset_stock_entries_stock_item_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_stock_entries
    ADD CONSTRAINT asset_stock_entries_stock_item_uuid_fkey FOREIGN KEY (stock_item_uuid) REFERENCES public.asset_stock_items(uuid) ON DELETE CASCADE;


--
-- Name: asset_stock_items asset_stock_items_asset_type_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_stock_items
    ADD CONSTRAINT asset_stock_items_asset_type_uuid_fkey FOREIGN KEY (asset_type_uuid) REFERENCES public.asset_types(uuid);


--
-- Name: asset_stock_items asset_stock_items_product_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_stock_items
    ADD CONSTRAINT asset_stock_items_product_uuid_fkey FOREIGN KEY (product_uuid) REFERENCES public.asset_products(uuid);


--
-- Name: assets assets_acquisition_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_acquisition_account_uuid_fkey FOREIGN KEY (acquisition_account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: assets assets_asset_type_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_asset_type_uuid_fkey FOREIGN KEY (asset_type_uuid) REFERENCES public.asset_types(uuid);


--
-- Name: auth_challenges auth_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_challenges
    ADD CONSTRAINT auth_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: committee_members committee_members_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_members
    ADD CONSTRAINT committee_members_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: committee_members committee_members_committee_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_members
    ADD CONSTRAINT committee_members_committee_uuid_fkey FOREIGN KEY (committee_uuid) REFERENCES public.committees(uuid) ON DELETE CASCADE;


--
-- Name: committee_members committee_members_member_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committee_members
    ADD CONSTRAINT committee_members_member_uuid_fkey FOREIGN KEY (member_uuid) REFERENCES public.members(uuid) ON DELETE CASCADE;


--
-- Name: committees committees_manager_member_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committees
    ADD CONSTRAINT committees_manager_member_uuid_fkey FOREIGN KEY (manager_member_uuid) REFERENCES public.members(uuid) ON DELETE SET NULL;


--
-- Name: committees committees_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.committees
    ADD CONSTRAINT committees_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cost_accrual_staging cost_accrual_staging_asset_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_accrual_staging
    ADD CONSTRAINT cost_accrual_staging_asset_uuid_fkey FOREIGN KEY (asset_uuid) REFERENCES public.assets(uuid) ON DELETE CASCADE;


--
-- Name: cost_accrual_staging cost_accrual_staging_cost_provision_rule_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_accrual_staging
    ADD CONSTRAINT cost_accrual_staging_cost_provision_rule_uuid_fkey FOREIGN KEY (cost_provision_rule_uuid) REFERENCES public.cost_provision_rules(uuid) ON DELETE CASCADE;


--
-- Name: cost_provision_rules cost_provision_rules_asset_type_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_provision_rules
    ADD CONSTRAINT cost_provision_rules_asset_type_uuid_fkey FOREIGN KEY (asset_type_uuid) REFERENCES public.asset_types(uuid);


--
-- Name: cost_provision_rules cost_provision_rules_fiscal_year_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_provision_rules
    ADD CONSTRAINT cost_provision_rules_fiscal_year_uuid_fkey FOREIGN KEY (fiscal_year_uuid) REFERENCES public.accounting_fiscal_years(uuid);


--
-- Name: cost_provision_rules cost_provision_rules_gl_account_credit_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_provision_rules
    ADD CONSTRAINT cost_provision_rules_gl_account_credit_uuid_fkey FOREIGN KEY (gl_account_credit_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: cost_provision_rules cost_provision_rules_gl_account_debit_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_provision_rules
    ADD CONSTRAINT cost_provision_rules_gl_account_debit_uuid_fkey FOREIGN KEY (gl_account_debit_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: federal_sync_logs federal_sync_logs_validated_flight_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.federal_sync_logs
    ADD CONSTRAINT federal_sync_logs_validated_flight_uuid_fkey FOREIGN KEY (validated_flight_uuid) REFERENCES public.validated_flights(uuid) ON DELETE CASCADE;


--
-- Name: accounting_journals fk_accounting_journals_default_account; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_journals
    ADD CONSTRAINT fk_accounting_journals_default_account FOREIGN KEY (default_account_uuid) REFERENCES public.accounting_accounts(uuid) ON DELETE SET NULL;


--
-- Name: accounting_lines fk_lines_entry; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.accounting_lines
    ADD CONSTRAINT fk_lines_entry FOREIGN KEY (entry_uuid, fiscal_year_uuid) REFERENCES public.accounting_entries(uuid, fiscal_year_uuid) ON DELETE CASCADE;


--
-- Name: flight_billing_settings flight_billing_settings_club_charge_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_club_charge_account_uuid_fkey FOREIGN KEY (club_charge_account_uuid) REFERENCES public.accounting_accounts(uuid) ON DELETE SET NULL;


--
-- Name: flight_billing_settings flight_billing_settings_club_member_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_club_member_uuid_fkey FOREIGN KEY (club_member_uuid) REFERENCES public.members(uuid) ON DELETE SET NULL;


--
-- Name: flight_billing_settings flight_billing_settings_default_initiation_charge_account__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_default_initiation_charge_account__fkey FOREIGN KEY (default_initiation_charge_account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: flight_billing_settings flight_billing_settings_default_pack_discount_expense_acco_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_default_pack_discount_expense_acco_fkey FOREIGN KEY (default_pack_discount_expense_account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: flight_billing_settings flight_billing_settings_default_pack_sales_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_default_pack_sales_account_uuid_fkey FOREIGN KEY (default_pack_sales_account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: flight_billing_settings flight_billing_settings_deposit_bank_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_deposit_bank_account_uuid_fkey FOREIGN KEY (deposit_bank_account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: flight_billing_settings flight_billing_settings_deposit_journal_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_deposit_journal_uuid_fkey FOREIGN KEY (deposit_journal_uuid) REFERENCES public.accounting_journals(uuid);


--
-- Name: flight_billing_settings flight_billing_settings_deposit_receivable_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_deposit_receivable_account_uuid_fkey FOREIGN KEY (deposit_receivable_account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: flight_billing_settings flight_billing_settings_fiscal_year_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_fiscal_year_uuid_fkey FOREIGN KEY (fiscal_year_uuid) REFERENCES public.accounting_fiscal_years(uuid) ON DELETE CASCADE;


--
-- Name: flight_billing_settings flight_billing_settings_fl_journal_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_fl_journal_uuid_fkey FOREIGN KEY (fl_journal_uuid) REFERENCES public.accounting_journals(uuid);


--
-- Name: flight_billing_settings flight_billing_settings_receivable_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_receivable_account_uuid_fkey FOREIGN KEY (receivable_account_uuid) REFERENCES public.accounting_accounts(uuid);


--
-- Name: flight_billing_settings flight_billing_settings_rem_journal_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_rem_journal_uuid_fkey FOREIGN KEY (rem_journal_uuid) REFERENCES public.accounting_journals(uuid);


--
-- Name: flight_billing_settings flight_billing_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: flight_billing_settings flight_billing_settings_vt_journal_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_billing_settings
    ADD CONSTRAINT flight_billing_settings_vt_journal_uuid_fkey FOREIGN KEY (vt_journal_uuid) REFERENCES public.accounting_journals(uuid);


--
-- Name: helloasso_vi_staging helloasso_vi_staging_promoted_vi_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.helloasso_vi_staging
    ADD CONSTRAINT helloasso_vi_staging_promoted_vi_uuid_fkey FOREIGN KEY (promoted_vi_uuid) REFERENCES public.vi_entitlements(uuid) ON DELETE SET NULL;


--
-- Name: member_pack_consumptions member_pack_consumptions_flight_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_pack_consumptions
    ADD CONSTRAINT member_pack_consumptions_flight_uuid_fkey FOREIGN KEY (flight_uuid) REFERENCES public.validated_flights(uuid) ON DELETE CASCADE;


--
-- Name: member_pack_consumptions member_pack_consumptions_member_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_pack_consumptions
    ADD CONSTRAINT member_pack_consumptions_member_uuid_fkey FOREIGN KEY (tiers_uuid) REFERENCES public.members(uuid) ON DELETE CASCADE;


--
-- Name: member_pack_consumptions member_pack_consumptions_pack_definition_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_pack_consumptions
    ADD CONSTRAINT member_pack_consumptions_pack_definition_uuid_fkey FOREIGN KEY (pack_definition_uuid) REFERENCES public.pack_definitions(uuid) ON DELETE SET NULL;


--
-- Name: member_registrations member_registrations_member_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_registrations
    ADD CONSTRAINT member_registrations_member_uuid_fkey FOREIGN KEY (member_uuid) REFERENCES public.members(uuid) ON DELETE CASCADE;


--
-- Name: member_registrations member_registrations_registered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_registrations
    ADD CONSTRAINT member_registrations_registered_by_fkey FOREIGN KEY (registered_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: member_sheets member_sheets_member_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sheets
    ADD CONSTRAINT member_sheets_member_uuid_fkey FOREIGN KEY (member_uuid) REFERENCES public.members(uuid) ON DELETE CASCADE;


--
-- Name: member_sheets member_sheets_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_sheets
    ADD CONSTRAINT member_sheets_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: members members_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pack_applicability pack_applicability_pack_definition_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_applicability
    ADD CONSTRAINT pack_applicability_pack_definition_uuid_fkey FOREIGN KEY (pack_definition_uuid) REFERENCES public.pack_definitions(uuid) ON DELETE CASCADE;


--
-- Name: pack_applicability pack_applicability_pricing_item_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_applicability
    ADD CONSTRAINT pack_applicability_pricing_item_uuid_fkey FOREIGN KEY (pricing_item_uuid) REFERENCES public.pricing_items(uuid) ON DELETE CASCADE;


--
-- Name: pack_definitions pack_definitions_eligible_asset_type_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_definitions
    ADD CONSTRAINT pack_definitions_eligible_asset_type_uuid_fkey FOREIGN KEY (eligible_asset_type_uuid) REFERENCES public.asset_types(uuid) ON DELETE SET NULL;


--
-- Name: pack_definitions pack_definitions_flights_journal_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_definitions
    ADD CONSTRAINT pack_definitions_flights_journal_uuid_fkey FOREIGN KEY (flights_journal_uuid) REFERENCES public.accounting_journals(uuid) ON DELETE SET NULL;


--
-- Name: pack_definitions pack_definitions_pack_sales_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_definitions
    ADD CONSTRAINT pack_definitions_pack_sales_account_uuid_fkey FOREIGN KEY (pack_sales_account_uuid) REFERENCES public.accounting_accounts(uuid) ON DELETE SET NULL;


--
-- Name: pack_definitions pack_definitions_rem_discount_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_definitions
    ADD CONSTRAINT pack_definitions_rem_discount_account_uuid_fkey FOREIGN KEY (pack_discount_expense_account_uuid) REFERENCES public.accounting_accounts(uuid) ON DELETE SET NULL;


--
-- Name: pricing_item_tiers pricing_item_tiers_pricing_item_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_item_tiers
    ADD CONSTRAINT pricing_item_tiers_pricing_item_uuid_fkey FOREIGN KEY (pricing_item_uuid) REFERENCES public.pricing_items(uuid) ON DELETE CASCADE;


--
-- Name: pricing_items pricing_items_gl_account_credit_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_items
    ADD CONSTRAINT pricing_items_gl_account_credit_uuid_fkey FOREIGN KEY (gl_account_credit_uuid) REFERENCES public.accounting_accounts(uuid) ON DELETE SET NULL;


--
-- Name: pricing_items pricing_items_pricing_version_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_items
    ADD CONSTRAINT pricing_items_pricing_version_uuid_fkey FOREIGN KEY (pricing_version_uuid) REFERENCES public.pricing_versions(uuid) ON DELETE CASCADE;


--
-- Name: pricing_versions pricing_versions_fiscal_year_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_versions
    ADD CONSTRAINT pricing_versions_fiscal_year_uuid_fkey FOREIGN KEY (fiscal_year_uuid) REFERENCES public.accounting_fiscal_years(uuid);


--
-- Name: role_capabilities role_capabilities_capability_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_capabilities
    ADD CONSTRAINT role_capabilities_capability_id_fkey FOREIGN KEY (capability_id) REFERENCES public.capabilities(id) ON DELETE CASCADE;


--
-- Name: role_capabilities role_capabilities_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_capabilities
    ADD CONSTRAINT role_capabilities_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: session_tokens session_tokens_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_tokens
    ADD CONSTRAINT session_tokens_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.auth_challenges(id) ON DELETE SET NULL;


--
-- Name: session_tokens session_tokens_trusted_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_tokens
    ADD CONSTRAINT session_tokens_trusted_device_id_fkey FOREIGN KEY (trusted_device_id) REFERENCES public.trusted_devices(id) ON DELETE SET NULL;


--
-- Name: session_tokens session_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_tokens
    ADD CONSTRAINT session_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: trusted_devices trusted_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trusted_devices
    ADD CONSTRAINT trusted_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: validated_flights validated_flights_source_snapshot_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validated_flights
    ADD CONSTRAINT validated_flights_source_snapshot_uuid_fkey FOREIGN KEY (source_snapshot_uuid) REFERENCES public.planche_flight_snapshots(uuid) ON DELETE SET NULL;


--
-- Name: vi_entitlements vi_entitlements_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vi_entitlements
    ADD CONSTRAINT vi_entitlements_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vi_entitlements vi_entitlements_vi_type_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vi_entitlements
    ADD CONSTRAINT vi_entitlements_vi_type_uuid_fkey FOREIGN KEY (vi_type_uuid) REFERENCES public.vi_type_catalog(uuid) ON DELETE RESTRICT;


--
-- Name: vi_type_catalog vi_type_catalog_charge_account_uuid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vi_type_catalog
    ADD CONSTRAINT vi_type_catalog_charge_account_uuid_fkey FOREIGN KEY (charge_account_uuid) REFERENCES public.accounting_accounts(uuid) ON DELETE SET NULL;


--
-- Name: vi_type_catalog vi_type_catalog_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vi_type_catalog
    ADD CONSTRAINT vi_type_catalog_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict j86ChAM3tQfxcNm0LBUdmeeHDB5C56R7xCS89XsAiqF1YBF0kvnsKLz4uSsMqii

