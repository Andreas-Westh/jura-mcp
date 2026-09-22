import { z } from "zod";
import type { Amendment } from "../../domain/Amendment.js";
import { LegalSource, type Provenance } from "../../domain/Provenance.js";
import { StatuteKind, type Statute } from "../../domain/Statute.js";
import type { LaterChange, LegalDocument } from "../../domain/LegalDocument.js";
import { parseLexDania, parseLexDaniaAmendment } from "./lexDania.js";

const BASE_URL = "https://www.retsinformation.dk";
const MAX_RESULTS = 10;

/**
 * Retsinformation's `dt` document-type ids for the statute kinds we map. Without
 * them the same search also returns bills, rulings and ombudsman opinions.
 * Repeated `dt` parameters are additive; a comma-separated list matches nothing.
 */
const STATUTE_DOCUMENT_TYPE_IDS = ["10", "20", "30", "60", "80"];

const STATUTE_KIND_BY_ELI_CODE: Record<string, StatuteKind> = {
  LOVH: StatuteKind.Act,
  LOVC: StatuteKind.AmendingAct,
  LBKH: StatuteKind.ConsolidatedAct,
  BEKH: StatuteKind.ExecutiveOrder,
  BEKC: StatuteKind.AmendingExecutiveOrder,
};

/** The search and references endpoints are undocumented, so their responses are parsed rather than trusted. */
const SEARCH_DOCUMENT_SCHEMA = z.object({
  shortName: z.string(),
  title: z.string(),
  popularTitle: z.string(),
  ressortName: z.string(),
  documentTypeEliCode: z.string(),
  retsinfoLink: z.string(),
  offentliggoerelsesDato: z.string(),
});

const SEARCH_RESPONSE_SCHEMA = z.object({
  documents: z.array(SEARCH_DOCUMENT_SCHEMA),
});

type SearchDocument = z.infer<typeof SEARCH_DOCUMENT_SCHEMA>;

const REFERENCES_RESPONSE_SCHEMA = z.object({
  referenceGroups: z.array(
    z.object({
      header: z.string(),
      references: z.array(
        z.object({
          title: z.string(),
          eliPath: z.string(),
          paragraph: z.number().optional(),
          offentliggoerelsesDato: z.string(),
        })
      ),
    })
  ),
});

const LATER_CHANGES_HEADER = "Senere ændringer til forskriften";

const toIsoDate = (danishDate: string): string => {
  const [day, month, year] = danishDate.split(/[/-]/);
  if (!day || !month || !year) {
    throw new Error(`Unexpected Retsinformation date: ${danishDate}`);
  }
  return `${year}-${month}-${day}`;
};

const toStatute = (document: SearchDocument, retrievedAt: string): Statute => {
  const kind = STATUTE_KIND_BY_ELI_CODE[document.documentTypeEliCode];
  if (!kind) {
    throw new Error(
      `Unmapped Retsinformation document type: ${document.documentTypeEliCode}`
    );
  }

  return {
    kind,
    title: document.title,
    popularTitle: document.popularTitle || undefined,
    citation: document.shortName,
    ministry: document.ressortName,
    publishedOn: toIsoDate(document.offentliggoerelsesDato),
    provenance: {
      source: LegalSource.Retsinformation,
      identifier: document.retsinfoLink.replace(/^\//, ""),
      url: `${BASE_URL}${document.retsinfoLink}`,
      retrievedAt,
    },
  };
};

/** `h=false` drops superseded versions, so every hit is the version now in force. */
export const findStatutes = async (query: string): Promise<Statute[]> => {
  const parameters = new URLSearchParams({ t: query, h: "false" });
  STATUTE_DOCUMENT_TYPE_IDS.forEach((id) => parameters.append("dt", id));

  const response = await fetch(`${BASE_URL}/api/documentsearch?${parameters}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Retsinformation search failed with ${response.status}`);
  }

  const { documents } = SEARCH_RESPONSE_SCHEMA.parse(await response.json());
  const retrievedAt = new Date().toISOString();
  return documents
    .slice(0, MAX_RESULTS)
    .map((document) => toStatute(document, retrievedAt));
};

const fetchLexDania = async (
  identifier: string
): Promise<{ xml: string; provenance: Provenance }> => {
  const url = `${BASE_URL}/${identifier}`;
  const response = await fetch(`${url}/xml`, {
    headers: { accept: "application/xml" },
  });
  if (!response.ok) {
    throw new Error(
      `Retsinformation document ${identifier} failed with ${response.status}`
    );
  }

  return {
    xml: await response.text(),
    provenance: {
      source: LegalSource.Retsinformation,
      identifier,
      url,
      retrievedAt: new Date().toISOString(),
    },
  };
};

const fetchLaterChanges = async (
  uniqueDocumentId: string
): Promise<LaterChange[]> => {
  const response = await fetch(
    `${BASE_URL}/api/document/${uniqueDocumentId}/references/0`,
    { headers: { accept: "application/json" } }
  );
  if (!response.ok) {
    throw new Error(
      `Retsinformation references for document ${uniqueDocumentId} failed with ${response.status}`
    );
  }

  const { referenceGroups } = REFERENCES_RESPONSE_SCHEMA.parse(
    await response.json()
  );
  const laterChanges = referenceGroups.find(
    (group) => group.header === LATER_CHANGES_HEADER
  );
  if (!laterChanges) {
    throw new Error(
      `Retsinformation references for document ${uniqueDocumentId} have no "${LATER_CHANGES_HEADER}" group`
    );
  }
  return laterChanges.references.map((reference) => ({
    announcedOn: toIsoDate(reference.offentliggoerelsesDato),
    title: reference.title,
    identifier: reference.eliPath.replace(/^\//, ""),
    changingParagraph: reference.paragraph?.toString(),
  }));
};

/** The text is the version consolidated at publication. Later changes are not applied to it. */
export const readStatute = async (
  identifier: string
): Promise<LegalDocument> => {
  const { xml, provenance } = await fetchLexDania(identifier);
  const { uniqueDocumentId, ...document } = parseLexDania(xml, provenance);
  return {
    ...document,
    laterChanges: await fetchLaterChanges(uniqueDocumentId),
  };
};

export const readAmendment = async (identifier: string): Promise<Amendment> => {
  const { xml, provenance } = await fetchLexDania(identifier);
  return parseLexDaniaAmendment(xml, provenance);
};
