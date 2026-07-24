import type {
  CodeIntelligenceProvider,
  CodeSearchQuery,
  CodeSearchResult,
} from "../types.js";

/**
 * Default provider when no code-intelligence integration is configured.
 * Documentation retrieval works fully without one; see
 * docs/integrations/codebase-memory.md for adding a real adapter.
 */
export class NullCodeIntelligenceProvider implements CodeIntelligenceProvider {
  readonly id = "none";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async searchCode(_query: CodeSearchQuery): Promise<CodeSearchResult[]> {
    return [];
  }
}
