import assert from "node:assert/strict";
import test from "node:test";
import { DocumentStatus } from "../src/domain/LegalDocument.js";
import { LegalSource } from "../src/domain/Provenance.js";
import { parseLexDania } from "../src/infrastructure/retsinformation/lexDania.js";

const PROVENANCE = {
  source: LegalSource.Retsinformation,
  identifier: "eli/lta/2016/193",
  url: "https://www.retsinformation.dk/eli/lta/2016/193",
  retrievedAt: "2026-08-30T00:00:00.000Z",
};

/** Titles sit on the afsnit and on the kapitel, as in aftaleloven and straffeloven. */
const XML = `<?xml version="1.0" encoding="utf-8"?>
<Dokument>
  <Meta>
    <DocumentTitle>Bekendtgørelse af testloven</DocumentTitle>
    <PopularTitle>Testloven</PopularTitle>
    <Ministry>Justitsministeriet</Ministry>
    <Status>Valid</Status>
    <EndDate>2021-11-28</EndDate>
    <Ref_Af>2021-11-27</Ref_Af>
    <Ref_Text>Lov om ændring af testloven</Ref_Text>
  </Meta>
  <DokumentIndhold>
    <Bog>
      <Afsnit>
        <Explicatus>I. Om aftaler</Explicatus>
        <Kapitel>
          <Explicatus>1. kapitel</Explicatus>
          <Rubrica><Linea><Char>Indledende bestemmelser</Char></Linea></Rubrica>
          <ParagrafGruppe>
            <Paragraf>
              <Explicatus>§ 1.</Explicatus>
              <Stk><Exitus><Linea><Char>Et tilbud er bindende.</Char></Linea></Exitus></Stk>
              <Stk>
                <Explicatus>Stk. 2.</Explicatus>
                <Exitus><Linea><Char>Reglen gælder ikke ved sædvane.</Char>
                  <Nota><Explicatus>1)</Explicatus><Exitus><Linea><Char>En fodnote.</Char></Linea></Exitus></Nota>
                </Linea></Exitus>
              </Stk>
            </Paragraf>
            <Paragraf>
              <Explicatus>§ 9 a.</Explicatus>
              <Stk><Exitus><Linea><Char>En særlig regel.</Char></Linea></Exitus></Stk>
            </Paragraf>
          </ParagrafGruppe>
        </Kapitel>
      </Afsnit>
    </Bog>
    <Ikraft>
      <Paragraf>
        <Explicatus>§ 12.</Explicatus>
        <Stk><Exitus><Linea><Char>Loven træder i kraft den 1. januar.</Char></Linea></Exitus></Stk>
      </Paragraf>
    </Ikraft>
  </DokumentIndhold>
</Dokument>`;

test("parses a statute and leaves the commencement provisions out", () => {
  const document = parseLexDania(XML, PROVENANCE);

  assert.equal(document.popularTitle, "Testloven");
  assert.equal(document.status, DocumentStatus.InForce);
  assert.equal(document.currentUntil, "2021-11-28");
  assert.deepEqual(document.laterChanges, [
    { announcedOn: "2021-11-27", title: "Lov om ændring af testloven" },
  ]);

  assert.deepEqual(
    document.paragraphs.map((paragraph) => paragraph.number),
    ["1", "9a"]
  );
  assert.equal(document.paragraphs[1]!.heading, "§ 9 a.");
  assert.equal(
    document.paragraphs[0]!.text,
    "Et tilbud er bindende.\nStk. 2. Reglen gælder ikke ved sædvane."
  );

  assert.deepEqual(document.sections, [
    { title: "I. Om aftaler", paragraphs: "1..9a" },
    {
      title: "1. kapitel — Indledende bestemmelser",
      depth: 1,
      paragraphs: "1..9a",
    },
  ]);
});
