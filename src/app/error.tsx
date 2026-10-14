"use client";

import { EmptyState, Button } from "@/components/ui";

/** Generic error boundary: never shows stack traces or internal details to the user. */
export default function ErrorPage({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <div className="py-16">
      <EmptyState title="Something went wrong" action={<Button onClick={reset}>Try again</Button>}>
        The page could not be loaded. {error.digest && <span className="font-mono text-xs">Reference: {error.digest}</span>}
      </EmptyState>
    </div>
  );
}
