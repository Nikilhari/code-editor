import React, { useEffect, useRef, useState } from "react";
import Client from "./Client";
import Editor from "./Editor";
import { initSocket } from "../Socket";
import { ACTIONS } from "../Actions";
import { useNavigate, useLocation, Navigate, useParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import axios from "axios";

// List of supported languages
const LANGUAGES = ["python3", "java", "cpp14", "cpp17", "c"];

function EditorPage() {
  const [clients, setClients] = useState([]);
  const [output, setOutput] = useState("");
  const [isCompileWindowOpen, setIsCompileWindowOpen] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("python3");
  const [activeUsers, setActiveUsers] = useState(new Set());
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [userLines, setUserLines] = useState(new Map()); // Track which line each user is on
  const [markedLines, setMarkedLines] = useState(new Map()); // Track marked lines
  const codeRef = useRef(null);

  const Location = useLocation();
  const navigate = useNavigate();
  const { roomId } = useParams();
  const socketRef = useRef(null);

  // Function to generate a unique color based on username
  const generateColor = (username) => {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${hash % 290}, 85%, 40%)`; // HSL for vibrant colors
  };

  useEffect(() => {
    const init = async () => {
      socketRef.current = await initSocket();
      socketRef.current.on("connect_error", (err) => handleErrors(err));
      socketRef.current.on("connect_failed", (err) => handleErrors(err));

      const handleErrors = (err) => {
        console.log("Error", err);
        toast.error("Socket connection failed, Try again later");
        navigate("/");
      };

      socketRef.current.emit(ACTIONS.JOIN, {
        roomId,
        username: Location.state?.username,
      });

      socketRef.current.on(ACTIONS.JOINED, ({ clients, username, socketId }) => {
        if (username !== Location.state?.username) {
          toast.success(`${username} joined the room.`);
        }
        // Assign each client a unique color
        const updatedClients = clients.map((client) => ({
          ...client,
          color: generateColor(client.username),
        }));
        setClients(updatedClients);

        socketRef.current.emit(ACTIONS.SYNC_CODE, {
          code: codeRef.current,
          socketId,
        });

        // Request existing marks for new users
        socketRef.current.emit(ACTIONS.SYNC_MARKS, { roomId });
      });

      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
        toast.success(`${username} left the room`);
        setClients((prev) => prev.filter((client) => client.socketId !== socketId));
        setActiveUsers((prev) => {
          const newSet = new Set(prev);
          newSet.delete(socketId);
          return newSet;
        });
        setTypingUsers((prev) => {
          const newSet = new Set(prev);
          // Remove typing status for disconnected user
          const disconnectedClient = clients.find(c => c.socketId === socketId);
          if (disconnectedClient) {
            newSet.delete(disconnectedClient.username);
          }
          return newSet;
        });
        setUserLines(prev => {
          const newMap = new Map(prev);
          const disconnectedClient = clients.find(c => c.socketId === socketId);
          if (disconnectedClient) {
            newMap.delete(disconnectedClient.username);
          }
          return newMap;
        });
      });

      // Listen for cursor activity to track active users
      socketRef.current.on(ACTIONS.USER_ACTIVITY, ({ socketId, username }) => {
        setActiveUsers((prev) => {
          const newSet = new Set(prev);
          newSet.add(socketId);
          // Remove activity status after 5 seconds of inactivity
          setTimeout(() => {
            setActiveUsers((current) => {
              const updated = new Set(current);
              updated.delete(socketId);
              return updated;
            });
          }, 5000);
          return newSet;
        });
      });

      socketRef.current.on(ACTIONS.CODE_CHANGE, ({ socketId }) => {
        if (socketId && socketId !== socketRef.current?.id) {
          setActiveUsers((prev) => {
            const newSet = new Set(prev);
            newSet.add(socketId);
            // Remove activity status after 3 seconds of inactivity
            setTimeout(() => {
              setActiveUsers((current) => {
                const updated = new Set(current);
                updated.delete(socketId);
                return updated;
              });
            }, 3000);
            return newSet;
          });
        }
      });

      // Listen for line highlighting to track user positions
      socketRef.current.on(ACTIONS.LINE_HIGHLIGHT, ({ lineNumber, username: remoteUsername, socketId }) => {
        if (socketId !== socketRef.current?.id) {
          setUserLines(prev => {
            const newMap = new Map(prev);
            newMap.set(remoteUsername, lineNumber + 1); // Convert to 1-based line number
            return newMap;
          });

          // Remove line tracking after 10 seconds of inactivity (increased from 8)
          setTimeout(() => {
            setUserLines(current => {
              const updated = new Map(current);
              // Only remove if the line hasn't been updated recently
              if (updated.get(remoteUsername) === lineNumber + 1) {
                updated.delete(remoteUsername);
              }
              return updated;
            });
          }, 10000);
        }
      });

      // Handle line marking events
      socketRef.current.on(ACTIONS.MARK_LINE, (markData) => {
        setMarkedLines(prev => {
          const newMap = new Map(prev);
          newMap.set(markData.id, markData);
          return newMap;
        });

        if (markData.username !== Location.state?.username) {
          try {
            toast(`${markData.username} marked line ${markData.lineNumber + 1}${markData.comment ? ': ' + markData.comment : ''}`, {
              icon: '📌',
              style: {
                borderRadius: '10px',
                background: '#333',
                color: '#fff',
              }
            });
          } catch (error) {
            console.log("Toast notification error:", error);
          }
        }
      });

      socketRef.current.on(ACTIONS.UNMARK_LINE, ({ markId, removedBy, originalMarker }) => {
        setMarkedLines(prev => {
          const newMap = new Map(prev);
          const mark = newMap.get(markId);
          if (mark) {
            newMap.delete(markId);
            if (removedBy !== Location.state?.username) {
              try {
                // Show different messages based on who removed what
                const message = originalMarker === removedBy
                  ? `${removedBy} removed their mark from line ${mark.lineNumber + 1}`
                  : `${removedBy} removed ${originalMarker}'s mark from line ${mark.lineNumber + 1}`;

                toast(`${message}`, {
                  icon: '🗑️',
                  style: {
                    borderRadius: '10px',
                    background: '#333',
                    color: '#fff',
                  }
                });
              } catch (error) {
                console.log("Toast notification error:", error);
              }
            }
          }
          return newMap;
        });
      });

      socketRef.current.on(ACTIONS.SYNC_MARKS, ({ marks }) => {
        const marksMap = new Map();
        marks.forEach(mark => {
          marksMap.set(mark.id, mark);
        });
        setMarkedLines(marksMap);
      });
    };
    init();

    return () => {
      socketRef.current && socketRef.current.disconnect();
      socketRef.current.off(ACTIONS.JOINED);
      socketRef.current.off(ACTIONS.DISCONNECTED);
      socketRef.current.off(ACTIONS.USER_ACTIVITY);
      socketRef.current.off(ACTIONS.CODE_CHANGE);
      socketRef.current.off(ACTIONS.LINE_HIGHLIGHT);
      socketRef.current.off(ACTIONS.MARK_LINE);
      socketRef.current.off(ACTIONS.UNMARK_LINE);
      socketRef.current.off(ACTIONS.SYNC_MARKS);
    };
  }, []);

  if (!Location.state) {
    return <Navigate to="/" />;
  }

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success(`Room ID is copied`);
    } catch (error) {
      console.log(error);
      toast.error("Unable to copy the room ID");
    }
  };

  const leaveRoom = async () => {
    navigate("/");
  };

  const runCode = async () => {
    if (!codeRef.current) {
      toast.error("No code to compile!");
      return;
    }

    setIsCompiling(true);
    try {
      const response = await axios.post("https://35f9l72x-5000.inc1.devtunnels.ms/compile", {
        code: codeRef.current,
        language: selectedLanguage.toLowerCase(),
        method: "jdoodle",
      });

      console.log("Backend response:", response.data);
      setOutput(response.data.output || "No output received");
    } catch (error) {
      console.error("Error compiling code:", error);
      setOutput(error.response?.data?.error || "An error occurred while compiling.");
    } finally {
      setIsCompiling(false);
    }
  };

  const toggleCompileWindow = () => {
    setIsCompileWindowOpen(!isCompileWindowOpen);
  };

  // Function to delete a marked line
  const deleteMarkedLine = (markId, markUsername) => {
    try {
      if (socketRef.current) {
        socketRef.current.emit(ACTIONS.UNMARK_LINE, {
          roomId,
          markId,
          username: Location.state?.username
        });

        // Show feedback
        if (markUsername === Location.state?.username) {
          toast.success("Your mark has been removed");
        } else {
          toast.success(`Removed ${markUsername}'s mark`);
        }
      }
    } catch (error) {
      console.error("Error removing mark:", error);
      toast.error("Failed to remove mark");
    }
  };

  // Function to clear all marks (admin only)
  const clearAllMarks = () => {
    if (socketRef.current && clients.length > 0 && clients[0].username === Location.state?.username) {
      // Delete all marks one by one
      markedLines.forEach((mark, markId) => {
        socketRef.current.emit(ACTIONS.UNMARK_LINE, {
          roomId,
          markId,
          username: Location.state?.username
        });
      });

      toast.success("All marks have been cleared");
    }
  };

  return (
    <div className="container-fluid vh-100 d-flex flex-column ">
      <div className="row flex-grow-1">
        {/* Client panel */}
        <div className="col-md-2 bg-dark text-light d-flex flex-column">
          <img
            src="/images/codecast1.png"
            alt="Logo"
            className="img-fluid mx-auto"
            style={{ maxWidth: "150px", marginTop: "-10px", marginBottom: "35px" }}
          />
          <hr style={{ marginTop: "-3rem" }} />

          {/* Client list container */}
          <div className="d-flex flex-column flex-grow-1 overflow-auto">
            <span
              className="mb-2"
              style={{
                fontWeight: "700",
                display: "inline-block",
                padding: "8px 16px",
                border: "2px solid #ffffff",
                borderRadius: "10px",
                textAlign: "center",
                width: "auto",
                backgroundColor: "#333", // Optional: subtle background for contrast
              }}
            >
              Members
            </span>
            {clients.map((client) => (
              <Client
                key={client.socketId}
                username={client.username}
                color={client.color}
                isActive={activeUsers.has(client.socketId)}
                isTyping={typingUsers.has(client.username)}
                currentLine={userLines.get(client.username)}
              />
            ))}
          </div>

          <hr />
          {/* Marked Lines Section */}
          <div className="mt-3">
            <span
              className="mb-2"
              style={{
                fontWeight: "700",
                display: "inline-block",
                padding: "6px 12px",
                border: "2px solid #ffd700",
                borderRadius: "8px",
                textAlign: "center",
                width: "auto",
                backgroundColor: "#333",
                color: "#ffd700",
                fontSize: "0.9rem"
              }}
            >
              📌 Marked Lines
            </span>
            <div className="text-muted mt-1" style={{ fontSize: "0.7rem", color: "#ffffffff" }}>
              Right-click on a line to mark it
            </div>

            {markedLines.size > 0 ? (
              <>
                <div className="mt-2" style={{ maxHeight: "150px", overflowY: "auto" }}>
                  {Array.from(markedLines.values())
                    .sort((a, b) => a.lineNumber - b.lineNumber)
                    .map((mark) => {
                      const client = clients.find(c => c.username === mark.username);
                      const userColor = client ? client.color : '#ffd700';

                      return (
                        <div
                          key={mark.id}
                          className="mb-2 p-2 rounded"
                          style={{
                            backgroundColor: "rgba(255, 215, 0, 0.1)",
                            border: `1px solid ${userColor}`,
                            fontSize: "0.8rem",
                            color: "#ffffff"
                          }}
                        >
                          <div className="d-flex align-items-center justify-content-between">
                            <div className="d-flex align-items-center">
                              <span style={{ color: userColor, fontWeight: "bold" }}>
                                Line {mark.lineNumber + 1}
                              </span>
                              <small className="text-white ms-2">
                                by {mark.username}
                              </small>

                            </div>

                            {/* Delete button - anyone can delete any mark */}
                            <button
                              className="btn btn-sm text-danger p-0"
                              style={{
                                background: "none",
                                border: "none",
                                fontSize: "1rem",
                                lineHeight: "1",
                                color: "#ffffff"
                              }}
                              onClick={() => deleteMarkedLine(mark.id, mark.username)}
                              title={mark.username === Location.state?.username
                                ? "Remove your mark"
                                : `Remove ${mark.username}'s mark`}
                            >
                              ×
                            </button>
                          </div>
                          {mark.comment && (
                            <div className="text-light mt-1" style={{ fontSize: "0.75rem" }}>
                              💬 {mark.comment}
                            </div>
                          )}
                          <div className="text-white mt-1" style={{ fontSize: "0.7rem", color: "#ffffff" }}>
                            {new Date(mark.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      );
                    })}
                </div>

                {/* Admin controls */}
                {clients.length > 0 && clients[0].username === Location.state?.username && markedLines.size > 1 && (
                  <div className="mt-2">
                    <button
                      className="btn btn-outline-warning btn-sm w-100"
                      onClick={() => {
                        if (window.confirm('Are you sure you want to clear all marked lines?')) {
                          clearAllMarks();
                        }
                      }}
                      style={{ fontSize: "0.75rem", color: "#ffffff" }}
                    >
                      🗑️ Clear All Marks (Admin)
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-2 p-3 text-center text-muted" style={{
                fontSize: "0.8rem",
                backgroundColor: "rgba(255, 215, 0, 0.05)",
                border: "1px dashed #ffd700",
                borderRadius: "8px"
              }}>
                <div style={{ color: "#ffffff" }}>No marked lines yet</div>
                <div className="mt-1" style={{ fontSize: "0.7rem", color: "#ffffff" }}>
                  Right-click on any line in the editor to mark it
                </div>
              </div>
            )}
          </div>

          {markedLines.size > 0 && (
            <hr />
          )}

          {/* Buttons */}
          <div className="mt-auto mb-3">
            <button className="btn btn-success w-100 mb-2" onClick={copyRoomId}>
              Copy Room ID
            </button>
            <button className="btn btn-danger w-100" onClick={leaveRoom}>
              Leave Room
            </button>
          </div>
        </div>

        {/* Editor panel */}
        <div className="col-md-10 text-light d-flex flex-column">
          <div className="bg-dark p-2 d-flex justify-content-between align-items-center">
            <small className="text-muted">
              💡 Right-click on any line to mark it for collaboration
            </small>
            <select
              className="form-select w-auto"
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              style={{
                paddingTop: "4px",
                paddingBottom: "4px",
                paddingRight: "40px",
                paddingLeft: "12px",
                border: "1px solid #007bff",
                color: "#000000",
              }}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          <Editor
            socketRef={socketRef}
            roomId={roomId}
            username={Location.state?.username}
            clients={clients}
            setTypingUsers={setTypingUsers}
            setUserLines={setUserLines}
            markedLines={markedLines}
            onCodeChange={(code) => {
              codeRef.current = code;
            }}
          />

          {/* Typing Indicator */}
          {typingUsers.size > 0 && (
            <div
              className="position-fixed bg-dark text-light px-3 py-2 rounded shadow"
              style={{
                bottom: isCompileWindowOpen ? "32vh" : "80px",
                right: "20px",
                zIndex: 1000,
                maxWidth: "350px",
                fontSize: "0.875rem"
              }}
            >
              <div className="d-flex flex-column">
                <div className="d-flex align-items-center mb-2">
                  <div
                    className="spinner-border spinner-border-sm text-success me-2"
                    role="status"
                    style={{ width: "1rem", height: "1rem" }}
                  >
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  <span>
                    {Array.from(typingUsers).length === 1
                      ? `${Array.from(typingUsers)[0]} is typing...`
                      : Array.from(typingUsers).length === 2
                        ? `${Array.from(typingUsers).join(' and ')} are typing...`
                        : `${Array.from(typingUsers).slice(0, -1).join(', ')} and ${Array.from(typingUsers).slice(-1)} are typing...`
                    }
                  </span>
                </div>

                {/* Enhanced line information display */}
                <div className="mt-1">
                  {Array.from(typingUsers).map(user => {
                    const line = userLines.get(user);
                    const client = clients.find(c => c.username === user);
                    const userColor = client ? client.color : '#007bff';

                    console.log(`Typing user: ${user}, Line: ${line}, UserLines:`, Array.from(userLines.entries()));

                    return (
                      <div
                        key={user}
                        className="d-flex align-items-center mb-1"
                        style={{ fontSize: "0.8rem" }}
                      >
                        <div
                          className="rounded-circle me-2"
                          style={{
                            width: "8px",
                            height: "8px",
                            backgroundColor: userColor,
                            flexShrink: 0
                          }}
                        />
                        <span className="text-light me-2">{user}</span>
                        {line ? (
                          <span className="text-warning">
                            📍 Line {line}
                          </span>
                        ) : (
                          <span className="text-muted">
                            📝 editing...
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compiler toggle button */}
      <button
        className="btn btn-primary position-fixed bottom-0 end-0 m-3"
        onClick={toggleCompileWindow}
        style={{ zIndex: 1050 }}
      >
        {isCompileWindowOpen ? "Close Compiler" : "Open Compiler"}
      </button>

      {/* Compiler Output Section */}
      <div
        className={`bg-dark text-light p-3 ${isCompileWindowOpen ? "d-block" : "d-none"}`}
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: isCompileWindowOpen ? "30vh" : "0",
          transition: "height 0.3s ease-in-out",
          overflowY: "auto",
          zIndex: 1040,
        }}
      >
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h5 className="m-0">Compiler Output ({selectedLanguage})</h5>
          <div>
            <button className="btn btn-success me-2" onClick={runCode} disabled={isCompiling}>
              {isCompiling ? "Compiling..." : "Run Code"}
            </button>
            <button className="btn btn-secondary" onClick={toggleCompileWindow}>
              Close
            </button>
          </div>
        </div>

        <div className="bg-black text-light p-3 rounded" style={{ minHeight: "10vh", whiteSpace: "pre-wrap" }}>
          {output || "Output will appear here after compilation"}
        </div>
      </div>
    </div>
  );
}

export default EditorPage;
