import type { Paragraph } from "./LegalDocument.js";
import type { Provenance } from "./Provenance.js";

export interface Amendment {
  title: string;
  ministry: string;
  paragraphs: Paragraph[];
  provenance: Provenance;
}
