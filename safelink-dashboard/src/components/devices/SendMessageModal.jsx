// src/components/devices/SendMessageModal.jsx

import React, { useState, useEffect, useRef } from "react";
import { sendDirectMessage } from "../../api/peerApi";
import "./SendMessageModal.css";

export default function SendMessageModal({ peer, onClose, onSuccess }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState(null);
  const recognitionRef = useRef(null);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const [senderId, setSenderId] = useState("");

  useEffect(() => {
    // Generate or get sender ID
    let storedSenderId = localStorage.getItem("safelink_sender_id");
    if (!storedSenderId) {
      storedSenderId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      localStorage.setItem("safelink_sender_id", storedSenderId);
    }
    setSenderId(storedSenderId);

    // Initialize speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError(null);
      };

      recognition.onresult = (event) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + " ";
          } else {
            interimTranscript += transcript;
          }
        }

        setMessage((prev) => {
          let baseMessage = prev.replace(/\[Listening\.\.\.\]/g, "").trim();
          if (finalTranscript) {
            baseMessage += (baseMessage ? " " : "") + finalTranscript.trim();
          }
          if (interimTranscript) {
            baseMessage += (baseMessage ? " " : "") + interimTranscript + " [Listening...]";
          }
          return baseMessage;
        });
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
        if (event.error === "no-speech") {
          setSpeechError("No speech detected. Please try again.");
        } else if (event.error === "audio-capture") {
          setSpeechError("No microphone found.");
        } else if (event.error === "not-allowed") {
          setSpeechError("Microphone permission denied.");
        } else {
          setSpeechError("Speech recognition error.");
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        setMessage((prev) => prev.replace(/\[Listening\.\.\.\]/g, "").trim());
      };

      recognitionRef.current = recognition;
    } else {
      setIsSpeechSupported(false);
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      setSpeechError("Speech recognition is not supported.");
      return;
    }

    if (isListening) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.error("Error stopping recognition:", err);
      }
      setIsListening(false);
      setMessage((prev) => prev.replace(/\[Listening\.\.\.\]/g, "").trim());
    } else {
      setSpeechError(null);
      try {
        setMessage((prev) => prev.replace(/\[Listening\.\.\.\]/g, "").trim());
        recognitionRef.current.start();
      } catch (err) {
        console.error("Error starting recognition:", err);
        setIsListening(false);
        setSpeechError("Could not start speech recognition.");
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const cleanMessage = message.replace(/\[Listening\.\.\.\]/g, "").trim();

    if (!cleanMessage) {
      setError("Please enter a message.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await sendDirectMessage({
        content: cleanMessage,
        senderId: senderId,
        recipientId: peer.id,
        type: "direct",
        priority: "normal",
      });

      if (onSuccess) {
        onSuccess();
      }

      onClose();
    } catch (err) {
      console.error("Error sending message:", err);
      setError(err.response?.data?.message || "Failed to send message. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sendMessageModalOverlay" onClick={onClose}>
      <div className="sendMessageModal" onClick={(e) => e.stopPropagation()}>
        <button className="sendMessageModal__close" onClick={onClose}>
          ×
        </button>

        <div className="sendMessageModal__header">
          <h2>Send Message</h2>
          <p className="sendMessageModal__subtitle">
            Send a direct message to <strong>{peer.name || peer.id}</strong>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="sendMessageModal__form">
          <div className="formGroup">
            <div className="formLabelRow">
              <label htmlFor="message" className="formLabel">
                Message *
              </label>
              {isSpeechSupported && (
                <button
                  type="button"
                  className={`voiceButton ${isListening ? "voiceButton--active" : ""}`}
                  onClick={toggleListening}
                  disabled={loading}
                  title={isListening ? "Stop recording" : "Start voice input"}
                >
                  {isListening ? (
                    <>
                      <span className="voiceButton__icon voiceButton__icon--stop">⏹️</span>
                      <span className="voiceButton__text">Stop</span>
                    </>
                  ) : (
                    <>
                      <span className="voiceButton__icon">🎤</span>
                      <span className="voiceButton__text">Voice</span>
                    </>
                  )}
                </button>
              )}
            </div>
            <textarea
              id="message"
              className={`formTextarea ${isListening ? "formTextarea--listening" : ""}`}
              placeholder="Type your message here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              required
              disabled={loading || isListening}
            />
            {isListening && (
              <div className="listeningIndicator">
                <span className="listeningIndicator__dot"></span>
                Listening... Speak clearly into your microphone.
              </div>
            )}
            {speechError && (
              <div className="speechError">
                {speechError}
              </div>
            )}
            <div className="formHint">
              {isSpeechSupported
                ? "Type your message or use voice input. Messages are sent directly to this device."
                : "Type your message. Messages are sent directly to this device."}
            </div>
          </div>

          {error && (
            <div className="formError">
              {error}
            </div>
          )}

          <div className="sendMessageModal__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading || !message.trim()}
            >
              {loading ? "Sending..." : "Send Message"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

