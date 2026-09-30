// src/components/firstaid/ConversationalAIDialog.jsx

import React, { useState, useEffect, useRef, useCallback } from "react";
import "./ConversationalAIDialog.css";

export default function ConversationalAIDialog({ 
  instructions, 
  description, 
  selectedLanguage,
  onClose 
}) {
  const [conversation, setConversation] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [userResponse, setUserResponse] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const conversationEndRef = useRef(null);
  const speechSynthesisRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (instructions && instructions.steps) {
      // Initialize conversation
      const initialMessage = {
        type: "ai",
        text: getTranslation("welcome_message", selectedLanguage),
        timestamp: new Date(),
      };
      const overviewMessage = {
        type: "ai",
        text: `${instructions.title}. ${instructions.overview}`,
        timestamp: new Date(),
      };
      setConversation([initialMessage, overviewMessage]);
      setCurrentStepIndex(0);
      setWaitingForResponse(false);
      
      // Start with first step after a delay
      const timer = setTimeout(() => {
        if (instructions.steps && instructions.steps.length > 0) {
          const step = instructions.steps[0];
          const stepText = `Step 1 of ${instructions.steps.length}. ${step.title}. ${step.description}`;
          addAIMessage(`Step 1: ${step.title}\n${step.description}`);
          speakText(stepText, selectedLanguage).then(() => {
            setTimeout(() => {
              setWaitingForResponse(true);
              const helpMessage = getTranslation("need_help", selectedLanguage);
              addAIMessage(helpMessage);
              speakText(helpMessage, selectedLanguage);
            }, 500);
          });
        }
      }, 1500);

      return () => {
        clearTimeout(timer);
      };
    }
  }, [instructions, selectedLanguage]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (speechSynthesisRef.current) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors
        }
      }
    };
  }, []);

  useEffect(() => {
    // Initialize speech recognition for user responses
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = selectedLanguage;

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setUserResponse(transcript);
        addUserMessage(transcript);
        setIsListening(false);
        // Handle response
        setTimeout(() => {
          processUserResponse(transcript);
        }, 100);
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors
        }
      }
    };
  }, [selectedLanguage, processUserResponse]);

  useEffect(() => {
    // Scroll to bottom when conversation updates
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation]);

  const getTranslation = (key, lang) => {
    const translations = {
      welcome_message: {
        "en-US": "Hello! I'm here to help you with first aid. Let me guide you through this step by step.",
        "es-ES": "¡Hola! Estoy aquí para ayudarte con primeros auxilios. Déjame guiarte paso a paso.",
        "fr-FR": "Bonjour! Je suis là pour vous aider avec les premiers secours. Laissez-moi vous guider étape par étape.",
        "de-DE": "Hallo! Ich bin hier, um Ihnen bei der Ersten Hilfe zu helfen. Lassen Sie mich Sie Schritt für Schritt führen.",
        "it-IT": "Ciao! Sono qui per aiutarti con il primo soccorso. Lascia che ti guidi passo dopo passo.",
        "pt-BR": "Olá! Estou aqui para ajudá-lo com primeiros socorros. Deixe-me guiá-lo passo a passo.",
        "zh-CN": "你好！我在这里帮助你进行急救。让我逐步指导你。",
        "ja-JP": "こんにちは！応急処置をお手伝いします。段階的に案内させていただきます。",
        "ko-KR": "안녕하세요! 응급 처치를 도와드리겠습니다. 단계별로 안내해드리겠습니다.",
        "ar-SA": "مرحبا! أنا هنا لمساعدتك في الإسعافات الأولية. دعني أرشدك خطوة بخطوة.",
        "hi-IN": "नमस्ते! मैं प्राथमिक चिकित्सा में आपकी मदद के लिए यहाँ हूँ। मुझे आपको कदम से कदम मार्गदर्शन करने दें।",
      },
      step_complete: {
        "en-US": "Great! Let's move to the next step.",
        "es-ES": "¡Excelente! Pasemos al siguiente paso.",
        "fr-FR": "Excellent! Passons à l'étape suivante.",
        "de-DE": "Großartig! Gehen wir zum nächsten Schritt.",
        "it-IT": "Ottimo! Passiamo al passo successivo.",
        "pt-BR": "Ótimo! Vamos para o próximo passo.",
        "zh-CN": "太好了！让我们进入下一步。",
        "ja-JP": "素晴らしい！次のステップに進みましょう。",
        "ko-KR": "훌륭합니다! 다음 단계로 넘어가겠습니다.",
        "ar-SA": "رائع! دعنا ننتقل إلى الخطوة التالية.",
        "hi-IN": "बढ़िया! अगले कदम पर चलते हैं।",
      },
      need_help: {
        "en-US": "Do you need help with this step, or are you ready to continue?",
        "es-ES": "¿Necesitas ayuda con este paso, o estás listo para continuar?",
        "fr-FR": "Avez-vous besoin d'aide pour cette étape, ou êtes-vous prêt à continuer?",
        "de-DE": "Benötigen Sie Hilfe bei diesem Schritt oder sind Sie bereit fortzufahren?",
        "it-IT": "Hai bisogno di aiuto con questo passaggio o sei pronto a continuare?",
        "pt-BR": "Você precisa de ajuda com este passo ou está pronto para continuar?",
        "zh-CN": "您需要这一步的帮助，还是准备继续？",
        "ja-JP": "このステップでサポートが必要ですか、それとも続行する準備ができていますか？",
        "ko-KR": "이 단계에서 도움이 필요하신가요, 아니면 계속 진행할 준비가 되셨나요?",
        "ar-SA": "هل تحتاج إلى مساعدة في هذه الخطوة أم أنك مستعد للمتابعة؟",
        "hi-IN": "क्या आपको इस कदम में मदद चाहिए, या आप जारी रखने के लिए तैयार हैं?",
      },
      yes: {
        "en-US": "Yes",
        "es-ES": "Sí",
        "fr-FR": "Oui",
        "de-DE": "Ja",
        "it-IT": "Sì",
        "pt-BR": "Sim",
        "zh-CN": "是",
        "ja-JP": "はい",
        "ko-KR": "예",
        "ar-SA": "نعم",
        "hi-IN": "हाँ",
      },
      no: {
        "en-US": "No",
        "es-ES": "No",
        "fr-FR": "Non",
        "de-DE": "Nein",
        "it-IT": "No",
        "pt-BR": "Não",
        "zh-CN": "否",
        "ja-JP": "いいえ",
        "ko-KR": "아니오",
        "ar-SA": "لا",
        "hi-IN": "नहीं",
      },
      ready: {
        "en-US": "Ready",
        "es-ES": "Listo",
        "fr-FR": "Prêt",
        "de-DE": "Bereit",
        "it-IT": "Pronto",
        "pt-BR": "Pronto",
        "zh-CN": "准备好了",
        "ja-JP": "準備完了",
        "ko-KR": "준비됨",
        "ar-SA": "جاهز",
        "hi-IN": "तैयार",
      },
      repeat: {
        "en-US": "Repeat",
        "es-ES": "Repetir",
        "fr-FR": "Répéter",
        "de-DE": "Wiederholen",
        "it-IT": "Ripeti",
        "pt-BR": "Repetir",
        "zh-CN": "重复",
        "ja-JP": "繰り返す",
        "ko-KR": "반복",
        "ar-SA": "كرر",
        "hi-IN": "दोहराएं",
      },
    };

    return translations[key]?.[lang] || translations[key]?.["en-US"] || key;
  };

  const speakText = (text, lang = selectedLanguage) => {
    if (!text) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.9; // Slightly slower for clarity
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onstart = () => {
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        resolve();
      };

      utterance.onerror = (error) => {
        console.error("Speech synthesis error:", error);
        setIsSpeaking(false);
        resolve();
      };

      speechSynthesisRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    });
  };


  const repeatCurrentStep = useCallback(async () => {
    if (instructions?.steps && currentStepIndex < instructions.steps.length) {
      const step = instructions.steps[currentStepIndex];
      const detailedText = `${step.title}. ${step.description}`;
      addAIMessage(`Let me repeat: ${step.title}\n${step.description}`);
      await speakText(detailedText, selectedLanguage);
      
      setWaitingForResponse(true);
      const helpMessage = getTranslation("need_help", selectedLanguage);
      addAIMessage(helpMessage);
      await speakText(helpMessage, selectedLanguage);
    }
  }, [instructions, currentStepIndex, selectedLanguage]);

  const speakStep = useCallback(async (stepIndex) => {
    if (!instructions?.steps || stepIndex >= instructions.steps.length) {
      // All steps complete
      const finalMessage = "All steps completed! Remember to seek professional medical help if needed.";
      addAIMessage(finalMessage);
      await speakText(finalMessage, selectedLanguage);
      return;
    }

    const step = instructions.steps[stepIndex];
    const stepNumber = stepIndex + 1;
    const totalSteps = instructions.steps.length;

    // Speak step instruction
    const stepText = `Step ${stepNumber} of ${totalSteps}. ${step.title}. ${step.description}`;
    addAIMessage(`Step ${stepNumber}: ${step.title}\n${step.description}`);
    await speakText(stepText, selectedLanguage);

    // Ask if user needs help or is ready
    setTimeout(() => {
      setWaitingForResponse(true);
      const helpMessage = getTranslation("need_help", selectedLanguage);
      addAIMessage(helpMessage);
      speakText(helpMessage, selectedLanguage);
    }, 500);
  }, [instructions, selectedLanguage]);

  const processUserResponse = useCallback((response) => {
    if (!waitingForResponse) return;

    const lowerResponse = response.toLowerCase();
    const yesWords = ["yes", "sí", "oui", "ja", "sì", "sim", "是", "はい", "예", "نعم", "हाँ", "ready", "listo", "prêt", "bereit", "pronto", "准备好了", "準備完了", "준비됨", "جاهز", "तैयार"];
    const noWords = ["no", "nein", "non", "不", "いいえ", "아니오", "لا", "नहीं", "help", "ayuda", "aide", "hilfe", "aiuto", "ajuda", "帮助", "ヘルプ", "도움", "مساعدة", "मदद"];

    const isYes = yesWords.some(word => lowerResponse.includes(word));
    const isNo = noWords.some(word => lowerResponse.includes(word));

    if (isYes) {
      // User is ready, move to next step
      setWaitingForResponse(false);
      setCurrentStepIndex(prev => {
        const next = prev + 1;
        setTimeout(() => speakStep(next), 500);
        return next;
      });
    } else if (isNo) {
      // User needs help, repeat current step with more detail
      setWaitingForResponse(false);
      repeatCurrentStep();
    } else {
      // Unclear response, ask again
      const clarification = getTranslation("need_help", selectedLanguage);
      addAIMessage(clarification);
      speakText(clarification, selectedLanguage);
    }
  }, [waitingForResponse, selectedLanguage, speakStep, repeatCurrentStep]);

  const handleUserResponse = (response) => {
    addUserMessage(response);
    processUserResponse(response);
  };


  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      setIsListening(true);
      recognitionRef.current.start();
    }
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const addAIMessage = (text) => {
    setConversation(prev => [...prev, {
      type: "ai",
      text,
      timestamp: new Date(),
    }]);
  };

  const addUserMessage = (text) => {
    setConversation(prev => [...prev, {
      type: "user",
      text,
      timestamp: new Date(),
    }]);
  };

  const handleQuickResponse = (response) => {
    setUserResponse(response);
    handleUserResponse(response);
  };

  if (!instructions) {
    return null;
  }

  return (
    <div className="conversationalDialog">
      <div className="conversationalDialog__header">
        <h3>🗣️ Conversational First Aid Guide</h3>
        <button className="conversationalDialog__close" onClick={onClose}>×</button>
      </div>

      <div className="conversationalDialog__messages">
        {conversation.map((msg, index) => (
          <div
            key={index}
            className={`conversationalDialog__message conversationalDialog__message--${msg.type}`}
          >
            <div className="conversationalDialog__messageContent">
              {msg.type === "ai" && <span className="conversationalDialog__avatar">🤖</span>}
              <div className="conversationalDialog__text">
                {msg.text.split("\n").map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
            <div className="conversationalDialog__timestamp">
              {msg.timestamp.toLocaleTimeString()}
            </div>
          </div>
        ))}
        <div ref={conversationEndRef} />
      </div>

      <div className="conversationalDialog__controls">
        {isSpeaking && (
          <button
            className="conversationalDialog__button conversationalDialog__button--stop"
            onClick={stopSpeaking}
          >
            ⏹️ Stop Speaking
          </button>
        )}

        {waitingForResponse && (
          <>
            <button
              className="conversationalDialog__button conversationalDialog__button--listen"
              onClick={startListening}
              disabled={isListening}
            >
              {isListening ? "🎤 Listening..." : "🎤 Speak Response"}
            </button>
            <div className="conversationalDialog__quickResponses">
              <button
                className="conversationalDialog__quickButton"
                onClick={() => handleQuickResponse(getTranslation("yes", selectedLanguage))}
              >
                ✓ {getTranslation("yes", selectedLanguage)}
              </button>
              <button
                className="conversationalDialog__quickButton"
                onClick={() => handleQuickResponse(getTranslation("no", selectedLanguage))}
              >
                ✗ {getTranslation("no", selectedLanguage)}
              </button>
              <button
                className="conversationalDialog__quickButton"
                onClick={() => handleQuickResponse(getTranslation("ready", selectedLanguage))}
              >
                ✓ {getTranslation("ready", selectedLanguage)}
              </button>
            </div>
          </>
        )}

        {!waitingForResponse && !isSpeaking && currentStepIndex < instructions.steps.length && (
          <button
            className="conversationalDialog__button conversationalDialog__button--repeat"
            onClick={() => repeatCurrentStep()}
          >
            🔄 {getTranslation("repeat", selectedLanguage)}
          </button>
        )}
      </div>

      {userResponse && (
        <div className="conversationalDialog__userInput">
          You said: "{userResponse}"
        </div>
      )}
    </div>
  );
}

