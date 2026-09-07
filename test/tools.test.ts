import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import test, { afterEach } from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import nock from "nock";
import { createHttpServer } from "../src/httpServer.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const SEARCH_RESPONSE = fixture("search-aftaleloven.json");
const DOCUMENT_XML = fixture("aftaleloven.xml");
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

test("read_statute warns that the text predates its own listed changes", async () => {
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
        "WARNING: this text was consolidated up to 2021-11-28. It does not contain the changes listed below. Read the changing act to see them.",
    });
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
