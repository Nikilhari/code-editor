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

function Editor({ socketRef, roomId, onCodeChange, username, clients, setTypingUsers, setUserLines, markedLines, onActivityLog, selectedLanguage }) {
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

  // AI Suggestions state
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestionsPosition, setSuggestionsPosition] = useState({ top: 0, left: 0 });

  // Add refs for debouncing activity logging
  const activityLogTimeoutRef = useRef(null);
  const pendingChangesRef = useRef({
    hasChanges: false,
    lastChangeTime: 0,
    changedLines: new Set(),
    changeDetails: []
  });

  useEffect(() => {
    const init = async () => {
      // Initialize pending changes ref properly
      pendingChangesRef.current = {
        hasChanges: false,
        lastChangeTime: 0,
        changedLines: new Set(),
        changeDetails: []
      };

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

          // Handle debounced activity logging with line tracking
          if (onActivityLog && changes.text && changes.text.length > 0) {
            // Ensure changedLines Set exists
            if (!pendingChangesRef.current.changedLines) {
              pendingChangesRef.current.changedLines = new Set();
            }

            // Track which lines were changed
            const fromLine = changes.from.line + 1; // Convert to 1-based
            const toLine = changes.to.line + 1;

            // Add changed lines to the set
            for (let line = fromLine; line <= toLine; line++) {
              pendingChangesRef.current.changedLines.add(line);
            }

            // Store change details for better logging
            const changeText = changes.text.join('\n');
            const isMultiLine = changes.text.length > 1;
            const isRemoval = changes.removed && changes.removed.length > 0;

            // Mark that changes are pending
            pendingChangesRef.current.hasChanges = true;
            pendingChangesRef.current.lastChangeTime = Date.now();

            // Clear existing timeout
            if (activityLogTimeoutRef.current) {
              clearTimeout(activityLogTimeoutRef.current);
            }

            // Set debounced timeout for activity logging (2 seconds after last change)
            activityLogTimeoutRef.current = setTimeout(() => {
              if (pendingChangesRef.current.hasChanges && pendingChangesRef.current.changedLines) {
                const changedLinesArray = Array.from(pendingChangesRef.current.changedLines).sort((a, b) => a - b);
                let logMessage = '';

                if (changedLinesArray.length === 1) {
                  logMessage = `made changes on line ${changedLinesArray[0]}`;
                } else if (changedLinesArray.length <= 5) {
                  logMessage = `made changes on lines ${changedLinesArray.join(', ')}`;
                } else {
                  const firstLine = changedLinesArray[0];
                  const lastLine = changedLinesArray[changedLinesArray.length - 1];
                  logMessage = `made changes on ${changedLinesArray.length} lines (${firstLine}-${lastLine})`;
                }

                onActivityLog('code_changed', username, logMessage);

                // Reset pending changes
                pendingChangesRef.current.hasChanges = false;
                pendingChangesRef.current.changedLines = new Set();
                pendingChangesRef.current.changeDetails = [];
              }
            }, 2000);
          }

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

      // Add right-click context menu for line marking and keyboard shortcuts
      const editorElement = editorRef.current.getWrapperElement();

      // Add keyboard shortcut for AI suggestions (Ctrl+Space)
      editorElement.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.code === 'Space') {
          e.preventDefault();
          requestAISuggestions();
        }
        // Close suggestions on Escape
        if (e.key === 'Escape' && showAISuggestions) {
          setShowAISuggestions(false);
          setAiSuggestions([]);
        }
      });

      // Add right-click context menu for line marking
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

  // Handle AI suggestions request
  const requestAISuggestions = async () => {
    if (!editorRef.current) return;

    const code = editorRef.current.getValue();
    const cursor = editorRef.current.getCursor();
    const language = selectedLanguage || 'javascript';

    // Get cursor position on screen for positioning suggestions panel
    const coords = editorRef.current.cursorCoords(cursor, 'local');
    setSuggestionsPosition({ top: coords.bottom + 5, left: coords.left });

    setIsLoadingSuggestions(true);
    setShowAISuggestions(true);

    try {
      // const response = await fetch('http://localhost:5000/ai-suggestions', {
      const response = await fetch('https://code-editor-fe83.onrender.com/ai-suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          language,
          cursorPosition: cursor,
          context: `Code editing in ${language}`
        })
      });

      const data = await response.json();
      setAiSuggestions(data.suggestions || []);

      // Log AI suggestion request
      if (onActivityLog) {
        onActivityLog('ai_suggestion_requested', username, `requested AI suggestions for ${language} code`);
      }

    } catch (error) {
      console.error('Failed to get AI suggestions:', error);
      setAiSuggestions([{
        title: 'Error loading suggestions',
        description: 'Please try again',
        code: '// Error occurred',
        type: 'error',
        confidence: 0
      }]);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  // Apply AI suggestion
  const applyAISuggestion = (suggestion) => {
    if (!editorRef.current) return;

    try {
      const cursor = editorRef.current.getCursor();
      const currentLine = editorRef.current.getLine(cursor.line);

      // Different handling based on suggestion type
      switch (suggestion.type) {
        case 'completion':
          // For completion, insert at cursor position
          editorRef.current.replaceRange(suggestion.code, cursor);
          break;

        case 'improvement':
        case 'fix':
        case 'optimization':
          // For improvements/fixes, try to replace the current line or insert after
          if (currentLine.trim() === '') {
            // If current line is empty, just insert
            editorRef.current.replaceRange(suggestion.code, cursor);
          } else {
            // Insert on next line
            const nextLinePos = { line: cursor.line + 1, ch: 0 };
            editorRef.current.replaceRange('\n' + suggestion.code, nextLinePos);
          }
          break;

        default:
          // Default behavior - insert at cursor with proper spacing
          let codeToInsert = suggestion.code;

          // Add proper spacing if needed
          if (cursor.ch > 0 && currentLine.charAt(cursor.ch - 1) !== ' ') {
            codeToInsert = ' ' + codeToInsert;
          }

          editorRef.current.replaceRange(codeToInsert, cursor);
          break;
      }

      // Focus the editor and trigger change event
      editorRef.current.focus();

      // Trigger the code change event
      const updatedCode = editorRef.current.getValue();
      onCodeChange(updatedCode);

      // Emit code change to other users
      if (socketRef.current) {
        socketRef.current.emit(ACTIONS.CODE_CHANGE, {
          roomId,
          code: updatedCode,
        });
      }

    } catch (error) {
      console.error('Error applying AI suggestion:', error);
    }

    // Log AI suggestion application
    if (onActivityLog) {
      onActivityLog('ai_suggestion_applied', username, `applied AI suggestion: "${suggestion.title}"`);
    }

    setShowAISuggestions(false);
    setAiSuggestions([]);
  };
  const handleMarkLine = () => {
    if (markingLine !== null && socketRef.current) {
      socketRef.current.emit(ACTIONS.MARK_LINE, {
        roomId,
        lineNumber: markingLine,
        username,
        comment: markComment.trim()
      });

      // Log marking activity
      if (onActivityLog) {
        const details = `marked line ${markingLine + 1}${markComment.trim() ? ': "' + markComment.trim() + '"' : ''}`;
        onActivityLog('line_marked', username, details);
      }

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

      // Log unmarking activity
      if (onActivityLog) {
        const mark = Array.from(markedLines.values()).find(m =>
          m.id === markId || markedLines.has(markId)
        );
        if (mark) {
          const details = mark.username === username
            ? `removed their mark from line ${mark.lineNumber + 1}`
            : `removed ${mark.username}'s mark from line ${mark.lineNumber + 1}`;
          onActivityLog('line_unmarked', username, details);
        }
      }
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
      if (activityLogTimeoutRef.current) {
        clearTimeout(activityLogTimeoutRef.current);
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

      {/* AI Suggestions Panel */}
      {showAISuggestions && (
        <div
          className="position-absolute bg-dark text-light rounded shadow-lg border border-info"
          style={{
            top: suggestionsPosition.top,
            left: suggestionsPosition.left,
            zIndex: 2001,
            minWidth: "400px",
            maxWidth: "600px",
            maxHeight: "400px",
            overflowY: "auto"
          }}
        >
          <div className="p-3">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="m-0 text-info">
                🤖 AI Code Suggestions
              </h6>
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={() => {
                  setShowAISuggestions(false);
                  setAiSuggestions([]);
                }}
              >
                ×
              </button>
            </div>

            {isLoadingSuggestions ? (
              <div className="text-center py-4">
                <div className="spinner-border spinner-border-sm text-info me-2" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                <span className="text-muted">Getting AI suggestions...</span>
              </div>
            ) : aiSuggestions.length > 0 ? (
              <div>
                <small className="text-muted mb-3 d-block">
                  Click on a suggestion to apply it, or press Escape to close
                </small>
                {aiSuggestions.map((suggestion, index) => {
                  let badgeColor = 'secondary';
                  let icon = '💡';

                  switch (suggestion.type) {
                    case 'completion':
                      badgeColor = 'primary';
                      icon = '✨';
                      break;
                    case 'improvement':
                      badgeColor = 'success';
                      icon = '🔧';
                      break;
                    case 'fix':
                      badgeColor = 'warning';
                      icon = '🐛';
                      break;
                    case 'optimization':
                      badgeColor = 'info';
                      icon = '⚡';
                      break;
                    case 'error':
                      badgeColor = 'danger';
                      icon = '❌';
                      break;
                    default:
                      badgeColor = 'secondary';
                      icon = '💡';
                  }

                  return (
                    <div
                      key={index}
                      className="mb-3 p-3 rounded suggestion-item"
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.borderColor = '#17a2b8';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                      }}
                    >
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <div className="d-flex align-items-center">
                          <span className="me-2">{icon}</span>
                          <strong className="text-info">{suggestion.title}</strong>
                        </div>
                        <div className="d-flex align-items-center">
                          <span className={`badge bg-${badgeColor} me-2`}>
                            {suggestion.type}
                          </span>
                          {suggestion.confidence && (
                            <small className="text-muted">
                              {Math.round(suggestion.confidence * 100)}%
                            </small>
                          )}
                        </div>
                      </div>

                      <p className="text-light mb-2" style={{ fontSize: '0.85rem' }}>
                        {suggestion.description}
                      </p>

                      <div className="bg-black p-2 rounded" style={{ fontSize: '0.75rem' }}>
                        <pre className="text-success m-0" style={{ whiteSpace: 'pre-wrap' }}>
                          {suggestion.code}
                        </pre>
                      </div>

                      <div className="mt-2 d-flex gap-2">

                        <button
                          className="btn btn-outline-info btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(suggestion.code);
                            e.target.innerText = 'Copied!';
                            setTimeout(() => {
                              e.target.innerText = '📋 Copy';
                            }, 1000);
                          }}
                        >
                          📋 Copy
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-4 text-muted">
                <span>No suggestions available</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Suggestions Trigger Button */}
      <button
        className="btn btn-info btn-sm position-absolute"
        style={{
          top: "10px",
          right: "10px",
          zIndex: 1000
        }}
        onClick={requestAISuggestions}
        disabled={isLoadingSuggestions}
        title="Get AI Code Suggestions (Ctrl+Space)"
      >
        {isLoadingSuggestions ? (
          <>
            <div className="spinner-border spinner-border-sm me-1" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            AI...
          </>
        ) : (
          <>🤖 AI Suggestions</>
        )}
      </button>

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