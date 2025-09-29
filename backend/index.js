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

// Start the Server
server.listen(5000, '0.0.0.0', () => console.log(`Server is running on port 5000`));
