import express from "express";
import cors from "cors";
import multer from "multer";
import { Queue } from "bullmq";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const queue = new Queue("file-upload-queue", {
  connection: { host: "localhost", port: 6379 },
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "uploads/"),
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${unique}-${file.originalname}`);
  },
});
const upload = multer({ storage });

const app = express();
app.use(cors());
app.use(express.json());

let conversationHistory = {};

app.get("/", (_req, res) => res.json({ status: "All Good!" }));

app.post("/upload/pdf", upload.single("pdf"), async (req, res) => {
  const file = req.file;
  await queue.add(
    "file-ready",
    JSON.stringify({
      filename: file?.originalname,
      destination: file?.destination,
      path: file?.path,
    })
  );
  return res.json({ message: "uploaded" });
});

app.post("/chat", async (req, res) => {
  const userQuery = req.body?.message ?? "";
  const sessionId = req.body?.sessionId || "default";

  conversationHistory[sessionId] ||= [];
  conversationHistory[sessionId].push({ role: "user", content: userQuery });

  const embeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-small",
    apiKey: process.env.OPENAI_API_KEY,
  });

  const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
    url: "http://localhost:6333",
    collectionName: "notebookfiesta",
  });

  const ret = vectorStore.asRetriever({ k: 3 });
  const retrieved = await ret.invoke(userQuery);

  const SYSTEM_PROMPT = `
  You are a helpful assistant. Use the following PDF snippets if relevant.
  If not found, say: "I couldn’t find that in the PDF, but here’s what I know."
  `;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory[sessionId],
  ];

  const chatResult = await client.chat.completions.create({
    model: "gpt-5-nano",
    messages,
  });

  const reply = chatResult.choices[0].message?.content || "Sorry, I got stuck.";
  conversationHistory[sessionId].push({ role: "assistant", content: reply });

  res.json({ message: reply, docs: retrieved, history: conversationHistory[sessionId] });
});

app.listen(8000, () => console.log("Server started on PORT:8000"));
