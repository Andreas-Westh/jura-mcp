import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Amendment } from "../domain/Amendment.js";
import {
  DocumentStatus,
  type LegalDocument,
  type Paragraph,
} from "../domain/LegalDocument.js";
import { LegalSource } from "../domain/Provenance.js";
import { StatuteKind, type Statute } from "../domain/Statute.js";
import {
  findStatutes,
  readAmendment,
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

const PARAGRAPH_SCHEMA = z.object({
  number: z.string(),
  heading: z.string(),
  text: z.string(),
});

const DOCUMENT_SCHEMA = z.object({
  title: z.string(),
  popularTitle: z.string().optional(),
  ministry: z.string(),
  status: z.enum(DocumentStatus),
  currentUntil: z.string().optional(),
  warning: z.string().optional(),
  laterChanges: z.array(
    z.object({
      announcedOn: z.string(),
      title: z.string(),
      identifier: z.string(),
      changingParagraph: z.string().optional(),
    })
  ),
  sections: z.array(
    z.object({
      title: z.string(),
      depth: z.number().optional(),
      paragraphs: z.string(),
    })
  ),
  paragraphs: z.array(PARAGRAPH_SCHEMA),
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
    return `WARNING: this text was consolidated up to ${document.currentUntil}. It does not contain the changes listed below. Read each change by its identifier.`;
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
      ({ announcedOn, identifier, changingParagraph, title }) =>
        `  · ${announcedOn} ${identifier}${changingParagraph ? ` § ${changingParagraph}` : ""} ${title}`
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
    const [from, to] = part.split("..").map((bound) => bound.trim());
    return paragraphs.slice(indexOf(from!), indexOf(to ?? from!) + 1);
  });
};

const readSelection = (
  paragraphs: Paragraph[],
  selection: string
): { text: string; paragraphs: Paragraph[]; omittedParagraphs?: number } => {
  const selected = selectParagraphs(paragraphs, selection);
  const shown = withinBudget(selected);
  const omitted = selected.slice(shown.length);
  if (omitted.length === 0) {
    return { text: formatParagraphs(shown), paragraphs: shown };
  }
  return {
    text: `${formatParagraphs(shown)}\n\n(${omitted.length} more \u00a7\u00a7 left out, from ${omitted[0]!.heading} Ask for a smaller range.)`,
    paragraphs: shown,
    omittedParagraphs: omitted.length,
  };
};

const PARAGRAPHS_INPUT = z
  .string()
  .max(100)
  .optional()
  .describe(
    'Which \u00a7 to read. For example "36", "38..38c" or "1,9a". ' +
      "A range uses two dots, because a \u00a7 number can hold a hyphen. " +
      "Leave it out to get the outline."
  );

const AMENDMENT_SCHEMA = z.object({
  title: z.string(),
  ministry: z.string(),
  outline: z.array(z.object({ number: z.string(), opening: z.string() })),
  paragraphs: z.array(PARAGRAPH_SCHEMA),
  omittedParagraphs: z.number().optional(),
  provenance: PROVENANCE_SCHEMA,
});

interface AmendmentOutline extends Amendment {
  outline: { number: string; opening: string }[];
}

const withOutline = (amendment: Amendment): AmendmentOutline => ({
  ...amendment,
  outline: amendment.paragraphs.map(({ number, text }) => ({
    number,
    opening: text.split("\n")[0] ?? "",
  })),
});

const formatAmendmentOutline = (amendment: AmendmentOutline): string =>
  [
    amendment.title,
    `${amendment.ministry} · ${amendment.provenance.url}`,
    "\nOutline — call again with the § numbers you need:",
    ...amendment.outline.map(
      ({ number, opening }) => `  § ${number}  ${opening}`
    ),
  ].join("\n");

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
        "For an amending-act, use read_amendment instead. " +
        "Without `paragraphs` the tool returns an outline: the status, the later changes, " +
        "and the section titles with their \u00a7 ranges. " +
        "Read the outline first. Then call the tool again with the \u00a7 numbers you need. " +
        "The text is the version consolidated at publication. It does not contain later changes. " +
        "The tool lists each change with its identifier and the \u00a7 of the changing act that makes it. " +
        'Read a "Lov om ændring" with read_amendment and pass that \u00a7 as `paragraphs`. ' +
        "Read any other later change with read_statute.",
      inputSchema: z.object({
        identifier: z
          .string()
          .min(1)
          .max(100)
          .describe(
            'An ELI identifier from find_statute. For example "eli/lta/2016/193".'
          ),
        paragraphs: PARAGRAPHS_INPUT,
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

      const { text, ...selected } = readSelection(
        document.paragraphs,
        paragraphs
      );
      return {
        content: [
          { type: "text", text: `${formatOutline(document)}\n\n${text}` },
        ],
        structuredContent: {
          ...document,
          ...selected,
          ...(warning ? { warning } : {}),
        },
      };
    }
  );

  server.registerTool(
    "read_amendment",
    {
      title: "Read Danish amending act",
      description:
        "Read a Danish amending act from Retsinformation: a lov or bekendtgørelse om ændring. " +
        "Use an identifier from the later changes of read_statute, or an amending-act from find_statute. " +
        "Without `paragraphs` the tool returns an outline: each \u00a7 with its first line. " +
        "The first line names the statute that the \u00a7 changes, or tells when the act commences. " +
        "Then call the tool again with the \u00a7 numbers you need. " +
        "The tool reports the changes as the act prints them. It does not apply them to the consolidated text. " +
        "If the tool says that the document is not an amending act, read it with read_statute.",
      inputSchema: z.object({
        identifier: z
          .string()
          .min(1)
          .max(100)
          .describe(
            'An ELI identifier of an amending act. For example "eli/lta/2021/2158".'
          ),
        paragraphs: PARAGRAPHS_INPUT,
      }),
      outputSchema: AMENDMENT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ identifier, paragraphs }) => {
      const amendment = withOutline(await readAmendment(identifier));
      const outline = formatAmendmentOutline(amendment);
      if (!paragraphs) {
        return {
          content: [{ type: "text", text: outline }],
          structuredContent: { ...amendment, paragraphs: [] },
        };
      }

      const { text, ...selected } = readSelection(
        amendment.paragraphs,
        paragraphs
      );
      return {
        content: [{ type: "text", text: `${outline}\n\n${text}` }],
        structuredContent: { ...amendment, ...selected },
      };
    }
  );
};
