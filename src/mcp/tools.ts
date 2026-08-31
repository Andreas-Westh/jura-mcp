import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  DocumentStatus,
  type LegalDocument,
  type Paragraph,
} from "../domain/LegalDocument.js";
import { LegalSource } from "../domain/Provenance.js";
import { StatuteKind, type Statute } from "../domain/Statute.js";
import {
  findStatutes,
  readStatute,
} from "../infrastructure/retsinformation/RetsinformationGateway.js";
import { toParagraphNumber } from "../infrastructure/retsinformation/lexDania.js";

const PROVENANCE_SCHEMA = z.object({
  source: z.enum(LegalSource),
  identifier: z.string(),
  url: z.string(),
  retrievedAt: z.string(),
});

const STATUTE_SCHEMA = z.object({
  kind: z.enum(StatuteKind),
  title: z.string(),
  popularTitle: z.string().optional(),
  citation: z.string(),
  ministry: z.string(),
  publishedOn: z.string(),
  provenance: PROVENANCE_SCHEMA,
});

const formatStatute = (statute: Statute, index: number): string =>
  [
    `${index + 1}. ${statute.popularTitle ?? statute.title}`,
    statute.popularTitle ? `   ${statute.title}` : undefined,
    `   ${statute.citation} · ${statute.kind} · ${statute.ministry} · published ${statute.publishedOn}`,
    `   Source: ${statute.provenance.source} · ${statute.provenance.identifier}`,
    `   ${statute.provenance.url}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

const formatStatutes = (statutes: Statute[]): string =>
  statutes.length === 0
    ? 'No statute in force matched the query. Try the Danish popular name, e.g. "aftaleloven".'
    : statutes.map(formatStatute).join("\n\n");

const MAX_CHARACTERS = 12_000;

const DOCUMENT_SCHEMA = z.object({
  title: z.string(),
  popularTitle: z.string().optional(),
  ministry: z.string(),
  status: z.enum(DocumentStatus),
  currentUntil: z.string().optional(),
  warning: z.string().optional(),
  laterChanges: z.array(
    z.object({ announcedOn: z.string(), title: z.string() })
  ),
  sections: z.array(
    z.object({
      title: z.string(),
      depth: z.number().optional(),
      paragraphs: z.string(),
    })
  ),
  paragraphs: z.array(
    z.object({ number: z.string(), heading: z.string(), text: z.string() })
  ),
  omittedParagraphs: z.number().optional(),
  provenance: PROVENANCE_SCHEMA,
});

/**
 * Retsinformation publishes the text as it stood when the version was consolidated.
 * Applying a later change is legal interpretation, so the tool reports it instead.
 */
const warnAboutAge = (document: LegalDocument): string | undefined => {
  if (document.status === DocumentStatus.Superseded) {
    return "WARNING: a newer version replaced this text. Do not cite it as current law.";
  }
  if (
    document.currentUntil &&
    document.currentUntil < new Date().toISOString().slice(0, 10)
  ) {
    return `WARNING: this text was consolidated up to ${document.currentUntil}. It does not contain the changes listed below. Read the changing act to see them.`;
  }
  return undefined;
};

const formatOutline = (document: LegalDocument): string =>
  [
    document.popularTitle ?? document.title,
    document.popularTitle ? document.title : undefined,
    `${document.ministry} · ${document.status} · ${document.provenance.url}`,
    warnAboutAge(document),
    document.laterChanges.length > 0 ? "\nLater changes:" : undefined,
    ...document.laterChanges.map(
      (change) => `  · ${change.announcedOn} ${change.title}`
    ),
    "\nOutline — call again with the § numbers you need:",
    ...document.sections.map(
      (section) =>
        `${"  ".repeat((section.depth ?? 0) + 1)}${section.title}  §§ ${section.paragraphs}`
    ),
  ]
    .filter((line) => line !== undefined)
    .join("\n");

/** A § runs from about 100 to about 5,700 characters, so the limit is on text, not on count. */
const withinBudget = (paragraphs: Paragraph[]): Paragraph[] => {
  const runningTotals = paragraphs.reduce<number[]>(
    (totals, paragraph) => [
      ...totals,
      (totals[totals.length - 1] ?? 0) + paragraph.text.length,
    ],
    []
  );
  const overflow = runningTotals.findIndex((total) => total > MAX_CHARACTERS);
  return overflow < 0 ? paragraphs : paragraphs.slice(0, Math.max(overflow, 1));
};

const formatParagraphs = (paragraphs: Paragraph[]): string =>
  paragraphs
    .map((paragraph) => `${paragraph.heading}\n${paragraph.text}`)
    .join("\n\n");

const selectParagraphs = (
  paragraphs: Paragraph[],
  selection: string
): Paragraph[] => {
  const indexOf = (number: string): number => {
    const index = paragraphs.findIndex(
      (p) => p.number === toParagraphNumber(number)
    );
    if (index < 0) {
      throw new Error(`The statute has no § ${number}`);
    }
    return index;
  };

  return selection.split(",").flatMap((part) => {
    const [from, to] = part.split("-").map((bound) => bound.trim());
    return paragraphs.slice(indexOf(from!), indexOf(to ?? from!) + 1);
  });
};

export const registerTools = (server: McpServer): void => {
  server.registerTool(
    "find_statute",
    {
      title: "Find Danish statute",
      description:
        "Search Danish statutes on Retsinformation. It covers love, lovbekendtgørelser and bekendtgørelser. " +
        "Write the query in Danish. The search does not translate. " +
        "Use one term. Extra words make the search wider, not narrower. " +
        'Prefer the popular name, for example "aftaleloven". Keep the letters æ, ø and å. ' +
        "The tool returns only statutes in force. " +
        "Each result gives the source, the ELI identifier and a URL. Cite from these.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(200)
          .describe('One Danish term. For example "aftaleloven".'),
      }),
      outputSchema: z.object({ statutes: z.array(STATUTE_SCHEMA) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      const statutes = await findStatutes(query);
      return {
        content: [{ type: "text", text: formatStatutes(statutes) }],
        structuredContent: { statutes },
      };
    }
  );

  server.registerTool(
    "read_statute",
    {
      title: "Read Danish statute",
      description:
        "Read a Danish statute from Retsinformation. Use an ELI identifier from find_statute. " +
        "Without `paragraphs` the tool returns an outline: the status, the later changes, " +
        "and the section titles with their \u00a7 ranges. " +
        "Read the outline first. Then call the tool again with the \u00a7 numbers you need. " +
        "The text is the version consolidated at publication. It does not contain later changes. " +
        "The tool lists those changes. Read the changing act to see them.",
      inputSchema: z.object({
        identifier: z
          .string()
          .min(1)
          .max(100)
          .describe(
            'An ELI identifier from find_statute. For example "eli/lta/2016/193".'
          ),
        paragraphs: z
          .string()
          .max(100)
          .optional()
          .describe(
            'Which \u00a7 to read. For example "36", "38-38c" or "1,9a". Leave it out to get the outline.'
          ),
      }),
      outputSchema: DOCUMENT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ identifier, paragraphs }) => {
      const document = await readStatute(identifier);
      const warning = warnAboutAge(document);
      if (!paragraphs) {
        return {
          content: [{ type: "text", text: formatOutline(document) }],
          structuredContent: {
            ...document,
            paragraphs: [],
            ...(warning ? { warning } : {}),
          },
        };
      }

      const selected = selectParagraphs(document.paragraphs, paragraphs);
      const shown = withinBudget(selected);
      const omitted = selected.slice(shown.length);
      const truncated =
        omitted.length > 0
          ? `\n\n(${omitted.length} more \u00a7\u00a7 left out, from ${omitted[0]!.heading} Ask for a smaller range.)`
          : "";

      return {
        content: [
          {
            type: "text",
            text: `${formatOutline(document)}\n\n${formatParagraphs(shown)}${truncated}`,
          },
        ],
        structuredContent: {
          ...document,
          paragraphs: shown,
          ...(warning ? { warning } : {}),
          ...(omitted.length > 0 ? { omittedParagraphs: omitted.length } : {}),
        },
      };
    }
  );
};
