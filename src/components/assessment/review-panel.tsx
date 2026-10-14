"use client";

import { useState } from "react";
import { reviewAssessmentAction } from "@/server/actions";
import { useRunAction } from "../client";
import { Badge, Button, Card } from "../ui";

export function ReviewPanel({ id, status, canReview, isAssessor, reviews }: {
  id: string;
  status: string;
  canReview: boolean;
  isAssessor: boolean;
  reviews: { id: string; reviewerName: string; decision: string; comments: string; createdAt: string }[];
}) {
  const [comments, setComments] = useState("");
  const { exec, pending } = useRunAction();
  const decide = (decision: "APPROVED" | "REJECTED" | "COMMENT") =>
    exec(() => reviewAssessmentAction(id, { decision, comments }), {
      confirm: decision === "REJECTED" ? "Reject this assessment? It stays as a historical record; the assessor creates a revision to address the comments." : undefined,
      success: decision === "APPROVED" ? "Assessment approved" : decision === "REJECTED" ? "Assessment rejected" : "Comment added",
      onSuccess: () => setComments(""),
    });
  return (
    <Card title="Review & approval" subtitle="Reviewer decisions are recorded with name and timestamp. A reviewer cannot approve their own assessment.">
      {reviews.length > 0 && (
        <ol className="mb-4 space-y-2">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-md border border-line px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={r.decision === "APPROVED" ? "ok" : r.decision === "REJECTED" ? "danger" : "neutral"}>{r.decision}</Badge>
                <span className="font-medium">{r.reviewerName}</span>
                <span className="text-muted">{r.createdAt}</span>
              </div>
              {r.comments && <p className="mt-1 whitespace-pre-line">{r.comments}</p>}
            </li>
          ))}
        </ol>
      )}
      {status === "COMPLETED" && canReview && (
        <div className="space-y-2">
          <label className="label" htmlFor="review-comments">Review comments</label>
          <textarea id="review-comments" className="input min-h-[80px]" value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Evidence sampled, consistency of answers, required changes…" />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={pending} onClick={() => decide("APPROVED")}>Approve</Button>
            <Button variant="danger" disabled={pending || comments.trim().length < 5} onClick={() => decide("REJECTED")}>Reject</Button>
            <Button disabled={pending || comments.trim().length < 5} onClick={() => decide("COMMENT")}>Add comment only</Button>
          </div>
        </div>
      )}
      {status === "COMPLETED" && !canReview && (
        <p className="text-sm text-muted">{isAssessor ? "Awaiting review by another reviewer (separation of duties)." : "Awaiting review. Switch to a Reviewer or Administrator to approve or reject."}</p>
      )}
      {status === "REJECTED" && <p className="text-sm text-muted">This assessment was rejected and remains as an immutable record. Use “Create reassessment / revision” to address the review comments.</p>}
    </Card>
  );
}
