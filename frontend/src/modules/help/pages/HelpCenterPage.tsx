/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - help: HelpCenterPage — /help and /help/:moduleSlug
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
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useParams } from "react-router-dom";

import { PageHeader } from "@club-erp/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpContent } from "../components/HelpContent";
import { HelpToc } from "../components/HelpToc";
import { DEFAULT_HELP_SLUG, HELP_TOC, loadHelpContent } from "../content/moduleContentMap";
import type { HelpLocale } from "../types";

interface HelpModuleBodyProps {
  moduleSlug: string;
  locale: HelpLocale;
}

/** Keyed by `${moduleSlug}:${locale}` in the parent — remounts fresh per navigation
 *  instead of resetting state inside the effect (avoids a set-state-in-effect footgun). */
function HelpModuleBody({ moduleSlug, locale }: HelpModuleBodyProps) {
  const { t } = useTranslation("help");
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadHelpContent>>>();

  useEffect(() => {
    let cancelled = false;
    void loadHelpContent(moduleSlug, locale).then((loaded) => {
      if (!cancelled) setResult(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [moduleSlug, locale]);

  if (result === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (result === null) {
    return <p className="text-sm text-muted-foreground">{t("center.notFound")}</p>;
  }

  return (
    <>
      {result.isFallback ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t("center.notTranslatedYet")}
        </div>
      ) : null}
      <HelpContent markdown={result.markdown} />
    </>
  );
}

export function HelpCenterPage() {
  const { moduleSlug } = useParams<{ moduleSlug?: string }>();
  const { t, i18n } = useTranslation("help");
  const locale: HelpLocale = i18n.language === "en" ? "en" : "fr";

  if (!moduleSlug) {
    return <Navigate replace to={`/help/${DEFAULT_HELP_SLUG}`} />;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t("center.title")} description={t("center.description")} />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        <HelpToc entries={HELP_TOC} className="md:sticky md:top-20 md:self-start" />

        <div className="min-w-0">
          <HelpModuleBody key={`${moduleSlug}:${locale}`} moduleSlug={moduleSlug} locale={locale} />
        </div>
      </div>
    </div>
  );
}
