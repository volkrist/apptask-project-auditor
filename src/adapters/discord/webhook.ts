import type {
  DiscordSummary,
  ReportArtifact,
  ReportPublisher,
} from "./publisher.js";

export class WebhookPublisher implements ReportPublisher {
  constructor(private readonly webhookUrl: string) {}

  async publish(
    _summary: DiscordSummary,
    _artifacts?: ReportArtifact[],
  ): Promise<void> {
    throw new Error("WebhookPublisher.publish is not implemented");
  }
}
