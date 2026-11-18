import { handleAssistant } from "../../../features/assistant/http.ts";
import { withRequestLogging } from "../../../lib/observability.ts";

export const POST = withRequestLogging("/api/assistant", (request) => handleAssistant(request));
