import { XMLParser } from "fast-xml-parser";
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
  "Bog",
  "Afsnit",
  "Kapitel",
  "ParagrafGruppe",
  "Paragraf",
  "Stk",
  "Rubrica",
  "Linea",
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

interface Container {
  Explicatus?: string;
  Rubrica?: unknown[];
  Afsnit?: Container[];
  Kapitel?: Container[];
  ParagrafGruppe?: Container[];
  Paragraf?: { Explicatus?: string; Stk?: unknown[] }[];
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
  source: NonNullable<Container["Paragraf"]>[number]
): Paragraph => {
  const heading = source.Explicatus;
  if (!heading) {
    throw new Error("LexDania paragraph without a § number");
  }
  return {
    number: toParagraphNumber(heading),
    heading: collapseSpaces(heading),
    text: (source.Stk ?? [])
      .map((stk) => collapseSpaces(textOf(stk)))
      .join("\n"),
  };
};

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
          paragraphs: (container.Paragraf ?? []).map(toParagraph),
        },
      ];

  const sections = inner.flatMap((result) => result.sections);
  const paragraphs = inner.flatMap((result) => result.paragraphs);
  if (!title || paragraphs.length === 0) {
    return { sections, paragraphs };
  }

  const section: Section = {
    title,
    depth,
    firstParagraph: paragraphs[0]!.number,
    lastParagraph: paragraphs[paragraphs.length - 1]!.number,
  };
  return { sections: [section, ...sections], paragraphs };
};

const toLaterChanges = (meta: {
  Ref_Af?: string[];
  Ref_Text?: string[];
}): LaterChange[] =>
  (meta.Ref_Af ?? []).map((announcedOn, index) => ({
    announcedOn,
    title: collapseSpaces(meta.Ref_Text?.[index] ?? ""),
  }));

/**
 * An amending act nests its new text inside change instructions instead of a
 * `Bog`, so only consolidated statutes are read.
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
