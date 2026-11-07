import { corsHeaders, principal } from "./auth";
import type { User, Principal } from "./identity";
import { API_VERSION, NOTE_LIMITS } from "@doompile/core";
import { observeRequest, observedUser, serverEvent } from "./telemetry";
import { errorProperties } from "../../../../packages/telemetry/core";

export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function readLimitedBody(
  request: Request,
  maximum: number,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maximum) throw new RequestError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new RequestError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function readJSON(
  request: Request,
  maximum: number = NOTE_LIMITS.requestBytes,
): Promise<unknown> {
  try {
    return JSON.parse(
      new TextDecoder().decode(await readLimitedBody(request, maximum)),
    );
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("Invalid JSON body.");
  }
}

export async function api(
  request: Request,
  handler: (user: User, auth: Principal) => Promise<Response> | Response,
): Promise<Response> {
  return observeRequest(request, async () => {
    let response: Response;
    try {
      const auth = principal(request);
      if (!auth) throw new RequestError("Authentication required.", 401);
      observedUser(auth.user.id);
      const expectedUser = request.headers.get("X-Doompile-User-ID");
      if (expectedUser && expectedUser !== auth.user.id)
        throw new RequestError(
          "The signed-in account has changed. Reload this client.",
          401,
        );
      const version = request.headers.get("X-Doompile-API-Version") ?? "1";
      if (!/^\d+$/.test(version) || Number(version) !== API_VERSION) {
        throw new RequestError(
          "This client uses an unsupported API version. Update the server or client.",
          426,
        );
      }
      response = await handler(auth.user, auth);
    } catch (error) {
      if (error instanceof RequestError)
        response = Response.json(
          { error: error.message },
          { status: error.status },
        );
      else {
        serverEvent("runtime.error", errorProperties(error));
        response = Response.json(
          { error: "The server could not complete this operation." },
          { status: 500 },
        );
      }
    }
    for (const [key, value] of corsHeaders(request))
      response.headers.set(key, value);
    response.headers.set("X-Doompile-API-Version", String(API_VERSION));
    return response;
  });
}

export function options(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
