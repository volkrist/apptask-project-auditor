import type {
  DiscordSummary,
  ReportArtifact,
  ReportPublisher,
} from "./publisher.js";

/** Placeholder for internal Discord bot / custom endpoint. */
export class BotAdapter implements ReportPublisher {
  async publish(
    _summary: DiscordSummary,
    _artifacts?: ReportArtifact[],
  ): Promise<void> {
    throw new Error("BotAdapter.publish is not implemented");
  }
}
