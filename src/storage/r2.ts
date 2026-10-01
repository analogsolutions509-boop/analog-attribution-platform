import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

function client(): S3Client {
  if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY) {
    throw new Error("r2_not_configured");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY
    }
  });
}

export async function uploadRecording(
  key: string,
  body: Uint8Array,
  mimeType: string
): Promise<void> {
  await client().send(new PutObjectCommand({
    Bucket: config.R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: mimeType
  }));
}

export async function createRecordingDownloadUrl(
  key: string,
  expiresInSeconds = 900
): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: config.R2_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds }
  );
}
