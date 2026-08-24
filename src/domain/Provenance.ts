export enum LegalSource {
  Retsinformation = "retsinformation",
}

/** Where a legal document came from, so a citation can be attributed and verified. */
export interface Provenance {
  source: LegalSource;
  /** The source's own identifier. An ELI for Retsinformation, e.g. `eli/lta/2016/193`. */
  identifier: string;
  /** Canonical page a reader can open to check the citation. */
  url: string;
  retrievedAt: string;
}
