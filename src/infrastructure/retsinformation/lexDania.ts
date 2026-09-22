import { XMLParser } from "fast-xml-parser";
import type { Amendment } from "../../domain/Amendment.js";
import {
  DocumentStatus,
  type LaterChange,
  type LegalDocument,
  type Paragraph,
  type Section,
} from "../../domain/LegalDocument.js";
import type { Provenance } from "../../domain/Provenance.js";

/**
 * Retsinformation serves every document as LexDania XML. The schema nests
 * containers in a fixed order and never skips a level, so the walk below can
 * follow one child element per step.
 */
const REPEATED_ELEMENTS = new Set([
  "Meta",
  "Ref_Af",
  "Ref_Text",
  "Ref_Accn",
  "Bog",
  "Afsnit",
  "Kapitel",
  "ParagrafGruppe",
  "Paragraf",
  "Stk",
  "Rubrica",
  "Linea",
  "AendringCentreretParagraf",
  "AendringsNummer",
  "Aendring",
  "IkraftCentreretParagraf",
]);

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => REPEATED_ELEMENTS.has(name),
});

const STATUS_BY_LEX_DANIA_STATUS: Record<string, DocumentStatus> = {
  Valid: DocumentStatus.InForce,
  Historic: DocumentStatus.Superseded,
};

/** A footnote interrupts the sentence it hangs on, so it is left out of the text. */
const FOOTNOTE_ELEMENT = "Nota";

interface StatuteParagraph {
  Explicatus?: string;
  Stk?: unknown[];
}

interface Container {
  Explicatus?: string;
  Rubrica?: unknown[];
  Afsnit?: Container[];
  Kapitel?: Container[];
  ParagrafGruppe?: Container[];
  Paragraf?: StatuteParagraph[];
}

/**
 * One numbered change: where it applies, the new text if the change adds any,
 * and the renumbering that follows from it, e.g. `Nr. 1-6 bliver herefter nr. 4-9.`
 */
interface AmendingInstruction {
  Explicatus?: string;
  Aendring?: { AendringDefinition?: unknown; AendringAktion?: unknown }[];
  Rykningsklausul?: unknown;
}

/**
 * A § of an amending act. `Exitus` names the statute that the § changes.
 * `Rubrica` titles the §, e.g. with the ministry in an act that spans several.
 */
interface AmendingParagraph {
  Explicatus?: string;
  Rubrica?: unknown[];
  Exitus?: unknown;
  AendringsNummer?: AmendingInstruction[];
}

/** `Rubrica` titles the §, e.g. `Ikrafttrædelse`. */
interface CommencementParagraph extends StatuteParagraph {
  Rubrica?: unknown[];
}

/** Body text is mixed content spread over Linea and Char, so it is collected. */
const textOf = (node: unknown): string => {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (node && typeof node === "object") {
    return Object.entries(node)
      .filter(([name]) => name !== FOOTNOTE_ELEMENT)
      .map(([, value]) => textOf(value))
      .join(" ");
  }
  return "";
};

const collapseSpaces = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

export const toParagraphNumber = (heading: string): string =>
  heading.replace(/[§.\s]/g, "").toLowerCase();

const toParagraph = (
  heading: string | undefined,
  lines: string[]
): Paragraph => {
  if (!heading) {
    throw new Error("LexDania paragraph without a § number");
  }
  return {
    number: toParagraphNumber(heading),
    heading: collapseSpaces(heading),
    text: lines.join("\n"),
  };
};

const stkLines = (source: StatuteParagraph): string[] =>
  (source.Stk ?? []).map((stk) => collapseSpaces(textOf(stk)));

const toStatuteParagraph = (source: StatuteParagraph): Paragraph =>
  toParagraph(source.Explicatus, stkLines(source));

/** The act prints new text in »«, so the quotes show where the new text ends. */
const toInstruction = (instruction: AmendingInstruction): string =>
  [
    instruction.Explicatus,
    ...(instruction.Aendring ?? []).flatMap((change) => {
      const newText = collapseSpaces(textOf(change.AendringAktion));
      return [textOf(change.AendringDefinition), newText ? `»${newText}«` : ""];
    }),
    textOf(instruction.Rykningsklausul),
  ]
    .map((part) => collapseSpaces(part ?? ""))
    .filter((part) => part !== "")
    .join(" ");

/** The title goes on the first line, so the outline shows it beside what the § changes. */
const withTitle = (rubrica: unknown, lines: string[]): string[] => {
  const title = collapseSpaces(textOf(rubrica));
  const [first, ...rest] = lines;
  if (!title) return lines;
  return [first ? `${title} — ${first}` : title, ...rest];
};

const toAmendingParagraph = (source: AmendingParagraph): Paragraph =>
  toParagraph(
    source.Explicatus,
    withTitle(
      source.Rubrica,
      [
        collapseSpaces(textOf(source.Exitus)),
        ...(source.AendringsNummer ?? []).map(toInstruction),
      ].filter((line) => line !== "")
    )
  );

const toCommencementParagraph = (source: CommencementParagraph): Paragraph =>
  toParagraph(source.Explicatus, withTitle(source.Rubrica, stkLines(source)));

/**
 * The title sits on a different level in every statute — on the afsnit in
 * aftaleloven, on the kapitel in straffeloven, on the paragraph group in
 * købeloven. So the walk titles whatever container carries one.
 */
const titleOf = (container: Container): string | undefined => {
  const parts = [
    container.Explicatus,
    container.Rubrica && textOf(container.Rubrica),
  ]
    .filter((part): part is string => Boolean(part))
    .map(collapseSpaces);
  return parts.length > 0 ? parts.join(" — ") : undefined;
};

const walk = (
  container: Container,
  depth: number
): { sections: Section[]; paragraphs: Paragraph[] } => {
  const title = titleOf(container);
  const children =
    container.Afsnit ?? container.Kapitel ?? container.ParagrafGruppe;
  const inner = children
    ? children.map((child) => walk(child, title ? depth + 1 : depth))
    : [
        {
          sections: [],
          paragraphs: (container.Paragraf ?? []).map(toStatuteParagraph),
        },
      ];

  const sections = inner.flatMap((result) => result.sections);
  const paragraphs = inner.flatMap((result) => result.paragraphs);
  if (!title || paragraphs.length === 0) {
    return { sections, paragraphs };
  }

  const first = paragraphs[0]!.number;
  const last = paragraphs[paragraphs.length - 1]!.number;
  const section: Section = {
    title,
    ...(depth > 0 ? { depth } : {}),
    paragraphs: first === last ? first : `${first}..${last}`,
  };
  return { sections: [section, ...sections], paragraphs };
};

/**
 * Retsinformation's accession number is `A`, the year, the number in Lovtidende A
 * and two more digits, so `A20210215830` is `eli/lta/2021/2158`. We found no ELI
 * for the other prefixes.
 */
const toIdentifier = (
  accessionNumber: string | undefined
): string | undefined => {
  const match = /^A(\d{4})(\d{5})\d{2}$/.exec(accessionNumber ?? "");
  return match ? `eli/lta/${match[1]}/${Number(match[2])}` : undefined;
};

const toLaterChanges = (meta: {
  Ref_Af?: string[];
  Ref_Text?: string[];
  Ref_Accn?: string[];
}): LaterChange[] =>
  (meta.Ref_Af ?? []).map((announcedOn, index) => ({
    announcedOn,
    title: collapseSpaces(meta.Ref_Text?.[index] ?? ""),
    identifier: toIdentifier(meta.Ref_Accn?.[index]),
  }));

/**
 * An amending act nests its new text inside change instructions instead of a
 * `Bog`, so `parseLexDaniaAmendment` reads it.
 *
 * `Ikraft` holds the commencement provisions of the amending acts. It is a
 * sibling of `Bog`, so walking `Bog` alone keeps their § numbers out of the
 * statute's own numbering.
 */
export const parseLexDania = (
  xml: string,
  provenance: Provenance
): LegalDocument => {
  const { Dokument: document } = parser.parse(xml);
  const meta = document.Meta[0];

  const status = STATUS_BY_LEX_DANIA_STATUS[meta.Status];
  if (!status) {
    throw new Error(`Unmapped LexDania status: ${meta.Status}`);
  }

  const books: Container[] | undefined = document.DokumentIndhold.Bog;
  if (!books) {
    throw new Error(
      `Cannot read ${provenance.identifier}. It is not a consolidated statute. Open ${provenance.url} to read it.`
    );
  }

  const body = books.map((book) => walk(book, 0));

  return {
    title: collapseSpaces(meta.DocumentTitle),
    popularTitle: meta.PopularTitle || undefined,
    ministry: meta.Ministry,
    status,
    currentUntil: meta.EndDate || undefined,
    laterChanges: toLaterChanges(meta),
    sections: body.flatMap(
      (result: { sections: Section[] }) => result.sections
    ),
    paragraphs: body.flatMap(
      (result: { paragraphs: Paragraph[] }) => result.paragraphs
    ),
    provenance,
  };
};

/** LexDania puts the commencement §§ after the amending §§, so the order holds. */
export const parseLexDaniaAmendment = (
  xml: string,
  provenance: Provenance
): Amendment => {
  const { Dokument: document } = parser.parse(xml);
  const meta = document.Meta[0];

  const body = document.DokumentIndhold;
  if (!body) {
    throw new Error(
      `Cannot read ${provenance.identifier}. Retsinformation has no text for it. Open ${provenance.url} to read it.`
    );
  }
  const amendingParagraphs: AmendingParagraph[] | undefined =
    body.AendringCentreretParagraf;
  if (!amendingParagraphs) {
    throw new Error(
      `Cannot read ${provenance.identifier}. It is not an amending act.`
    );
  }
  const commencementParagraphs: CommencementParagraph[] =
    body.IkraftCentreretParagraf ?? [];

  return {
    title: collapseSpaces(meta.DocumentTitle),
    ministry: meta.Ministry,
    paragraphs: [
      ...amendingParagraphs.map(toAmendingParagraph),
      ...commencementParagraphs.map(toCommencementParagraph),
    ],
    provenance,
  };
};
