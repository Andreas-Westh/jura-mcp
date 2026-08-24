import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { LegalSource } from "../domain/Provenance.js";
import { StatuteKind, type Statute } from "../domain/Statute.js";
import { findStatutes } from "../infrastructure/retsinformation/RetsinformationGateway.js";

const STATUTE_SCHEMA = z.object({
  kind: z.enum(StatuteKind),
  title: z.string(),
  popularTitle: z.string().optional(),
  citation: z.string(),
  ministry: z.string(),
  publishedOn: z.string(),
  provenance: z.object({
    source: z.enum(LegalSource),
    identifier: z.string(),
    url: z.string(),
    retrievedAt: z.string(),
  }),
});

const formatStatute = (statute: Statute, index: number): string =>
  [
    `${index + 1}. ${statute.popularTitle ?? statute.title}`,
    statute.popularTitle ? `   ${statute.title}` : undefined,
    `   ${statute.citation} · ${statute.kind} · ${statute.ministry} · published ${statute.publishedOn}`,
    `   Source: ${statute.provenance.source} · ${statute.provenance.identifier}`,
    `   ${statute.provenance.url}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

const formatStatutes = (statutes: Statute[]): string =>
  statutes.length === 0
    ? 'No statute in force matched the query. Try the Danish popular name, e.g. "aftaleloven".'
    : statutes.map(formatStatute).join("\n\n");

export const registerTools = (server: McpServer): void => {
  server.registerTool(
    "find_statute",
    {
      title: "Find Danish statute",
      description:
        "Search Danish statutes on Retsinformation. It covers love, lovbekendtgørelser and bekendtgørelser. " +
        "Write the query in Danish. The search does not translate. " +
        "Use one term. Extra words make the search wider, not narrower. " +
        'Prefer the popular name, for example "aftaleloven". Keep the letters æ, ø and å. ' +
        "The tool returns only statutes in force. " +
        "Each result gives the source, the ELI identifier and a URL. Cite from these.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(200)
          .describe('One Danish term. For example "aftaleloven".'),
      }),
      outputSchema: z.object({ statutes: z.array(STATUTE_SCHEMA) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      const statutes = await findStatutes(query);
      return {
        content: [{ type: "text", text: formatStatutes(statutes) }],
        structuredContent: { statutes },
      };
    }
  );
};
