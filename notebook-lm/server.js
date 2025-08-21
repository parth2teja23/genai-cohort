import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import 'dotenv/config';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import OpenAI from "openai";

const app = express();
const upload = multer({ dest: "uploads/" });
app.use(cors());
app.use(express.json());

const client = new OpenAI();
const uploadedFiles = []; // store uploaded file names

// Upload + Index PDF
app.post("/index", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No file uploaded");

    const loader = new PDFLoader(req.file.path);
    const docs = await loader.load();

    const embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-large" });

    await QdrantVectorStore.fromDocuments(docs, embeddings, {
      url: "http://localhost:6333",
      collectionName: "chaicode-collection",
    });

    uploadedFiles.push(req.file.originalname);

    fs.unlinkSync(req.file.path);

    res.status(200).send("Indexing done successfully");
  } catch (err) {
    console.error("Indexing failed:", err);
    res.status(500).send("Indexing failed");
  }
});

// List uploaded files
app.get("/files", (req, res) => {
  res.json(uploadedFiles);
});

// Chat about a file
app.post("/chat", async (req, res) => {
  const { fileName, query } = req.body;
  if (!fileName || !query) return res.status(400).send("fileName and query required");

  try {
    const embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-large" });

    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
      url: "http://localhost:6333",
      collectionName: "chaicode-collection",
    });

    const retriever = vectorStore.asRetriever({ k: 3 });
    const relevantChunk = await retriever.invoke(query);

    const SYSTEM_PROMPT = `
      You are an AI assistant answering based ONLY on the context from the uploaded PDF file.
      Always mention page numbers if available.
      Context:
      ${JSON.stringify(relevantChunk)}
    `;

    const response = await client.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
    });

    res.json({ answer: response.choices[0].message.content });
  } catch (err) {
    console.error("Chat failed:", err);
    res.status(500).send("Chat failed");
  }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`✅ Backend running at http://localhost:${PORT}`));
