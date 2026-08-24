import type { Provenance } from "./Provenance.js";

export enum StatuteKind {
  Act = "act",
  AmendingAct = "amending-act",
  ConsolidatedAct = "consolidated-act",
  ExecutiveOrder = "executive-order",
  AmendingExecutiveOrder = "amending-executive-order",
}

export interface Statute {
  kind: StatuteKind;
  title: string;
  /** The name lawyers use, e.g. `Aftaleloven`. Most executive orders have none. */
  popularTitle?: string;
  /** Danish citation form, e.g. `LBK nr 193 af 02/03/2016`. */
  citation: string;
  ministry: string;
  publishedOn: string;
  provenance: Provenance;
}
