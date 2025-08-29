import { Worker } from "bullmq";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import dotenv from "dotenv";
dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "notebookfiesta";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.warn("[worker] WARN: OPENAI_API_KEY is not set");
}

const worker = new Worker(
  "file-upload-queue",
  async (job) => {
    console.log("[worker] Job received:", job.id);

    // Your server enqueues JSON.stringify(...), so parse here:
    const data = typeof job.data === "string" ? JSON.parse(job.data) : job.data;

    // 1) Load PDF (split by pages)
    const loader = new PDFLoader(data.path, { splitPages: true });
    const docs = await loader.load();

    // 2) Chunk pages
    const splitter = new CharacterTextSplitter({ chunkSize: 1200, chunkOverlap: 150 });
    const chunks = await splitter.splitDocuments(docs);

    // 3) Enrich metadata
    const enriched = chunks.map((d) => ({
      ...d,
      metadata: { ...d.metadata, source: data.filename || data.path },
    }));

    // 4) Embed & upsert into Qdrant (creates collection if missing)
    const embeddings = new OpenAIEmbeddings({
      model: "text-embedding-3-small",
      apiKey: OPENAI_API_KEY,
    });

    await QdrantVectorStore.fromDocuments(enriched, embeddings, {
      url: QDRANT_URL,
      collectionName: QDRANT_COLLECTION,
    });

    console.log("[worker] PDF embedded and stored.");
  },
  {
    concurrency: 4,
    connection: { host: REDIS_HOST, port: REDIS_PORT },
  }
);

worker.on("completed", (job) => console.log(`[worker] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[worker] Job ${job?.id} failed:`, err));
