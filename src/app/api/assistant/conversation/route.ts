import { createConversationHandler } from "../../../../features/assistant/conversation/http.ts";

import { requestIdFromProxy } from "../../../../lib/observability.ts";

export const POST = createConversationHandler({ identify: requestIdFromProxy });
