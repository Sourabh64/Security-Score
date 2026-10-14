/** An error whose message is safe to show to the user. */
export class ServiceError extends Error {
  constructor(message: string, public code: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" = "VALIDATION") {
    super(message);
    this.name = "ServiceError";
  }
}
export const notFound = (what: string) => new ServiceError(`${what} not found`, "NOT_FOUND");
export const forbidden = (msg = "You do not have permission to perform this action") => new ServiceError(msg, "FORBIDDEN");
