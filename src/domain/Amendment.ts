import type { Paragraph } from "./LegalDocument.js";
import type { Provenance } from "./Provenance.js";

/**
 * An act that changes other statutes. Each § names the statute it changes and
 * lists the changes, so the text is reported as printed and never applied.
 */
export interface Amendment {
  title: string;
  ministry: string;
  paragraphs: Paragraph[];
  provenance: Provenance;
}
