import assert from "node:assert/strict";
import test from "node:test";
import { DocumentStatus } from "../src/domain/LegalDocument.js";
import { LegalSource } from "../src/domain/Provenance.js";
import {
  parseLexDania,
  parseLexDaniaAmendment,
} from "../src/infrastructure/retsinformation/lexDania.js";

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
    <Ref_Accn>A20210215830</Ref_Accn>
    <Ref_Af>2021-11-27</Ref_Af>
    <Ref_Text>Lov om ændring af testloven</Ref_Text>
    <Ref_Accn>B20250009405</Ref_Accn>
    <Ref_Af>2025-03-01</Ref_Af>
    <Ref_Text>Bekendtgørelse i Lovtidende B</Ref_Text>
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
    {
      announcedOn: "2021-11-27",
      title: "Lov om ændring af testloven",
      identifier: "eli/lta/2021/2158",
    },
    {
      announcedOn: "2025-03-01",
      title: "Bekendtgørelse i Lovtidende B",
      identifier: undefined,
    },
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

const AMENDMENT_PROVENANCE = {
  ...PROVENANCE,
  identifier: "eli/lta/2024/1669",
  url: "https://www.retsinformation.dk/eli/lta/2024/1669",
};

const AMENDMENT_XML = `<?xml version="1.0" encoding="utf-8"?>
<Dokument>
  <Meta>
    <DocumentTitle>Lov om ændring af testloven</DocumentTitle>
    <Ministry>Justitsministeriet</Ministry>
  </Meta>
  <DokumentIndhold>
    <AendringCentreretParagraf>
      <Explicatus>§ 1</Explicatus>
      <Rubrica><Linea><Char>Justitsministeriet</Char></Linea></Rubrica>
      <Exitus><Linea><Char>I testloven foretages følgende ændringer:</Char></Linea></Exitus>
      <AendringsNummer>
        <Explicatus>1.</Explicatus>
        <Aendring>
          <AendringDefinition><Exitus><Linea><Char>I § 3 indsættes før nr. 1 som nyt nummer:</Char></Linea></Exitus></AendringDefinition>
          <AendringAktion><AendringNyTekst><Exitus><Linea><Char>1) Varer.</Char></Linea></Exitus></AendringNyTekst></AendringAktion>
        </Aendring>
        <Rykningsklausul><Exitus><Linea><Char>Nr. 1-6 bliver herefter nr. 2-7.</Char></Linea></Exitus></Rykningsklausul>
      </AendringsNummer>
      <AendringsNummer>
        <Explicatus>2.</Explicatus>
        <Aendring>
          <AendringDefinition><Exitus><Linea><Char>I § 8 ændres »nr. 3« til: »nr. 4«.</Char></Linea></Exitus></AendringDefinition>
          <AendringAktion><AendringNyTekst /></AendringAktion>
        </Aendring>
      </AendringsNummer>
    </AendringCentreretParagraf>
    <IkraftCentreretParagraf>
      <Explicatus>§ 2</Explicatus>
      <Rubrica><Linea><Char>Ikrafttrædelse</Char></Linea></Rubrica>
      <Stk><Exitus><Linea><Char>Loven træder i kraft den 1. januar 2025.</Char></Linea></Exitus></Stk>
    </IkraftCentreretParagraf>
  </DokumentIndhold>
</Dokument>`;

test("parses an amending act with its titles and renumbering", () => {
  const amendment = parseLexDaniaAmendment(AMENDMENT_XML, AMENDMENT_PROVENANCE);

  assert.deepEqual(amendment.paragraphs, [
    {
      number: "1",
      heading: "§ 1",
      text: [
        "Justitsministeriet — I testloven foretages følgende ændringer:",
        "1. I § 3 indsættes før nr. 1 som nyt nummer: »1) Varer.« Nr. 1-6 bliver herefter nr. 2-7.",
        "2. I § 8 ændres »nr. 3« til: »nr. 4«.",
      ].join("\n"),
    },
    {
      number: "2",
      heading: "§ 2",
      text: "Ikrafttrædelse — Loven træder i kraft den 1. januar 2025.",
    },
  ]);
});

test("an act without published text is refused with the page to open", () => {
  const xml = `<Dokument><Meta><DocumentTitle>Lov om ændring</DocumentTitle><Ministry>Justitsministeriet</Ministry></Meta></Dokument>`;

  assert.throws(() => parseLexDaniaAmendment(xml, AMENDMENT_PROVENANCE), {
    message:
      "Cannot read eli/lta/2024/1669. Retsinformation has no text for it. Open https://www.retsinformation.dk/eli/lta/2024/1669 to read it.",
  });
});
