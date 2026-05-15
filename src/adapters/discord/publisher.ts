export type ReportArtifact = {
  filename: string;
  content: Buffer;
  mimeType: string;
};

export type DiscordSummary = {
  text: string;
};

/** Delivers audit output. Webhook first; bot adapter later. */
export interface ReportPublisher {
  publish(summary: DiscordSummary, artifacts?: ReportArtifact[]): Promise<void>;
}
