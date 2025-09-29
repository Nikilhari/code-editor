import React, { useState } from "react";
import { v4 as uuid } from "uuid";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

function Home() {
  const [roomId, setRoomId] = useState("");
  const [username, setUsername] = useState("");

  const navigate = useNavigate();

  const generateRoomId = (e) => {
    e.preventDefault();
    const Id = uuid();
    setRoomId(Id);
    toast.success("Room Id is generated");
  };

  const joinRoom = () => {
    if (!roomId || !username) {
      toast.error("Both fields are required!");
      return;
    }

    // Redirect to the editor page
    navigate(`/editor/${roomId}`, {
      state: {
        username,
      },
    });
    toast.success("Room is created");
  };

  // Join the room when Enter is pressed
  const handleInputEnter = (e) => {
    if (e.code === "Enter") {
      joinRoom();
    }
  };

  return (
    <div className="container-fluid">
      <div className="row justify-content-center align-items-center min-vh-100" style={{background:"#0f1114"}}>
        <div className="col-12 col-md-5"> {/* Reduced width for better centering */}
          <div className="card shadow-lg p-2 bg-secondary rounded">
            <div className="card-body text-center rounded " style={{background:"#1d1819"}} >
              {/* Enlarged Logo */}
              <img
                src="/images/codecast.png"
                alt="Logo"
                className="img-fluid mx-auto d-block mb-3"
                style={{ maxWidth: "230px" }} // Increased logo size
              />
              <h4 className="card-title text-light mb-4">Enter the ROOM ID</h4>

              {/* Reduced input box width and added spacing */}
              <div className="form-group">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="form-control mb-3 mx-auto"
                  style={{ maxWidth: "80%" }} // Reduced input width
                  placeholder="ROOM ID"
                  onKeyUp={handleInputEnter}
                />
              </div>
              <div className="form-group">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="form-control mb-4 mx-auto"
                  style={{ maxWidth: "80%" }} // Reduced input width
                  placeholder="USERNAME"
                  onKeyUp={handleInputEnter}
                />
              </div>

              {/* Increased gap between text box and button */}
              <button
                onClick={joinRoom}
                className="btn btn-lg btn-block mt-2"
                style={{ padding: "8px 18px", backgroundColor: "#157724", borderColor: "#0b3d20", color: "white"  }} // Enhanced button size
              >
                JOIN
              </button>

              {/* Styled "New Room" text */}
              <p className="mt-4 text-light">
                Don't have a room ID? Create{" "}
                <span
                  onClick={generateRoomId}
                  className="fw-bold"
                  style={{ cursor: "pointer", textDecoration: "underline", color:"#158224" }}
                >
                  New Room
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;
