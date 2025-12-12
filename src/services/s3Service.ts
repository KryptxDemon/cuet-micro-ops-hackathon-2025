/**
 * S3 Service - Handles S3 operations for the download service
 *
 * Provides:
 * - File upload to S3/MinIO
 * - Presigned URL generation for downloads
 * - Health checks
 *
 * Works with both AWS S3 and S3-compatible services (MinIO, RustFS)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "node:https";

// S3 configuration interface
export interface S3Config {
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName: string;
  forcePathStyle: boolean;
}

// Default presigned URL expiration (24 hours in seconds)
const DEFAULT_URL_EXPIRATION = 24 * 60 * 60;

// OPTIMIZATION: Reusable HTTP agent with keep-alive for connection pooling
const httpsAgent = new Agent({
  keepAlive: true,
  maxSockets: 50, // Max concurrent connections
  maxFreeSockets: 10, // Keep idle connections ready
  timeout: 60000, // 60 second timeout
});

/**
 * S3 Service class
 * OPTIMIZED: Uses connection pooling via HTTP keep-alive
 */
class S3Service {
  private client: S3Client | null = null;
  private bucketName: string = "";
  private isConfigured: boolean = false;

  /**
   * Initialize the S3 service with configuration
   * OPTIMIZED: Uses custom HTTP handler with connection pooling
   */
  initialize(config: S3Config): void {
    this.bucketName = config.bucketName;

    // Only create client if we have a bucket name (not mock mode)
    if (config.bucketName) {
      this.client = new S3Client({
        region: config.region,
        ...(config.endpoint && { endpoint: config.endpoint }),
        ...(config.accessKeyId &&
          config.secretAccessKey && {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }),
        forcePathStyle: config.forcePathStyle,
        // OPTIMIZATION: Custom HTTP handler with keep-alive
        requestHandler: new NodeHttpHandler({
          httpsAgent,
          connectionTimeout: 5000,
          socketTimeout: 30000,
        }),
      });
      this.isConfigured = true;
      console.log(
        `[S3Service] Initialized with bucket: ${config.bucketName}, endpoint: ${config.endpoint ?? "AWS S3"}`,
      );
      console.log(`[S3Service] Connection pooling enabled (maxSockets: 50)`);
    } else {
      this.isConfigured = false;
      console.log("[S3Service] Running in mock mode (no bucket configured)");
    }
  }

  /**
   * Check if S3 is configured (not mock mode)
   */
  isS3Configured(): boolean {
    return this.isConfigured && this.client !== null;
  }

  /**
   * Generate a safe S3 key from file ID
   * Prevents path traversal attacks
   */
  generateS3Key(fileId: number): string {
    const sanitizedId = Math.floor(Math.abs(fileId));
    return `downloads/${String(sanitizedId)}.zip`;
  }

  /**
   * Upload a file to S3
   * For the hackathon, we create mock file content
   */
  async uploadFile(
    fileId: number,
    content?: Buffer | string,
  ): Promise<{ s3Key: string; size: number }> {
    const s3Key = this.generateS3Key(fileId);

    // If not configured, return mock result
    if (!this.isS3Configured()) {
      console.log(`[S3Service] Mock upload for file ${String(fileId)}`);
      return {
        s3Key,
        size: Math.floor(Math.random() * 10000000) + 1000,
      };
    }

    // Create mock content if not provided
    const fileContent =
      content ??
      Buffer.from(
        `Mock download content for file ID: ${String(fileId)}\n` +
          `Generated at: ${new Date().toISOString()}\n` +
          `This is a simulated file for the hackathon challenge.\n`,
      );

    const size =
      typeof fileContent === "string"
        ? Buffer.byteLength(fileContent)
        : fileContent.length;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileContent,
        ContentType: "application/zip",
        Metadata: {
          fileId: String(fileId),
          createdAt: new Date().toISOString(),
        },
      });

      if (!this.client) throw new Error("S3 client not initialized");
      await this.client.send(command);
      console.log(
        `[S3Service] Uploaded file ${String(fileId)} to ${s3Key} (${String(size)} bytes)`,
      );

      return { s3Key, size };
    } catch (error) {
      console.error(
        `[S3Service] Failed to upload file ${String(fileId)}:`,
        error,
      );
      throw new Error(`S3 upload failed: ${(error as Error).message}`);
    }
  }

  /**
   * Generate a presigned URL for downloading a file
   */
  async generatePresignedUrl(
    s3Key: string,
    expiresIn: number = DEFAULT_URL_EXPIRATION,
  ): Promise<string> {
    // If not configured, return mock URL
    if (!this.isS3Configured()) {
      const bucketName = this.bucketName || "downloads";
      const mockUrl = `https://mock-s3.example.com/${bucketName}/${s3Key}?token=${crypto.randomUUID()}&expires=${String(Date.now() + expiresIn * 1000)}`;
      console.log(`[S3Service] Generated mock presigned URL for ${s3Key}`);
      return mockUrl;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      if (!this.client) throw new Error("S3 client not initialized");
      const url = await getSignedUrl(this.client, command, { expiresIn });
      console.log(
        `[S3Service] Generated presigned URL for ${s3Key} (expires in ${String(expiresIn)}s)`,
      );
      return url;
    } catch (error) {
      console.error(
        `[S3Service] Failed to generate presigned URL for ${s3Key}:`,
        error,
      );
      throw new Error(
        `Failed to generate download URL: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Check if a file exists in S3
   */
  async checkFileExists(
    s3Key: string,
  ): Promise<{ exists: boolean; size?: number }> {
    // If not configured, return mock result based on file ID pattern
    if (!this.isS3Configured()) {
      // Mock: files with IDs divisible by 7 exist
      const fileIdMatch = /\/(\d+)\.zip$/.exec(s3Key);
      if (fileIdMatch) {
        const fileId = parseInt(fileIdMatch[1], 10);
        const exists = fileId % 7 === 0;
        return {
          exists,
          size: exists
            ? Math.floor(Math.random() * 10000000) + 1000
            : undefined,
        };
      }
      return { exists: false };
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      if (!this.client) throw new Error("S3 client not initialized");
      const response = await this.client.send(command);
      return {
        exists: true,
        size: response.ContentLength,
      };
    } catch (error) {
      if ((error as Error).name === "NotFound") {
        return { exists: false };
      }
      throw error;
    }
  }

  /**
   * Health check - verify S3 connectivity
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isS3Configured()) {
      return true; // Mock mode is always "healthy"
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: "__health_check_marker__",
      });
      if (!this.client) throw new Error("S3 client not initialized");
      await this.client.send(command);
      return true;
    } catch (error) {
      // NotFound is fine - bucket is accessible
      if ((error as Error).name === "NotFound") {
        return true;
      }
      console.error("[S3Service] Health check failed:", error);
      return false;
    }
  }

  /**
   * Get the S3 client (for advanced operations)
   */
  getClient(): S3Client | null {
    return this.client;
  }

  /**
   * Get bucket name
   */
  getBucketName(): string {
    return this.bucketName;
  }

  /**
   * Destroy the S3 client
   */
  destroy(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      console.log("[S3Service] Client destroyed");
    }
  }
}

// Export singleton instance
export const s3Service = new S3Service();

// Export class for testing
export { S3Service };
