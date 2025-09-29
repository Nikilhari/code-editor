import React, { useEffect, useRef, useState } from "react";
import "codemirror/mode/javascript/javascript";
import "codemirror/mode/python/python";
import "codemirror/mode/clike/clike";
import "codemirror/theme/dracula.css";
import "codemirror/addon/edit/closetag";
import "codemirror/addon/edit/closebrackets";
import "codemirror/addon/selection/active-line";
import "codemirror/lib/codemirror.css";
import "../components/collaborative.css";
import CodeMirror from "codemirror";
import { ACTIONS } from "../Actions";

function Editor({ socketRef, roomId, onCodeChange, username, clients, setTypingUsers, setUserLines, markedLines }) {
  const editorRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const activityTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);
  const lineHighlightsRef = useRef({});
  const cursorTimeoutRef = useRef(null);
  const markedLineWidgets = useRef({});
  const [showMarkDialog, setShowMarkDialog] = useState(false);
  const [markingLine, setMarkingLine] = useState(null);
  const [markComment, setMarkComment] = useState("");

  useEffect(() => {
    const init = async () => {
      const editor = CodeMirror.fromTextArea(
        document.getElementById("realtimeEditor"),
        {
          mode: { name: "javascript", json: true },
          theme: "dracula",
          autoCloseTags: true,
          autoCloseBrackets: true,
          lineNumbers: true,
          styleActiveLine: true,
        }
      );
      editorRef.current = editor;

      editor.setSize(null, "100%");

      // Handle code changes with typing detection
      editorRef.current.on("change", (instance, changes) => {
        const { origin } = changes;
        const code = instance.getValue();
        onCodeChange(code);

        if (origin !== "setValue") {
          // Emit code change
          socketRef.current.emit(ACTIONS.CODE_CHANGE, {
            roomId,
            code,
          });

          // Handle typing indicators
          handleTypingActivity();
        }
      });

      // Handle user activity (focus, cursor movement, etc.)
      const handleUserActivity = () => {
        if (socketRef.current) {
          socketRef.current.emit(ACTIONS.USER_ACTIVITY, {
            roomId,
            username,
          });
        }
      };

      // Handle cursor position changes with debouncing for line highlighting
      const handleCursorActivity = (instance) => {
        const cursor = instance.getCursor();
        const lineNumber = cursor.line;

        // Clear existing cursor timeout
        if (cursorTimeoutRef.current) {
          clearTimeout(cursorTimeoutRef.current);
        }

        // Debounce cursor position updates
        cursorTimeoutRef.current = setTimeout(() => {
          if (socketRef.current) {
            socketRef.current.emit(ACTIONS.CURSOR_POSITION, {
              roomId,
              position: cursor,
              username,
            });

            socketRef.current.emit(ACTIONS.LINE_HIGHLIGHT, {
              roomId,
              lineNumber,
              username,
            });
          }
        }, 300); // Debounce for 300ms

        handleUserActivity();
      };

      // Add activity listeners
      editorRef.current.on("focus", handleUserActivity);
      editorRef.current.on("cursorActivity", handleCursorActivity);

      // Add right-click context menu for line marking
      const editorElement = editorRef.current.getWrapperElement();
      editorElement.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        // Use lineAtHeight to get the line number from the Y coordinate
        const editorRect = editorElement.getBoundingClientRect();
        const relativeY = e.clientY - editorRect.top;
        const lineNumber = editorRef.current.lineAtHeight(relativeY, "local");

        console.log("Click Y:", e.clientY, "Editor Top:", editorRect.top, "Relative Y:", relativeY, "Line:", lineNumber);

        setMarkingLine(lineNumber);
        setShowMarkDialog(true);
      });
    };

    init();
  }, []);

  // Handle typing activity with debouncing
  const handleTypingActivity = () => {
    if (!isTypingRef.current && socketRef.current) {
      // User started typing
      isTypingRef.current = true;
      socketRef.current.emit(ACTIONS.TYPING_START, {
        roomId,
        username,
      });
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout to detect when user stops typing
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current && socketRef.current) {
        isTypingRef.current = false;
        socketRef.current.emit(ACTIONS.TYPING_STOP, {
          roomId,
          username,
        });
      }
    }, 2000); // User stops typing after 2 seconds of inactivity
  };

  // Handle line marking
  const handleMarkLine = () => {
    if (markingLine !== null && socketRef.current) {
      socketRef.current.emit(ACTIONS.MARK_LINE, {
        roomId,
        lineNumber: markingLine,
        username,
        comment: markComment.trim()
      });

      setShowMarkDialog(false);
      setMarkComment("");
      setMarkingLine(null);
    }
  };

  // Display marked lines in editor
  const displayMarkedLines = () => {
    if (!editorRef.current || !markedLines) return;

    // Clear existing marked line widgets
    Object.values(markedLineWidgets.current).forEach(widget => {
      if (widget.clear) widget.clear();
    });
    markedLineWidgets.current = {};

    // Add new marked line widgets
    markedLines.forEach((mark, markId) => {
      const client = clients.find(c => c.username === mark.username);
      const userColor = client ? client.color : '#ffd700';

      // Check if current user can delete this mark - anyone can delete any mark
      const canDelete = true;

      // Add line class for background highlighting
      const lineHandle = editorRef.current.addLineClass(mark.lineNumber, "background", "marked-line");

      // Create mark widget
      const markElement = document.createElement('div');
      markElement.className = 'line-mark-widget';
      markElement.innerHTML = `
        <div class="mark-indicator" style="background-color: ${userColor}; opacity: 0.9;">
          <div class="mark-content">
            <span class="mark-user">📌 ${mark.username}</span>
            ${mark.comment ? `<span class="mark-comment">: ${mark.comment}</span>` : ''}
            <small class="mark-time">(${new Date(mark.timestamp).toLocaleTimeString()})</small>
          </div>
          ${canDelete ? `<button class="mark-remove-btn" onclick="window.removeMark_${markId.replace(/[^a-zA-Z0-9]/g, '_')}" title="Remove mark">&times;</button>` : ''}
        </div>
      `;

      // Add global remove function
      window[`removeMark_${markId.replace(/[^a-zA-Z0-9]/g, '_')}`] = () => {
        if (canDelete) {
          handleUnmarkLine(markId);
        }
      };

      // Add widget below the line
      const widget = editorRef.current.addLineWidget(mark.lineNumber, markElement, {
        coverGutter: false,
        noHScroll: true
      });

      markedLineWidgets.current[markId] = {
        clear: () => {
          editorRef.current.removeLineClass(mark.lineNumber, "background", "marked-line");
          widget.clear();
          delete window[`removeMark_${markId.replace(/[^a-zA-Z0-9]/g, '_')}`];
        }
      };
    });
  };

  // Effect to update marked lines when they change
  useEffect(() => {
    displayMarkedLines();
  }, [markedLines, clients]);

  // Handle line unmarking
  const handleUnmarkLine = (markId) => {
    if (socketRef.current) {
      socketRef.current.emit(ACTIONS.UNMARK_LINE, {
        roomId,
        markId,
        username
      });
    }
  };

  // Function to highlight a line for a specific user
  const highlightUserLine = (lineNumber, username, socketId) => {
    if (!editorRef.current || socketId === socketRef.current?.id) return;

    // Remove existing highlight for this user
    if (lineHighlightsRef.current[socketId]) {
      lineHighlightsRef.current[socketId].clear();
    }

    // Get user color
    const client = clients.find(c => c.socketId === socketId);
    const color = client ? client.color : generateUserColor(username);

    // Add new line highlight
    const lineHandle = editorRef.current.addLineClass(lineNumber, "background", "user-line-highlight");
    const mark = editorRef.current.markText(
      { line: lineNumber, ch: 0 },
      { line: lineNumber, ch: editorRef.current.getLine(lineNumber)?.length || 0 },
      {
        className: "user-line-content",
        css: `background-color: ${color}20; border-left: 3px solid ${color}; padding-left: 4px;`,
        title: `${username} is working on this line`,
      }
    );

    // Store reference for cleanup
    lineHighlightsRef.current[socketId] = {
      clear: () => {
        editorRef.current.removeLineClass(lineNumber, "background", "user-line-highlight");
        if (mark) mark.clear();
      }
    };

    // Auto-remove highlight after 10 seconds of inactivity
    setTimeout(() => {
      if (lineHighlightsRef.current[socketId]) {
        lineHighlightsRef.current[socketId].clear();
        delete lineHighlightsRef.current[socketId];
      }
    }, 10000);
  };

  // Generate user color based on username
  const generateUserColor = (username) => {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${hash % 360}, 70%, 50%)`;
  };

  useEffect(() => {
    if (socketRef.current) {
      // Listen for code changes
      socketRef.current.on(ACTIONS.CODE_CHANGE, ({ code, socketId }) => {
        if (code !== null && socketId !== socketRef.current.id) {
          editorRef.current.setValue(code);
        }
      });

      // Listen for typing indicators and pass to parent
      socketRef.current.on(ACTIONS.TYPING_START, ({ username: typingUsername, socketId }) => {
        if (socketId !== socketRef.current.id) {
          console.log(`${typingUsername} started typing`);
          setTypingUsers(prev => {
            const newSet = new Set(prev);
            newSet.add(typingUsername);
            return newSet;
          });
        }
      });

      socketRef.current.on(ACTIONS.TYPING_STOP, ({ username: typingUsername, socketId }) => {
        if (socketId !== socketRef.current.id) {
          console.log(`${typingUsername} stopped typing`);
          setTypingUsers(prev => {
            const newSet = new Set(prev);
            newSet.delete(typingUsername);
            return newSet;
          });
        }
      });

      // Listen for user activity
      socketRef.current.on(ACTIONS.USER_ACTIVITY, ({ username: activeUsername, socketId, timestamp }) => {
        if (socketId !== socketRef.current.id) {
          // Update activity status for other users
          console.log(`${activeUsername} is active at ${new Date(timestamp).toLocaleTimeString()}`);
        }
      });

      // Listen for cursor position updates
      socketRef.current.on(ACTIONS.CURSOR_POSITION, ({ position, username: remoteUsername, socketId }) => {
        if (socketId !== socketRef.current.id) {
          console.log(`${remoteUsername} cursor at line ${position.line + 1}, column ${position.ch + 1}`);
        }
      });

      // Listen for line highlighting
      socketRef.current.on(ACTIONS.LINE_HIGHLIGHT, ({ lineNumber, username: remoteUsername, socketId }) => {
        if (socketId !== socketRef.current.id) {
          console.log(`${remoteUsername} is on line ${lineNumber + 1}`);
          highlightUserLine(lineNumber, remoteUsername, socketId);

          // Update parent component's line tracking
          if (setUserLines) {
            setUserLines(prev => {
              const newMap = new Map(prev);
              newMap.set(remoteUsername, lineNumber + 1);
              return newMap;
            });
          }
        }
      });
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.off(ACTIONS.CODE_CHANGE);
        socketRef.current.off(ACTIONS.TYPING_START);
        socketRef.current.off(ACTIONS.TYPING_STOP);
        socketRef.current.off(ACTIONS.USER_ACTIVITY);
        socketRef.current.off(ACTIONS.CURSOR_POSITION);
        socketRef.current.off(ACTIONS.LINE_HIGHLIGHT);
      }

      // Clear timeouts
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
      if (cursorTimeoutRef.current) {
        clearTimeout(cursorTimeoutRef.current);
      }

      // Clear all line highlights
      Object.keys(lineHighlightsRef.current).forEach(socketId => {
        if (lineHighlightsRef.current[socketId]) {
          lineHighlightsRef.current[socketId].clear();
        }
      });
    };
  }, [socketRef.current, setTypingUsers, setUserLines]);

  return (
    <div style={{ height: "600px", position: "relative" }}>
      <textarea id="realtimeEditor"></textarea>

      {/* Line Marking Dialog */}
      {showMarkDialog && (
        <div
          className="position-fixed bg-dark text-light p-3 rounded shadow"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 2000,
            minWidth: "300px"
          }}
        >
          <h6 className="mb-3">Mark Line {markingLine + 1}</h6>
          <div className="mb-3">
            <label htmlFor="markComment" className="form-label">Comment (optional):</label>
            <input
              id="markComment"
              type="text"
              className="form-control"
              value={markComment}
              onChange={(e) => setMarkComment(e.target.value)}
              placeholder="Add a comment for this line..."
              maxLength={100}
            />
          </div>
          <div className="d-flex gap-2">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleMarkLine}
            >
              Mark Line
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setShowMarkDialog(false);
                setMarkComment("");
                setMarkingLine(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Backdrop for dialog */}
      {showMarkDialog && (
        <div
          className="position-fixed"
          style={{
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 1999
          }}
          onClick={() => {
            setShowMarkDialog(false);
            setMarkComment("");
            setMarkingLine(null);
          }}
        />
      )}
    </div>
  );
}

export default Editor;