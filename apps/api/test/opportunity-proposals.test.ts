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

  it("ingests automation reports through a per-user Codex RFP token and ignores body userId", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({ store });

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/v1/integrations/codex-rfp/token",
      payload: {
        userId: "user-a"
      }
    });
    const token = tokenResponse.json().token as string;
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/automation/rfp-reports/ingest",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        userId: "user-b",
        report: sidecar()
      }
    });
    const ownerProposals = await app.inject({
      method: "GET",
      url: "/v1/opportunity-proposals?userId=local-owner&status=proposed"
    });
    const otherProposals = await app.inject({
      method: "GET",
      url: "/v1/opportunity-proposals?userId=user-b&status=proposed"
    });
    await app.close();

    expect(tokenResponse.statusCode).toBe(200);
    expect(token).toMatch(/^ryanos_rfp_[a-f0-9]{16}_.+/);
    expect(ingest.statusCode).toBe(200);
    expect(ingest.json().result).toMatchObject({
      proposalsCreatedOrUpdated: 1
    });
    expect(ownerProposals.json().proposals).toHaveLength(1);
    expect(otherProposals.json().proposals).toHaveLength(0);
  });

  it("rejects missing or invalid Codex RFP ingest tokens", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({ store });

    const missing = await app.inject({
      method: "POST",
      url: "/v1/automation/rfp-reports/ingest",
      payload: sidecar()
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/automation/rfp-reports/ingest",
      headers: {
        authorization: "Bearer ryanos_rfp_0011223344556677_wrong"
      },
      payload: sidecar()
    });
    await app.close();

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
  });

  it("returns 403 for disabled Codex RFP ingest tokens", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({ store });

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/v1/integrations/codex-rfp/token",
      payload: {
        userId: "local-owner"
      }
    });
    const token = tokenResponse.json().token as string;
    await app.inject({
      method: "PATCH",
      url: "/v1/integrations/codex_rfp/settings",
      payload: {
        enabled: false
      }
    });
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/automation/rfp-reports/ingest",
      headers: {
        "x-ryanos-ingest-token": token
      },
      payload: sidecar()
    });
    await app.close();

    expect(ingest.statusCode).toBe(403);
  });

  it("rotation invalidates the old Codex RFP token", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({ store });

    const first = await app.inject({
      method: "POST",
      url: "/v1/integrations/codex-rfp/token",
      payload: {
        userId: "local-owner"
      }
    });
    const firstToken = first.json().token as string;
    const second = await app.inject({
      method: "POST",
      url: "/v1/integrations/codex-rfp/token",
      payload: {
        userId: "local-owner"
      }
    });
    const secondToken = second.json().token as string;
    const oldTokenIngest = await app.inject({
      method: "POST",
      url: "/v1/automation/rfp-reports/ingest",
      headers: {
        authorization: `Bearer ${firstToken}`
      },
      payload: sidecar()
    });
    const newTokenIngest = await app.inject({
      method: "POST",
      url: "/v1/automation/rfp-reports/ingest",
      headers: {
        authorization: `Bearer ${secondToken}`
      },
      payload: sidecar()
    });
    await app.close();

    expect(firstToken).not.toBe(secondToken);
    expect(oldTokenIngest.statusCode).toBe(401);
    expect(newTokenIngest.statusCode).toBe(200);
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
