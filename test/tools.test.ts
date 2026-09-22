import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import test, { afterEach } from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import nock from "nock";
import { z } from "zod";
import { createHttpServer } from "../src/httpServer.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const SEARCH_RESPONSE = fixture("search-aftaleloven.json");
const DOCUMENT_XML = fixture("aftaleloven.xml");
const REFERENCES_RESPONSE = fixture("references-aftaleloven.json");
const AMENDMENT_XML = fixture("amendment-2021-2158.xml");
const RETSINFORMATION = "https://www.retsinformation.dk";

afterEach(() => nock.cleanAll());

const mockRetsinformation = (): void => {
  nock(RETSINFORMATION)
    .get("/api/documentsearch")
    .query(true)
    .reply(200, SEARCH_RESPONSE, { "content-type": "application/json" });
  nock(RETSINFORMATION)
    .get("/eli/lta/2016/193/xml")
    .reply(200, DOCUMENT_XML, { "content-type": "application/xml" });
  nock(RETSINFORMATION)
    .get("/api/document/177079/references/0")
    .reply(200, REFERENCES_RESPONSE, { "content-type": "application/json" });
  nock(RETSINFORMATION)
    .get("/eli/lta/2021/2158/xml")
    .reply(200, AMENDMENT_XML, { "content-type": "application/xml" });
};

const withClient = async (
  run: (client: Client) => Promise<void>
): Promise<void> => {
  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const client = new Client({ name: "jura-mcp-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`))
  );
  try {
    await run(client);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
};

test("every tool advertises an output schema, so its shape is visible before it is called", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      "find_statute",
      "read_amendment",
      "read_statute",
    ]);
    assert.ok(tools.every((tool) => tool.outputSchema));
  });
});

test("find_statute maps a search hit to a statute with a citable provenance", async () => {
  mockRetsinformation();
  await withClient(async (client) => {
    const { structuredContent } = await client.callTool({
      name: "find_statute",
      arguments: { query: "aftaleloven" },
    });

    assert.partialDeepStrictEqual(structuredContent, {
      statutes: [
        {
          kind: "consolidated-act",
          popularTitle: "Aftaleloven",
          citation: "LBK nr 193 af 02/03/2016",
          ministry: "Justitsministeriet",
          publishedOn: "2016-03-05",
          provenance: {
            source: "retsinformation",
            identifier: "eli/lta/2016/193",
            url: "https://www.retsinformation.dk/eli/lta/2016/193",
          },
        },
      ],
    });
  });
});

test("read_statute warns that the text predates its own listed changes, and names each change to read", async () => {
  mockRetsinformation();
  await withClient(async (client) => {
    const { structuredContent } = await client.callTool({
      name: "read_statute",
      arguments: { identifier: "eli/lta/2016/193" },
    });

    assert.partialDeepStrictEqual(structuredContent, {
      status: "in-force",
      currentUntil: "2021-11-28",
      warning:
        "WARNING: this text was consolidated up to 2021-11-28. It does not contain the changes listed below. Read each change by its identifier.",
      laterChanges: [
        {
          announcedOn: "2021-11-28",
          identifier: "eli/lta/2021/2158",
          changingParagraph: "2",
        },
      ],
    });
  });
});

test("read_amendment outlines which statute each § changes", async () => {
  mockRetsinformation();
  await withClient(async (client) => {
    const { structuredContent } = await client.callTool({
      name: "read_amendment",
      arguments: { identifier: "eli/lta/2021/2158" },
    });

    assert.partialDeepStrictEqual(structuredContent, {
      ministry: "Justitsministeriet",
      outline: [
        {
          number: "1",
          opening:
            "I lov om forbrugeraftaler, jf. lovbekendtgørelse nr. 1457 af 17. december 2013, som ændret ved § 160 i lov nr. 652 af 8. juni 2017 og § 44 i lov nr. 1666 af 26. december 2017, foretages følgende ændringer:",
        },
        {
          number: "2",
          opening:
            "I lov om aftaler og andre retshandler på formuerettens område, jf. lovbekendtgørelse nr. 193 af 2. marts 2016, foretages følgende ændringer:",
        },
        { number: "3", opening: "Loven træder i kraft den 28. maj 2022." },
        {
          number: "4",
          opening: "Stk. 1. Loven gælder ikke for Færøerne og Grønland.",
        },
      ],
      paragraphs: [],
    });
  });
});

test("read_amendment reports each change as the act prints it, new text in »«", async () => {
  mockRetsinformation();
  await withClient(async (client) => {
    const { structuredContent } = await client.callTool({
      name: "read_amendment",
      arguments: { identifier: "eli/lta/2021/2158", paragraphs: "2" },
    });

    const {
      paragraphs: [paragraph],
    } = z
      .object({
        paragraphs: z.array(z.object({ number: z.string(), text: z.string() })),
      })
      .parse(structuredContent);
    assert.ok(paragraph);
    assert.equal(paragraph.number, "2");
    assert.deepEqual(paragraph.text.split("\n").slice(0, 2), [
      "I lov om aftaler og andre retshandler på formuerettens område, jf. lovbekendtgørelse nr. 193 af 2. marts 2016, foretages følgende ændringer:",
      "1. I § 38 c indsættes efter stk. 1 som nyt stykke: »Stk. 2. Hvis et aftalevilkår, som er omfattet af stk. 1, 2. pkt., ikke har været genstand for individuel forhandling, kan vilkåret dog ikke ændres eller tilsidesættes delvis, men skal tilsidesættes helt.« Stk. 2 bliver herefter stk. 3.",
    ]);
  });
});

test("an unknown paragraph is reported to the model, not thrown at the transport", async () => {
  mockRetsinformation();
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "read_statute",
      arguments: { identifier: "eli/lta/2016/193", paragraphs: "999" },
    });

    assert.equal(result.isError, true);
    assert.partialDeepStrictEqual(result.content, [
      { type: "text", text: "The statute has no § 999" },
    ]);
  });
});

test("a selection above the character budget is truncated, not refused", async () => {
  mockRetsinformation();
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "read_statute",
      arguments: { identifier: "eli/lta/2016/193", paragraphs: "1..38" },
    });

    assert.notEqual(result.isError, true);
    assert.partialDeepStrictEqual(result.structuredContent, {
      omittedParagraphs: 11,
    });
    assert.equal(
      (result.structuredContent as { paragraphs: unknown[] }).paragraphs.length,
      28
    );
  });
});
