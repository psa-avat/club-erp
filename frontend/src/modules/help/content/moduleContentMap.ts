/*
    ERP-CLUB - ERP pour Club de vol à voile
    - Logiciel libre de gestion d'un club de vol à voile
    - help: Maps a help slug + locale to its markdown content, lazily loaded
      and code-split per file via Vite's import.meta.glob.
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

import type { HelpLocale, HelpTocEntry } from "../types";

// Lazy, code-split loaders keyed by file path — one chunk per markdown file.
const frModules = import.meta.glob<string>("./fr/*.md", { query: "?raw", import: "default" });
const enModules = import.meta.glob<string>("./en/*.md", { query: "?raw", import: "default" });

function slugFromPath(path: string): string {
  return path.replace(/^\.\/(fr|en)\//, "").replace(/\.md$/, "");
}

const frLoaders = new Map(Object.entries(frModules).map(([path, loader]) => [slugFromPath(path), loader]));
const enLoaders = new Map(Object.entries(enModules).map(([path, loader]) => [slugFromPath(path), loader]));

/** Ordered table of contents for the Help Center — display order, not alphabetical. */
export const HELP_TOC: HelpTocEntry[] = [
  { slug: "getting-started", labelKey: "toc.gettingStarted" },
  { slug: "members", labelKey: "toc.members" },
  { slug: "assets", labelKey: "toc.assets" },
  { slug: "flights", labelKey: "toc.flights" },
  { slug: "vi", labelKey: "toc.vi" },
  { slug: "finance", labelKey: "toc.finance" },
  { slug: "tarifs", labelKey: "toc.tarifs" },
  { slug: "portal", labelKey: "toc.portal" },
  { slug: "admin", labelKey: "toc.admin" },
  { slug: "dashboard", labelKey: "toc.dashboard" },
  { slug: "faq", labelKey: "toc.faq" },
];

export const DEFAULT_HELP_SLUG = HELP_TOC[0].slug;

export interface HelpContentResult {
  markdown: string;
  /** True when the requested locale has no content and French was used instead. */
  isFallback: boolean;
}

/**
 * Loads the markdown for a given slug/locale, falling back to French when the
 * requested locale isn't translated yet (see docs/plans/help-documentation-feature.md).
 */
export async function loadHelpContent(slug: string, locale: HelpLocale): Promise<HelpContentResult | null> {
  const primaryLoader = locale === "en" ? enLoaders.get(slug) : frLoaders.get(slug);
  if (primaryLoader) {
    return { markdown: await primaryLoader(), isFallback: false };
  }

  const frLoader = frLoaders.get(slug);
  if (frLoader) {
    return { markdown: await frLoader(), isFallback: locale !== "fr" };
  }

  return null;
}
