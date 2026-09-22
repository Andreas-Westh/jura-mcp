import type { Provenance } from "./Provenance.js";

export enum DocumentStatus {
  InForce = "in-force",
  /** A later version replaced this text. Do not cite it as current law. */
  Superseded = "superseded",
}

/**
 * A document announced after this text was consolidated, so the text does not contain it.
 * It is an amending act, a new act, or a newer consolidation of the same statute.
 */
export interface LaterChange {
  announcedOn: string;
  title: string;
  /** The ELI of the document. Absent when Retsinformation gives no Lovtidende A number. */
  identifier?: string;
}

export interface Paragraph {
  /** The § number without spaces, for example `9a`. Ask for a paragraph by this. */
  number: string;
  /** The number as the statute prints it, for example `§ 9 a.`. */
  heading: string;
  text: string;
}

/**
 * A titled part of a statute. Danish statutes put the title on different levels,
 * so a section is any container that has one — an afsnit, a kapitel or a group.
 */
export interface Section {
  title: string;
  /** How many titled sections contain this one. Absent at the top level. */
  depth?: number;
  paragraphs: string;
}

export interface LegalDocument {
  title: string;
  popularTitle?: string;
  ministry: string;
  status: DocumentStatus;
  /** The last day this text was the current version. */
  currentUntil?: string;
  laterChanges: LaterChange[];
  sections: Section[];
  paragraphs: Paragraph[];
  provenance: Provenance;
}
