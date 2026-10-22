/**
 * api/guard.ts - Elysia write guard plugin.
 * Enforces access policy, Origin checks, Content-Type checks, and in-memory rate limiting.
 */
import { Elysia } from "elysia";
import { decideWrite } from "./access";

export interface GuardOptions {
  token?: string | null;
  clientIp?: (request: Request) => string | null;
  /** Injectable clock for testing */
  now?: () => number;
}

export class FailureRateLimiter {
  private failures = new Map<string, number[]>();
  private blockedUntil = new Map<string, number>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 60_000,
    private readonly blockDurationMs = 60_000,
  ) {}

  isBlocked(ip: string, now: number): boolean {
    const blockedTime = this.blockedUntil.get(ip);
    if (blockedTime && now < blockedTime) {
      return true;
    }
    return false;
  }

  recordFailure(ip: string, now: number): void {
    const list = (this.failures.get(ip) ?? []).filter((t) => now - t <= this.windowMs);
    list.push(now);
    this.failures.set(ip, list);
    if (list.length >= this.maxFailures) {
      this.blockedUntil.set(ip, now + this.blockDurationMs);
    }
  }

  reset(): void {
    this.failures.clear();
    this.blockedUntil.clear();
  }
}

export const defaultWriteRateLimiter = new FailureRateLimiter();

export function resetWriteRateLimits(): void {
  defaultWriteRateLimiter.reset();
}

function extractToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    const tokenPart = match?.[1];
    return tokenPart ? tokenPart.trim() : auth.trim();
  }
  return null;
}

function resolveClientIp(
  request: Request,
  server: any,
  customGetter?: (request: Request) => string | null,
): string | null {
  if (customGetter) {
    return customGetter(request);
  }
  if (server?.requestIP) {
    const s = server.requestIP(request);
    if (s?.address) return s.address;
  }
  // Synthetic / app.handle fallback: if host in URL is loopback, treat as 127.0.0.1
  try {
    const host = new URL(request.url).hostname;
    if (host === "127.0.0.1" || host === "localhost") {
      return "127.0.0.1";
    }
  } catch {
    // ignore URL parsing errors
  }
  return null;
}

export function writeGuard(options?: GuardOptions) {
  const rateLimiter = defaultWriteRateLimiter;

  return new Elysia({ name: "writeGuard" }).onBeforeHandle(
    { as: "scoped" },
    async ({ request, set, server }) => {
      const method = request.method.toUpperCase();
      if (method !== "POST" && method !== "PUT" && method !== "DELETE") {
        return;
      }

      const now = options?.now ? options.now() : Date.now();
      const clientIp = resolveClientIp(request, server, options?.clientIp);
      const ipKey = clientIp ?? "unknown";

      // 1. Rate limiter check (429)
      if (rateLimiter.isBlocked(ipKey, now)) {
        set.status = 429;
        return {
          error: "rate_limited",
          message: "Too many failed attempts. Try again in a minute.",
        };
      }

      // 2. Origin check (403)
      const origin = request.headers.get("origin");
      if (origin) {
        try {
          const url = new URL(request.url);
          const hostHeader = request.headers.get("host");
          const serverOrigin = hostHeader
            ? `${url.protocol}//${hostHeader}`
            : url.origin;
          if (origin.toLowerCase() !== serverOrigin.toLowerCase()) {
            set.status = 403;
            return {
              error: "forbidden",
              message: "Cross-site write requests are not allowed.",
            };
          }
        } catch {
          set.status = 403;
          return {
            error: "forbidden",
            message: "Cross-site write requests are not allowed.",
          };
        }
      }

      // 3. Media type check (415)
      const contentType = request.headers.get("content-type");
      if (method === "POST" || method === "PUT") {
        if (!contentType || !contentType.toLowerCase().includes("application/json")) {
          set.status = 415;
          return {
            error: "unsupported_media_type",
            message: "Request body must be JSON. Set Content-Type: application/json.",
          };
        }
      } else if (method === "DELETE") {
        if (contentType && !contentType.toLowerCase().includes("application/json")) {
          set.status = 415;
          return {
            error: "unsupported_media_type",
            message: "Request body must be JSON. Set Content-Type: application/json.",
          };
        }
      }

      // 4. Access policy check
      const presented = extractToken(request);
      const decision = decideWrite({
        token: options?.token,
        clientIp,
        presented,
      });

      if (decision === "deny-token") {
        rateLimiter.recordFailure(ipKey, now);
        set.status = 401;
        return {
          error: "token_required",
          message: "Write token required. Provide it in the Authorization header.",
        };
      }

      if (decision === "deny-remote") {
        rateLimiter.recordFailure(ipKey, now);
        set.status = 403;
        return {
          error: "local_only",
          message:
            "Writing is allowed only from this computer. Configure TTF_WRITE_TOKEN to allow remote access.",
        };
      }

      // Allowed - proceed
    },
  );
}
