import { EmptyState, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="py-16">
      <EmptyState title="Not found" action={<LinkButton href="/">Back to dashboard</LinkButton>}>The requested record does not exist or was deleted.</EmptyState>
    </div>
  );
}
