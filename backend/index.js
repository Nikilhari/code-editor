require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const axios = require("axios");
const ACTIONS = require("./Actions");

const app = express();
const server = http.createServer(app);


// Language Configuration for JDoodle
const languageConfig = {
  python3: { versionIndex: "3" },
  java: { versionIndex: "3" },
  cpp14: { versionIndex: "4" },  // C++14
  cpp17: { versionIndex: "5" },  // C++17
  c: { versionIndex: "4" },
};

// Language Configuration for Judge0
const judge0Languages = {
  python3: 71,
  java: 62,
  cpp: 54,  // C++17
  cpp14: 52,
  cpp17: 54,
  c: 50,
};

// Enable CORS & JSON Parsing
app.use(cors());
app.use(express.json());

// Setup WebSocket Server
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Manage Users in Rooms
const userSocketMap = {};
const roomMarkedLines = {}; // Store marked lines for each room
const roomActivityLogs = {}; // Store activity logs for each room

const getAllConnectedClients = (roomId) => {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => ({
      socketId,
      username: userSocketMap[socketId],
    })
  );
};

// WebSocket Events
io.on("connection", (socket) => {
  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);
    const clients = getAllConnectedClients(roomId);
    clients.forEach(({ socketId }) => {
      io.to(socketId).emit(ACTIONS.JOINED, {
        clients,
        username,
        socketId: socket.id,
      });
    });
  });

  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code, socketId: socket.id });
  });

  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  // Handle cursor position updates
  socket.on(ACTIONS.TYPING_START, ({ roomId, username }) => {
    socket.in(roomId).emit(ACTIONS.TYPING_START, {
      username,
      socketId: socket.id
    });
  });

  socket.on(ACTIONS.TYPING_STOP, ({ roomId, username }) => {
    socket.in(roomId).emit(ACTIONS.TYPING_STOP, {
      username,
      socketId: socket.id
    });
  });

  socket.on(ACTIONS.USER_ACTIVITY, ({ roomId, username }) => {
    socket.in(roomId).emit(ACTIONS.USER_ACTIVITY, {
      username,
      socketId: socket.id,
      timestamp: Date.now()
    });
  });

  // Handle cursor position updates
  socket.on(ACTIONS.CURSOR_POSITION, ({ roomId, position, username }) => {
    socket.in(roomId).emit(ACTIONS.CURSOR_POSITION, {
      position,
      username,
      socketId: socket.id
    });
  });

  // Handle line highlighting
  socket.on(ACTIONS.LINE_HIGHLIGHT, ({ roomId, lineNumber, username }) => {
    socket.in(roomId).emit(ACTIONS.LINE_HIGHLIGHT, {
      lineNumber,
      username,
      socketId: socket.id
    });
  });

  // Handle line marking
  socket.on(ACTIONS.MARK_LINE, ({ roomId, lineNumber, username, comment = "" }) => {
    // Initialize room marks if not exists
    if (!roomMarkedLines[roomId]) {
      roomMarkedLines[roomId] = new Map();
    }

    const markId = `${lineNumber}-${Date.now()}`;
    const markData = {
      id: markId,
      lineNumber,
      username,
      comment,
      timestamp: Date.now(),
      socketId: socket.id
    };

    roomMarkedLines[roomId].set(markId, markData);

    // Broadcast to all users in the room
    io.to(roomId).emit(ACTIONS.MARK_LINE, markData);
  });

  socket.on(ACTIONS.UNMARK_LINE, ({ roomId, markId, username }) => {
    if (roomMarkedLines[roomId] && roomMarkedLines[roomId].has(markId)) {
      const mark = roomMarkedLines[roomId].get(markId);

      // Allow anyone to remove marks (collaborative editing)
      roomMarkedLines[roomId].delete(markId);

      // Broadcast removal to all users
      io.to(roomId).emit(ACTIONS.UNMARK_LINE, {
        markId,
        removedBy: username,
        originalMarker: mark.username
      });
    }
  });

  // Send existing marks to newly joined users
  socket.on(ACTIONS.SYNC_MARKS, ({ roomId }) => {
    if (roomMarkedLines[roomId] && roomMarkedLines[roomId].size > 0) {
      const marks = Array.from(roomMarkedLines[roomId].values());
      socket.emit(ACTIONS.SYNC_MARKS, { marks });
    }
  });

  // Handle activity logging
  socket.on(ACTIONS.ACTIVITY_LOG, ({ roomId, log }) => {
    // Initialize room activity logs if not exists
    if (!roomActivityLogs[roomId]) {
      roomActivityLogs[roomId] = [];
    }

    // Add log to room history (keep last 100 logs)
    roomActivityLogs[roomId].unshift(log);
    if (roomActivityLogs[roomId].length > 100) {
      roomActivityLogs[roomId] = roomActivityLogs[roomId].slice(0, 100);
    }

    // Broadcast to other users in the room
    socket.in(roomId).emit(ACTIONS.ACTIVITY_LOG, { log });
  });

  // Send existing activity logs to newly joined users
  socket.on(ACTIONS.SYNC_ACTIVITY_LOGS, ({ roomId }) => {
    const logs = roomActivityLogs[roomId] || [];
    socket.emit(ACTIONS.SYNC_ACTIVITY_LOGS, { logs });
  });

  // Handle cursor position and line highlighting
  socket.on(ACTIONS.CURSOR_POSITION, ({ roomId, position, username }) => {
    socket.in(roomId).emit(ACTIONS.CURSOR_POSITION, {
      position,
      username,
      socketId: socket.id
    });
  });

  socket.on(ACTIONS.LINE_HIGHLIGHT, ({ roomId, lineNumber, username }) => {
    socket.in(roomId).emit(ACTIONS.LINE_HIGHLIGHT, {
      lineNumber,
      username,
      socketId: socket.id
    });
  });


  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    rooms.forEach((roomId) => {
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });

    // Clean up room data if room becomes empty
    rooms.forEach((roomId) => {
      const remainingClients = getAllConnectedClients(roomId).filter(
        client => client.socketId !== socket.id
      );
      // If no clients left, clean up room data
      if (remainingClients.length === 0) {
        delete roomMarkedLines[roomId];
        delete roomActivityLogs[roomId];
      }
    });

    delete userSocketMap[socket.id];
  });
});

// Compilation Endpoint (JDoodle & Judge0)
app.post("/compile", async (req, res) => {
  const { code, language, method } = req.body;
  console.log("Received compilation request:", { code, language, method });

  try {
    let response;

    // JDoodle Compiler
    if (method === "jdoodle") {
      if (!languageConfig[language]) {
        return res.status(400).json({ error: "Invalid language for JDoodle" });
      }

      console.log("JDoodle request data:", {
        script: code,
        language: language,
        versionIndex: languageConfig[language].versionIndex,
        clientId: process.env.JDOODLE_CLIENTID,
        clientSecret: process.env.JDOODLE_CLIENTSECRET,
      });

      response = await axios.post("https://api.jdoodle.com/v1/execute", {
        script: code,
        language: language,
        versionIndex: languageConfig[language].versionIndex,
        clientId: process.env.JDOODLE_CLIENTID,
        clientSecret: process.env.JDOODLE_CLIENTSECRET,
      });

      if (response.data.error) {
        return res.status(500).json({ error: response.data.error });
      }

      console.log("JDoodle response:", response.data);
      res.json(response.data);
    }

    // Judge0 Compiler
    else if (method === "judge0") {
      if (!judge0Languages[language]) {
        return res.status(400).json({ error: "Invalid language for Judge0" });
      }

      console.log("Sending request to Judge0");

      const judge0Response = await axios.post(
        "https://ce.judge0.com/submissions/?base64_encoded=false&wait=true",
        {
          source_code: code,
          language_id: judge0Languages[language],
          stdin: "",
        }
      );

      console.log("Judge0 response:", judge0Response.data);

      res.json({
        output: judge0Response.data.stdout || judge0Response.data.stderr,
        status: judge0Response.data.status.description,
      });
    }

    else {
      res.status(400).json({ error: "Invalid compilation method" });
    }
  } catch (error) {
    console.error("Compilation error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to compile code" });
  }
});

// AI Code Suggestions Endpoint (Groq API)
app.post("/ai-suggestions", async (req, res) => {
  const { code, language, cursorPosition, context } = req.body;
  console.log("Received AI suggestions request:", { language, cursorPosition, context });

  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Groq API key not configured" });
    }

    // Prepare the prompt for Groq
    const prompt = `You are an expert ${language} programmer. Analyze the following code and provide 3-5 intelligent code suggestions.

Current code:
\`\`\`${language}
${code}
\`\`\`

Context: ${context || 'General code improvement'}
Cursor position: Line ${cursorPosition?.line + 1 || 'unknown'}

Please provide suggestions in this exact JSON format:
{
  "suggestions": [
    {
      "title": "Brief description (max 50 characters)",
      "description": "Detailed explanation (max 150 characters)",
      "code": "actual code snippet to insert - keep it concise and focused",
      "type": "completion|improvement|fix|optimization",
      "confidence": 0.95
    }
  ]
}

Guidelines for suggestions:
1. Keep code snippets SHORT and FOCUSED (1-3 lines max)
2. For completion: provide what comes next at cursor position
3. For improvement: suggest better coding patterns
4. For fix: identify and fix potential bugs
5. For optimization: suggest performance improvements
6. Make code snippets ready to insert directly
7. Don't include excessive whitespace or formatting
8. Focus on practical, actionable suggestions

IMPORTANT: Only return valid JSON, no additional text or explanations outside the JSON.`;

    const groqResponse = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant", // Fast and capable model
        messages: [
          {
            role: "system",
            content: "You are a helpful coding assistant that provides accurate code suggestions in JSON format."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1500,
        top_p: 0.9
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const aiResponse = groqResponse.data.choices[0].message.content;
    console.log("Groq AI response:", aiResponse);

    try {
      // Parse the JSON response from Groq
      const parsedResponse = JSON.parse(aiResponse);
      res.json(parsedResponse);
    } catch (parseError) {
      console.error("Failed to parse Groq response as JSON:", parseError);
      // Fallback response
      res.json({
        suggestions: [
          {
            title: "AI suggestion temporarily unavailable",
            description: "Please try again in a moment",
            code: "// AI suggestions will appear here",
            type: "info",
            confidence: 0.5
          }
        ]
      });
    }

  } catch (error) {
    console.error("AI suggestions error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to get AI suggestions",
      suggestions: [
        {
          title: "Error getting suggestions",
          description: "Please check your internet connection and try again",
          code: "// No suggestions available",
          type: "error",
          confidence: 0.0
        }
      ]
    });
  }
});

// Start the Server
server.listen(5000, '0.0.0.0', () => console.log(`Server is running on port 5000`));
