import { InMemoryRyanStore } from "@ryanos/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import {
  opportunityCandidateSchema,
  opportunityProposalIdempotencyKey
} from "../src/opportunity-proposals.js";

function sidecar() {
  return {
    automationId: "court-nox-rfp-search",
    projectSlug: "court-nox",
    runAt: "2026-06-24T14:03:58Z",
    reportPath: "/Users/ryan/Projects/active/NoxJury/docs/rfp-auto-search.md",
    candidates: [
      {
        title: "James City County Commonwealth Attorney Case Management Software",
        sourceUrls: ["https://www.jamescitycountyva.gov/DocumentCenter/View/42989"],
        rating: 7.5,
        dueAt: "2026-07-06",
        fit: "high",
        summary: "RFI for case management software.",
        rationale: "Good shaping opportunity for CourtNox workflows.",
        recommendedAction: "Decide whether to submit the James City RFI.",
        promoteToRyanOS: false
      },
      {
        title: "Low fit closed procurement",
        sourceUrls: ["https://example.com/closed"],
        rating: 4,
        summary: "Closed and low fit."
      }
    ]
  };
}

describe("opportunity proposal API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ingests promoted report candidates and filters low-rated noise", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({ store });

    const ingest = await app.inject({
      method: "POST",
      url: "/v1/opportunity-proposals/ingest",
      payload: {
        userId: "local-owner",
        report: sidecar()
      }
    });
    expect(ingest.statusCode).toBe(200);
    expect(ingest.json().result).toMatchObject({
      candidatesSeen: 2,
      proposalsCreatedOrUpdated: 1,
      proposalsSkippedByThreshold: 1
    });

    const proposals = await app.inject({
      method: "GET",
      url: "/v1/opportunity-proposals?userId=local-owner&status=proposed"
    });
    expect(proposals.statusCode).toBe(200);
    expect(proposals.json().proposals).toHaveLength(1);
    expect(proposals.json().proposals[0]).toMatchObject({
      projectSlug: "court-nox",
      rating: 7.5,
      dueAt: "2026-07-06T12:00:00.000Z",
      sourceUrls: ["https://www.jamescitycountyva.gov/DocumentCenter/View/42989"]
    });
  });

  it("dedupes repeated ingests by automation and candidate source", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({ store });
    const report = sidecar();

    await app.inject({
      method: "POST",
      url: "/v1/opportunity-proposals/ingest",
      payload: {
        userId: "local-owner",
        report
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/opportunity-proposals/ingest",
      payload: {
        userId: "local-owner",
        report: {
          ...report,
          candidates: [
            {
              ...report.candidates[0]!,
              title: "Updated James City County RFI",
              summary: "Updated summary."
            }
          ]
        }
      }
    });

    const proposals = await app.inject({
      method: "GET",
      url: "/v1/opportunity-proposals?userId=local-owner&status=proposed"
    });
    expect(proposals.json().proposals).toHaveLength(1);
    expect(proposals.json().proposals[0]).toMatchObject({
      title: "Updated James City County RFI",
      summary: "Updated summary."
    });
  });

  it("accepts a proposal into an opportunity and one opportunity action", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({ store });
    await app.inject({
      method: "POST",
      url: "/v1/opportunity-proposals/ingest",
      payload: {
        userId: "local-owner",
        report: sidecar()
      }
    });
    const proposals = await app.inject({
      method: "GET",
      url: "/v1/opportunity-proposals?userId=local-owner&status=proposed"
    });
    const proposalId = proposals.json().proposals[0].id as string;

    const accepted = await app.inject({
      method: "POST",
      url: `/v1/opportunity-proposals/${proposalId}/accept`,
      payload: {
        userId: "local-owner"
      }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      proposal: {
        status: "accepted"
      },
      opportunity: {
        title: "James City County Commonwealth Attorney Case Management Software",
        status: "tracking",
        fit: "high"
      },
      item: {
        kind: "opportunity_action",
        title: "Decide whether to submit the James City RFI."
      }
    });
    expect(store.opportunities.size).toBe(1);
    expect(store.items.size).toBe(1);

    const repeated = await app.inject({
      method: "POST",
      url: `/v1/opportunity-proposals/${proposalId}/accept`,
      payload: {
        userId: "local-owner"
      }
    });
    expect(repeated.statusCode).toBe(200);
    expect(store.opportunities.size).toBe(1);
    expect(store.items.size).toBe(1);
  });

  it("rejects a proposal without creating an opportunity or item", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({ store });
    await app.inject({
      method: "POST",
      url: "/v1/opportunity-proposals/ingest",
      payload: {
        userId: "local-owner",
        report: sidecar()
      }
    });
    const proposals = await app.inject({
      method: "GET",
      url: "/v1/opportunity-proposals?userId=local-owner&status=proposed"
    });
    const proposalId = proposals.json().proposals[0].id as string;

    const rejected = await app.inject({
      method: "POST",
      url: `/v1/opportunity-proposals/${proposalId}/reject`,
      payload: {
        userId: "local-owner"
      }
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().proposal.status).toBe("rejected");
    expect(store.opportunities.size).toBe(0);
    expect(store.items.size).toBe(0);
  });

  it("uses source URL for stable idempotency across title changes", () => {
    const first = opportunityCandidateSchema.parse({
      title: "Original title",
      sourceUrls: ["https://example.com/rfp"],
      rating: "7.5/10"
    });
    const second = opportunityCandidateSchema.parse({
      title: "New title",
      sourceUrls: ["https://example.com/rfp"],
      rating: 7.5
    });
    expect(opportunityProposalIdempotencyKey({ automationId: "a", candidate: first })).toBe(
      opportunityProposalIdempotencyKey({ automationId: "a", candidate: second })
    );
  });
});
