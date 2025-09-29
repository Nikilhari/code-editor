// import React from 'react';
// import Avatar from '@mui/material/Avatar';

// function Client({ username }) {
//   return (
//     <div className="d-flex align-items-center mb-3">
//       <Avatar alt={username} src="" sx={{ width: 50, height: 50, borderRadius: "14px" }} />
//       <span className='mx-2'>{username || "User"}</span>
//     </div>
//   );
// }

// export default Client;

import React from "react";
import "../components/collaborative.css";

const Client = ({ username, color, isActive = false, isTyping = false, currentLine = null }) => {
  return (
    <div className={`d-flex align-items-center mb-2 ${isActive ? 'user-active' : ''}`}>
      <div className="rounded-circle d-flex align-items-center justify-content-center position-relative"
        style={{ width: "35px", height: "35px", backgroundColor: color, color: "#fff", fontWeight: "bold" }}>
        {username.charAt(0).toUpperCase()}
        {isActive && (
          <div
            className="user-indicator position-absolute"
            style={{
              bottom: "-2px",
              right: "-2px",
              backgroundColor: "#00ff00",
              border: "2px solid #333",
              width: "12px",
              height: "12px"
            }}
          />
        )}
      </div>
      <div className="ms-2 d-flex flex-column flex-grow-1">
        <div className="d-flex align-items-center">
          <span>{username}</span>
          {isTyping && (
            <div className="ms-2 d-flex align-items-center">
              <div className="typing-dots">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
              <small className="text-muted ms-1">typing...</small>
            </div>
          )}
        </div>
        {currentLine && (
          <small className="text-muted mt-1" style={{ fontSize: "0.75rem" }}>
            📍 Line {currentLine}
          </small>
        )}
      </div>
    </div>
  );
};

export default Client;
