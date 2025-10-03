// All the events
const ACTIONS = {
  JOIN: "join",
  JOINED: "joined",
  DISCONNECTED: "disconnected",
  CODE_CHANGE: "conde-change",
  SYNC_CODE: "sync-code",
  LEAVE: "leave",
  TYPING_START: "typing-start",
  TYPING_STOP: "typing-stop",
  USER_ACTIVITY: "user-activity",
  CURSOR_POSITION: "cursor-position",
  LINE_HIGHLIGHT: "line-highlight",
  MARK_LINE: "mark-line",
  UNMARK_LINE: "unmark-line",
  SYNC_MARKS: "sync-marks",
  ACTIVITY_LOG: "activity-log",
  SYNC_ACTIVITY_LOGS: "sync-activity-logs",
  //  REMOVE_USER: 'remove_user', // Add this
  //USER_REMOVED: 'user_removed', // Add this
};
module.exports = ACTIONS;