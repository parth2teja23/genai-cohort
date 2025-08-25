import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Queue } from 'bullmq';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import OpenAI from 'openai';

// ===================== OpenAI Client =====================
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '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',
});

// ===================== BullMQ Queue =====================
const queue = new Queue('file-upload-queue', {
  connection: {
    host: 'localhost',
    port: 6379,
  },
});

// ===================== Multer Storage =====================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});
const upload = multer({ storage: storage });

// ===================== Express App =====================
const app = express();
app.use(cors());
app.use(express.json());

// ===================== Memory Store =====================
// In production → store per-user history in DB/Redis
let conversationHistory = {};

app.get('/', (req, res) => {
  return res.json({ status: 'All Good!' });
});

// ===================== File Upload =====================
app.post('/upload/pdf', upload.single('pdf'), async (req, res) => {
  await queue.add(
    'file-ready',
    JSON.stringify({
      filename: req.file.originalname,
      destination: req.file.destination,
      path: req.file.path,
    })
  );
  return res.json({ message: 'uploaded' });
});

// ===================== Chat Endpoint =====================
app.get('/chat', async (req, res) => {
  const userQuery = req.query.message;
  const sessionId = req.query.sessionId || 'default'; // for multi-user later

  if (!conversationHistory[sessionId]) {
    conversationHistory[sessionId] = [];
  }

  // Save user query
  conversationHistory[sessionId].push({ role: 'user', content: userQuery });

  // ====== Embed + Retrieve PDF Context ======
  const embeddings = new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY || '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',
  });

  const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
    url: 'http://localhost:6333',
    collectionName: 'langchainjs-testing',
  });

  const ret = vectorStore.asRetriever({ k: 2 });
  const result = await ret.invoke(userQuery);

  // ====== Build System Prompt ======
  const SYSTEM_PROMPT = `
  You are a helpful AI Assistant who answers the user query based on the context from PDF files.
  Always use the PDF context when relevant. If not found, say "I couldn’t find that in the PDF, but here’s what I know."

  Context from PDF:
  ${JSON.stringify(result)}
  `;

  // ====== Construct Message History ======
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory[sessionId],
  ];

  // ====== OpenAI Chat Call ======
  const chatResult = await client.chat.completions.create({
    model: 'gpt-5-nano',
    messages,
  });

  const assistantReply = chatResult.choices[0].message?.content || 'Sorry, I got stuck.';

  // Save assistant reply
  conversationHistory[sessionId].push({ role: 'assistant', content: assistantReply });

  return res.json({
    message: assistantReply,
    docs: result,
    history: conversationHistory[sessionId], // useful for frontend debug
  });
});

// ===================== Start Server =====================
app.listen(8000, () => console.log(`Server started on PORT:8000`));
